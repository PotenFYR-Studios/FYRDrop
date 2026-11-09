import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import { db } from "../db";
import { items, peers } from "../db/schema";
import { requireOwner } from "../lib/auth";
import { publish } from "../lib/events";
import { decryptString, readDecrypted, encryptString } from "../lib/crypto";
import { pathForRef, writeStoredFile, storageRefusal } from "../lib/storage";
import { storedFileName } from "../lib/files";
import { makeThumbnailFromBuffer } from "../lib/thumbs";
import { getSettings } from "../lib/settings";
import { isHttpUrl, ITEM_TYPES } from "../lib/content";
import { timingSafeEqualStr } from "../lib/secrets";
import { rateLimit } from "../lib/security";
import { clientIp, type AppEnv } from "../lib/net";
import { audit } from "./users";

/**
 * Federation: connect multiple FYRDrop instances and push/broadcast shared
 * content between them. Outbound pushes carry the peer's token in
 * X-FYRDrop-Token; the inbound endpoint rejects anything else.
 * Managing peers is owner-only - the server makes outbound requests to the
 * configured URL, which must never be controllable by ordinary users (SSRF).
 */

export const federationRoutes = new Hono<AppEnv>();
federationRoutes.use("*", requireOwner);

type Peer = typeof peers.$inferSelect;
const MAX_FED_BYTES = 64 * 1024 * 1024;

function serialize(p: Peer) {
  const { token, ...rest } = p;
  return { ...rest, tokenPreview: token.slice(0, 4) + "…" };
}

federationRoutes.get("/peers", (c) => c.json({ peers: db.select().from(peers).all().map(serialize) }));

federationRoutes.post("/peers", async (c) => {
  const body = await c.req.json<{ name?: string; baseUrl?: string; token?: string }>().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  let baseUrl = (typeof body?.baseUrl === "string" ? body.baseUrl : "").trim().replace(/\/+$/, "");
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!name || !baseUrl || !token) return c.json({ error: "name, baseUrl and token are required." }, 400);
  if (token.length < 16 || token.length > 256) return c.json({ error: "Token must be 16-256 characters." }, 400);
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `https://${baseUrl}`;
  if (!isHttpUrl(baseUrl)) return c.json({ error: "Invalid baseUrl." }, 400);
  const row: Peer = { id: crypto.randomUUID(), name: name.slice(0, 60), baseUrl, token, enabled: 1, lastSyncAt: null, lastStatus: "never", createdAt: Date.now() };
  db.insert(peers).values(row).run();
  publish({ scope: "settings", action: "peer-added" });
  return c.json({ peer: serialize(row) }, 201);
});

federationRoutes.delete("/peers/:id", (c) => {
  const row = db.select().from(peers).where(eq(peers.id, c.req.param("id"))).limit(1).get();
  if (!row) return c.json({ error: "Not found." }, 404);
  db.delete(peers).where(eq(peers.id, row.id)).run();
  publish({ scope: "settings", action: "peer-removed" });
  return c.json({ ok: true });
});

