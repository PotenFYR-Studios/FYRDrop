import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { db, dirs } from "../db";
import { items, shareLinks, userPins } from "../db/schema";
import { makeThumbnail, makeThumbnailFromBuffer, deleteThumb, thumbPath } from "../lib/thumbs";
import { storedFileName } from "../lib/files";
import { requireSession, type SessionCtx } from "../lib/auth";
import { publish } from "../lib/events";
import { encryptString, decryptString, encryptPartsToFile, decryptedWebStream } from "../lib/crypto";
import { writeStoredFile, pathForRef, deleteStoredFile, unitDirForWrite, makeRef, storageRefusal, markUsageDirty } from "../lib/storage";
import { maxUploadBytes } from "../lib/settings";
import { userContentHeaders, ITEM_TYPES } from "../lib/content";
import { hashSecret, PIN_RE } from "../lib/secrets";
import { auditRequest } from "../lib/audit";
import { ensureDefaultGroup, groupAccessSet, isGroupMember } from "../lib/groups";
import type { AppEnv } from "../lib/net";

export const itemRoutes = new Hono<AppEnv>();

type Item = typeof items.$inferSelect;
type Scope = "everyone" | "selected" | "group" | "private";

itemRoutes.use("*", requireSession);

/** Multipart uploads are buffered by the runtime, so keep them small; big files go chunked. */
export const MULTIPART_MAX = 48 * 1024 * 1024;

/* ------------------------------ Access model ------------------------------ */

const ids = (v: string | null | undefined) => (v ? v.split(",").filter(Boolean) : []);

/** Group ids for the session user, cached per session object (one query per request). */
const groupCache = new WeakMap<object, Set<string>>();
function sessionGroups(session: SessionCtx): Set<string> {
  if (!session.user) return new Set();
  let set = groupCache.get(session);
  if (!set) {
    set = groupAccessSet(session.user.id);
    groupCache.set(session, set);
  }
  return set;
}

/** Read gate: owners see everything; uploaders keep their own; others need everyone/selected/group. */
function visibleTo(row: Item, session: SessionCtx) {
  const user = session.user;
  if (!user) return false;
  if (user.role === "owner" || row.userId === user.id) return true;
  if (row.audience === "everyone") return true;
  if (row.audience === "selected") return ids(row.audienceUsers).includes(user.id);
  if (row.audience === "group") {
    const mine = sessionGroups(session);
    return ids(row.audienceGroups).some((g) => mine.has(g));
  }
  return false;
}

function allowedBy(scope: string, list: string, groupList: string, row: Item, session: SessionCtx) {
  const user = session.user;
  if (!user) return false;
  if (user.role === "owner" || row.userId === user.id) return true;
  // Write/delete never exceed read: you cannot change what you cannot see.
  if (!visibleTo(row, session)) return false;
  if (scope === "everyone") return true;
  if (scope === "selected") return ids(list).includes(user.id);
  if (scope === "group") {
    const mine = sessionGroups(session);
    return ids(groupList).some((g) => mine.has(g));
  }
  return false;
}

const canWrite = (row: Item, s: SessionCtx) => allowedBy(row.writeAccess, row.writeUsers, row.writeGroups, row, s);
const canDelete = (row: Item, s: SessionCtx) => allowedBy(row.deleteAccess, row.deleteUsers, row.deleteGroups, row, s);
const canManage = (row: Item, s: SessionCtx) => s.user?.role === "owner" || (!!row.userId && row.userId === s.user?.id);

const SCOPES = new Set(["everyone", "selected", "group", "private"]);
const normScope = (v: unknown, fallback: Scope): Scope => (typeof v === "string" && SCOPES.has(v) ? (v as Scope) : fallback);
const normIds = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 500).join(",") : "";
const normGroupIds = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 200).join(",") : "";
export const cleanCategory = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 60) : "");
export const cleanLabels = (v: unknown) => {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [...new Set(list.map((x) => String(x).trim().toLowerCase()).filter(Boolean).map((x) => x.slice(0, 30)))].slice(0, 12).join(",");
};

/**
 * Parse an access spec. New items default to "everyone can read, only the
 * uploader (and owner) can edit/delete" - safer than the old everyone/everyone/everyone.
 */
function parseAccess(body: any, opts: { defaultGroupId?: string } = {}) {
  const fallbackRead: Scope = opts.defaultGroupId ? "group" : "everyone";
  const read = normScope(body?.read?.scope ?? body?.audience, fallbackRead);
  const write = normScope(body?.write?.scope, "private");
  const del = normScope(body?.delete?.scope, "private");
  const readGroups = read === "group" ? normGroupIds(body?.read?.groupIds ?? (opts.defaultGroupId ? [opts.defaultGroupId] : [])) : "";
  return {
    audience: read,
    audienceUsers: read === "selected" ? normIds(body?.read?.userIds ?? body?.audienceUserIds) : "",
    audienceGroups: readGroups,
    writeAccess: write,
    writeUsers: write === "selected" ? normIds(body?.write?.userIds) : "",
    writeGroups: write === "group" ? normGroupIds(body?.write?.groupIds) : "",
    deleteAccess: del,
    deleteUsers: del === "selected" ? normIds(body?.delete?.userIds) : "",
    deleteGroups: del === "group" ? normGroupIds(body?.delete?.groupIds) : "",
  };
}

