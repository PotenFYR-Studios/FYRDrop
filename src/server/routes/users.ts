import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, sessions, users, items, userPins, shareLinks } from "../db/schema";
import { requireSession, requireOwner, revokeUserSessions, publicUser } from "../lib/auth";
import { publish } from "../lib/events";
import { clientIp } from "../lib/net";
import { hashSecret, randomPassword } from "../lib/secrets";
import { auditRequest, type LogInput } from "../lib/audit";
import type { AppEnv } from "../lib/net";

/** Accounts: self-service profile + owner-only administration. */
export const userRoutes = new Hono<AppEnv>();

const AVATAR_MAX = 200 * 1024;
const AVATAR_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

export { clientIp };

type AuditExtra = Omit<LogInput, "event" | "ok" | "detail" | "ip">;

/** Write an activity entry for the current request (actor is filled in for you). */
export function audit(c: Parameters<typeof auditRequest>[0], event: string, ok: boolean, detail: string, extra: AuditExtra = {}) {
  auditRequest(c, event, ok, detail, extra);
}

/** null = no avatar, false = invalid, string = accepted data URL. */
export function cleanAvatar(v: unknown): string | null | false {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || v.length > AVATAR_MAX || !AVATAR_RE.test(v)) return false;
  return v;
}

export function cleanColor(v: unknown): string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : "#6366f1";
}

/** Current account (requires a fully signed-in session). */
userRoutes.get("/me", requireSession, (c) => c.json({ user: publicUser(c.get("session").user) }));

/** Edit own profile (display name / avatar / color). */
userRoutes.patch("/me", requireSession, async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{ name?: string; avatar?: string | null; color?: string }>().catch(() => null);
  const patch: Partial<typeof users.$inferInsert> = { lastSeenAt: Date.now() };
  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name) return c.json({ error: "Name cannot be empty." }, 400);
    if (name.length > 40) return c.json({ error: "Name is too long (max 40 characters)." }, 400);
    patch.name = name;
  }
  if (body?.avatar !== undefined) {
    const avatar = cleanAvatar(body.avatar);
    if (avatar === false) return c.json({ error: "Avatar must be a PNG/JPEG/WebP image under ~150 KB." }, 400);
    patch.avatar = avatar;
  }
  if (typeof body?.color === "string") patch.color = cleanColor(body.color);
  db.update(users).set(patch).where(eq(users.id, session.user!.id)).run();
  publish({ scope: "sessions", action: "profile-updated" });
  return c.json({ user: publicUser(db.select().from(users).where(eq(users.id, session.user!.id)).limit(1).get()) });
});

/** People directory for access pickers (no stats, no secrets, no blocked accounts). */
userRoutes.get("/directory", requireSession, (c) => {
  const rows = db
    .select({ id: users.id, username: users.username, name: users.name, avatar: users.avatar, color: users.color, role: users.role })
    .from(users)
    .where(eq(users.isBlocked, 0))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  return c.json({ users: rows });
});

/* ------------------------------ Owner only ------------------------------ */

const admin = new Hono<AppEnv>();
admin.use("*", requireOwner);

