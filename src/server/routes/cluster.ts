import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq, sql } from "drizzle-orm";
import fs from "node:fs";
import crypto from "node:crypto";
import { db } from "../db";
import { clusterNodes, clusterUsers, items, kv, groupMembers, users } from "../db/schema";
import { decryptString, encryptString, readDecrypted } from "../lib/crypto";
import { writeStoredFile, pathForRef, deleteStoredFile, availableBytes, quotaBytes, localStorageBytes } from "../lib/storage";
import { storedFileName } from "../lib/files";
import { makeThumbnailFromBuffer, deleteThumb } from "../lib/thumbs";
import { publish } from "../lib/events";
import {
  getIdentity,
  signRequest,
  verifySignedRequest,
  seal,
  open,
  deriveLinkKey,
  newEphemeral,
  keyFingerprint,
  pairFingerprint,
} from "../lib/cluster";
import { discovered, scanNetwork, advertisedUrl } from "../lib/discovery";
import { requireOwner } from "../lib/auth";
import { getSettings } from "../lib/settings";
import { currentPin } from "../lib/bootstrap";
import { isHttpUrl, ITEM_TYPES } from "../lib/content";
import { rateLimit } from "../lib/security";
import { auditRequest, type LogInput } from "../lib/audit";
import type { AppEnv } from "../lib/net";
import { checkReplicas, deleteReplicas, getReplica, replicationSummary, runRebalance, setPolicy, storeReplica } from "../lib/replication";
import { replicas } from "../db/schema";
import { effectivePort } from "../lib/config";

/* =========================================================================
 * Owner (admin) API - session authenticated, mounted at /api/cluster
 * ========================================================================= */

declare module "hono" {
  interface ContextVariableMap {
    clusterAuth: { node: typeof clusterNodes.$inferSelect; key: Buffer; payload: any };
  }
}

export const clusterRoutes = new Hono<AppEnv>();
clusterRoutes.use("*", requireOwner);

const MAX_CLUSTER_BYTES = 64 * 1024 * 1024;

/** Validate an item payload received from a peer. */
function cleanRemoteItem(it: any) {
  const type = String(it?.type ?? "");
  const name = typeof it?.name === "string" ? it.name.trim().slice(0, 200) : "";
  if (!ITEM_TYPES.has(type) || !name) return null;
  const mime = String(it?.mime || "application/octet-stream").slice(0, 100);
  if (type === "url" && typeof it.content === "string" && !isHttpUrl(it.content)) return null;
  if (typeof it?.content === "string" && it.content.length > 1_000_000) return null;
  return { type, name, mime, uploadedBy: String(it?.uploadedBy ?? "peer").slice(0, 60) };
}

/** Store a validated remote payload as a local item. */
async function storeRemote(
  meta: NonNullable<ReturnType<typeof cleanRemoteItem>>,
  data: { buf?: Buffer; text?: string },
  extra: { uploadedBy: string; clusterOrigin: string | null },
) {
  let storedRef: string | null = null;
  let thumbName: string | null = null;
  let content: string | null = null;
  let size = 0;
  if (meta.type === "file" || meta.type === "image") {
    if (!data.buf) return null;
    const baseName = storedFileName(meta.name);
    storedRef = writeStoredFile(baseName, data.buf).ref;
    if (meta.type === "image" && meta.mime !== "image/svg+xml") thumbName = await makeThumbnailFromBuffer(data.buf, baseName);
    size = data.buf.byteLength;
  } else {
    const text = data.text ?? data.buf?.toString("utf8") ?? "";
    if (!text || text.length > 1_000_000) return null;
    if (meta.type === "url" && !isHttpUrl(text)) return null;
    content = encryptString(text);
    size = Buffer.byteLength(text);
  }
  const row = {
    id: crypto.randomUUID(),
    type: meta.type,
    name: meta.name,
    mime: meta.mime,
    size,
    storedName: storedRef,
    thumbName,
    content,
    uploadedBy: extra.uploadedBy,
    userId: null,
    clusterOrigin: extra.clusterOrigin,
    audience: "everyone",
    audienceUsers: "",
    writeAccess: "private",
    writeUsers: "",
    deleteAccess: "private",
    deleteUsers: "",
    pinned: 0,
    downloads: 0,
    createdAt: Date.now(),
    expiresAt: null as number | null,
  };
  db.insert(items).values(row).run();
  return row;
}
const PENDING_TTL = 15 * 60_000;
const appName = () => getSettings()?.appName ?? "FYRDrop";
const selfUrl = () => advertisedUrl();

type ClusterAudit = Omit<LogInput, "event" | "ok" | "detail">;
function audit(c: Context, event: string, ok: boolean, detail: string, extra: ClusterAudit = {}) {
  auditRequest(c, event, ok, detail, extra);
}

function peerKey(node: typeof clusterNodes.$inferSelect): Buffer | null {
  if (!node.publicKey) return null;
  try {
    return Buffer.from(decryptString(node.secret), "base64");
  } catch {
    return null;
  }
}

function serializeNode(n: typeof clusterNodes.$inferSelect) {
  const { secret: _secret, pinEnc, ...rest } = n;
  let pin = "";
  try {
    pin = pinEnc ? decryptString(pinEnc) : "";
  } catch {
    pin = "";
  }
  return { ...rest, pin, needsRepair: !n.publicKey };
}

interface PendingIn {
  nodeId: string;
  name: string;
  url: string;
  ip: string;
  ephPub: string;
  staticPub: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
}
interface PendingOut {
  nodeId: string;
  name: string;
  url: string;
  nonce: string;
  ephPriv: string;
  ephPub: string;
  staticPub: string;
  stage: "requested" | "confirmed";
  remoteEphPub?: string;
  remoteStaticPub?: string;
  keyEnc?: string;
  createdAt: number;
  expiresAt: number;
}

