import { Hono } from "hono";
import { and, eq, gt, isNull, lt, or, sql, like } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { db, dirs, purgeExpired } from "../db";
import { items, sessions, certs, auditLog, clusterNodes, storageUnits, users, groups, groupMembers } from "../db/schema";
import { requireOwner } from "../lib/auth";
import { availableBytes, resolveUnitPath, listUnits, invalidateUnits, parseRef, usage, dirUsage } from "../lib/storage";
import { readConfig, writeConfig } from "../lib/config";
import { decryptString } from "../lib/crypto";
import { getSettings } from "../lib/settings";
import { clientIp, type AppEnv } from "../lib/net";
import { audit } from "./users";
import { ensureDefaultGroup } from "../lib/groups";
import { currentVersion, updateMode, readPending, latestRelease, stageRelease, cancelStaging, scheduleRestart, history, lastFailure, REPO } from "../lib/update";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", requireOwner);

/**
 * Orphans = files on disk that no item references.
 * Item refs are "<unitId>:<filename>" - compare per unit directory, by
 * filename. (The previous version compared raw refs to bare filenames, so
 * EVERY stored file looked orphaned and "Delete orphans" wiped all uploads.)
 */
function orphans() {
  const rows = db.select({ storedName: items.storedName, thumbName: items.thumbName }).from(items).all();
  const byDir = new Map<string, Set<string>>();
  const unitDir = new Map(listUnits().map((u) => [u.id, resolveUnitPath(u.path)]));
  const keep = (dir: string, name: string) => {
    let set = byDir.get(dir);
    if (!set) byDir.set(dir, (set = new Set()));
    set.add(name);
  };
  for (const r of rows) {
    if (r.storedName) {
      const { unitId, filename } = parseRef(r.storedName);
      keep(unitDir.get(unitId) ?? dirs.files, filename);
    }
    if (r.thumbName) keep(dirs.thumbs, path.basename(r.thumbName));
  }
  const out: { dir: string; unit: string; name: string; bytes: number }[] = [];
  const scan = (dir: string, label: string) => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    const known = byDir.get(dir) ?? new Set<string>();
    for (const name of names) {
      if (known.has(name)) continue;
      try {
        const st = fs.statSync(path.join(dir, name));
        if (!st.isFile()) continue;
        // Never touch anything written in the last 10 minutes (upload/assembly in flight).
        if (Date.now() - st.mtimeMs < 10 * 60_000) continue;
        out.push({ dir: label, unit: dir, name, bytes: st.size });
      } catch {
        /* raced with a delete */
      }
    }
  };
  const seen = new Set<string>();
  for (const u of listUnits()) {
    const d = resolveUnitPath(u.path);
    if (seen.has(d)) continue;
    seen.add(d);
    scan(d, u.id === "primary" ? "files" : u.name);
  }
  scan(dirs.thumbs, "thumbs");
  return out;
}