/** All accounts with usage stats (aggregated in SQL, not in JS). */
admin.get("/all", (c) => {
  const now = Date.now();
  const itemStats = new Map(
    db
      .select({ userId: items.userId, n: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${items.size}),0)`, dl: sql<number>`coalesce(sum(${items.downloads}),0)` })
      .from(items)
      .groupBy(items.userId)
      .all()
      .map((r) => [r.userId, r]),
  );
  const sessStats = new Map(
    db
      .select({
        userId: sessions.userId,
        devices: sql<number>`sum(case when ${sessions.expiresAt} > ${now} then 1 else 0 end)`,
        lastIp: sql<string>`(select s2.ip from sessions s2 where s2.user_id = ${sessions.userId} order by s2.last_seen_at desc limit 1)`,
      })
      .from(sessions)
      .groupBy(sessions.userId)
      .all()
      .map((r) => [r.userId, r]),
  );
  const rows = db.select().from(users).all().sort((a, b) => b.createdAt - a.createdAt);
  return c.json({
    users: rows.map((u) => {
      const i = itemStats.get(u.id);
      const s = sessStats.get(u.id);
      return {
        ...publicUser(u)!,
        itemCount: i?.n ?? 0,
        storageBytes: i?.bytes ?? 0,
        quotaMb: u.quotaMb,
        quotaBytes: u.quotaMb * 1024 * 1024,
        downloads: i?.dl ?? 0,
        devices: s?.devices ?? 0,
        lastIp: s?.lastIp ?? "",
      };
    }),
  });
});

function target(id: string) {
  return db.select().from(users).where(eq(users.id, id)).limit(1).get();
}

/** Owner can edit a profile (name / colour). */
admin.patch("/:id", async (c) => {
  const row = target(c.req.param("id"));
  if (!row) return c.json({ error: "Not found." }, 404);
  const body = await c.req.json<{ name?: string; color?: string; quotaMb?: number }>().catch(() => null);
  const patch: Partial<typeof users.$inferInsert> = {};
  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name) return c.json({ error: "Name cannot be empty." }, 400);
    patch.name = name.slice(0, 40);
  }
  if (typeof body?.color === "string") patch.color = cleanColor(body.color);
  if (body?.quotaMb !== undefined) {
    const q = Number(body.quotaMb);
    if (!Number.isFinite(q) || q < 0 || q > 10_000_000) return c.json({ error: "Quota must be between 0 and 10000000 MB." }, 400);
    patch.quotaMb = Math.round(q);
  }
  if (body?.quotaMb !== undefined) {
    const q = Number(body.quotaMb);
    if (!Number.isFinite(q) || q < 0 || q > 10_000_000) return c.json({ error: "Quota must be between 0 and 10000000 MB." }, 400);
    patch.quotaMb = Math.round(q);
  }
  if (Object.keys(patch).length === 0) return c.json({ error: "Nothing to update." }, 400);
  db.update(users).set(patch).where(eq(users.id, row.id)).run();
  publish({ scope: "sessions", action: "profile-updated" });
  return c.json({ ok: true });
});

/** Sign an account out of every device. */
admin.post("/:id/signout", (c) => {
  const row = target(c.req.param("id"));
  if (!row) return c.json({ error: "Not found." }, 404);
  const self = c.get("session");
  const count = revokeUserSessions(row.id, row.id === self.user?.id ? self.token : undefined);
  audit(c, "user.signout-all", true, `Signed ${row.name} out of ${count} device(s)`, { target: row.username ?? row.name, meta: { devices: count } });
  publish({ scope: "sessions", action: "signout" });
  return c.json({ ok: true, count });
});

/** Issue a temporary password; the user must change it at next sign-in. */
admin.post("/:id/reset-password", async (c) => {
  const row = target(c.req.param("id"));
  if (!row) return c.json({ error: "Not found." }, 404);
  if (row.id === c.get("session").user?.id) return c.json({ error: "Change your own password from your profile instead." }, 400);
  const temp = randomPassword(12);
  db.update(users).set({ passwordHash: await hashSecret(temp), mustChangePassword: 1 }).where(eq(users.id, row.id)).run();
  const count = revokeUserSessions(row.id);
  audit(c, "user.password-reset", true, `Issued a temporary password for ${row.name}`, { target: row.username ?? row.name, meta: { devicesSignedOut: count } });
  publish({ scope: "sessions", action: "password-reset" });
  // Returned exactly once so the owner can hand it over; never stored in plain text.
  return c.json({ ok: true, temporaryPassword: temp });
});

/** Block / unblock an account - its devices lose access instantly. */
admin.post("/:id/block", async (c) => {
  const row = target(c.req.param("id"));
  if (!row) return c.json({ error: "Not found." }, 404);
  if (row.role === "owner") return c.json({ error: "The owner account cannot be blocked." }, 403);
  const body = await c.req.json<{ blocked?: boolean }>().catch(() => null);
  const blocked = body?.blocked ? 1 : 0;
  db.update(users).set({ isBlocked: blocked }).where(eq(users.id, row.id)).run();
  if (blocked) revokeUserSessions(row.id);
  audit(c, blocked ? "user.blocked" : "user.unblocked", true, `${blocked ? "Blocked" : "Unblocked"} ${row.name}`, { target: row.username ?? row.name, severity: blocked ? "warn" : "info" });
  publish({ scope: "sessions", action: blocked ? "user-blocked" : "user-unblocked" });
  return c.json({ ok: true, blocked: !!blocked });
});

admin.delete("/:id", async (c) => {
  const row = target(c.req.param("id"));
  if (!row) return c.json({ error: "Not found." }, 404);
  if (row.role === "owner") return c.json({ error: "The owner account cannot be deleted." }, 403);
  const purge = c.req.query("purge") === "1";
  let purged = 0;
  if (purge) {
    const { deleteStoredFile } = await import("../lib/storage");
    const { deleteThumb } = await import("../lib/thumbs");
    for (const it of db.select().from(items).where(eq(items.userId, row.id)).all()) {
      if (it.storedName) deleteStoredFile(it.storedName);
      deleteThumb(it.thumbName);
      db.delete(shareLinks).where(eq(shareLinks.itemId, it.id)).run();
      db.delete(userPins).where(eq(userPins.itemId, it.id)).run();
      db.delete(items).where(eq(items.id, it.id)).run();
      purged++;
    }
  }
  revokeUserSessions(row.id);
  db.delete(userPins).where(eq(userPins.userId, row.id)).run();
  db.delete(users).where(eq(users.id, row.id)).run();
  audit(c, "user.deleted", true, `Deleted ${row.name}${purge ? ` and ${purged} item(s)` : ""}`, { target: row.username ?? row.name, meta: { purged }, severity: "warn" });
  publish({ scope: "sessions", action: "user-deleted" });
  if (purged) publish({ scope: "items", action: "deleted" });
  return c.json({ ok: true, purged });
});

userRoutes.route("/", admin);