function expiryFrom(days: unknown): number | null {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return null;
  return Date.now() + Math.min(d, 3650) * 86_400_000;
}

function pinnedSet(userId: string | undefined) {
  if (!userId) return new Set<string>();
  return new Set(db.select({ id: userPins.itemId }).from(userPins).where(eq(userPins.userId, userId)).all().map((r) => r.id));
}

function serialize(row: Item, session: SessionCtx, opts: { withContent?: boolean; pins?: Set<string> } = {}) {
  const { content, storedName, clusterOrigin, pinned: _legacy, ...rest } = row;
  const plain = opts.withContent && content ? decryptString(content) : null;
  const pins = opts.pins ?? pinnedSet(session.user?.id);
  return {
    ...rest,
    pinned: pins.has(row.id) ? 1 : 0,
    hasContent: content != null,
    preview: plain != null ? (row.type === "url" ? plain : plain.slice(0, 240)) : undefined,
    canWrite: canWrite(row, session),
    canDelete: canDelete(row, session),
    canManage: canManage(row, session),
  };
}

function load(id: string) {
  const row = db.select().from(items).where(eq(items.id, id)).limit(1).get();
  if (!row || (row.expiresAt && row.expiresAt <= Date.now())) return null;
  return row;
}

function baseRow(c: Context, partial: Partial<Item> & Pick<Item, "type" | "name" | "mime" | "size">): Item {
  const s = c.get("session") as SessionCtx;
  return {
    id: crypto.randomUUID(),
    storedName: null,
    thumbName: null,
    content: null,
    uploadedBy: s.user?.name ?? s.deviceName,
    userId: s.user?.id ?? null,
    clusterOrigin: null,
    groupId: "",
    category: "",
    labels: "",
    audience: "everyone",
    audienceUsers: "",
    audienceGroups: "",
    writeAccess: "private",
    writeUsers: "",
    writeGroups: "",
    deleteAccess: "private",
    deleteUsers: "",
    deleteGroups: "",
    pinned: 0,
    downloads: 0,
    createdAt: Date.now(),
    expiresAt: null,
    ...partial,
  };
}

/* --------------------------------- Listing -------------------------------- */

/** List items (optionally ?type=file|text|image|url). Expired ones are hidden. */
itemRoutes.get("/", (c) => {
  const type = c.req.query("type");
  if (type && !ITEM_TYPES.has(type)) return c.json({ error: "Unknown type." }, 400);
  const now = Date.now();
  const live = or(isNull(items.expiresAt), gt(items.expiresAt, now));
  const rows = db
    .select()
    .from(items)
    .where(type ? and(eq(items.type, type), live) : live)
    .orderBy(sql`${items.createdAt} desc`)
    .all();
  const session = c.get("session");
  const pins = pinnedSet(session.user?.id);
  const group = c.req.query("group") ?? "";
  const category = c.req.query("category") ?? "";
  const label = (c.req.query("label") ?? "").toLowerCase();
  const filtered = rows.filter((r) => {
    if (!visibleTo(r, session)) return false;
    if (group && r.groupId !== group) return false;
    if (category && r.category !== category) return false;
    if (label && !ids(r.labels.replace(/,/g, ",")).map((x) => x.toLowerCase()).includes(label)) return false;
    return true;
  });
  return c.json({
    items: filtered.map((r) => serialize(r, session, { withContent: r.type === "text" || r.type === "url", pins })),
  });
});

/** The signed-in user's quick links. */
itemRoutes.get("/pinned/all", (c) => {
  const session = c.get("session");
  const pins = pinnedSet(session.user?.id);
  if (pins.size === 0) return c.json({ items: [] });
  const now = Date.now();
  const rows = db
    .select()
    .from(items)
    .where(and(inArray(items.id, [...pins]), or(isNull(items.expiresAt), gt(items.expiresAt, now))))
    .orderBy(sql`${items.createdAt} desc`)
    .all();
  return c.json({ items: rows.filter((r) => visibleTo(r, session)).map((r) => serialize(r, session, { withContent: true, pins })) });
});

/* --------------------------------- Uploads -------------------------------- */

function parseFormAccess(form: FormData, defaultGroupId: string) {
  const raw = form.get("access");
  if (typeof raw === "string" && raw.length < 64_000) {
    try {
      return parseAccess(JSON.parse(raw), { defaultGroupId });
    } catch {
      /* fall through */
    }
  }
  return parseAccess(
    { audience: form.get("audience"), audienceUserIds: String(form.get("audienceUserIds") ?? "").split(",").filter(Boolean) },
    { defaultGroupId },
  );
}