async function pushToPeer(peer: Peer, payload: string): Promise<{ ok: boolean; status: string }> {
  try {
    const res = await fetch(`${peer.baseUrl}/api/federation/inbound`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-fyrdrop-token": peer.token },
      body: payload,
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    const status = res.ok ? "ok" : `HTTP ${res.status}`;
    db.update(peers).set({ lastSyncAt: Date.now(), lastStatus: status }).where(eq(peers.id, peer.id)).run();
    return { ok: res.ok, status };
  } catch {
    db.update(peers).set({ lastSyncAt: Date.now(), lastStatus: "unreachable" }).where(eq(peers.id, peer.id)).run();
    return { ok: false, status: "unreachable" };
  }
}

function buildPayload(item: typeof items.$inferSelect): string | { error: string; status: 410 | 413 } {
  let fileData: string | undefined;
  if (item.storedName) {
    const fp = pathForRef(item.storedName);
    if (!fs.existsSync(fp)) return { error: "Stored file missing.", status: 410 };
    if (item.size > MAX_FED_BYTES) return { error: "File too large for federation push (max 64 MB).", status: 413 };
    fileData = readDecrypted(fp).toString("base64");
  }
  return JSON.stringify({
    from: getSettings()?.appName ?? "FYRDrop",
    item: { type: item.type, name: item.name, mime: item.mime, size: item.size, content: item.content ? decryptString(item.content) : null, fileData, uploadedBy: item.uploadedBy },
  });
}

federationRoutes.post("/peers/:id/send/:itemId", async (c) => {
  const peer = db.select().from(peers).where(eq(peers.id, c.req.param("id"))).limit(1).get();
  const item = db.select().from(items).where(eq(items.id, c.req.param("itemId"))).limit(1).get();
  if (!peer) return c.json({ error: "Peer not found." }, 404);
  if (!item) return c.json({ error: "Item not found." }, 404);
  if (peer.enabled !== 1) return c.json({ error: "Peer is disabled." }, 409);
  const payload = buildPayload(item);
  if (typeof payload !== "string") return c.json({ error: payload.error }, payload.status);
  const result = await pushToPeer(peer, payload);
  return c.json(result, result.ok ? 200 : 502);
});

federationRoutes.post("/broadcast/:itemId", async (c) => {
  const item = db.select().from(items).where(eq(items.id, c.req.param("itemId"))).limit(1).get();
  if (!item) return c.json({ error: "Item not found." }, 404);
  const enabled = db.select().from(peers).all().filter((p) => p.enabled === 1);
  if (enabled.length === 0) return c.json({ error: "No enabled peers configured." }, 409);
  const payload = buildPayload(item);
  if (typeof payload !== "string") return c.json({ error: payload.error }, payload.status);
  // Sequential: one copy of the payload in flight at a time keeps memory flat.
  const results = [];
  for (const p of enabled) results.push({ peer: p.name, ...(await pushToPeer(p, payload)) });
  publish({ scope: "settings", action: "broadcast" });
  return c.json({ results });
});

/* ----------------------- Inbound (token-authenticated) ---------------------- */

export const inboundRoutes = new Hono<AppEnv>();

inboundRoutes.post(
  "/inbound",
  rateLimit({ name: "fed-in", windowMs: 60_000, max: 60 }),
  async (c, next) => {
    // Authenticate BEFORE reading the (potentially large) body.
    const token = c.req.header("x-fyrdrop-token") ?? "";
    const peer = token ? db.select().from(peers).all().find((p) => p.enabled === 1 && timingSafeEqualStr(p.token, token)) : undefined;
    if (!peer) {
      audit(c, "federation.inbound-rejected", false, "Inbound federation request with an unknown token", { actor: { name: "unknown peer" }, target: "federation", severity: "error" });
      return c.json({ error: "Unknown federation token." }, 401);
    }
    c.set("peer" as never, peer as never);
    return next();
  },
  bodyLimit({ maxSize: Math.ceil(MAX_FED_BYTES * 1.4), onError: (c) => c.json({ error: "Payload too large." }, 413) }),
  async (c) => {
    const peer = c.get("peer" as never) as unknown as Peer;
    const body = await c.req.json<any>().catch(() => null);
    const item = body?.item;
    const type = String(item?.type ?? "");
    const name = typeof item?.name === "string" ? item.name.trim().slice(0, 200) : "";
    if (!ITEM_TYPES.has(type) || !name) return c.json({ error: "Invalid payload." }, 400);

    let storedName: string | null = null;
    let thumbName: string | null = null;
    let content: string | null = null;
    let size = 0;
    if (type === "text" || type === "url") {
      const text = typeof item.content === "string" ? item.content : "";
      if (!text || text.length > 1_000_000) return c.json({ error: "Text/url payload requires content (max 1 MB)." }, 400);
      if (type === "url" && !isHttpUrl(text)) return c.json({ error: "Only http(s) URLs are accepted." }, 400);
      content = encryptString(text);
      size = Buffer.byteLength(text);
    } else {
      if (typeof item.fileData !== "string" || !/^[A-Za-z0-9+/=\s]*$/.test(item.fileData.slice(0, 1000))) return c.json({ error: "File payload missing." }, 400);
      const buf = Buffer.from(item.fileData, "base64");
      if (buf.byteLength > MAX_FED_BYTES) return c.json({ error: "Payload too large." }, 413);
      const refusal = storageRefusal(buf.byteLength);
      if (refusal) return c.json({ error: refusal }, 507);
      const base = storedFileName(name);
      storedName = writeStoredFile(base, buf).ref;
      const mime = String(item.mime ?? "");
      if (type === "image" && mime !== "image/svg+xml") thumbName = await makeThumbnailFromBuffer(buf, base);
      size = buf.byteLength;
    }
    const row = {
      id: crypto.randomUUID(),
      type,
      name,
      mime: String(item.mime || "application/octet-stream").slice(0, 100),
      size,
      storedName,
      thumbName,
      content,
      uploadedBy: `${String(item.uploadedBy || "unknown").slice(0, 60)} @ ${String(body?.from || peer.name).slice(0, 60)}`,
      // Readable by everyone (the owner trusts this peer); only the owner may edit/delete.
      audience: "everyone",
      writeAccess: "private",
      deleteAccess: "private",
      pinned: 0,
      downloads: 0,
      createdAt: Date.now(),
      expiresAt: null as number | null,
    };
    db.insert(items).values(row).run();
    audit(c, "federation.inbound", true, `${peer.name} pushed "${name}"`, { actor: { name: peer.name }, target: name, meta: { peer: peer.name } });
    publish({ scope: "items", action: "federated", id: row.id });
    return c.json({ ok: true, id: row.id }, 201);
  },
);