const kvGet = <T>(key: string): T | null => {
  const row = db.select().from(kv).where(eq(kv.key, key)).limit(1).get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
};
const kvSet = (key: string, value: unknown) =>
  db.insert(kv).values({ key, value: JSON.stringify(value) }).onConflictDoUpdate({ target: kv.key, set: { value: JSON.stringify(value) } }).run();
const kvDel = (key: string) => db.delete(kv).where(eq(kv.key, key)).run();

function pendingIncoming(): PendingIn[] {
  const out: PendingIn[] = [];
  for (const row of db.select().from(kv).where(sql`${kv.key} like 'cluster:in:%'`).all()) {
    try {
      const p = JSON.parse(row.value) as PendingIn;
      if (p.expiresAt > Date.now()) out.push(p);
      else db.delete(kv).where(eq(kv.key, row.key)).run();
    } catch {
      db.delete(kv).where(eq(kv.key, row.key)).run();
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

function pendingOutgoing(): PendingOut[] {
  const out: PendingOut[] = [];
  for (const row of db.select().from(kv).where(sql`${kv.key} like 'cluster:out:%'`).all()) {
    try {
      const p = JSON.parse(row.value) as PendingOut;
      if (p.expiresAt > Date.now()) out.push(p);
      else db.delete(kv).where(eq(kv.key, row.key)).run();
    } catch {
      db.delete(kv).where(eq(kv.key, row.key)).run();
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/* ------------------------------ Owner surface ----------------------------- */

clusterRoutes.get("/", (c) => {
  const id = getIdentity();
  const nodes = db.select().from(clusterNodes).all().sort((a, b) => (b.linkedAt ?? b.createdAt) - (a.linkedAt ?? a.createdAt));
  const itemCount = db.select({ n: sql<number>`count(*)` }).from(items).get()?.n ?? 0;
  const local = localStorageBytes();
  return c.json({
    identity: {
      nodeId: id.id,
      shortId: id.id.slice(0, 8),
      fingerprint: keyFingerprint(id.publicKey),
      name: appName(),
      url: selfUrl(),
      storageBytes: local,
      itemCount,
      encryption: "AES-256-GCM per link, keys derived with X25519",
    },
    nodes: nodes.map(serializeNode),
    pending: {
      incoming: pendingIncoming(),
      outgoing: pendingOutgoing().map(({ ephPriv: _k, keyEnc: _e, ...rest }) => rest),
    },
    discovered: discovered().filter((d) => !nodes.some((n) => n.id === d.nodeId)),
    aggregate: {
      nodes: nodes.length + 1,
      storageBytes: local + nodes.reduce((a, n) => a + n.lastStorageBytes, 0),
      itemCount: itemCount + nodes.reduce((a, n) => a + n.lastItemCount, 0),
    },
  });
});

/** Step 1: ask a discovered instance to link. Nothing is stored on our side until its admin approves. */
clusterRoutes.post("/request", rateLimit({ name: "cluster-request", windowMs: 60_000, max: 10 }), async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => null);
  const url = String(body?.url ?? "").trim().replace(/\/+$/, "");
  if (!isHttpUrl(url)) return c.json({ error: "Enter the http(s) address of the other instance." }, 400);
  const id = getIdentity();
  const eph = newEphemeral();
  const nonce = crypto.randomBytes(16).toString("base64url");
  let res: Response;
  try {
    res = await fetch(`${url}/api/cluster-node/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ v: 2, nodeId: id.id, name: appName(), url: selfUrl(), staticPub: id.publicKey, ephPub: eph.publicKey, nonce }),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    return c.json({ error: `Could not reach ${url}: ${String(err).slice(0, 180)}` }, 502);
  }
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) return c.json({ error: String(data?.error ?? `That instance refused the request (HTTP ${res.status}).`).slice(0, 300) }, 502);
  const pending: PendingOut = {
    nodeId: String(data.nodeId ?? ""),
    name: String(data.name ?? "Peer").slice(0, 60),
    url,
    nonce,
    ephPriv: eph.privateKey,
    ephPub: eph.publicKey,
    staticPub: id.publicKey,
    stage: "requested",
    createdAt: Date.now(),
    expiresAt: Date.now() + PENDING_TTL,
  };
  if (!/^[0-9a-f]{16,64}$/i.test(pending.nodeId)) return c.json({ error: "That instance returned an invalid node id." }, 502);
  kvSet(`cluster:out:${pending.nodeId}`, pending);
  publish({ scope: "settings", action: "cluster-pending" });
  audit(c, "cluster.requested", true, `Asked "${pending.name}" to link`, { target: pending.name, meta: { url, nodeId: pending.nodeId } });
  return c.json({ ok: true, pending: { ...pending, ephPriv: undefined, staticPriv: undefined } });
});

/** Step 2 (target side): approve the incoming request. This sends our confirmation to the requester. */
clusterRoutes.post("/incoming/:nodeId/approve", async (c) => {
  const nodeId = c.req.param("nodeId");
  const pending = kvGet<PendingIn>(`cluster:in:${nodeId}`);
  if (!pending || pending.expiresAt < Date.now()) return c.json({ error: "Request not found or expired." }, 404);
  const id = getIdentity();
  const eph = newEphemeral();
  const key = deriveLinkKey(
    { nodeId: id.id, ephPriv: eph.privateKey, ephPub: eph.publicKey, staticPriv: id.privateKey, staticPub: id.publicKey },
    { nodeId: pending.nodeId, ephPub: pending.ephPub, staticPub: pending.staticPub },
  );
  kvSet(`cluster:b:${pending.nodeId}`, {
    nodeId: pending.nodeId,
    name: pending.name,
    url: pending.url,
    keyEnc: encryptString(key.toString("base64")),
    ephPub: eph.publicKey,
    nonce: pending.nonce,
    expiresAt: Date.now() + PENDING_TTL,
  });
  try {
    const res = await fetch(`${pending.url.replace(/\/+$/, "")}/api/cluster-node/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        v: 2,
        nodeId: id.id,
        name: appName(),
        url: selfUrl(),
        staticPub: id.publicKey,
        ephPub: eph.publicKey,
        nonce: pending.nonce,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  } catch (err) {
    kvDel(`cluster:b:${pending.nodeId}`);
    return c.json({ error: `Could not confirm with the requester: ${String(err).slice(0, 180)}` }, 502);
  }
  kvDel(`cluster:in:${pending.nodeId}`);
  publish({ scope: "settings", action: "cluster-approved" });
  audit(c, "cluster.approved", true, `Approved "${pending.name}" (waiting for its admin to approve too)`, {
    target: pending.name,
    meta: { nodeId: pending.nodeId, url: pending.url, ip: pending.ip },
  });
  return c.json({ ok: true, waitingForPeer: true });
});

clusterRoutes.post("/incoming/:nodeId/reject", (c) => {
  const pending = kvGet<PendingIn>(`cluster:in:${c.req.param("nodeId")}`);
  if (pending) {
    kvDel(`cluster:in:${pending.nodeId}`);
    audit(c, "cluster.rejected", true, `Rejected link request from "${pending.name}"`, { target: pending.name, severity: "warn" });
  }
  return c.json({ ok: true });
});

/** Step 3 (requester side): the peer approved; our admin approves too and the link goes live. */
clusterRoutes.post("/outgoing/:nodeId/approve", async (c) => {
  const nodeId = c.req.param("nodeId");
  const out = kvGet<PendingOut>(`cluster:out:${nodeId}`);
  if (!out || out.expiresAt < Date.now()) return c.json({ error: "Request not found or expired." }, 404);
  if (out.stage !== "confirmed" || !out.keyEnc || !out.remoteEphPub || !out.remoteStaticPub) {
    return c.json({ error: "The other admin has not approved yet." }, 409);
  }
  const key = Buffer.from(decryptString(out.keyEnc), "base64");

  // Tell the peer the link is live before we store anything locally: sealed and
  // signed, so only the peer that derived the same key can read it. If this
  // fails, neither side is linked and the pending request stays for a retry.
  try {
    const payload = seal(key, { nodeId: getIdentity().id, staticPub: getIdentity().publicKey });
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      ...signRequest(key, getIdentity().id, "POST", "/api/cluster-node/activate", body),
      "content-type": "application/json",
    };
    const res = await fetch(`${out.url.replace(/\/+$/, "")}/api/cluster-node/activate`, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as any;
      return c.json({ error: `The other side did not finish linking: ${String(data?.error ?? `HTTP ${res.status}`).slice(0, 200)}` }, 502);
    }
  } catch (err) {
    return c.json({ error: `Could not confirm the link: ${String(err).slice(0, 200)}` }, 502);
  }

  const fingerprint = pairFingerprint(getIdentity().publicKey, out.remoteStaticPub);
  const existing = db.select().from(clusterNodes).where(eq(clusterNodes.id, out.nodeId)).limit(1).get();
  const row = {
    name: out.name,
    baseUrl: out.url,
    secret: encryptString(key.toString("base64")),
    publicKey: out.remoteStaticPub,
    fingerprint,
    status: "linked",
    linkedAt: Date.now(),
    lastStatus: "linked",
  };
  if (existing) db.update(clusterNodes).set(row).where(eq(clusterNodes.id, out.nodeId)).run();
  else db.insert(clusterNodes).values({ id: out.nodeId, createdAt: Date.now(), ...row }).run();
  kvDel(`cluster:out:${nodeId}`);

  publish({ scope: "settings", action: "cluster-linked" });
  // Pull the peer's manifest straight away so the counts are not zero.
  try {
    const fresh = db.select().from(clusterNodes).where(eq(clusterNodes.id, out.nodeId)).limit(1).get();
    if (fresh) {
      const manifest = (await sealedFetch(fresh, key, "GET", "/api/cluster-node/manifest", undefined, 10_000)) as any;
      db.update(clusterNodes)
        .set({
          lastStatus: "ok",
          lastSeenAt: Date.now(),
          lastStorageBytes: Number(manifest?.storage?.bytes) || 0,
          lastItemCount: Number(manifest?.storage?.count) || 0,
        })
        .where(eq(clusterNodes.id, out.nodeId))
        .run();
    }
  } catch {
    /* the manual refresh button covers this */
  }
  try {
    const fresh = db.select().from(clusterNodes).where(eq(clusterNodes.id, out.nodeId)).limit(1).get();
    if (fresh) {
      await syncClusterUsers(fresh, key);
      await syncPeerPin(fresh, key);
    }
  } catch {
    /* directory is best effort */
  }
  audit(c, "cluster.linked", true, `Linked with "${out.name}"`, {
    target: out.name,
    meta: { nodeId: out.nodeId, fingerprint, encryption: "aes-256-gcm" },
  });
  return c.json({ ok: true, node: serializeNode(db.select().from(clusterNodes).where(eq(clusterNodes.id, nodeId)).limit(1).get()!) });
});

clusterRoutes.post("/outgoing/:nodeId/reject", async (c) => {
  const out = kvGet<PendingOut>(`cluster:out:${c.req.param("nodeId")}`);
  if (out) {
    kvDel(`cluster:out:${out.nodeId}`);
    try {
      await fetch(`${out.url.replace(/\/+$/, "")}/api/cluster-node/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId: getIdentity().id, nonce: out.nonce }),
        redirect: "error",
        signal: AbortSignal.timeout(6_000),
      });
    } catch {
      /* peer will time the pending entry out */
    }
    audit(c, "cluster.cancelled", true, `Cancelled the link request to "${out.name}"`, { target: out.name });
  }
  return c.json({ ok: true });
});

clusterRoutes.post("/scan", async (c) => {
  const found = await scanNetwork();
  audit(c, "cluster.scanned", true, `Network scan found ${found.length} instance(s)`, { meta: { found: found.map((f) => f.url) } });
  return c.json({ ok: true, found, discovered: discovered() });
});

/** Refresh manifests for every linked node (best effort, bounded concurrency). */
clusterRoutes.post("/refresh", async (c) => {
  const nodes = db.select().from(clusterNodes).all();
  const results: { id: string; ok: boolean; error?: string }[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < nodes.length) {
      const node = nodes[cursor++];
      if (!node) continue;
      const key = peerKey(node);
      if (!key) {
        results.push({ id: node.id, ok: false, error: "needs re-pair" });
        continue;
      }
      try {
        const data = (await sealedFetch(node, key, "GET", "/api/cluster-node/manifest")) as any;
        db.update(clusterNodes)
          .set({
            lastStatus: "ok",
            lastSeenAt: Date.now(),
            lastStorageBytes: Number(data?.storage?.bytes) || 0,
            lastItemCount: Number(data?.storage?.count) || 0,
          })
          .where(eq(clusterNodes.id, node.id))
          .run();
        await syncClusterUsers(node, key);
        await syncPeerPin(node, key);
        results.push({ id: node.id, ok: true });
      } catch (err) {
        db.update(clusterNodes).set({ lastStatus: "unreachable", lastSeenAt: Date.now() }).where(eq(clusterNodes.id, node.id)).run();
        results.push({ id: node.id, ok: false, error: String(err).slice(0, 160) });
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return c.json({ ok: true, results, nodes: db.select().from(clusterNodes).all().map(serializeNode) });
});

/** Pull a shared item from a peer into local storage. */
clusterRoutes.post("/:id/fetch/:itemId", async (c) => {
  const node = db.select().from(clusterNodes).where(eq(clusterNodes.id, c.req.param("id"))).limit(1).get();
  if (!node) return c.json({ error: "Node not found." }, 404);
  const key = peerKey(node);
  if (!key) return c.json({ error: "This link predates encrypted transport. Unlink and pair again." }, 409);
  const itemId = c.req.param("itemId");
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return c.json({ error: "Invalid item id." }, 400);
  let data: any;
  try {
    data = await sealedFetch(node, key, "GET", `/api/cluster-node/item/${itemId}`, "", 300_000);
  } catch (err) {
    return c.json({ error: String(err).slice(0, 240) }, 502);
  }
  const buf = typeof data?.fileData === "string" ? Buffer.from(data.fileData, "base64") : undefined;
  if (buf && buf.byteLength > MAX_CLUSTER_BYTES) return c.json({ error: "Remote item is too large to import (max 64 MB)." }, 413);
  if (buf && availableBytes() < buf.byteLength) return c.json({ error: "Not enough local storage." }, 507);
  const meta = cleanRemoteItem(data?.item);
  if (!meta) return c.json({ error: "Peer sent invalid item metadata." }, 502);
  const row = await storeRemote(meta, { buf, text: typeof data?.item?.content === "string" ? data.item.content : undefined }, {
    uploadedBy: `${meta.uploadedBy} @ ${node.name}`,
    clusterOrigin: null,
  });
  if (!row) return c.json({ error: "Peer sent an invalid payload." }, 502);
  publish({ scope: "items", action: "cluster-import", id: row.id });
  audit(c, "cluster.imported", true, `Imported "${row.name}" from ${node.name}`, { target: row.name, meta: { node: node.name } });
  return c.json({ ok: true, item: { id: row.id, name: row.name } }, 201);
});

/** Mirror a local item into a peer. */
clusterRoutes.post("/:id/push/:itemId", async (c) => {
  const node = db.select().from(clusterNodes).where(eq(clusterNodes.id, c.req.param("id"))).limit(1).get();
  if (!node) return c.json({ error: "Node not found." }, 404);
  const item = db.select().from(items).where(eq(items.id, c.req.param("itemId"))).limit(1).get();
  if (!item) return c.json({ error: "Item not found." }, 404);
  const key = peerKey(node);
  if (!key) return c.json({ error: "This link predates encrypted transport. Unlink and pair again." }, 409);
  let fileData: string | undefined;
  if (item.storedName) {
    const fp = pathForRef(item.storedName);
    if (!fs.existsSync(fp)) return c.json({ error: "Stored file missing." }, 410);
    if (item.size > MAX_CLUSTER_BYTES) return c.json({ error: "File too large for cluster push (max 64 MB)." }, 413);
    fileData = readDecrypted(fp).toString("base64");
  }
  try {
    const data = (await sealedFetch(
      node,
      key,
      "POST",
      "/api/cluster-node/push",
      { item: { type: item.type, name: item.name, mime: item.mime, size: item.size, content: item.content ? decryptString(item.content) : null, fileData, uploadedBy: item.uploadedBy } },
      300_000,
    )) as any;
    audit(c, "cluster.pushed", true, `Pushed "${item.name}" to ${node.name}`, { target: item.name, meta: { node: node.name, remoteId: data?.id } });
    return c.json({ ok: true, remoteId: data?.id });
  } catch (err) {
    return c.json({ error: String(err).slice(0, 240) }, 502);
  }
});

/** Unlink: reclaim what this peer stored for us, then forget the link on both sides. */
clusterRoutes.delete("/:id", async (c) => {
  const node = db.select().from(clusterNodes).where(eq(clusterNodes.id, c.req.param("id"))).limit(1).get();
  if (!node) return c.json({ error: "Node not found." }, 404);
  const force = c.req.query("force") === "1";
  const key = peerKey(node);
  let reclaimed = 0;
  let warning: string | null = null;

  if (key) {
    try {
      const data = (await sealedFetch(node, key, "POST", "/api/cluster-node/reclaim", {}, 300_000)) as any;
      for (const it of Array.isArray(data?.items) ? data.items : []) {
        const meta = cleanRemoteItem(it);
        if (!meta) continue;
        const dupe = db
          .select({ id: items.id })
          .from(items)
          .where(and(eq(items.name, meta.name), eq(items.size, Number(it.size ?? -1))))
          .limit(1)
          .get();
        if (dupe) {
          reclaimed++;
          continue;
        }
        const buf = typeof it.fileData === "string" ? Buffer.from(it.fileData, "base64") : undefined;
        if (buf && buf.byteLength > MAX_CLUSTER_BYTES) continue;
        const row = await storeRemote(meta, { buf, text: typeof it.content === "string" ? it.content : undefined }, {
          uploadedBy: `${meta.uploadedBy} (reclaimed)`,
          clusterOrigin: null,
        });
        if (row) reclaimed++;
      }
    } catch (err) {
      warning = String(err).slice(0, 240);
    }
  }

  if (warning && !force) {
    return c.json({ error: `Reclaim failed: ${warning}. Retry with force=1 to unlink anyway.`, canForce: true }, 502);
  }
  db.delete(clusterNodes).where(eq(clusterNodes.id, node.id)).run();
  db.delete(replicas).where(eq(replicas.nodeId, node.id)).run();
  kvDel(`cluster:in:${node.id}`);
  kvDel(`cluster:out:${node.id}`);
  kvDel(`cluster:b:${node.id}`);
  publish({ scope: "settings", action: "cluster-unlinked" });
  if (reclaimed) publish({ scope: "items", action: "cluster-reclaimed" });
  audit(c, "cluster.unlinked", true, `Unlinked "${node.name}"${reclaimed ? ` and reclaimed ${reclaimed} item(s)` : ""}`, {
    target: node.name,
    severity: "warn",
    meta: { reclaimed, forced: !!warning, keyDestroyed: true },
  });
  return c.json({ ok: true, reclaimed, warning: warning ?? undefined });
});

/* =========================================================================
 * Node-to-node API - paired: sealed with AES-256-GCM + HMAC signed
 * ========================================================================= */

export const clusterNodeRoutes = new Hono<AppEnv>();

/** Public presence endpoint (no secrets). Used by discovery scans. */
clusterNodeRoutes.get("/announce", rateLimit({ name: "announce", windowMs: 60_000, max: 120 }), (c) => {
  const id = getIdentity();
  return c.json({
    v: 2,
    nodeId: id.id,
    name: appName(),
    url: selfUrl(),
    publicKey: id.publicKey,
    fingerprint: keyFingerprint(id.publicKey),
    port: effectivePort(),
  });
});

/** Step 1: a peer asks to link. Stored until this instance's admin approves. */
clusterNodeRoutes.post(
  "/request",
  rateLimit({ name: "cluster-request-in", windowMs: 60_000, max: 10 }),
  bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ error: "Payload too large." }, 413) }),
  async (c) => {
    const body = await c.req.json<any>().catch(() => null);
    if (body?.v !== 2 || typeof body.nodeId !== "string" || !/^[0-9a-f]{16,64}$/i.test(body.nodeId)) return c.json({ error: "Invalid request." }, 400);
    if (typeof body.url !== "string" || !isHttpUrl(body.url)) return c.json({ error: "Invalid URL." }, 400);
    if (body.nodeId === getIdentity().id) return c.json({ error: "That is this instance." }, 400);
    for (const field of ["staticPub", "ephPub"] as const) {
      try {
        crypto.createPublicKey(String(body[field] ?? ""));
      } catch {
        return c.json({ error: "Invalid public key." }, 400);
      }
    }
    if (db.select().from(clusterNodes).where(eq(clusterNodes.id, body.nodeId)).limit(1).get()) {
      return c.json({ error: "Already linked." }, 409);
    }
    const pending: PendingIn = {
      nodeId: body.nodeId,
      name: String(body.name ?? "Peer").slice(0, 60),
      url: String(body.url).replace(/\/+$/, ""),
      ip: c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
      ephPub: String(body.ephPub),
      staticPub: String(body.staticPub),
      nonce: String(body.nonce ?? "").slice(0, 64),
      createdAt: Date.now(),
      expiresAt: Date.now() + PENDING_TTL,
    };
    kvSet(`cluster:in:${pending.nodeId}`, pending);
    publish({ scope: "settings", action: "cluster-request" });
    return c.json({ ok: true, nodeId: getIdentity().id, name: appName(), waitingForApproval: true }, 202);
  },
);

/** Step 2: the target approved; the requester derives the key and waits for its own admin. */
clusterNodeRoutes.post("/confirm", rateLimit({ name: "confirm", windowMs: 60_000, max: 20 }), async (c) => {
  const body = await c.req.json<any>().catch(() => null);
  if (body?.v !== 2 || typeof body.nodeId !== "string") return c.json({ error: "Invalid confirmation." }, 400);
  const out = kvGet<PendingOut>(`cluster:out:${body.nodeId}`);
  if (!out || out.expiresAt < Date.now()) return c.json({ error: "No matching request." }, 404);
  if (out.nonce !== String(body.nonce ?? "")) return c.json({ error: "Nonce mismatch." }, 401);
  try {
    crypto.createPublicKey(String(body.staticPub ?? ""));
    crypto.createPublicKey(String(body.ephPub ?? ""));
  } catch {
    return c.json({ error: "Invalid public key." }, 400);
  }
  const id = getIdentity();
  const key = deriveLinkKey(
    { nodeId: id.id, ephPriv: out.ephPriv, ephPub: out.ephPub, staticPriv: id.privateKey, staticPub: id.publicKey },
    { nodeId: out.nodeId, ephPub: String(body.ephPub), staticPub: String(body.staticPub) },
  );
  out.stage = "confirmed";
  out.remoteEphPub = String(body.ephPub);
  out.remoteStaticPub = String(body.staticPub);
  out.name = String(body.name ?? out.name).slice(0, 60);
  out.url = String(body.url ?? out.url).replace(/\/+$/, "");
  out.keyEnc = encryptString(key.toString("base64"));
  kvSet(`cluster:out:${out.nodeId}`, out);
  publish({ scope: "settings", action: "cluster-confirmed" });
  return c.json({ ok: true, waitingForLocalApproval: true });
});

/** Step 3: sealed activation from the requester; only the derived key can open it. */
clusterNodeRoutes.post("/activate", rateLimit({ name: "activate", windowMs: 60_000, max: 20 }), async (c) => {
  const nodeId = c.req.header("x-cluster-node") ?? "";
  const pending = kvGet<{ nodeId: string; name: string; url: string; keyEnc: string; ephPub: string; expiresAt: number }>(`cluster:b:${nodeId}`);
  if (!pending || pending.expiresAt < Date.now()) return c.json({ error: "No pending link." }, 404);
  const key = Buffer.from(decryptString(pending.keyEnc), "base64");
  const raw = await c.req.text();
  const check = verifySignedRequest(key, { node: nodeId, ts: c.req.header("x-cluster-ts"), sig: c.req.header("x-cluster-sig") }, "POST", new URL(c.req.url).pathname, raw);
  if (!check.ok) return c.json({ error: `Activation failed: ${check.reason}` }, 401);
  let payload: any;
  try {
    payload = open(key, JSON.parse(raw));
  } catch {
    return c.json({ error: "Activation could not be decrypted." }, 401);
  }
  if (payload?.nodeId !== nodeId) return c.json({ error: "Activation node mismatch." }, 401);
  let peerStatic = "";
  try {
    peerStatic = String(payload?.staticPub ?? "");
    crypto.createPublicKey(peerStatic);
  } catch {
    return c.json({ error: "Activation is missing the peer key." }, 400);
  }
  const fingerprint = pairFingerprint(getIdentity().publicKey, peerStatic);
  const existing = db.select().from(clusterNodes).where(eq(clusterNodes.id, nodeId)).limit(1).get();
  const row = {
    name: pending.name,
    baseUrl: pending.url,
    secret: encryptString(key.toString("base64")),
    publicKey: peerStatic,
    fingerprint,
    status: "linked",
    linkedAt: Date.now(),
    lastStatus: "linked",
  };
  if (existing) db.update(clusterNodes).set(row).where(eq(clusterNodes.id, nodeId)).run();
  else db.insert(clusterNodes).values({ id: nodeId, createdAt: Date.now(), ...row }).run();
  kvDel(`cluster:b:${nodeId}`);
  publish({ scope: "settings", action: "cluster-linked" });
  return c.json({ ok: true, sealed: true });
});

clusterNodeRoutes.post("/reject", async (c) => {
  // Unauthenticated cancellation is limited to deleting a pending entry that
  // matches the nonce the requester already knows.
  const body = await c.req.json<{ nodeId?: string; nonce?: string }>().catch(() => null);
  const pending = body?.nodeId ? kvGet<any>(`cluster:b:${body.nodeId}`) : null;
  if (pending && body?.nonce && pending.nonce === body.nonce) kvDel(`cluster:b:${body.nodeId}`);
  return c.json({ ok: true });
});

/* ------------------------------- Auth helpers ----------------------------- */

const seenSigs = new Map<string, number>();
function rememberSig(sig: string) {
  const now = Date.now();
  if (seenSigs.size > 5_000) for (const [k, t] of seenSigs) if (now - t > 10 * 60_000) seenSigs.delete(k);
  if (seenSigs.has(sig)) return false;
  seenSigs.set(sig, now);
  return true;
}

async function authenticate(c: any): Promise<{ node: typeof clusterNodes.$inferSelect; key: Buffer; payload: any } | Response> {
  const nodeId = c.req.header("x-cluster-node");
  if (!nodeId) return c.json({ error: "Missing x-cluster-node." }, 401);
  const node = db.select().from(clusterNodes).where(eq(clusterNodes.id, nodeId)).limit(1).get();
  if (!node) return c.json({ error: "Unknown cluster node." }, 401);
  const key = peerKey(node);
  if (!key) return c.json({ error: "This link needs to be paired again." }, 401);
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_CLUSTER_BYTES * 1.5 + 8192) return c.json({ error: "Payload too large." }, 413);
  const raw = c.req.method === "GET" || c.req.method === "HEAD" ? "" : await c.req.text();
  if (raw.length > MAX_CLUSTER_BYTES * 1.5 + 8192) return c.json({ error: "Payload too large." }, 413);
  const url = new URL(c.req.url);
  const sig = c.req.header("x-cluster-sig");
  const check = verifySignedRequest(key, { node: nodeId, ts: c.req.header("x-cluster-ts"), sig }, c.req.method, url.pathname + url.search, raw);
  if (!check.ok) return c.json({ error: `Cluster auth failed: ${check.reason}` }, 401);
  if (!rememberSig(sig!)) return c.json({ error: "Cluster auth failed: replayed request" }, 401);
  let payload: any = null;
  if (raw) {
    try {
      payload = open(key, JSON.parse(raw));
    } catch {
      return c.json({ error: "Payload could not be decrypted." }, 400);
    }
  }
  db.update(clusterNodes).set({ lastSeenAt: Date.now(), lastStatus: "ok" }).where(eq(clusterNodes.id, node.id)).run();
  return { node, key, payload };
}

export async function sealedFetch(node: typeof clusterNodes.$inferSelect, key: Buffer, method: "GET" | "POST", path: string, payload?: any, timeoutMs = 20_000) {
  const body = payload === undefined ? "" : JSON.stringify(seal(key, payload));
  const headers: Record<string, string> = { ...signRequest(key, getIdentity().id, method, path, body) };
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(`${node.baseUrl}${path}`, { method, headers, body: body || undefined, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      msg = String(parsed?.error ?? msg);
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  if (!text) return null;
  return open(key, JSON.parse(text));
}

/* --------------------------- Remote principals --------------------------- */

const principal = (nodeId: string, userId: string) => `${nodeId}:${userId}`;

function idsCsv(v: string | null | undefined) {
  return v ? v.split(",").filter(Boolean) : [];
}

/** Read check for an account on a linked instance. */
function remoteVisible(row: typeof items.$inferSelect, key: string) {
  if (row.audience === "everyone") return true;
  if (row.audience === "selected" && idsCsv(row.audienceUsers).includes(key)) return true;
  if (row.audience === "group") {
    const mine = db.select({ groupId: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, key)).all();
    return mine.some((m) => idsCsv(row.audienceGroups).includes(m.groupId));
  }
  return false;
}

/** Pull the peer's instance PIN (sealed) so the owner can see it on the Cluster page. */
export async function syncPeerPin(node: typeof clusterNodes.$inferSelect, key: Buffer) {
  try {
    const data = (await sealedFetch(node, key, "GET", "/api/cluster-node/pin", undefined, 8_000)) as any;
    if (typeof data?.pin === "string" && /^\d{4,10}$/.test(data.pin)) {
      db.update(clusterNodes).set({ pinEnc: encryptString(data.pin) }).where(eq(clusterNodes.id, node.id)).run();
    }
  } catch {
    /* older peer or unreachable */
  }
}

/** Pull the account directory from a peer and store it for access pickers. */
export async function syncClusterUsers(node: typeof clusterNodes.$inferSelect, key: Buffer) {
  try {
    const data = (await sealedFetch(node, key, "GET", "/api/cluster-node/users", undefined, 10_000)) as any;
    const list = Array.isArray(data?.users) ? data.users : [];
    for (const u of list.slice(0, 2000)) {
      if (typeof u?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(u.id)) continue;
      db.insert(clusterUsers)
        .values({
          nodeId: node.id,
          userId: u.id,
          name: String(u.name ?? "").slice(0, 80),
          username: typeof u.username === "string" ? u.username.slice(0, 40) : null,
          role: u.role === "owner" ? "owner" : "user",
          avatar: typeof u.avatar === "string" ? u.avatar.slice(0, 400) : null,
          color: /^#[0-9a-f]{6}$/i.test(String(u.color)) ? String(u.color) : "#6366f1",
          updatedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: [clusterUsers.nodeId, clusterUsers.userId],
          set: { name: String(u.name ?? "").slice(0, 80), username: typeof u.username === "string" ? u.username.slice(0, 40) : null, role: u.role === "owner" ? "owner" : "user", updatedAt: Date.now() },
        })
        .run();
    }
  } catch {
    /* unreachable peer */
  }
}

/* ---------------------------- Peer data endpoints -------------------------- */

clusterNodeRoutes.get("/manifest", requireLinked, async (c) => {
  const { key } = c.get("clusterAuth") as any;
  const now = Date.now();
  const live = db
    .select({ id: items.id, type: items.type, name: items.name, mime: items.mime, size: items.size, uploadedBy: items.uploadedBy, createdAt: items.createdAt })
    .from(items)
    .where(sql`${items.audience} = 'everyone' and (${items.expiresAt} is null or ${items.expiresAt} > ${now})`)
    .orderBy(sql`${items.createdAt} desc`)
    .limit(1000)
    .all();
  const count = db.select({ n: sql<number>`count(*)` }).from(items).get()?.n ?? 0;
  return c.json(
    seal(key, {
      node: { id: getIdentity().id, name: appName() },
      items: live,
      storage: { bytes: localStorageBytes(), count, quotaBytes: quotaBytes(), freeBytes: availableBytes() },
    }),
  );
});

clusterNodeRoutes.get("/pin", requireLinked, async (c) => {
  const { key } = c.get("clusterAuth") as any;
  const pin = currentPin() ?? "";
  if (!pin) return c.json(seal(key, { pin: "" }));
  return c.json(seal(key, { pin }));
});

clusterNodeRoutes.get("/users", requireLinked, async (c) => {
  const { key } = c.get("clusterAuth") as any;
  const list = db
    .select({ id: users.id, name: users.name, username: users.username, role: users.role, avatar: users.avatar, color: users.color })
    .from(users)
    .all();
  return c.json(seal(key, { users: list }));
});

clusterNodeRoutes.post("/visible", requireLinked, async (c) => {
  const { key, node, payload } = c.get("clusterAuth") as any;
  const userId = String(payload?.userId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return c.json({ error: "Invalid user." }, 400);
  const remoteKey = principal(node.id, userId);
  const now = Date.now();
  const rows = db.select().from(items).all().filter((r) => (!r.expiresAt || r.expiresAt > now) && remoteVisible(r, remoteKey));
  return c.json(
    seal(key, {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        name: r.name,
        mime: r.mime,
        size: r.size,
        uploadedBy: r.uploadedBy,
        createdAt: r.createdAt,
        category: r.category,
        labels: r.labels,
      })),
    }),
  );
});

clusterNodeRoutes.post("/item-as/:id", requireLinked, async (c) => {
  const { key, node, payload } = c.get("clusterAuth") as any;
  const userId = String(payload?.userId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return c.json({ error: "Invalid user." }, 400);
  const row = db.select().from(items).where(eq(items.id, c.req.param("id"))).limit(1).get();
  if (!row || (row.expiresAt && row.expiresAt <= Date.now()) || !remoteVisible(row, principal(node.id, userId))) {
    return c.json({ error: "Not found." }, 404);
  }
  let fileData: string | null = null;
  if (row.storedName) {
    const fp = pathForRef(row.storedName);
    if (!fs.existsSync(fp)) return c.json({ error: "Stored file missing." }, 410);
    if (row.size > MAX_CLUSTER_BYTES) return c.json({ error: "Too large for remote access." }, 413);
    fileData = readDecrypted(fp).toString("base64");
  }
  return c.json(
    seal(key, {
      item: {
        name: row.name,
        type: row.type,
        mime: row.mime,
        size: row.size,
        content: row.content ? decryptString(row.content) : null,
        fileData,
      },
    }),
  );
});

clusterNodeRoutes.get("/item/:id", requireLinked, async (c) => {
  const { key } = c.get("clusterAuth") as any;
  const row = db.select().from(items).where(eq(items.id, c.req.param("id"))).limit(1).get();
  if (!row || row.audience !== "everyone" || (row.expiresAt && row.expiresAt <= Date.now())) return c.json({ error: "Not found." }, 404);
  let fileData: string | null = null;
  if (row.storedName) {
    const fp = pathForRef(row.storedName);
    if (!fs.existsSync(fp)) return c.json({ error: "Stored file missing." }, 410);
    if (row.size > MAX_CLUSTER_BYTES) return c.json({ error: "Too large for cluster transfer." }, 413);
    fileData = readDecrypted(fp).toString("base64");
  }
  return c.json(
    seal(key, {
      item: {
        type: row.type,
        name: row.name,
        mime: row.mime,
        size: row.size,
        content: row.content ? decryptString(row.content) : null,
        uploadedBy: row.uploadedBy,
        fileData,
      },
    }),
  );
});

clusterNodeRoutes.post("/push", requireLinked, async (c) => {
  const { key, payload } = c.get("clusterAuth") as any;
  const meta = cleanRemoteItem(payload?.item);
  if (!meta) return c.json({ error: "Invalid payload." }, 400);
  const buf = typeof payload.item.fileData === "string" ? Buffer.from(payload.item.fileData, "base64") : undefined;
  if (buf && buf.byteLength > MAX_CLUSTER_BYTES) return c.json({ error: "Payload too large." }, 413);
  const incoming = buf?.byteLength ?? 64;
  if (availableBytes() < incoming) {
    return c.json(seal(key, { error: "Insufficient storage on this node.", needsSpace: true, freeBytes: availableBytes() }), 507);
  }
  const row = await storeRemote(meta, { buf, text: typeof payload.item.content === "string" ? payload.item.content : undefined }, {
    uploadedBy: `${meta.uploadedBy} (cluster)`,
    clusterOrigin: (c.get("clusterAuth") as any).node.id,
  });
  if (!row) return c.json({ error: "Payload needs valid fileData or content." }, 400);
  publish({ scope: "items", action: "cluster-push", id: row.id });
  return c.json(seal(key, { ok: true, id: row.id }), 201);
});

clusterNodeRoutes.post("/reclaim", requireLinked, async (c) => {
  const { key, node } = c.get("clusterAuth") as any;
  const rows = db.select().from(items).where(eq(items.clusterOrigin, node.id)).all();
  const out: any[] = [];
  let budget = 256 * 1024 * 1024;
  for (const row of rows) {
    let fileData: string | undefined;
    if (row.storedName && row.size <= budget) {
      try {
        const fp = pathForRef(row.storedName);
        if (fs.existsSync(fp)) {
          fileData = readDecrypted(fp).toString("base64");
          budget -= row.size;
        }
      } catch {
        /* skip payload */
      }
    }
    out.push({ type: row.type, name: row.name, mime: row.mime, size: row.size, content: row.content ? decryptString(row.content) : null, fileData, uploadedBy: row.uploadedBy });
  }
  for (const row of rows) {
    if (row.storedName) deleteStoredFile(row.storedName);
    deleteThumb(row.thumbName);
    db.delete(items).where(eq(items.id, row.id)).run();
  }
  // Two-sided unlink: forget the peer here as well.
  db.delete(clusterNodes).where(eq(clusterNodes.id, node.id)).run();
  if (rows.length) publish({ scope: "items", action: "cluster-reclaimed" });
  return c.json(seal(key, { ok: true, count: out.length, items: out }));
});

/* ------------------------------ Replicas (peer side) ----------------------- */

clusterNodeRoutes.post("/replica/put", requireLinked, async (c) => {
  const { key, node, payload } = c.get("clusterAuth") as any;
  const r = await storeReplica(node.id, payload);
  if ("error" in r) return c.json(seal(key, { error: r.error }), r.status as any);
  return c.json(seal(key, { ok: true, id: r.id }), 201);
});

clusterNodeRoutes.post("/replica/check", requireLinked, async (c) => {
  const { key, node, payload } = c.get("clusterAuth") as any;
  return c.json(seal(key, { replicas: checkReplicas(node.id, payload?.ids) }));
});

clusterNodeRoutes.post("/replica/get", requireLinked, async (c) => {
  const { key, node, payload } = c.get("clusterAuth") as any;
  const r = getReplica(node.id, payload?.id);
  if (!r) return c.json(seal(key, { error: "No such replica." }), 404);
  return c.json(seal(key, r));
});

clusterNodeRoutes.post("/replica/delete", requireLinked, async (c) => {
  const { key, node, payload } = c.get("clusterAuth") as any;
  return c.json(seal(key, { ok: true, deleted: deleteReplicas(node.id, payload?.ids) }));
});

/* ------------------------------ Replicas (owner) -------------------------- */

clusterRoutes.get("/replication", (c) => c.json(replicationSummary()));

clusterRoutes.post("/replication/policy", async (c) => {
  const body = (await c.req.json<any>().catch(() => null)) ?? {};
  const policy = setPolicy(body);
  audit(c, "cluster.replica-policy", true, policy.enabled ? `Replica policy: ${policy.copies} cop${policy.copies === 1 ? "y" : "ies"} of ${policy.include === "all" ? "every item" : `items labelled "${policy.label}"`}` : "Replica policy turned off", { target: "replica policy", meta: { ...policy } });
  publish({ scope: "settings", action: "replication" });
  return c.json({ ok: true, policy });
});

clusterRoutes.post("/replication/run", async (c) => {
  const report = await runRebalance("manual");
  audit(c, "cluster.rebalance-run", report.failed === 0, `Replication pass run by hand: ${report.placed} placed, ${report.removed} removed, ${report.moved} moved`, { target: "cluster", meta: { placed: report.placed, removed: report.removed, moved: report.moved, failed: report.failed } });
  return c.json({ ok: true, ...replicationSummary(), report });
});

/** Middleware: authenticate a paired node and keep its key on the context. */
async function requireLinked(c: any, next: any) {
  const auth = await authenticate(c);
  if (auth instanceof Response) return auth;
  c.set("clusterAuth", auth);
  await next();
}
