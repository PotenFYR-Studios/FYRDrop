import fs from "node:fs";
import path from "node:path";
import { db, dirs, dbFile } from "../db";
import { storageUnits, items } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { encryptBuffer } from "./crypto";
import { getSettings } from "./settings";

/**
 * Storage units: named directories that hold encrypted item payloads.
 * A stored reference looks like "<unitId>:<filename>"; legacy references
 * without a prefix resolve to the primary files directory.
 */

export const PRIMARY_UNIT = "primary";

type Unit = typeof storageUnits.$inferSelect;
let unitCache: Unit[] | null = null;

export function invalidateUnits() {
  unitCache = null;
  usageCache = null;
}

export function ensurePrimaryUnit() {
  fs.mkdirSync(dirs.files, { recursive: true });
  const existing = db.select().from(storageUnits).all().find((u) => u.id === PRIMARY_UNIT);
  if (!existing) {
    db.insert(storageUnits).values({ id: PRIMARY_UNIT, name: "Primary", path: dirs.files, enabled: 1, createdAt: Date.now() }).run();
    invalidateUnits();
  }
}

export function listUnits(): Unit[] {
  if (unitCache) return unitCache;
  ensurePrimaryUnit();
  unitCache = db.select().from(storageUnits).all();
  return unitCache;
}

export function resolveUnitPath(unitPath: string) {
  return path.isAbsolute(unitPath) ? unitPath : path.resolve(unitPath);
}

function freeBytesOf(dir: string) {
  try {
    const st = fs.statfsSync(dir);
    return st.bavail * st.bsize;
  } catch {
    return 0;
  }
}

export function unitDirForWrite(_bytes: number): { id: string; dir: string } {
  let best: { id: string; dir: string; free: number } | null = null;
  for (const u of listUnits()) {
    if (u.enabled !== 1) continue;
    const dir = resolveUnitPath(u.path);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const free = freeBytesOf(dir);
      if (!best || free > best.free) best = { id: u.id, dir, free };
    } catch {
      // skip unreadable unit
    }
  }
  return best ? { id: best.id, dir: best.dir } : { id: PRIMARY_UNIT, dir: dirs.files };
}

/** Split a stored reference into its unit and (path-safe) filename. */
export function parseRef(ref: string): { unitId: string; filename: string } {
  const idx = ref.indexOf(":");
  const unitId = idx === -1 ? PRIMARY_UNIT : ref.slice(0, idx);
  const filename = path.basename(idx === -1 ? ref : ref.slice(idx + 1));
  return { unitId, filename };
}

export function pathForRef(ref: string): string {
  const { unitId, filename } = parseRef(ref);
  const unit = listUnits().find((u) => u.id === unitId);
  const dir = unit ? resolveUnitPath(unit.path) : dirs.files;
  return path.join(dir, filename);
}

export function makeRef(unitId: string, filename: string) {
  return `${unitId}:${filename}`;
}

/** Encrypt and write a payload into the unit with the most free space. */
export function writeStoredFile(filename: string, plain: Buffer): { ref: string; path: string } {
  const unit = unitDirForWrite(plain.byteLength);
  fs.mkdirSync(unit.dir, { recursive: true });
  const safe = path.basename(filename);
  const p = path.join(unit.dir, safe);
  fs.writeFileSync(p, encryptBuffer(plain), { mode: 0o600 });
  usageCache = null;
  return { ref: makeRef(unit.id, safe), path: p };
}

/** Delete the payload behind a stored reference. */
export function deleteStoredFile(ref: string) {
  try {
    fs.rmSync(pathForRef(ref), { force: true });
    usageCache = null;
  } catch {
    /* already gone */
  }
}

export function quotaBytes() {
  return (getSettings()?.storageQuotaMb ?? 0) * 1024 * 1024;
}

/* ---------- Usage (cached: directory scans are expensive on SD cards) ---------- */

export function dirUsage(dir: string) {
  let bytes = 0;
  let count = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      try {
        bytes += fs.statSync(path.join(dir, e.name)).size;
        count++;
      } catch {
        /* raced with a delete */
      }
    }
  } catch {
    /* missing dir */
  }
  return { bytes, count };
}

type Usage = { at: number; units: Map<string, { bytes: number; count: number }>; thumbs: number; certs: number; db: number };
let usageCache: Usage | null = null;
const USAGE_TTL = 30_000;

export function usage(force = false): Usage {
  if (!force && usageCache && Date.now() - usageCache.at < USAGE_TTL) return usageCache;
  const units = new Map<string, { bytes: number; count: number }>();
  const seen = new Set<string>();
  for (const u of listUnits()) {
    const dir = resolveUnitPath(u.path);
    if (seen.has(dir)) {
      units.set(u.id, { bytes: 0, count: 0 });
      continue;
    }
    seen.add(dir);
    units.set(u.id, dirUsage(dir));
  }
  let dbBytes = 0;
  for (const f of [dbFile, `${dbFile}-wal`]) {
    try {
      dbBytes += fs.statSync(f).size;
    } catch {
      /* none */
    }
  }
  usageCache = { at: Date.now(), units, thumbs: dirUsage(dirs.thumbs).bytes, certs: dirUsage(dirs.certs).bytes, db: dbBytes };
  return usageCache;
}

export function localStorageBytes() {
  const u = usage();
  let total = u.thumbs + u.certs + u.db;
  for (const v of u.units.values()) total += v.bytes;
  return total;
}

/** Bytes used by items stored in a unit (ciphertext on disk). */
export function unitUsedBytes(unitId: string): number {
  return usage().units.get(unitId)?.bytes ?? 0;
}

/** Free space for new data: quota head-room, else physical disk free. */
export function availableBytes(): number {
  let used = 0;
  for (const v of usage().units.values()) used += v.bytes;
  const quota = quotaBytes();
  let physical = 0;
  for (const u of listUnits()) if (u.enabled === 1) physical = Math.max(physical, freeBytesOf(resolveUnitPath(u.path)));
  const quotaFree = quota > 0 ? Math.max(0, quota - used) : Number.MAX_SAFE_INTEGER;
  return Math.min(quotaFree, physical);
}

/** Null when `bytes` fits; otherwise a user-facing reason. */
export function storageRefusal(bytes: number): string | null {
  const free = availableBytes();
  if (bytes <= free) return null;
  return quotaBytes() > 0
    ? "Storage quota reached - ask the owner to raise the quota or free some space."
    : "The server is out of disk space.";
}

export function markUsageDirty() {
  usageCache = null;
}

/** Bytes stored by one account, including items currently in trash. */
export function userStorageBytes(userId: string): number {
  const row = db.select({ n: sql<number>`coalesce(sum(${items.size}), 0)` }).from(items).where(eq(items.userId, userId)).get();
  return Number(row?.n ?? 0);
}