/** Small uploads (multipart). Images get gallery thumbnails. */
itemRoutes.post(
  "/upload",
  bodyLimit({ maxSize: MULTIPART_MAX, onError: (c) => c.json({ error: "Upload too large for a single request - the client should use chunked upload." }, 413) }),
  async (c) => {
    const limit = maxUploadBytes();
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: "Invalid upload." }, 400);
    const files = form.getAll("files").filter((f): f is File => f instanceof File).slice(0, 50);
    if (files.length === 0) return c.json({ error: "No files provided." }, 400);
    const total = files.reduce((n, f) => n + f.size, 0);
    const refusal = storageRefusal(total);
    if (refusal) return c.json({ error: refusal }, 507);
    const expiresAt = expiryFrom(form.get("expiresDays"));
    const session = c.get("session");
    const userId = session.user!.id;
    const wanted = String(form.get("groupId") ?? "");
    const groupId = wanted && isGroupMember(wanted, userId) ? wanted : ensureDefaultGroup(userId);
    const access = parseFormAccess(form, groupId);
    const category = cleanCategory(form.get("category"));
    const labels = cleanLabels(form.get("labels"));

    const created: Item[] = [];
    for (const file of files) {
      if (file.size > limit) {
        return c.json({ error: `"${file.name}" exceeds the ${Math.round(limit / 1024 / 1024)} MB limit.` }, 413);
      }
      const name = (file.name || "file").slice(0, 200);
      const storedName = storedFileName(name);
      const buf = Buffer.from(await file.arrayBuffer());
      const { ref } = writeStoredFile(storedName, buf);
      const mime = (file.type || "application/octet-stream").slice(0, 100);
      const isImage = mime.startsWith("image/") && mime !== "image/svg+xml";
      const thumbName = isImage ? await makeThumbnailFromBuffer(buf, storedName) : null;
      const row = baseRow(c, {
        type: isImage ? "image" : "file",
        name,
        mime,
        size: buf.byteLength,
        storedName: ref,
        thumbName,
        expiresAt,
        groupId,
        category,
        labels,
        ...access,
      });
      db.insert(items).values(row).run();
      created.push(row);
    }
    publish({ scope: "items", action: "created" });
    auditRequest(c, "item.upload", true, `Uploaded ${created.length} file(s)`, {
      target: created.map((r) => r.name).join(", ").slice(0, 160),
      meta: { count: created.length, bytes: created.reduce((n, r) => n + r.size, 0) },
    });
    const pins = pinnedSet(session.user?.id);
    return c.json({ items: created.map((r) => serialize(r, session, { pins })) }, 201);
  },
);

/* --- Chunked upload for huge files ---------------------------------------
 * POST /upload/begin  {name,size,mime,chunkSize,access} -> {uploadId, chunkSize, chunkCount}
 * PUT  /upload/chunk/:uploadId/:index (raw bytes, streamed to disk)
 * POST /upload/finish {uploadId, expiresDays}
 * POST /upload/abort  {uploadId}
 * Uploads are bound to the account that started them and expire after 6 h idle.
 */

type Upload = {
  name: string;
  mime: string;
  size: number;
  chunkSize: number;
  total: number;
  received: Set<number>;
  lastActivity: number;
  userId: string;
  access: ReturnType<typeof parseAccess>;
  groupId: string;
  category: string;
  labels: string;
  finishing: boolean;
};
const activeUploads = new Map<string, Upload>();
const UPLOAD_IDLE_MS = 6 * 60 * 60_000;
const MAX_UPLOADS_PER_USER = 6;
const partPath = (id: string, i: number) => path.join(dirs.tmp, `${id}.${i}.part`);

function dropUpload(id: string) {
  const u = activeUploads.get(id);
  activeUploads.delete(id);
  if (!u) return;
  for (let i = 0; i < u.total; i++) fs.rmSync(partPath(id, i), { force: true });
}

/** Called by the maintenance timer: forget idle uploads and their temp parts. */
export function sweepUploads() {
  const now = Date.now();
  for (const [id, u] of activeUploads) if (!u.finishing && now - u.lastActivity > UPLOAD_IDLE_MS) dropUpload(id);
  // Parts left behind by a crash/restart.
  try {
    for (const f of fs.readdirSync(dirs.tmp)) {
      const id = f.split(".")[0]!;
      if (activeUploads.has(id)) continue;
      const p = path.join(dirs.tmp, f);
      try {
        if (now - fs.statSync(p).mtimeMs > UPLOAD_IDLE_MS) fs.rmSync(p, { force: true });
      } catch {
        /* gone */
      }
    }
  } catch {
    /* tmp missing */
  }
}

function ownUpload(c: Context): [string, Upload] | null {
  const id = String(c.req.param("uploadId") ?? "");
  const u = activeUploads.get(id);
  if (!u || u.userId !== (c.get("session") as SessionCtx).user?.id) return null;
  return [id, u];
}

