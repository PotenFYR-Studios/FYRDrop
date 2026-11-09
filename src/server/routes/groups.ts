import { Hono } from "hono";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { groups, groupMembers, items, users } from "../db/schema";
import { requireSession, isOwner, publicUser } from "../lib/auth";
import { ensureDefaultGroup, canManageGroup, isGroupMember } from "../lib/groups";
import { auditRequest } from "../lib/audit";
import { publish } from "../lib/events";
import type { AppEnv } from "../lib/net";

export const groupRoutes = new Hono<AppEnv>();
groupRoutes.use("*", requireSession);

const COLORS = /^#[0-9a-f]{6}$/i;
const cleanName = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 60) : "");
const cleanDesc = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 200) : "");

function countsFor(groupId: string) {
  const itemCount = db.select({ n: sql<number>`count(*)` }).from(items).where(eq(items.groupId, groupId)).get()?.n ?? 0;
  const memberCount = db.select({ n: sql<number>`count(*)` }).from(groupMembers).where(eq(groupMembers.groupId, groupId)).get()?.n ?? 0;
  return { itemCount, memberCount };
}

function serialize(g: typeof groups.$inferSelect, userId: string) {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    color: g.color,
    ownerId: g.ownerId,
    isDefault: g.isDefault === 1,
    createdAt: g.createdAt,
    mine: g.ownerId === userId,
    ...countsFor(g.id),
  };
}

/** Groups the signed-in account owns or belongs to. */
groupRoutes.get("/", (c) => {
  const me = c.get("session").user!;
  ensureDefaultGroup(me.id);
  const owned = db.select().from(groups).where(eq(groups.ownerId, me.id)).all();
  const memberIds = db.select({ id: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, me.id)).all().map((r) => r.id);
  const memberGroups = memberIds.length ? db.select().from(groups).where(sql`${groups.id} in ${memberIds}`).all() : [];
  const map = new Map([...owned, ...memberGroups].map((g) => [g.id, g]));
  return c.json({ groups: [...map.values()].map((g) => serialize(g, me.id)).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)) });
});

groupRoutes.post("/", (c) => {
  const me = c.get("session").user!;
  return c.req
    .json<{ name?: string; description?: string; color?: string }>()
    .catch(() => null)
    .then((body) => {
      const name = cleanName(body?.name);
      if (!name) return c.json({ error: "A group needs a name." }, 400);
      const id = crypto.randomUUID();
      const color = typeof body?.color === "string" && COLORS.test(body.color) ? body.color : "#6366f1";
      db.insert(groups).values({ id, name, description: cleanDesc(body?.description), color, ownerId: me.id, isDefault: 0, createdAt: Date.now() }).run();
      db.insert(groupMembers).values({ groupId: id, userId: me.id, role: "owner", addedBy: me.id, createdAt: Date.now() }).run();
      publish({ scope: "settings", action: "group-created" });
      auditRequest(c, "group.created", true, `Created group "${name}"`, { target: name, meta: { groupId: id } });
      return c.json({ group: serialize(db.select().from(groups).where(eq(groups.id, id)).get()!, me.id) }, 201);
    });
});

groupRoutes.get("/:id", (c) => {
  const me = c.get("session").user!;
  const g = db.select().from(groups).where(eq(groups.id, c.req.param("id"))).limit(1).get();
  if (!g || (!isGroupMember(g.id, me.id) && me.role !== "owner")) return c.json({ error: "Not found." }, 404);
  const members = db.select().from(groupMembers).where(eq(groupMembers.groupId, g.id)).all();
  const userMap = new Map(db.select().from(users).all().map((u) => [u.id, publicUser(u)]));
  return c.json({
    group: serialize(g, me.id),
    members: members.map((m) => ({ ...m, user: userMap.get(m.userId) ?? null })),
    canManage: canManageGroup(g.id, me.id) || isOwner(c.get("session")),
  });
});

