import { Hono } from "hono";
import crypto from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { apiKeys, webhookDeliveries, webhooks } from "../db/schema";
import { requireSession } from "../lib/auth";
import { auditRequest } from "../lib/audit";
import { encryptString } from "../lib/crypto";
import { SCOPES, createApiKey, publicKey, type ApiScope } from "../lib/apikeys";
import { EVENTS, checkTarget, ping } from "../lib/webhooks";
import type { AppEnv } from "../lib/net";

/** Personal API keys (/api/keys) and webhooks (/api/webhooks). Browser sessions only. */
export const keyRoutes = new Hono<AppEnv>();
export const webhookRoutes = new Hono<AppEnv>();
keyRoutes.use("*", requireSession);
webhookRoutes.use("*", requireSession);

const MAX_KEYS = 20;
const MAX_HOOKS = 10;

/* --------------------------------- API keys -------------------------------- */

keyRoutes.get("/", (c) => {
  const me = c.get("session").user!.id;
  const rows = db.select().from(apiKeys).where(and(eq(apiKeys.userId, me), isNull(apiKeys.revokedAt))).orderBy(desc(apiKeys.createdAt)).all();
  return c.json({ keys: rows.map(publicKey), scopes: SCOPES });
});

keyRoutes.post("/", async (c) => {
  const me = c.get("session").user!;
  const b = (await c.req.json<{ name?: string; scopes?: string[]; expiresDays?: number }>().catch(() => null)) ?? {};
  const name = String(b.name ?? "").trim().slice(0, 60);
  if (!name) return c.json({ error: "Give the key a name so you know where it is used." }, 400);
  const scopes = (Array.isArray(b.scopes) ? b.scopes : ["read"]).filter((s): s is ApiScope => (SCOPES as readonly string[]).includes(s));
  if (scopes.length === 0) return c.json({ error: "Pick at least one scope." }, 400);
  if (scopes.includes("write") && !scopes.includes("read")) scopes.push("read");
  const days = Number(b.expiresDays ?? 0);
  if (!Number.isFinite(days) || days < 0 || days > 3650) return c.json({ error: "Expiry must be 0 (never) to 3650 days." }, 400);
  const live = db.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.userId, me.id), isNull(apiKeys.revokedAt))).all().length;
  if (live >= MAX_KEYS) return c.json({ error: `You already have ${MAX_KEYS} keys. Revoke one first.` }, 400);
  const { id, token } = createApiKey(me.id, name, scopes, days ? Date.now() + days * 86_400_000 : null);
  auditRequest(c, "account.apikey-created", true, `${me.name} created the API key "${name}" (${scopes.join(", ")})`, { target: name, meta: { id, scopes, expiresDays: days } });
  const row = db.select().from(apiKeys).where(eq(apiKeys.id, id)).get()!;
  return c.json({ key: publicKey(row), token }, 201);
});

keyRoutes.delete("/:id", (c) => {
  const me = c.get("session").user!;
  const gone = db.update(apiKeys).set({ revokedAt: Date.now() }).where(and(eq(apiKeys.id, c.req.param("id")), eq(apiKeys.userId, me.id), isNull(apiKeys.revokedAt))).returning().all();
  if (gone.length === 0) return c.json({ error: "No such key." }, 404);
  auditRequest(c, "account.apikey-revoked", true, `${me.name} revoked the API key "${gone[0]!.name}"`, { target: gone[0]!.name });
  return c.json({ ok: true });
});

/* --------------------------------- webhooks -------------------------------- */

function publicHook(h: typeof webhooks.$inferSelect) {
  const { secretEnc, ...rest } = h;
  return { ...rest, events: rest.events.split(",").filter(Boolean), enabled: rest.enabled === 1 };
}

function cleanEvents(v: unknown): string | null {
  if (!Array.isArray(v)) return "";
  const list = [...new Set(v.map(String))];
  if (list.some((e) => !(EVENTS as readonly string[]).includes(e) || e === "ping")) return null;
  return list.join(",");
}

webhookRoutes.get("/", (c) => {
  const me = c.get("session").user!.id;
  const rows = db.select().from(webhooks).where(eq(webhooks.userId, me)).orderBy(desc(webhooks.createdAt)).all();
  return c.json({ webhooks: rows.map(publicHook), events: EVENTS.filter((e) => e !== "ping"), canTargetPrivate: c.get("session").user!.role === "owner" });
});

