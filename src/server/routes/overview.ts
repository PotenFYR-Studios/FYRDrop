import { Hono } from "hono";
import { gt, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { clusterNodes, items, sessions, users, certs, shareLinks } from "../db/schema";
import { requireSession, isOwner } from "../lib/auth";
import { getIdentity, keyFingerprint } from "../lib/cluster";
import { availableBytes, listUnits, localStorageBytes } from "../lib/storage";
import { readConfig } from "../lib/config";
import { getSettings } from "../lib/settings";
import type { AppEnv } from "../lib/net";

/**
 * Read-only overview available to every signed-in user: cluster identity,
 * peers, pooled storage and instance statistics. No secrets. All counts are
 * SQL aggregates and disk usage comes from the 30 s usage cache.
 */
export const publicClusterRoutes = new Hono<AppEnv>();

publicClusterRoutes.use("*", requireSession);

const count = (q: { n: number } | undefined) => q?.n ?? 0;

publicClusterRoutes.get("/", (c) => {
  const id = getIdentity();
  const now = Date.now();
  const owner = isOwner(c.get("session"));
  const nodes = db.select().from(clusterNodes).all();
  const itemAgg = db.select({ n: sql<number>`count(*)`, dl: sql<number>`coalesce(sum(${items.downloads}),0)` }).from(items).get();
  const localBytes = localStorageBytes();
  return c.json({
    identity: { name: getSettings()?.appName ?? "FYRDrop", shortId: id.id.slice(0, 8), fingerprint: keyFingerprint(id.publicKey) },
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      baseUrl: owner ? n.baseUrl : undefined,
      status: n.lastStatus,
      lastSeenAt: n.lastSeenAt,
      bytes: n.lastStorageBytes,
      items: n.lastItemCount,
    })),
    storage: {
      localBytes,
      pooledBytes: localBytes + nodes.reduce((sum, n) => sum + n.lastStorageBytes, 0),
      availableBytes: availableBytes(),
      units: owner ? listUnits().map((u) => ({ id: u.id, name: u.name, path: u.path })) : [],
    },
    stats: {
      items: itemAgg?.n ?? 0,
      users: count(db.select({ n: sql<number>`count(*)` }).from(users).get()),
      devices: count(db.select({ n: sql<number>`count(*)` }).from(sessions).where(gt(sessions.expiresAt, now)).get()),
      certs: count(db.select({ n: sql<number>`count(*)` }).from(certs).get()),
      activeShares: count(db.select({ n: sql<number>`count(*)` }).from(shareLinks).where(or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, now))).get()),
      downloads: itemAgg?.dl ?? 0,
    },
  });
});

/** Public-safe system configuration (no secrets) used by the Profile page. */
publicClusterRoutes.get("/system", (c) => {
  const conf = readConfig();
  return c.json({ networkMode: conf.networkMode, port: conf.port, tlsCommonName: conf.tlsCommonName, sessionTtlDays: conf.sessionTtlDays });
});