itemRoutes.post("/upload/begin", async (c) => {
  const limit = maxUploadBytes();
  const body = await c.req.json<any>().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 200) : "";
  const size = Number(body?.size ?? 0);
  if (!name || !Number.isSafeInteger(size) || size <= 0) return c.json({ error: "name and size are required." }, 400);
  if (size > limit) return c.json({ error: `File exceeds the configured limit of ${Math.round(limit / 1024 / 1024)} MB.` }, 413);
  const refusal = storageRefusal(size);
  if (refusal) return c.json({ error: refusal }, 507);
  const userId = c.get("session").user!.id;
  let mine = 0;
  for (const u of activeUploads.values()) if (u.userId === userId) mine++;
  if (mine >= MAX_UPLOADS_PER_USER) return c.json({ error: "Too many uploads in progress - wait for one to finish." }, 429);
  const chunkSize = Math.min(Math.max(Number(body?.chunkSize) || 8 * 1024 * 1024, 1024 * 1024), 32 * 1024 * 1024);
  const uploadId = crypto.randomUUID();
  const wanted = typeof body?.groupId === "string" ? body.groupId : "";
  const groupId = wanted && isGroupMember(wanted, userId) ? wanted : ensureDefaultGroup(userId);
  activeUploads.set(uploadId, {
    name,
    mime: typeof body?.mime === "string" && body.mime ? body.mime.slice(0, 100) : "application/octet-stream",
    size,
    chunkSize,
    total: Math.ceil(size / chunkSize),
    received: new Set(),
    lastActivity: Date.now(),
    userId,
    access: parseAccess(body?.access ?? body, { defaultGroupId: groupId }),
    groupId,
    category: cleanCategory(body?.category),
    labels: cleanLabels(body?.labels),
    finishing: false,
  });
  return c.json({ uploadId, chunkSize, chunkCount: Math.ceil(size / chunkSize) }, 201);
});

itemRoutes.put(
  "/upload/chunk/:uploadId/:index",
  bodyLimit({ maxSize: 32 * 1024 * 1024 + 1024, onError: (c) => c.json({ error: "Chunk too large." }, 413) }),
  async (c) => {
    const found = ownUpload(c);
    if (!found) return c.json({ error: "Unknown uploadId - restart the upload." }, 404);
    const [id, upload] = found;
    if (upload.finishing) return c.json({ error: "Upload is being finalised." }, 409);
    const index = Number(c.req.param("index"));
    if (!Number.isInteger(index) || index < 0 || index >= upload.total) return c.json({ error: "Invalid chunk index." }, 400);
    const expected = index === upload.total - 1 ? upload.size - index * upload.chunkSize : upload.chunkSize;
    const declared = Number(c.req.header("content-length") ?? expected);
    if (declared !== expected) return c.json({ error: `Chunk ${index}: expected ${expected} bytes.` }, 400);
    // Stream straight to disk - never hold the chunk in memory. Write to a temp
    // name and rename so a retried/parallel chunk can't leave a torn file.
    const tmp = `${partPath(id, index)}.${crypto.randomBytes(4).toString("hex")}`;
    const written = await Bun.write(tmp, new Response(c.req.raw.body));
    if (written !== expected) {
      fs.rmSync(tmp, { force: true });
      return c.json({ error: `Chunk ${index}: expected ${expected} bytes, got ${written}.` }, 400);
    }
    fs.renameSync(tmp, partPath(id, index));
    upload.received.add(index);
    upload.lastActivity = Date.now();
    return c.json({ ok: true, received: upload.received.size, of: upload.total });
  },
);

itemRoutes.post("/upload/abort", async (c) => {
  const body = await c.req.json<{ uploadId?: string }>().catch(() => null);
  const u = activeUploads.get(body?.uploadId ?? "");
  if (u && u.userId === c.get("session").user?.id && !u.finishing) dropUpload(body!.uploadId!);
  return c.json({ ok: true });
});

