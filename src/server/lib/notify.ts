import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { kv, notifications, users } from "../db/schema";
import { publish } from "./events";
import { getSettings } from "./settings";
import { mailEnabled, publicLink, renderMail, sendMailInBackground } from "./mail";

/**
 * In-app notifications with optional email delivery.
 *
 * notify() stores a row for the account, pushes a live event to that account's
 * open tabs only, and - when the person confirmed an email address and opted
 * in for that kind - sends an email. Emails per account and kind are
 * throttled so a popular share link does not flood an inbox.
 */

export const KINDS = {
  "share.downloaded": { label: "Someone downloaded one of your share links", email: false, group: "Sharing" },
  "item.shared": { label: "An item was shared with you", email: false, group: "Sharing" },
  "group.added": { label: "You were added to a group", email: false, group: "Sharing" },
  "security.login": { label: "New sign-in to your account", email: true, group: "Security" },
  "security.account": { label: "Password or two-step sign-in changed", email: true, group: "Security" },
  "storage.quota": { label: "Your storage is almost full", email: true, group: "Storage" },
  "system.alert": { label: "Instance problems (owner): failed backups, low disk", email: true, group: "Instance" },
} as const;
export type Kind = keyof typeof KINDS;

export type Prefs = { inapp: Partial<Record<Kind, boolean>>; email: Partial<Record<Kind, boolean>> };
const prefKey = (userId: string) => `notify:prefs:${userId}`;
const KEEP_PER_USER = 300;
const EMAIL_GAP_MS = 10 * 60_000;
const lastEmail = new Map<string, number>();

export function getPrefs(userId: string): Required<{ inapp: Record<Kind, boolean>; email: Record<Kind, boolean> }> {
  let stored: Prefs = { inapp: {}, email: {} };
  const row = db.select().from(kv).where(eq(kv.key, prefKey(userId))).get();
  try {
    if (row) stored = { inapp: {}, email: {}, ...JSON.parse(row.value) };
  } catch {
    /* defaults */
  }
  const inapp = {} as Record<Kind, boolean>;
  const email = {} as Record<Kind, boolean>;
  for (const k of Object.keys(KINDS) as Kind[]) {
    inapp[k] = stored.inapp?.[k] ?? true;
    email[k] = stored.email?.[k] ?? KINDS[k].email;
  }
  return { inapp, email };
}

export function setPrefs(userId: string, patch: Prefs) {
  const cur = getPrefs(userId);
  for (const k of Object.keys(KINDS) as Kind[]) {
    if (typeof patch.inapp?.[k] === "boolean") cur.inapp[k] = patch.inapp[k]!;
    if (typeof patch.email?.[k] === "boolean") cur.email[k] = patch.email[k]!;
  }
  const value = JSON.stringify(cur);
  db.insert(kv).values({ key: prefKey(userId), value }).onConflictDoUpdate({ target: kv.key, set: { value } }).run();
  return cur;
}

export interface NotifyInput {
  title: string;
  body?: string;
  /** In-app path, e.g. "/files". */
  link?: string;
}

export function notify(userId: string | null | undefined, kind: Kind, input: NotifyInput) {
  if (!userId) return;
  try {
    const u = db.select({ id: users.id, name: users.name, email: users.email, emailVerified: users.emailVerified, isBlocked: users.isBlocked }).from(users).where(eq(users.id, userId)).get();
    if (!u || u.isBlocked) return;
    const prefs = getPrefs(userId);
    const title = input.title.slice(0, 200);
    const body = (input.body ?? "").slice(0, 1000);
    const link = input.link && input.link.startsWith("/") ? input.link.slice(0, 300) : "";
    if (prefs.inapp[kind]) {
      db.insert(notifications).values({ userId, kind, title, body, link, createdAt: Date.now() }).run();
      publish({ scope: "notifications", action: "new", userId });
    }
    if (prefs.email[kind] && u.email && u.emailVerified === 1 && mailEnabled()) {
      const key = `${userId}:${kind}`;
      const now = Date.now();
      // Security mail is never throttled; the rest at most once per 10 min per kind.
      if (kind.startsWith("security.") || now - (lastEmail.get(key) ?? 0) > EMAIL_GAP_MS) {
        lastEmail.set(key, now);
        const appName = getSettings()?.appName ?? "FYRDrop";
        const m = renderMail({
          appName,
          heading: title,
          paragraphs: body ? body.split("\n").filter(Boolean) : [],
          button: link ? { label: `Open ${appName}`, href: publicLink(link) } : undefined,
          footer: "Change which emails you get under Profile → Notifications.",
        });
        sendMailInBackground({ to: u.email, subject: `${appName}: ${title}`, ...m }, `notification ${kind}`);
      }
    }
  } catch (err) {
    console.error("[notify]", err);
  }
}

/** Every owner account (alerts about the instance itself). */
export function notifyOwners(input: NotifyInput) {
  for (const o of db.select({ id: users.id }).from(users).where(eq(users.role, "owner")).all()) notify(o.id, "system.alert", input);
}

export function listNotifications(userId: string, limit = 50, before?: number) {
  const where = before ? and(eq(notifications.userId, userId), lt(notifications.id, before)) : eq(notifications.userId, userId);
  const rows = db.select().from(notifications).where(where).orderBy(desc(notifications.id)).limit(Math.min(Math.max(limit, 1), 200)).all();
  const unread = db.select({ n: sql<number>`count(*)` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))).get()?.n ?? 0;
  return { items: rows, unread };
}

export function markRead(userId: string, ids: number[] | "all") {
  const now = Date.now();
  if (ids === "all") db.update(notifications).set({ readAt: now }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))).run();
  else if (ids.length) db.update(notifications).set({ readAt: now }).where(and(eq(notifications.userId, userId), inArray(notifications.id, ids.slice(0, 500)))).run();
  publish({ scope: "notifications", action: "read", userId });
}

export function deleteNotification(userId: string, id: number | "read") {
  if (id === "read") db.delete(notifications).where(and(eq(notifications.userId, userId), isNotNull(notifications.readAt))).run();
  else db.delete(notifications).where(and(eq(notifications.userId, userId), eq(notifications.id, id))).run();
  publish({ scope: "notifications", action: "deleted", userId });
}

/** Maintenance: cap each inbox and drop old read entries. */
export function sweepNotifications() {
  const cutoff = Date.now() - 60 * 86_400_000;
  db.delete(notifications).where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, cutoff))).run();
  const heavy = db
    .select({ userId: notifications.userId, n: sql<number>`count(*)` })
    .from(notifications)
    .groupBy(notifications.userId)
    .all()
    .filter((r) => r.n > KEEP_PER_USER);
  for (const h of heavy) {
    const edge = db.select({ id: notifications.id }).from(notifications).where(eq(notifications.userId, h.userId)).orderBy(desc(notifications.id)).limit(1).offset(KEEP_PER_USER).get();
    if (edge) db.delete(notifications).where(and(eq(notifications.userId, h.userId), lt(notifications.id, edge.id + 1))).run();
  }
  for (const [k, t] of lastEmail) if (Date.now() - t > EMAIL_GAP_MS) lastEmail.delete(k);
}
