import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { clusterNodes, clusterUsers } from "../db/schema";
import { requireSession } from "../lib/auth";
import { decryptString } from "../lib/crypto";
import { sealedFetch } from "./cluster";
import type { AppEnv } from "../lib/net";

/**
 * Access to content on linked instances. A local user is identified to the peer
 * as "<this node id>:<local user id>"; the peer checks that principal against
 * its own access rules, and the payload travels back sealed with the link key.
 */
export const remoteRoutes = new Hono<AppEnv>();
remoteRoutes.use("*", requireSession);

function linkedNodes() {
  return db.select().from(clusterNodes).all().filter((n) => n.publicKey);
}

remoteRoutes.get("/users", (c) => {
  const nodes = new Map(linkedNodes().map((n) => [n.id, n.name]));
  const rows = db.select().from(clusterUsers).all().filter((u) => nodes.has(u.nodeId));
  return c.json({
    users: rows.map((u) => ({
      id: `${u.nodeId}:${u.userId}`,
      userId: u.userId,
      nodeId: u.nodeId,
      nodeName: nodes.get(u.nodeId) ?? "peer",
      name: u.name,
      username: u.username,
      role: u.role,
      avatar: u.avatar,
      color: u.color,
    })),
  });
});

remoteRoutes.get("/items", async (c) => {
  const me = c.get("session").user!;
  const out: any[] = [];
  for (const node of linkedNodes()) {
    try {
      const key = Buffer.from(decryptString(node.secret), "base64");
      const data = (await sealedFetch(node, key, "POST", "/api/cluster-node/visible", { userId: me.id }, 12_000)) as any;
      for (const it of Array.isArray(data?.items) ? data.items.slice(0, 500) : []) {
        out.push({
          ...it,
          remote: true,
          remoteNode: node.id,
          remoteNodeName: node.name,
          id: `${node.id}:${it.id}`,
          remoteId: it.id,
        });
      }
    } catch {
      /* peer offline */
    }
  }
  return c.json({ items: out });
});

remoteRoutes.get("/:nodeId/item/:id/download", async (c) => {
  const me = c.get("session").user!;
  const node = db.select().from(clusterNodes).where(eq(clusterNodes.id, c.req.param("nodeId"))).limit(1).get();
  if (!node || !node.publicKey) return c.json({ error: "Instance not found." }, 404);
  try {
    const key = Buffer.from(decryptString(node.secret), "base64");
    const data: any = await sealedFetch(node, key, "POST", `/api/cluster-node/item-as/${encodeURIComponent(c.req.param("id"))}`, { userId: me.id }, 120_000);
    const item = data?.item;
    if (!item) return c.json({ error: "Item not found." }, 404);
    const name = String(item.name ?? "download").replace(/["\r\n]/g, "_");
    if (item.fileData) {
      const buf = Buffer.from(item.fileData, "base64");
      return c.body(buf, 200, {
        "content-type": "application/octet-stream",
        "content-length": String(buf.byteLength),
        "content-disposition": `attachment; filename="${name}"`,
        "x-content-type-options": "nosniff",
      });
    }
    return c.body(String(item.content ?? ""), 200, {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
  } catch (err) {
    return c.json({ error: String(err).slice(0, 200) }, 502);
  }
});