itemRoutes.post("/upload/finish", async (c) => {
  const body = await c.req.json<{ uploadId?: string; expiresDays?: number }>().catch(() => null);
  const uploadId = body?.uploadId ?? "";
  const upload = activeUploads.get(uploadId);
  if (!upload || upload.userId !== c.get("session").user?.id) return c.json({ error: "Unknown uploadId." }, 404);
  // A double-click / retry must not assemble the same upload twice.
  if (upload.finishing) return c.json({ error: "Upload is already being finalised." }, 409);
  upload.finishing = true;

  const parts = Array.from({ length: upload.total }, (_, i) => partPath(uploadId, i));
  const missing = parts.map((p, i) => (fs.existsSync(p) ? -1 : i)).filter((i) => i >= 0);
  if (missing.length > 0) {
    upload.finishing = false;
    return c.json({ error: `Missing chunks: ${missing.slice(0, 20).join(", ")}` }, 400);
  }
  const storedName = storedFileName(upload.name);
  const unit = unitDirForWrite(upload.size);
  const ref = makeRef(unit.id, storedName);
  const target = path.join(unit.dir, storedName);
  let plainSize = 0;
  try {
    fs.mkdirSync(unit.dir, { recursive: true });
    plainSize = await encryptPartsToFile(parts, target);
  } catch (err) {
    dropUpload(uploadId);
    return c.json({ error: `Could not store the file: ${String(err)}` }, 500);
  }
  dropUpload(uploadId);
  markUsageDirty();
  if (plainSize !== upload.size) {
    fs.rmSync(target, { force: true });
    return c.json({ error: `Size mismatch after assembly (${plainSize} != ${upload.size}).` }, 400);
  }
  const isImage = upload.mime.startsWith("image/") && upload.mime !== "image/svg+xml";
  const thumbName = isImage ? await makeThumbnail(ref, upload.mime, upload.size) : null;
  const row = baseRow(c, {
    type: isImage ? "image" : "file",
    name: upload.name,
    mime: upload.mime,
    size: upload.size,
    storedName: ref,
    thumbName,
    userId: upload.userId,
    groupId: upload.groupId,
    category: upload.category,
    labels: upload.labels,
    expiresAt: expiryFrom(body?.expiresDays),
    ...upload.access,
  });
  db.insert(items).values(row).run();
  publish({ scope: "items", action: "created" });
  auditRequest(c, "item.upload", true, `Uploaded ${row.name} in ${upload.total} chunk(s)`, {
    target: row.name,
    meta: { size: row.size, chunks: upload.total, chunked: true },
  });
  return c.json({ item: serialize(row, c.get("session")) }, 201);
});

/* ------------------------------ Notes & links ----------------------------- */

itemRoutes.post("/text", async (c) => {
  const body = await c.req.json<any>().catch(() => null);
  const content = typeof body?.content === "string" ? body.content : "";
  if (!content.trim()) return c.json({ error: "Text content is required." }, 400);
  if (content.length > 1_000_000) return c.json({ error: "Text is too long (max 1 MB)." }, 400);
  const title = (typeof body?.title === "string" && body.title.trim() ? body.title.trim() : content.trim().split("\n")[0]!).slice(0, 120);
  const userId = c.get("session").user!.id;
  const wanted = typeof body?.groupId === "string" ? body.groupId : "";
  const groupId = wanted && isGroupMember(wanted, userId) ? wanted : ensureDefaultGroup(userId);
  const row = baseRow(c, {
    type: "text",
    name: title || "Untitled note",
    mime: "text/plain",
    size: Buffer.byteLength(content),
    content: encryptString(content),
    expiresAt: expiryFrom(body?.expiresDays),
    groupId,
    category: cleanCategory(body?.category),
    labels: cleanLabels(body?.labels),
    ...parseAccess(body?.access ?? body, { defaultGroupId: groupId }),
  });
  db.insert(items).values(row).run();
  publish({ scope: "items", action: "created", id: row.id });
  auditRequest(c, "item.note", true, `Created note "${row.name}"`, {
    target: row.name,
    meta: { size: row.size, read: row.audience, write: row.writeAccess, delete: row.deleteAccess },
  });
  return c.json({ item: serialize(row, c.get("session"), { withContent: true }) }, 201);
});

itemRoutes.post("/url", async (c) => {
  const body = await c.req.json<any>().catch(() => null);
  const raw = (typeof body?.url === "string" ? body.url : "").trim();
  if (!raw) return c.json({ error: "URL is required." }, 400);
  if (raw.length > 4096) return c.json({ error: "URL is too long." }, 400);
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return c.json({ error: "Invalid URL." }, 400);
  }
  if (!["http:", "https:"].includes(url.protocol)) return c.json({ error: "Only http(s) URLs are allowed." }, 400);
  if (url.username || url.password) return c.json({ error: "URLs with embedded credentials are not allowed." }, 400);
  const href = url.toString();
  const userId = c.get("session").user!.id;
  const wanted = typeof body?.groupId === "string" ? body.groupId : "";
  const groupId = wanted && isGroupMember(wanted, userId) ? wanted : ensureDefaultGroup(userId);
  const row = baseRow(c, {
    type: "url",
    name: (typeof body?.title === "string" && body.title.trim() ? body.title.trim() : url.hostname).slice(0, 120),
    mime: "text/uri-list",
    size: href.length,
    content: encryptString(href),
    expiresAt: expiryFrom(body?.expiresDays),
    groupId,
    category: cleanCategory(body?.category),
    labels: cleanLabels(body?.labels),
    ...parseAccess(body?.access ?? body, { defaultGroupId: groupId }),
  });
  db.insert(items).values(row).run();
  publish({ scope: "items", action: "created", id: row.id });
  auditRequest(c, "item.link", true, `Saved link "${row.name}"`, {
    target: row.name,
    meta: { url: href, read: row.audience },
  });
  return c.json({ item: serialize(row, c.get("session"), { withContent: true }) }, 201);
});

