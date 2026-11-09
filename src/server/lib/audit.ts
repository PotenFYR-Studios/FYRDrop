import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, kv } from "../db/schema";
import { publish } from "./events";
import { clientIp } from "./net";
import { sessionFromContext, type SessionCtx } from "./auth";

/**
 * One writer for the activity log.
 *
 * Every entry answers three questions the admin UI shows: who did it (actor),
 * what it touched (target) and whether it worked (ok/severity). Categories are
 * derived from the event name so new call sites don't have to think about them.
 */

export type LogCategory =
  | "auth"
  | "account"
  | "device"
  | "item"
  | "share"
  | "cert"
  | "storage"
  | "cluster"
  | "federation"
  | "security"
  | "system";

export type LogSeverity = "info" | "warn" | "error";

const CATEGORY_BY_PREFIX: Record<string, LogCategory> = {
  login: "auth",
  account: "auth",
  auth: "auth",
  user: "account",
  device: "device",
  session: "device",
  presence: "device",
  item: "item",
  upload: "item",
  download: "item",
  share: "share",
  cert: "cert",
  storage: "storage",
  cluster: "cluster",
  node: "cluster",
  federation: "federation",
  peer: "federation",
  ip: "security",
  security: "security",
  settings: "system",
  config: "system",
  system: "system",
};

export function categoryOf(event: string): LogCategory {
  return CATEGORY_BY_PREFIX[event.split(".")[0] ?? ""] ?? "system";
}

export function severityOf(event: string, ok: boolean): LogSeverity {
  if (event.endsWith(".error") || event.includes("rejected") || event.includes("blocked")) return "error";
  if (!ok || event.includes("failed") || event.includes("locked")) return "warn";
  return "info";
}

export type LogActor = { id?: string | null; name?: string | null };

export interface LogInput {
  event: string;
  ok?: boolean;
  detail?: string;
  ip?: string;
  actor?: LogActor | null;
  target?: string;
  meta?: Record<string, unknown> | null;
  category?: LogCategory;
  severity?: LogSeverity;
}

/** Actor for a request: the signed-in account, or the paired device. */
export function actorFromSession(session: SessionCtx | undefined): LogActor {
  if (!session) return { id: null, name: "" };
  return { id: session.user?.id ?? null, name: session.user?.name ?? session.deviceName };
}

export function logEvent(input: LogInput) {
  const ok = input.ok !== false;
  const category = input.category ?? categoryOf(input.event);
  const severity = input.severity ?? severityOf(input.event, ok);
  const detail = (input.detail ?? "").slice(0, 400);
  let meta = "";
  if (input.meta && Object.keys(input.meta).length > 0) {
    try {
      meta = JSON.stringify(input.meta).slice(0, 2000);
    } catch {
      meta = "";
    }
  }
  try {
    db.insert(auditLog)
      .values({
        ts: Date.now(),
        ip: (input.ip ?? "").slice(0, 64),
        event: input.event.slice(0, 80),
        ok: ok ? 1 : 0,
        detail,
        category,
        severity,
        actorId: input.actor?.id ?? null,
        actorName: (input.actor?.name ?? "").slice(0, 80),
        target: (input.target ?? "").slice(0, 160),
        meta,
      })
      .run();
    publish({ scope: "audit", action: "append" });
  } catch (err) {
    // Logging must never break the request it is describing.
    console.error("[audit] could not write entry:", err);
  }
}

/** Log an event for the request's current session. */
export function auditRequest(
  c: Context,
  event: string,
  ok: boolean,
  detail = "",
  extra: Omit<LogInput, "event" | "ok" | "detail" | "ip" | "actor"> & { actor?: LogActor | null } = {},
) {
  const session = sessionFromContext(c);
  logEvent({
    ...extra,
    event,
    ok,
    detail,
    ip: clientIp(c),
    actor: extra.actor ?? actorFromSession(session),
  });
}

/**
 * One-time backfill: old rows predate categories/severities, so derive them
 * from the event name. Runs once per database (flagged in kv).
 */
export function backfillAuditV2() {
  const KEY = "migr:audit-v2";
  if (db.select({ key: kv.key }).from(kv).all().some((r) => r.key === KEY)) return;
  const rows = db.select().from(auditLog).all();
  for (const r of rows) {
    const category = categoryOf(r.event);
    const severity = severityOf(r.event, !!r.ok);
    if (r.category === category && r.severity === severity) continue;
    db.update(auditLog).set({ category, severity }).where(eq(auditLog.id, r.id)).run();
  }
  db.insert(kv).values({ key: KEY, value: String(Date.now()) }).onConflictDoNothing().run();
}
