import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { requireOwner } from "../lib/auth";
import { auditRequest } from "../lib/audit";
import { publish } from "../lib/events";
import { currentVersion, scheduleRestart } from "../lib/update";
import {
  BACKUP_DIR,
  BadPassphrase,
  adoptUploaded,
  backupPath,
  backupRunning,
  cancelStagedRestore,
  createBackup,
  deleteBackup,
  getSchedule,
  inspectBackup,
  isEncryptedBackup,
  lastRestoreResult,
  listBackups,
  setSchedule,
  stageRestore,
  stagedRestore,
} from "../lib/backup";
import type { AppEnv } from "../lib/net";

export const backupRoutes = new Hono<AppEnv>();
backupRoutes.use("*", requireOwner);

const MIN_PASS = 10;
let lastError = "";

function actorName(c: Context) {
  return c.get("session").user?.name ?? "owner";
}

backupRoutes.get("/", (c) =>
  c.json({
    backups: listBackups(),
    running: backupRunning(),
    lastError,
    schedule: getSchedule(),
    staged: stagedRestore(),
    lastRestore: lastRestoreResult(),
  }),
);

/** Start a backup. Small ones finish before the response; big ones keep running and the UI polls. */
backupRoutes.post("/", async (c) => {
  const body = await c.req.json<{ includeFiles?: boolean; passphrase?: string; note?: string }>().catch(() => null);
  const passphrase = typeof body?.passphrase === "string" && body.passphrase ? body.passphrase : undefined;
  if (passphrase && (passphrase.length < MIN_PASS || passphrase.length > 256)) return c.json({ error: `Passphrase must be ${MIN_PASS}-256 characters.` }, 400);
  if (backupRunning()) return c.json({ error: "A backup is already running." }, 409);
  const includeFiles = body?.includeFiles === true;
  lastError = "";
  const job = createBackup({ includeFiles, passphrase, note: typeof body?.note === "string" ? body.note : "", version: currentVersion() });
  const settle = job.then(
    (info) => {
      auditRequest(c, "system.backup", true, `Backup ${info.name} created`, { target: info.name, meta: { size: info.size, includesFiles: includeFiles, encrypted: info.encrypted } });
      publish({ scope: "settings", action: "backup" });
      return info;
    },
    (err) => {
      lastError = String(err?.message ?? err).slice(0, 300);
      auditRequest(c, "system.backup", false, `Backup failed: ${lastError}`, { target: "backup", severity: "error" });
      publish({ scope: "settings", action: "backup" });
      throw err;
    },
  );
  const quick = await Promise.race([settle.then((i) => ({ i })).catch((e) => ({ e })), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
  if (quick === null) {
    settle.catch(() => {});
    return c.json({ ok: true, running: true }, 202);
  }
  if ("e" in quick) return c.json({ error: `Backup failed: ${lastError}` }, 500);
  return c.json({ ok: true, backup: quick.i }, 201);
});

backupRoutes.get("/file/:name", (c) => {
  const name = c.req.param("name");
  const p = backupPath(name);
  if (!p) return c.json({ error: "No such backup." }, 404);
  auditRequest(c, "system.backup-download", true, `${actorName(c)} downloaded backup ${name}`, { target: name, severity: "warn" });
  const st = fs.statSync(p);
  return new Response(Bun.file(p).stream(), {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(st.size),
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
});

backupRoutes.delete("/file/:name", (c) => {
  const name = c.req.param("name");
  if (!deleteBackup(name)) return c.json({ error: "No such backup." }, 404);
  auditRequest(c, "system.backup-deleted", true, `Backup ${name} deleted`, { target: name });
  return c.json({ ok: true });
});

backupRoutes.post("/schedule", async (c) => {
  const body = await c.req.json<{ enabled?: boolean; everyHours?: number; keep?: number; includeFiles?: boolean }>().catch(() => null);
  if (!body) return c.json({ error: "Invalid body." }, 400);
  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.everyHours !== undefined) patch.everyHours = Number(body.everyHours);
  if (body.keep !== undefined) patch.keep = Number(body.keep);
  if (typeof body.includeFiles === "boolean") patch.includeFiles = body.includeFiles;
  const next = setSchedule(patch);
  auditRequest(c, "system.backup-schedule", true, next.enabled ? `Automatic backups every ${next.everyHours} h, keeping ${next.keep}` : "Automatic backups turned off", { target: "backup schedule", meta: { ...next } });
  return c.json({ ok: true, schedule: next });
});

/* ---- Uploading a backup from another machine (sequential 32 MB chunks) ---- */

type Incoming = { name: string; size: number; received: number; next: number; file: string; userId: string; at: number };
const incoming = new Map<string, Incoming>();
const CHUNK_MAX = 32 * 1024 * 1024;

function sweepIncoming() {
  const now = Date.now();
  for (const [id, u] of incoming) {
    if (now - u.at > 2 * 3600_000) {
      fs.rmSync(u.file, { force: true });
      incoming.delete(id);
    }
  }
}

backupRoutes.post("/upload/begin", async (c) => {
  sweepIncoming();
  const body = await c.req.json<{ name?: string; size?: number }>().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.slice(0, 200) : "";
  const size = Number(body?.size ?? 0);
  if (!name || !/\.(tar|fyb)$/i.test(name)) return c.json({ error: "Pick a FYRDrop backup (.tar or .fyb)." }, 400);
  if (!Number.isSafeInteger(size) || size < 1024) return c.json({ error: "That file is too small to be a backup." }, 400);
  let free = Infinity;
  try {
    fs.mkdirSync(BACKUP_DIR(), { recursive: true });
    const st = fs.statfsSync(BACKUP_DIR());
    free = st.bavail * st.bsize;
  } catch {
    /* unknown */
  }
  // Room for the archive plus its unpacked copy during restore.
  if (size * 2.1 > free) return c.json({ error: "Not enough free disk space to upload and restore this backup." }, 507);
  const id = crypto.randomUUID();
  const file = path.join(BACKUP_DIR(), `.upload-${id}`);
  fs.writeFileSync(file, "");
  incoming.set(id, { name, size, received: 0, next: 0, file, userId: c.get("session").user!.id, at: Date.now() });
  return c.json({ uploadId: id, chunkSize: CHUNK_MAX }, 201);
});

backupRoutes.put(
  "/upload/:id/:index",
  bodyLimit({ maxSize: CHUNK_MAX + 1024, onError: (c) => c.json({ error: "Chunk too large." }, 413) }),
  async (c) => {
    const u = incoming.get(c.req.param("id"));
    if (!u || u.userId !== c.get("session").user!.id) return c.json({ error: "Unknown upload." }, 404);
    const index = Number(c.req.param("index"));
    if (index !== u.next) return c.json({ error: `Expected chunk ${u.next}.`, next: u.next }, 409);
    const buf = Buffer.from(await c.req.arrayBuffer());
    if (buf.length === 0 || u.received + buf.length > u.size) return c.json({ error: "Chunk does not fit the declared size." }, 400);
    fs.appendFileSync(u.file, buf);
    u.received += buf.length;
    u.next++;
    u.at = Date.now();
    return c.json({ ok: true, received: u.received, of: u.size });
  },
);

backupRoutes.post("/upload/:id/finish", async (c) => {
  const id = c.req.param("id");
  const u = incoming.get(id);
  if (!u || u.userId !== c.get("session").user!.id) return c.json({ error: "Unknown upload." }, 404);
  incoming.delete(id);
  if (u.received !== u.size) {
    fs.rmSync(u.file, { force: true });
    return c.json({ error: `Upload incomplete (${u.received} of ${u.size} bytes).` }, 400);
  }
  const encrypted = await isEncryptedBackup(u.file);
  if (!encrypted) {
    // A plain archive must at least start with our manifest.
    try {
      await inspectBackup(u.file);
    } catch (err: any) {
      fs.rmSync(u.file, { force: true });
      return c.json({ error: err?.message ?? "Not a FYRDrop backup." }, 400);
    }
  }
  const name = adoptUploaded(u.file, u.name, encrypted);
  auditRequest(c, "system.backup-uploaded", true, `Backup ${name} uploaded`, { target: name, meta: { size: u.size } });
  return c.json({ ok: true, name, encrypted }, 201);
});

/* -------------------------------- Restore --------------------------------- */

backupRoutes.post("/inspect", async (c) => {
  const body = await c.req.json<{ name?: string; passphrase?: string }>().catch(() => null);
  const p = backupPath(String(body?.name ?? ""));
  if (!p) return c.json({ error: "No such backup." }, 404);
  try {
    const manifest = await inspectBackup(p, body?.passphrase || undefined);
    return c.json({ ok: true, manifest });
  } catch (err: any) {
    const needs = err instanceof BadPassphrase;
    return c.json({ error: err?.message ?? "Could not read that backup.", needsPassphrase: needs }, needs ? 401 : 400);
  }
});

backupRoutes.post("/restore", async (c) => {
  const body = await c.req.json<{ name?: string; passphrase?: string; confirm?: string; restart?: boolean }>().catch(() => null);
  const name = String(body?.name ?? "");
  const p = backupPath(name);
  if (!p) return c.json({ error: "No such backup." }, 404);
  if (body?.confirm !== "RESTORE") return c.json({ error: 'Type RESTORE to confirm. Everything on this instance is replaced by the backup.' }, 400);
  if (backupRunning()) return c.json({ error: "Wait for the running backup to finish." }, 409);
  let manifest;
  try {
    manifest = await stageRestore(p, body?.passphrase || undefined, actorName(c));
  } catch (err: any) {
    const needs = err instanceof BadPassphrase;
    auditRequest(c, "system.restore", false, `Restore from ${name} refused: ${err?.message ?? err}`, { target: name, severity: "error" });
    return c.json({ error: err?.message ?? "Restore failed.", needsPassphrase: needs }, needs ? 401 : 400);
  }
  auditRequest(c, "system.restore", true, `Restore from ${name} staged - applies on restart`, { target: name, severity: "warn", meta: { createdAt: manifest.createdAt, includesFiles: manifest.includesFiles } });
  if (body?.restart) {
    scheduleRestart();
    setTimeout(() => process.exit(0), 600);
  }
  return c.json({ ok: true, staged: true, restarting: !!body?.restart, manifest });
});

backupRoutes.delete("/restore", (c) => {
  if (!stagedRestore()) return c.json({ error: "No restore is waiting." }, 404);
  cancelStagedRestore();
  auditRequest(c, "system.restore-cancelled", true, "Staged restore cancelled", { target: "restore" });
  return c.json({ ok: true });
});