/** Move an item between groups, set its category and labels. */
itemRoutes.patch("/:id/meta", async (c) => {
  const row = load(c.req.param("id"));
  const session = c.get("session");
  if (!row || !visibleTo(row, session)) return c.json({ error: "Not found." }, 404);
  if (!canWrite(row, session)) return c.json({ error: "You do not have write access to this item." }, 403);
  const body = await c.req.json<any>().catch(() => null);
  const patch: Partial<Item> = {};
  if (body?.groupId !== undefined) {
    const wanted = String(body.groupId);
    patch.groupId = wanted && isGroupMember(wanted, session.user!.id) ? wanted : ensureDefaultGroup(session.user!.id);
  }
  if (body?.category !== undefined) patch.category = cleanCategory(body.category);
  if (body?.labels !== undefined) patch.labels = cleanLabels(body.labels);
  if (Object.keys(patch).length === 0) return c.json({ error: "Nothing to update." }, 400);
  db.update(items).set(patch).where(eq(items.id, row.id)).run();
  publish({ scope: "items", action: "updated", id: row.id });
  auditRequest(c, "item.meta", true, `Updated the group, category or labels on "${row.name}"`, {
    target: row.name,
    meta: { groupId: patch.groupId ?? row.groupId, category: patch.category ?? row.category, labels: patch.labels ?? row.labels },
  });
  return c.json({ item: serialize(load(row.id)!, session, { withContent: row.type === "text" || row.type === "url" }) });
});

/** One-click share link: reuses a live link if there is one, otherwise creates a 7 day, no-PIN link. */
itemRoutes.post("/:id/quick-link", async (c) => {
  const row = load(c.req.param("id"));
  const session = c.get("session");
  if (!row || !visibleTo(row, session)) return c.json({ error: "Not found." }, 404);
  if (!canManage(row, session)) return c.json({ error: "Only the owner or uploader can share this." }, 403);
  const now = Date.now();
  const existing = db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.itemId, row.id))
    .all()
    .find((l) => (!l.expiresAt || l.expiresAt > now) && (l.maxDownloads == null || l.downloads < l.maxDownloads) && !l.pinHash);
  if (existing) return c.json({ token: existing.token, url: `/s/${existing.token}`, reused: true });
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let token = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    token = Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join("");
    if (!db.select({ token: shareLinks.token }).from(shareLinks).where(eq(shareLinks.token, token)).limit(1).get()) break;
  }
  db.insert(shareLinks)
    .values({
      token,
      itemId: row.id,
      createdAt: now,
      expiresAt: now + 7 * 86_400_000,
      maxDownloads: null,
      createdBy: session.user?.name ?? session.deviceName,
      pinHash: null,
      note: "Quick link",
      allowedUsers: "",
    })
    .run();
  publish({ scope: "items", action: "shared", id: row.id });
  auditRequest(c, "share.quick", true, `Created a quick link for "${row.name}"`, { target: row.name, meta: { expiresInDays: 7 } });
  return c.json({ token, url: `/s/${token}`, reused: false }, 201);
});

/* ------------------------------- Share links ------------------------------ */

itemRoutes.post("/:id/share", async (c) => {
  const row = load(c.req.param("id"));
  const session = c.get("session");
  if (!row || !visibleTo(row, session)) return c.json({ error: "Not found." }, 404);
  const body = await c.req.json<any>().catch(() => null);
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  if (pin && !PIN_RE.test(pin)) return c.json({ error: "Link PIN must be 4-10 digits." }, 400);
  const maxDl = Number(body?.maxDownloads);
  // Short, URL-safe tokens: 8 characters from a 57 symbol alphabet (~46 bits).
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let token = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const bytes = crypto.randomBytes(8);
    token = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    if (!db.select({ token: shareLinks.token }).from(shareLinks).where(eq(shareLinks.token, token)).limit(1).get()) break;
  }
  db.insert(shareLinks)
    .values({
      token,
      itemId: row.id,
      createdAt: Date.now(),
      expiresAt: expiryFrom(body?.expiresDays),
      maxDownloads: Number.isInteger(maxDl) && maxDl > 0 ? Math.min(maxDl, 1_000_000) : null,
      createdBy: session.user?.name ?? session.deviceName,
      pinHash: pin ? await hashSecret(pin) : null,
      note: typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null,
      allowedUsers: normIds(body?.allowedUserIds),
    })
    .run();
  publish({ scope: "items", action: "shared", id: row.id });
  auditRequest(c, "share.link-created", true, `Created a share link for "${row.name}"`, {
    target: row.name,
    meta: {
      pin: !!pin,
      maxDownloads: Number.isInteger(maxDl) && maxDl > 0 ? maxDl : null,
      expiresInDays: Number(body?.expiresDays) || 0,
      restrictedToAccounts: !!(body?.allowedUserIds && String(body.allowedUserIds).length),
    },
  });
  return c.json({ token, url: `/s/${token}` }, 201);
});