groupRoutes.patch("/:id", async (c) => {
  const me = c.get("session").user!;
  const g = db.select().from(groups).where(eq(groups.id, c.req.param("id"))).limit(1).get();
  if (!g) return c.json({ error: "Not found." }, 404);
  if (!canManageGroup(g.id, me.id) && !isOwner(c.get("session"))) return c.json({ error: "Only the group owner can change it." }, 403);
  const body = await c.req.json<{ name?: string; description?: string; color?: string }>().catch(() => null);
  const patch: Partial<typeof groups.$inferInsert> = {};
  if (body?.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return c.json({ error: "A group needs a name." }, 400);
    patch.name = name;
  }
  if (body?.description !== undefined) patch.description = cleanDesc(body.description);
  if (body?.color !== undefined && COLORS.test(String(body.color))) patch.color = String(body.color);
  if (Object.keys(patch).length === 0) return c.json({ error: "Nothing to update." }, 400);
  db.update(groups).set(patch).where(eq(groups.id, g.id)).run();
  publish({ scope: "settings", action: "group-updated" });
  return c.json({ group: serialize(db.select().from(groups).where(eq(groups.id, g.id)).get()!, me.id) });
});

groupRoutes.delete("/:id", (c) => {
  const me = c.get("session").user!;
  const g = db.select().from(groups).where(eq(groups.id, c.req.param("id"))).limit(1).get();
  if (!g) return c.json({ error: "Not found." }, 404);
  if (!canManageGroup(g.id, me.id) && !isOwner(c.get("session"))) return c.json({ error: "Only the group owner can delete it." }, 403);
  if (g.isDefault === 1) return c.json({ error: "The Default group cannot be deleted." }, 400);
  const fallback = ensureDefaultGroup(g.ownerId);
  db.update(items).set({ groupId: fallback }).where(eq(items.groupId, g.id)).run();
  db.delete(groupMembers).where(eq(groupMembers.groupId, g.id)).run();
  db.delete(groups).where(eq(groups.id, g.id)).run();
  publish({ scope: "settings", action: "group-deleted" });
  auditRequest(c, "group.deleted", true, `Deleted group "${g.name}"`, { target: g.name, severity: "warn", meta: { movedItemsTo: fallback } });
  return c.json({ ok: true, movedTo: fallback });
});

groupRoutes.post("/:id/members", async (c) => {
  const me = c.get("session").user!;
  const g = db.select().from(groups).where(eq(groups.id, c.req.param("id"))).limit(1).get();
  if (!g) return c.json({ error: "Not found." }, 404);
  if (!canManageGroup(g.id, me.id) && !isOwner(c.get("session"))) return c.json({ error: "Only the group owner can add people." }, 403);
  const body = await c.req.json<{ username?: string }>().catch(() => null);
  const username = String(body?.username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!username) return c.json({ error: "Enter a username." }, 400);
  const user = db.select().from(users).where(eq(users.username, username)).limit(1).get();
  if (!user) return c.json({ error: "No account with that username." }, 404);
  if (db.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.userId, user.id))).limit(1).get()) {
    return c.json({ error: `${user.name} is already in this group.` }, 409);
  }
  db.insert(groupMembers).values({ groupId: g.id, userId: user.id, role: "member", addedBy: me.id, createdAt: Date.now() }).run();
  publish({ scope: "settings", action: "group-member" });
  auditRequest(c, "group.member-added", true, `Added ${user.name} to "${g.name}"`, { target: g.name, meta: { user: user.username } });
  return c.json({ ok: true, member: { userId: user.id, user: publicUser(user) } }, 201);
});

groupRoutes.delete("/:id/members/:userId", (c) => {
  const me = c.get("session").user!;
  const g = db.select().from(groups).where(eq(groups.id, c.req.param("id"))).limit(1).get();
  if (!g) return c.json({ error: "Not found." }, 404);
  const target = c.req.param("userId");
  const self = target === me.id;
  if (!self && !canManageGroup(g.id, me.id) && !isOwner(c.get("session"))) return c.json({ error: "Only the group owner can remove people." }, 403);
  if (target === g.ownerId) return c.json({ error: "The owner cannot be removed from their own group." }, 400);
  db.delete(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.userId, target))).run();
  publish({ scope: "settings", action: "group-member" });
  return c.json({ ok: true });
});