adminRoutes.get("/stats", (c) => {
  const now = Date.now();
  const live = or(isNull(items.expiresAt), gt(items.expiresAt, now));
  const byType = (["file", "image", "text", "url"] as const).map((t) => {
    const r = db
      .select({ n: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${items.size}),0)`, dl: sql<number>`coalesce(sum(${items.downloads}),0)` })
      .from(items)
      .where(sql`${items.type} = ${t} and (${items.expiresAt} is null or ${items.expiresAt} > ${now})`)
      .get();
    return { type: t, count: r?.n ?? 0, bytes: r?.bytes ?? 0, downloads: r?.dl ?? 0 };
  });

  // uploads per local calendar day, last 14 days (one indexed range query)
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const from = start.getTime() - 13 * 86_400_000;
  const recentRows = db.select({ createdAt: items.createdAt, size: items.size }).from(items).where(gt(items.createdAt, from - 1)).all();
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    return { start: d.getTime(), date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, count: 0, bytes: 0 };
  });
  for (const r of recentRows) {
    for (let i = days.length - 1; i >= 0; i--) {
      if (r.createdAt >= days[i]!.start) {
        days[i]!.count++;
        days[i]!.bytes += r.size;
        break;
      }
    }
  }

  const topDownloads = db
    .select({ id: items.id, name: items.name, type: items.type, mime: items.mime, downloads: items.downloads })
    .from(items)
    .where(live)
    .orderBy(sql`${items.downloads} desc`)
    .limit(5)
    .all();
  const recent = db.select().from(items).where(live).orderBy(sql`${items.createdAt} desc`).limit(8).all();
  const activeDevices = db.select({ n: sql<number>`count(*)` }).from(sessions).where(gt(sessions.expiresAt, now)).get()?.n ?? 0;
  const certRows = db.select({ notAfter: certs.notAfter }).from(certs).all();
  const u = usage();
  let fileBytes = 0;
  for (const v of u.units.values()) fileBytes += v.bytes;

  return c.json({
    totals: {
      items: byType.reduce((s, t) => s + t.count, 0),
      downloads: byType.reduce((s, t) => s + t.downloads, 0),
      storageBytes: fileBytes + u.thumbs + u.certs,
      devices: activeDevices,
      certs: certRows.length,
      expiringCerts: certRows.filter((r) => r.notAfter - now < 30 * 86_400_000).length,
    },
    byType,
    timeline: days.map(({ start: _s, ...d }) => d),
    topDownloads,
    recent: recent.map(({ content, storedName, ...r }) => ({
      ...r,
      preview: content && (r.type === "text" || r.type === "url") ? decryptString(content).slice(0, 120) : undefined,
    })),
  });
});

adminRoutes.get("/storage", (c) => {
  const u = usage(true);
  const primary = u.units.get("primary") ?? { bytes: 0, count: 0 };
  let otherBytes = 0;
  let otherCount = 0;
  for (const [id, v] of u.units) if (id !== "primary") {
    otherBytes += v.bytes;
    otherCount += v.count;
  }
  const orphanRows = orphans();
  const nodes = db.select().from(clusterNodes).all();
  return c.json({
    db: { bytes: u.db, path: "fyrdrop.db" },
    files: { bytes: primary.bytes + otherBytes, count: primary.count + otherCount },
    thumbs: dirUsage(dirs.thumbs),
    certs: dirUsage(dirs.certs),
    orphans: orphanRows.slice(0, 500).map(({ unit: _u, ...o }) => o),
    orphansCount: orphanRows.length,
    orphansBytes: orphanRows.reduce((s, o) => s + o.bytes, 0),
    cluster: {
      nodes: nodes.map((n) => ({ id: n.id, name: n.name, baseUrl: n.baseUrl, bytes: n.lastStorageBytes, items: n.lastItemCount, lastSeenAt: n.lastSeenAt, status: n.lastStatus })),
      pooledBytes: primary.bytes + otherBytes + u.thumbs + u.certs + u.db + nodes.reduce((s, n) => s + n.lastStorageBytes, 0),
    },
  });
});

/** Cleanup: purge expired items and/or delete orphaned files on disk. */
adminRoutes.post("/cleanup", async (c) => {
  const body = await c.req.json<{ mode?: "expired" | "orphans" | "all" }>().catch(() => null);
  const mode = body?.mode ?? "all";
  if (!["expired", "orphans", "all"].includes(mode)) return c.json({ error: "Invalid mode." }, 400);
  const result = { expiredRemoved: 0, orphansRemoved: 0, bytesFreed: 0 };
  if (mode === "expired" || mode === "all") result.expiredRemoved = purgeExpired();
  if (mode === "orphans" || mode === "all") {
    for (const o of orphans()) {
      fs.rmSync(path.join(o.unit, path.basename(o.name)), { force: true });
      result.orphansRemoved++;
      result.bytesFreed += o.bytes;
    }
  }
  usage(true);
  audit(c, "storage.cleanup", true, `Cleanup (${mode}): ${result.expiredRemoved} expired, ${result.orphansRemoved} orphaned file(s)`, { target: "storage", meta: { mode, ...result } });
  return c.json({ ok: true, ...result });
});

adminRoutes.get("/security", (c) => {
  const s = getSettings();
  const q = c.req.query("q")?.trim();
  const log = db
    .select()
    .from(auditLog)
    .where(q ? or(like(auditLog.event, `%${q}%`), like(auditLog.ip, `%${q}%`), like(auditLog.detail, `%${q}%`)) : undefined)
    .orderBy(sql`${auditLog.ts} desc`)
    .limit(300)
    .all();
  const failed24h =
    db.select({ n: sql<number>`count(*)` }).from(auditLog).where(sql`${auditLog.ok} = 0 and ${auditLog.ts} > ${Date.now() - 86_400_000}`).get()?.n ?? 0;
  return c.json({
    audit: log,
    failed24h,
    whitelist: { enabled: !!s?.ipWhitelistEnabled, entries: (s?.ipWhitelist ?? "").split(",").map((x) => x.trim()).filter(Boolean) },
    registrationOpen: s?.registrationOpen !== 0,
    yourIp: clientIp(c),
  });
});

/** Owner-only directory browser used when picking a storage-unit path. */
adminRoutes.get("/browse", (c) => {
  const requested = c.req.query("path")?.trim() ?? "";
  if (!requested) {
    const roots: { name: string; path: string }[] = [];
    if (process.platform === "win32") {
      for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
        const p = `${letter}:\\`;
        try {
          fs.accessSync(p);
          roots.push({ name: `Drive ${letter}:`, path: p });
        } catch {
          /* not mounted */
        }
      }
    } else {
      roots.push({ name: "Filesystem root", path: "/" });
      for (const p of ["/mnt", "/media", process.env.HOME ?? ""]) if (p && fs.existsSync(p)) roots.push({ name: p, path: p });
    }
    return c.json({ path: "", parent: null, entries: roots, freeBytes: 0, isRoot: true });
  }
  const dir = path.resolve(requested);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return c.json({ error: "Directory does not exist." }, 404);
  }
  if (!stat.isDirectory()) return c.json({ error: "Not a directory." }, 400);
  let entries: { name: string; path: string; writable: boolean }[] = [];
  try {
    entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .slice(0, 500)
      .map((e) => {
        const child = path.join(dir, e.name);
        let writable = false;
        try {
          fs.accessSync(child, fs.constants.W_OK);
          writable = true;
        } catch {
          /* read-only */
        }
        return { name: e.name, path: child, writable };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return c.json({ error: "Permission denied reading this directory." }, 403);
  }
  let freeBytes = 0;
  try {
    const st = fs.statfsSync(dir);
    freeBytes = st.bavail * st.bsize;
  } catch {
    /* unsupported */
  }
  const parent = path.dirname(dir);
  return c.json({ path: dir, parent: parent === dir ? null : parent, entries, freeBytes, isRoot: false });
});

adminRoutes.get("/units", (c) => {
  const u = usage();
  const units = listUnits().map((unit) => {
    const dir = resolveUnitPath(unit.path);
    let freeBytes = 0;
    let exists = true;
    try {
      const st = fs.statfsSync(dir);
      freeBytes = st.bavail * st.bsize;
      fs.accessSync(dir);
    } catch {
      exists = false;
    }
    return { ...unit, bytes: u.units.get(unit.id)?.bytes ?? 0, freeBytes, exists };
  });
  return c.json({ units, quotaMb: getSettings()?.storageQuotaMb ?? 0, availableBytes: availableBytes() });
});

/** Directories a storage unit must never point at (would expose keys / DB to file ops). */
function forbiddenUnitPath(resolved: string) {
  const norm = (p: string) => path.resolve(p).toLowerCase();
  const r = norm(resolved);
  const banned = [path.join(dirs.data, "keys"), dirs.certs, dirs.thumbs, dirs.tmp, path.join(dirs.data, "tls")].map(norm);
  if (banned.some((b) => r === b || r.startsWith(b + path.sep))) return true;
  if (r === norm(dirs.data)) return true;
  return listUnits().some((u) => norm(resolveUnitPath(u.path)) === r);
}

adminRoutes.post("/units", async (c) => {
  const body = await c.req.json<{ name?: string; path?: string }>().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const dir = typeof body?.path === "string" ? body.path.trim() : "";
  if (!name || !dir) return c.json({ error: "name and path are required." }, 400);
  const resolved = resolveUnitPath(dir);
  if (forbiddenUnitPath(resolved)) return c.json({ error: "That folder is reserved or already a storage unit." }, 400);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    fs.accessSync(resolved, fs.constants.W_OK);
  } catch {
    return c.json({ error: "Path is not writable." }, 400);
  }
  const row = { id: crypto.randomUUID(), name: name.slice(0, 60), path: resolved, enabled: 1, createdAt: Date.now() };
  db.insert(storageUnits).values(row).run();
  invalidateUnits();
  audit(c, "storage.unit-added", true, `Added storage unit "${row.name}"`, { target: row.name, meta: { path: resolved } });
  return c.json({ unit: row }, 201);
});

adminRoutes.delete("/units/:id", (c) => {
  if (c.req.param("id") === "primary") return c.json({ error: "The primary unit cannot be removed." }, 400);
  const unit = db.select().from(storageUnits).where(eq(storageUnits.id, c.req.param("id"))).limit(1).get();
  if (!unit) return c.json({ error: "Not found." }, 404);
  const used = db.select({ n: sql<number>`count(*)` }).from(items).where(like(items.storedName, `${unit.id}:%`)).get()?.n ?? 0;
  if (used > 0) return c.json({ error: `This unit still holds ${used} item(s). Move or delete them first.` }, 409);
  db.delete(storageUnits).where(eq(storageUnits.id, unit.id)).run();
  invalidateUnits();
  audit(c, "storage.unit-removed", true, `Removed storage unit "${unit.name}"`, { target: unit.name, severity: "warn" });
  return c.json({ ok: true });
});

adminRoutes.get("/config", (c) => {
  return c.json({ config: readConfig(), restartFields: ["port", "networkMode", "tlsCommonName", "sessionTtlDays", "trustProxy"] });
});

adminRoutes.post("/config", async (c) => {
  const body = await c.req.json<any>().catch(() => null);
  if (!body) return c.json({ error: "Invalid body." }, 400);
  const patch: Record<string, unknown> = {};
  if (body.port !== undefined) {
    const p = Number(body.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return c.json({ error: "port must be 1-65535." }, 400);
    patch.port = p;
  }
  if (body.networkMode !== undefined) {
    if (!["auto", "off", "custom"].includes(body.networkMode)) return c.json({ error: "networkMode must be auto, off or custom." }, 400);
    patch.networkMode = body.networkMode;
  }
  if (typeof body.tlsCommonName === "string") patch.tlsCommonName = body.tlsCommonName.trim().slice(0, 80) || "fyrdrop.local";
  if (body.sessionTtlDays !== undefined) {
    const d = Number(body.sessionTtlDays);
    if (!Number.isInteger(d) || d < 1 || d > 365) return c.json({ error: "sessionTtlDays must be 1-365." }, 400);
    patch.sessionTtlDays = d;
  }
  if (typeof body.trustProxy === "boolean") patch.trustProxy = body.trustProxy;
  if (typeof body.showPinInLogs === "boolean") patch.showPinInLogs = body.showPinInLogs;
  const next = writeConfig(patch);
  const restartFields = ["port", "networkMode", "tlsCommonName", "sessionTtlDays", "trustProxy"];
  const restartRequired = Object.keys(patch).filter((k) => restartFields.includes(k));
  audit(c, "config.updated", true, `System config updated: ${Object.keys(patch).join(", ")}`, {
    target: "config",
    severity: restartRequired.length ? "warn" : "info",
    meta: { changed: Object.keys(patch), restartRequired },
  });
  return c.json({ ok: true, config: next, restartRequired });
});

adminRoutes.post("/restart", (c) => {
  audit(c, "system.restart", true, "Restart requested from Settings", { severity: "warn" });
  scheduleRestart();
  setTimeout(() => process.exit(0), 600);
  return c.json({ ok: true, restarting: true });
});

adminRoutes.get("/connections", (c) => {
  const now = Date.now();
  const rows = db.select().from(sessions).orderBy(sql`${sessions.lastSeenAt} desc`).all();
  return c.json({ connections: rows.map((r) => ({ ...r, active: r.expiresAt > now, daysOld: Math.floor((now - r.createdAt) / 86_400_000) })) });
});

/* ----------------------------- Activity log ----------------------------- */

const CATEGORIES = new Set(["auth", "account", "device", "item", "share", "cert", "storage", "cluster", "federation", "security", "system"]);
const SEVERITIES = new Set(["info", "warn", "error"]);

/** Paged, filterable activity log with per-category counts for the UI. */
adminRoutes.get("/logs", (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  const category = c.req.query("category") ?? "all";
  const severity = c.req.query("severity") ?? "all";
  const actor = c.req.query("actor")?.trim() ?? "";
  const before = Number(c.req.query("before") ?? 0);
  const limit = Math.min(300, Math.max(10, Number(c.req.query("limit") ?? 120) || 120));
  const days = Math.min(365, Math.max(0, Number(c.req.query("days") ?? 0) || 0));

  const conds = [];
  if (q) {
    const term = `%${q}%`;
    conds.push(
      or(
        like(auditLog.event, term),
        like(auditLog.detail, term),
        like(auditLog.actorName, term),
        like(auditLog.target, term),
        like(auditLog.ip, term),
      )!,
    );
  }
  if (CATEGORIES.has(category)) conds.push(eq(auditLog.category, category));
  if (severity === "failed") conds.push(eq(auditLog.ok, 0));
  else if (SEVERITIES.has(severity)) conds.push(eq(auditLog.severity, severity));
  if (actor) conds.push(eq(auditLog.actorId, actor));
  if (Number.isFinite(before) && before > 0) conds.push(lt(auditLog.id, before));
  if (days > 0) conds.push(gt(auditLog.ts, Date.now() - days * 86_400_000));

  const rows = db
    .select()
    .from(auditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${auditLog.id} desc`)
    .limit(limit + 1)
    .all();
  const page = rows.slice(0, limit);

  const since = Date.now() - 86_400_000;
  const counts = new Map(
    db
      .select({ category: auditLog.category, n: sql<number>`count(*)` })
      .from(auditLog)
      .where(gt(auditLog.ts, since))
      .groupBy(auditLog.category)
      .all()
      .map((r) => [r.category, r.n] as const),
  );
  const totals = db
    .select({
      events: sql<number>`count(*)`,
      failed: sql<number>`sum(case when ${auditLog.ok} = 0 then 1 else 0 end)`,
      warnings: sql<number>`sum(case when ${auditLog.severity} = 'warn' then 1 else 0 end)`,
      errors: sql<number>`sum(case when ${auditLog.severity} = 'error' then 1 else 0 end)`,
    })
    .from(auditLog)
    .where(gt(auditLog.ts, since))
    .get();

  return c.json({
    entries: page.map((r) => ({
      id: r.id,
      ts: r.ts,
      event: r.event,
      ok: !!r.ok,
      detail: r.detail,
      ip: r.ip,
      category: r.category,
      severity: r.severity,
      actorId: r.actorId,
      actorName: r.actorName,
      target: r.target,
      meta: r.meta ? safeJson(r.meta) : null,
    })),
    nextBefore: rows.length > limit ? page[page.length - 1]!.id : null,
    counts: Object.fromEntries(counts),
    totals: {
      events: totals?.events ?? 0,
      failed: totals?.failed ?? 0,
      warnings: totals?.warnings ?? 0,
      errors: totals?.errors ?? 0,
    },
    categories: [...CATEGORIES],
  });
});

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/* -------------------------------- Devices -------------------------------- */

/**
 * Every paired device with the account it belongs to. This is the admin view
 * that ties connections to people: one row per session, grouped in the UI by
 * account, with the raw user agent kept for debugging.
 */
adminRoutes.get("/devices", (c) => {
  const now = Date.now();
  const userFilter = c.req.query("user")?.trim() ?? "";
  const userMap = new Map(db.select().from(users).all().map((u) => [u.id, u]));
  const rows = db.select().from(sessions).orderBy(sql`${sessions.lastSeenAt} desc`).all();
  const devices = rows.map((r) => {
    const u = r.userId ? userMap.get(r.userId) : null;
    return {
      token: r.token,
      deviceName: r.deviceName,
      hostName: r.hostName,
      ip: r.ip,
      ipSource: r.ipSource,
      reportedIp: r.reportedIp,
      mac: r.mac,
      userAgent: r.userAgent,
      macNote: r.macNote,
      meta: (() => {
        try {
          return JSON.parse(r.deviceMeta || "{}");
        } catch {
          return {};
        }
      })(),
      createdAt: r.createdAt,
      lastSeenAt: r.lastSeenAt,
      expiresAt: r.expiresAt,
      active: r.expiresAt > now,
      isCurrent: r.token === c.get("session").token,
      account: u
        ? { id: u.id, name: u.name, username: u.username, role: u.role, avatar: u.avatar, color: u.color, isBlocked: u.isBlocked }
        : null,
    };
  });
  const filtered = userFilter ? devices.filter((d) => d.account?.id === userFilter) : devices;
  const accountIds = new Set(devices.filter((d) => d.account).map((d) => d.account!.id));
  return c.json({
    devices: filtered,
    counts: {
      total: devices.length,
      active: devices.filter((d) => d.active).length,
      unassigned: devices.filter((d) => !d.account).length,
      accounts: accountIds.size,
    },
  });
});

/* --------------------------------- Updates -------------------------------- */

adminRoutes.get("/update", (c) => {
  const mode = updateMode();
  return c.json({
    current: currentVersion(),
    mode,
    repo: REPO,
    pending: readPending(),
    history: history(),
    lastFailure: lastFailure(),
    dockerHint: mode === "docker" ? `docker pull ghcr.io/potenfyr-studios/fyrdrop:latest && docker compose up -d` : null,
  });
});

adminRoutes.post("/update/check", async (c) => {
  const { release, error } = await latestRelease(true);
  const current = currentVersion();
  return c.json({
    current,
    mode: updateMode(),
    latest: release,
    error: error ?? null,
    updateAvailable: !!release && release.version !== current,
  });
});

adminRoutes.post("/update/stage", async (c) => {
  const body = await c.req.json<{ tag?: string }>().catch(() => null);
  const tag = String(body?.tag ?? "").trim();
  if (!tag) return c.json({ error: "A release tag is required." }, 400);
  if (updateMode() === "docker") {
    return c.json({ error: "This instance runs in Docker. Pull the new image and recreate the container instead." }, 409);
  }
  const result = await stageRelease(tag);
  if (!result.ok) return c.json({ error: result.error ?? "Could not stage the update." }, 500);
  audit(c, "system.update-staged", true, `Staged update to ${tag}`, { severity: "warn", target: tag, meta: { from: currentVersion(), tag } });
  return c.json({ ok: true, pending: readPending() });
});

adminRoutes.post("/update/cancel", (c) => {
  cancelStaging();
  audit(c, "system.update-cancelled", true, "Cancelled a staged update", { severity: "warn" });
  return c.json({ ok: true });
});

adminRoutes.post("/update/restart", (c) => {
  const pending = readPending();
  if (!pending) return c.json({ error: "There is no staged update to apply." }, 400);
  audit(c, "system.update-restart", true, `Restarting to apply ${pending.to}`, { severity: "warn", target: pending.to });
  scheduleRestart();
  // Give the response time to flush, then let the helper take over.
  setTimeout(() => process.exit(0), 600);
  return c.json({ ok: true, restarting: true, to: pending.to });
});

/* --------------------------------- Groups --------------------------------- */

adminRoutes.get("/groups", (c) => {
  const rows = db.select().from(groups).all();
  const userMap = new Map(db.select().from(users).all().map((u) => [u.id, { id: u.id, name: u.name, username: u.username }]));
  const counts = new Map(
    db.select({ groupId: items.groupId, n: sql<number>`count(*)` }).from(items).groupBy(items.groupId).all().map((r) => [r.groupId, r.n]),
  );
  return c.json({
    groups: rows
      .map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        color: g.color,
        ownerId: g.ownerId,
        owner: userMap.get(g.ownerId) ?? null,
        isDefault: g.isDefault === 1,
        itemCount: counts.get(g.id) ?? 0,
        createdAt: g.createdAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
});

adminRoutes.delete("/groups/:id", (c) => {
  const g = db.select().from(groups).where(eq(groups.id, c.req.param("id"))).limit(1).get();
  if (!g) return c.json({ error: "Not found." }, 404);
  if (g.isDefault === 1) return c.json({ error: "A Default group cannot be deleted." }, 400);
  const fallback = ensureDefaultGroup(g.ownerId);
  db.update(items).set({ groupId: fallback }).where(eq(items.groupId, g.id)).run();
  db.delete(groupMembers).where(eq(groupMembers.groupId, g.id)).run();
  db.delete(groups).where(eq(groups.id, g.id)).run();
  audit(c, "group.deleted", true, `Admin deleted group "${g.name}"`, { severity: "warn", target: g.name });
  return c.json({ ok: true });
});