/** Existing links for an item (manager only; never exposes PIN hashes). */
itemRoutes.get("/:id/share", (c) => {
  const row = load(c.req.param("id"));
  const session = c.get("session");
  if (!row || !visibleTo(row, session)) return c.json({ error: "Not found." }, 404);
  const now = Date.now();
  const manager = canManage(row, session);
  const links = db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.itemId, row.id))
    .all()
    .filter((l) => manager || l.createdBy === (session.user?.name ?? ""))
    .map(({ pinHash, ...l }) => ({
      ...l,
      hasPin: !!pinHash,
      url: `/s/${l.token}`,
      active: (!l.expiresAt || l.expiresAt > now) && (l.maxDownloads === null || l.downloads < l.maxDownloads),
    }));
  return c.json({ links });
});

itemRoutes.delete("/:id/share/:token", (c) => {
  const row = load(c.req.param("id"));
  const session = c.get("session");
  if (!row || !visibleTo(row, session)) return c.json({ error: "Not found." }, 404);
  const link = db.select().from(shareLinks).where(and(eq(shareLinks.token, c.req.param("token")), eq(shareLinks.itemId, row.id))).get();
  if (!link) return c.json({ error: "Not found." }, 404);
  if (!canManage(row, session) && link.createdBy !== session.user?.name) return c.json({ error: "Not allowed." }, 403);
  db.delete(shareLinks).where(eq(shareLinks.token, link.token)).run();
  auditRequest(c, "share.link-revoked", true, `Revoked a share link for "${row.name}"`, {
    target: row.name,
    meta: { linkCreatedBy: link.createdBy },
  });
  return c.json({ ok: true });
});

/* ------------------------------ Serving bytes ----------------------------- */

function serve(c: Context, row: Item, inline: boolean) {
  if (row.type === "text" || row.type === "url") {
    const body = decryptString(row.content ?? "");
    const name = row.type === "url" ? `${row.name}.url.txt` : row.name.endsWith(".txt") ? row.name : `${row.name}.txt`;
    return c.body(body, 200, userContentHeaders({ mime: "text/plain", name, inline }));
  }
  const fp = pathForRef(row.storedName ?? "");
  if (!fs.existsSync(fp)) return c.json({ error: "Stored file is missing." }, 410);
  // Stream-decrypt on the way out - no full buffering for huge files.
  return c.body(decryptedWebStream(fp), 200, userContentHeaders({ mime: row.mime, name: row.name, inline, size: row.size }));
}

itemRoutes.get("/:id/download", (c) => {
  const row = load(c.req.param("id"));
  if (!row || !visibleTo(row, c.get("session"))) return c.json({ error: "Not found." }, 404);
  // Atomic increment: concurrent downloads never lose a count.
  db.update(items).set({ downloads: sql`${items.downloads} + 1` }).where(eq(items.id, row.id)).run();
  publish({ scope: "items", action: "download", id: row.id });
  auditRequest(c, "item.download", true, `Downloaded "${row.name}"`, { target: row.name, meta: { size: row.size, type: row.type } });
  return serve(c, row, false);
});

/** Inline preview inside FYRDrop (safe media types only; others download). */
itemRoutes.get("/:id/preview", (c) => {
  const row = load(c.req.param("id"));
  if (!row || !visibleTo(row, c.get("session"))) return c.json({ error: "Not found." }, 404);
  return serve(c, row, true);
});

