import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db, purgeExpired } from "../db";
import { auditLog, items, kv } from "../db/schema";
import { cleanupSessions } from "./auth";
import { sweepRateLimits, sweepLockouts } from "./security";
import { repairMislabelledFile } from "./crypto";
import { pathForRef, markUsageDirty } from "./storage";
import { publish } from "./events";
import { logEvent } from "./audit";

/**
 * Housekeeping that used to run on public request paths (/api/auth/status ran
 * a full session scan + purge for every anonymous hit). Now it runs on one
 * unref()'d timer, so it never keeps the process alive and never runs twice
 * concurrently.
 */

const AUDIT_KEEP = 20_000;
let running = false;
const extra: (() => void)[] = [];

export function registerSweep(fn: () => void) {
  extra.push(fn);
}

export function runMaintenance() {
  if (running) return;
  running = true;
  try {
    cleanupSessions();
    const purged = purgeExpired();
    if (purged > 0) {
      markUsageDirty();
      publish({ scope: "items", action: "expired" });
      logEvent({
        event: "system.expired-items",
        ok: true,
        detail: `Removed ${purged} expired item(s)`,
        actor: { name: "maintenance" },
        target: "items",
        meta: { removed: purged },
      });
    }
    sweepRateLimits();
    sweepLockouts();
    for (const fn of extra) {
      try {
        fn();
      } catch (err) {
        console.error("[maintenance]", err);
      }
    }
    // Cap the audit log so a long-running brute force can't fill the disk.
    const n = db.select({ n: sql<number>`count(*)` }).from(auditLog).get()?.n ?? 0;
    if (n > AUDIT_KEEP * 1.1) {
      const cutoff = db.select({ id: auditLog.id }).from(auditLog).orderBy(sql`${auditLog.id} desc`).limit(1).offset(AUDIT_KEEP).get();
      if (cutoff) db.delete(auditLog).where(lt(auditLog.id, cutoff.id + 1)).run();
    }
  } catch (err) {
    console.error("[maintenance] failed:", err);
  } finally {
    running = false;
  }
}

export function startMaintenance(intervalMs = 5 * 60_000) {
  runMaintenance();
  const t = setInterval(runMaintenance, intervalMs);
  t.unref?.();
  return () => clearInterval(t);
}

/**
 * One-time repair of files over 32 MB written by the old chunked uploader
 * (FYE2 layout mislabelled as FYE1 → undownloadable). Runs in the background,
 * one file at a time.
 */
export async function repairLegacyChunkedFiles() {
  const KEY = "migr:fye2";
  if (db.select().from(kv).where(eq(kv.key, KEY)).get()) return;
  const rows = db
    .select({ id: items.id, storedName: items.storedName, name: items.name })
    .from(items)
    .where(and(gt(items.size, 16 * 1024 * 1024), sql`${items.storedName} is not null`))
    .all();
  let repaired = 0;
  for (const r of rows) {
    try {
      const res = await repairMislabelledFile(pathForRef(r.storedName!));
      if (res === "repaired") repaired++;
    } catch {
      /* missing file etc. */
    }
  }
  db.insert(kv).values({ key: KEY, value: String(Date.now()) }).onConflictDoNothing().run();
  if (repaired) console.log(`  repaired ${repaired} large file(s) from an older version so they can be downloaded again`);
}