webhookRoutes.post("/", async (c) => {
  const me = c.get("session").user!;
  const b = (await c.req.json<{ name?: string; url?: string; events?: string[] }>().catch(() => null)) ?? {};
  const name = String(b.name ?? "").trim().slice(0, 60) || "Webhook";
  const url = String(b.url ?? "").trim().slice(0, 500);
  const events = cleanEvents(b.events);
  if (events === null) return c.json({ error: "Unknown event in the list." }, 400);
  const problem = await checkTarget(url, me.role === "owner");
  if (problem) return c.json({ error: problem }, 400);
  if (db.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.userId, me.id)).all().length >= MAX_HOOKS) return c.json({ error: `At most ${MAX_HOOKS} webhooks per account.` }, 400);
  const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
  const id = crypto.randomUUID();
  db.insert(webhooks).values({ id, userId: me.id, name, url, secretEnc: encryptString(secret), events, enabled: 1, createdAt: Date.now() }).run();
  auditRequest(c, "account.webhook-created", true, `${me.name} added the webhook "${name}"`, { target: name, meta: { host: new URL(url).host, events } });
  return c.json({ webhook: publicHook(db.select().from(webhooks).where(eq(webhooks.id, id)).get()!), secret }, 201);
});

function own(c: any) {
  return db.select().from(webhooks).where(and(eq(webhooks.id, c.req.param("id")), eq(webhooks.userId, c.get("session").user!.id))).get();
}

webhookRoutes.patch("/:id", async (c) => {
  const h = own(c);
  if (!h) return c.json({ error: "No such webhook." }, 404);
  const me = c.get("session").user!;
  const b = (await c.req.json<{ name?: string; url?: string; events?: string[]; enabled?: boolean }>().catch(() => null)) ?? {};
  const patch: Partial<typeof webhooks.$inferInsert> = {};
  if (typeof b.name === "string") patch.name = b.name.trim().slice(0, 60) || h.name;
  if (typeof b.url === "string") {
    const problem = await checkTarget(b.url.trim(), me.role === "owner");
    if (problem) return c.json({ error: problem }, 400);
    patch.url = b.url.trim().slice(0, 500);
  }
  if (b.events !== undefined) {
    const ev = cleanEvents(b.events);
    if (ev === null) return c.json({ error: "Unknown event in the list." }, 400);
    patch.events = ev;
  }
  if (typeof b.enabled === "boolean") {
    patch.enabled = b.enabled ? 1 : 0;
    if (b.enabled) patch.failures = 0;
  }
  db.update(webhooks).set(patch).where(eq(webhooks.id, h.id)).run();
  return c.json({ webhook: publicHook(db.select().from(webhooks).where(eq(webhooks.id, h.id)).get()!) });
});

webhookRoutes.post("/:id/rotate-secret", (c) => {
  const h = own(c);
  if (!h) return c.json({ error: "No such webhook." }, 404);
  const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
  db.update(webhooks).set({ secretEnc: encryptString(secret) }).where(eq(webhooks.id, h.id)).run();
  auditRequest(c, "account.webhook-secret", true, `New signing secret for the webhook "${h.name}"`, { target: h.name });
  return c.json({ ok: true, secret });
});

webhookRoutes.post("/:id/test", async (c) => {
  const h = own(c);
  if (!h) return c.json({ error: "No such webhook." }, 404);
  return c.json(await ping(h));
});

webhookRoutes.get("/:id/deliveries", (c) => {
  const h = own(c);
  if (!h) return c.json({ error: "No such webhook." }, 404);
  return c.json({ deliveries: db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, h.id)).orderBy(desc(webhookDeliveries.id)).limit(50).all() });
});

webhookRoutes.delete("/:id", (c) => {
  const h = own(c);
  if (!h) return c.json({ error: "No such webhook." }, 404);
  db.delete(webhooks).where(eq(webhooks.id, h.id)).run();
  db.delete(webhookDeliveries).where(eq(webhookDeliveries.webhookId, h.id)).run();
  auditRequest(c, "account.webhook-deleted", true, `Webhook "${h.name}" deleted`, { target: h.name });
  return c.json({ ok: true });
});
