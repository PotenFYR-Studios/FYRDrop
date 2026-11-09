import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { sessions, users } from "../db/schema";
import { requireSession, revokeSession, publicUser, isOwner } from "../lib/auth";
import { publish } from "../lib/events";
import { auditRequest } from "../lib/audit";
import type { AppEnv } from "../lib/net";

/** Device sessions. Owners see every device; users see (and revoke) only their own. */
export const sessionRoutes = new Hono<AppEnv>();

sessionRoutes.use("*", requireSession);

sessionRoutes.get("/", (c) => {
  const now = Date.now();
  const me = c.get("session");
  const owner = isOwner(me);
  const rows = owner ? db.select().from(sessions).all() : db.select().from(sessions).where(eq(sessions.userId, me.user!.id)).all();
  const userMap = new Map(db.select().from(users).all().map((u) => [u.id, publicUser(u)]));
  return c.json({
    sessions: rows
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((r) => ({
        token: r.token,
        deviceName: r.deviceName,
        hostName: r.hostName,
        userAgent: r.userAgent,
        ip: r.ip,
        ipSource: r.ipSource,
        reportedIp: r.reportedIp,
        mac: r.mac,
        macNote: owner ? r.macNote : "",
        meta: (() => {
          try {
            return JSON.parse(r.deviceMeta || "{}");
          } catch {
            return {};
          }
        })(),
        user: r.userId ? (userMap.get(r.userId) ?? null) : null,
        createdAt: r.createdAt,
        lastSeenAt: r.lastSeenAt,
        expiresAt: r.expiresAt,
        isCurrent: r.token === me.token,
        active: r.expiresAt > now,
      })),
  });
});

/** Rename a device and/or annotate its MAC (owner only; HTTP cannot see MACs). */
sessionRoutes.patch("/:token", async (c) => {
  if (!isOwner(c.get("session"))) return c.json({ error: "Owner access required." }, 403);
  const token = c.req.param("token");
  const row = db.select().from(sessions).where(eq(sessions.token, token)).limit(1).get();
  if (!row) return c.json({ error: "Not found." }, 404);
  const body = await c.req.json<{ macNote?: string; deviceName?: string }>().catch(() => null);
  const patch: { macNote?: string; deviceName?: string } = {};
  if (body?.macNote !== undefined) {
    const mac = String(body.macNote).trim().toLowerCase();
    if (mac && !/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/.test(mac)) return c.json({ error: "MAC must look like aa:bb:cc:dd:ee:ff." }, 400);
    patch.macNote = mac;
  }
  if (body?.deviceName !== undefined) {
    const name = String(body.deviceName).trim();
    if (!name) return c.json({ error: "Device name cannot be empty." }, 400);
    patch.deviceName = name.slice(0, 60);
  }
  if (Object.keys(patch).length === 0) return c.json({ error: "Nothing to update." }, 400);
  db.update(sessions).set(patch).where(eq(sessions.token, token)).run();
  auditRequest(c, "device.updated", true, `Updated device "${patch.deviceName ?? row.deviceName}"`, {
    target: patch.deviceName ?? row.deviceName,
    meta: { fields: Object.keys(patch), mac: patch.macNote ?? row.macNote },
  });
  publish({ scope: "sessions", action: "updated" });
  return c.json({ ok: true, macNote: patch.macNote ?? row.macNote, deviceName: patch.deviceName ?? row.deviceName });
});

/** Revoke a device - it will be asked for the PIN again. */
sessionRoutes.delete("/:token", (c) => {
  const me = c.get("session");
  const token = c.req.param("token");
  const row = db.select().from(sessions).where(eq(sessions.token, token)).limit(1).get();
  if (!row) return c.json({ error: "Not found." }, 404);
  if (!isOwner(me) && row.userId !== me.user?.id) return c.json({ error: "Not found." }, 404);
  revokeSession(token);
  publish({ scope: "sessions", action: "revoked" });
  auditRequest(c, "device.revoked", true, `Revoked device "${row.deviceName}"`, {
    target: row.deviceName,
    severity: "warn",
    meta: { account: row.userId ?? null, wasCurrent: row.token === me.token },
  });
  return c.json({ ok: true });
});
