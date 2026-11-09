import crypto from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db";
import { groups, groupMembers } from "../db/schema";

/** Every account owns one "Default" group. Items uploaded without a group land there. */
export function ensureDefaultGroup(userId: string): string {
  const existing = db
    .select()
    .from(groups)
    .where(and(eq(groups.ownerId, userId), eq(groups.isDefault, 1)))
    .limit(1)
    .get();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  db.insert(groups)
    .values({ id, name: "Default", description: "Everything uploaded without another group", color: "#6366f1", ownerId: userId, isDefault: 1, createdAt: Date.now() })
    .run();
  db.insert(groupMembers).values({ groupId: id, userId, role: "owner", addedBy: userId, createdAt: Date.now() }).run();
  return id;
}

/** Groups the user owns or belongs to. */
export function groupIdsFor(userId: string): string[] {
  const owned = db.select({ id: groups.id }).from(groups).where(eq(groups.ownerId, userId)).all();
  const member = db.select({ id: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, userId)).all();
  return [...new Set([...owned.map((r) => r.id), ...member.map((r) => r.id)])];
}

export function groupAccessSet(userId: string): Set<string> {
  return new Set(groupIdsFor(userId));
}

export function isGroupMember(groupId: string, userId: string): boolean {
  if (db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, groupId), eq(groups.ownerId, userId))).limit(1).get()) return true;
  return !!db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1)
    .get();
}

export function canManageGroup(groupId: string, userId: string): boolean {
  return !!db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, groupId), eq(groups.ownerId, userId))).limit(1).get();
}

/** Validate a list of group ids against what this user can use. */
export function usableGroupIds(raw: unknown, userId: string): string[] {
  if (!Array.isArray(raw)) return [];
  const allowed = groupAccessSet(userId);
  return [...new Set(raw.filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) && allowed.has(v)))].slice(0, 200);
}