itemRoutes.get("/:id/thumb", (c) => {
  const row = load(c.req.param("id"));
  if (!row || !row.thumbName || !visibleTo(row, c.get("session"))) return c.json({ error: "Not found." }, 404);
  const fp = thumbPath(row.thumbName);
  if (!fs.existsSync(fp)) return c.json({ error: "Thumbnail missing." }, 410);
  return new Response(Bun.file(fp), {
    headers: { "content-type": "image/webp", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" },
  });
});

/* -------------------------------- Mutations ------------------------------- */

/** Change who can read (works after upload too). */
itemRoutes.patch("/:id/audience", async (c) => {
  const row = load(c.req.param("id"));
  if (!row) return c.json({ error: "Not found." }, 404);
  if (!canManage(row, c.get("session"))) return c.json({ error: "Only the owner or uploader can change this." }, 403);
  const body = await c.req.json<any>().catch(() => null);
  const acc = parseAccess({ read: { scope: body?.audience, userIds: body?.audienceUserIds }, write: { scope: row.writeAccess, userIds: ids(row.writeUsers) }, delete: { scope: row.deleteAccess, userIds: ids(row.deleteUsers) } });
  db.update(items).set({ audience: acc.audience, audienceUsers: acc.audienceUsers }).where(eq(items.id, row.id)).run();
  publish({ scope: "items", action: "audience", id: row.id });
  auditRequest(c, "item.audience", true, `Changed who can read "${row.name}"`, { target: row.name, meta: { read: acc.audience } });
  return c.json({ ok: true, audience: acc.audience, audienceUsers: acc.audienceUsers });
});

itemRoutes.patch("/:id/content", async (c) => {
  const row = load(c.req.param("id"));
  const session = c.get("session");
  if (!row || !visibleTo(row, session)) return c.json({ error: "Not found." }, 404);
  if (row.type !== "text") return c.json({ error: "Only notes can be edited." }, 400);
  if (!canWrite(row, session)) return c.json({ error: "You do not have write access to this item." }, 403);
  const body = await c.req.json<{ content?: string; title?: string }>().catch(() => null);
  if (typeof body?.content !== "string") return c.json({ error: "content is required." }, 400);
  if (body.content.length > 1_000_000) return c.json({ error: "Content too large." }, 413);
  db.update(items)
    .set({
      content: encryptString(body.content),
      size: Buffer.byteLength(body.content),
      name: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : row.name,
    })
    .where(eq(items.id, row.id))
    .run();
  publish({ scope: "items", action: "updated", id: row.id });
  return c.json({ item: serialize(load(row.id)!, session, { withContent: true }) });
});

/** Rename any item (write access). */
itemRoutes.patch("/:id/name", async (c) => {
  const row = load(c.req.param("id"));
  const session = c.get("session");
  if (!row || !visibleTo(row, session)) return c.json({ error: "Not found." }, 404);
  if (!canWrite(row, session)) return c.json({ error: "You do not have write access to this item." }, 403);
  const body = await c.req.json<{ name?: string }>().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 200) : "";
  if (!name) return c.json({ error: "Name is required." }, 400);
  db.update(items).set({ name }).where(eq(items.id, row.id)).run();
  publish({ scope: "items", action: "updated", id: row.id });
  auditRequest(c, "item.renamed", true, `Renamed "${row.name}" to "${name}"`, { target: name, meta: { from: row.name } });
  return c.json({ item: serialize(load(row.id)!, session, { withContent: row.type === "text" || row.type === "url" }) });
});

/** Set read/write/delete access (owner or uploader). */
itemRoutes.patch("/:id/access", async (c) => {
  const row = load(c.req.param("id"));
  const session = c.get("session");
  if (!row) return c.json({ error: "Not found." }, 404);
  if (!canManage(row, session)) return c.json({ error: "Only the owner or uploader can change access." }, 403);
  const body = await c.req.json<any>().catch(() => null);
  db.update(items).set(parseAccess(body)).where(eq(items.id, row.id)).run();
  publish({ scope: "items", action: "access", id: row.id });
  auditRequest(c, "item.access", true, `Changed access on "${row.name}"`, { target: row.name, meta: { ...parseAccess(body) } });
  return c.json({ item: serialize(load(row.id)!, session, { withContent: row.type === "text" || row.type === "url" }) });
});

/** Personal quick-link pin. */
itemRoutes.patch("/:id/pin", async (c) => {
  const row = load(c.req.param("id"));
  const session = c.get("session");
  if (!row || !visibleTo(row, session)) return c.json({ error: "Not found." }, 404);
  const body = await c.req.json<{ pinned?: boolean }>().catch(() => null);
  const userId = session.user!.id;
  if (body?.pinned) {
    db.insert(userPins).values({ userId, itemId: row.id, createdAt: Date.now() }).onConflictDoNothing().run();
  } else {
    db.delete(userPins).where(and(eq(userPins.userId, userId), eq(userPins.itemId, row.id))).run();
  }
  publish({ scope: "items", action: "pinned", id: row.id });
  return c.json({ ok: true, pinned: !!body?.pinned });
});

itemRoutes.delete("/:id", (c) => {
  const row = db.select().from(items).where(eq(items.id, c.req.param("id"))).limit(1).get();
  const session = c.get("session");
  if (!row || !visibleTo(row, session)) return c.json({ error: "Not found." }, 404);
  if (!canDelete(row, session)) return c.json({ error: "You do not have delete access to this item." }, 403);
  // Delete the row first so concurrent readers stop finding it, then the bytes.
  const gone = db.delete(items).where(eq(items.id, row.id)).returning({ id: items.id }).all();
  if (gone.length === 0) return c.json({ ok: true }); // a parallel delete won the race
  db.delete(shareLinks).where(eq(shareLinks.itemId, row.id)).run();
  db.delete(userPins).where(eq(userPins.itemId, row.id)).run();
  if (row.storedName) deleteStoredFile(row.storedName);
  deleteThumb(row.thumbName);
  publish({ scope: "items", action: "deleted", id: row.id });
  auditRequest(c, "item.deleted", true, `Deleted "${row.name}"`, { target: row.name, meta: { type: row.type, size: row.size }, severity: "warn" });
  return c.json({ ok: true });
});
