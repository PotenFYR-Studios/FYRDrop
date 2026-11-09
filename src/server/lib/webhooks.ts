import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { users, webhookDeliveries, webhooks } from "../db/schema";
import { decryptString } from "./crypto";
import { logEvent } from "./audit";
import { notify } from "./notify";

/**
 * Outgoing webhooks.
 *
 * Body: {"id","event","createdAt","data"} as JSON.
 * Headers:
 *   X-FYRDrop-Event      event name
 *   X-FYRDrop-Delivery   unique id (retries reuse it - deduplicate on it)
 *   X-FYRDrop-Timestamp  unix seconds
 *   X-FYRDrop-Signature  sha256=hex(HMAC_SHA256(secret, "<timestamp>.<body>"))
 * A delivery counts as ok on any 2xx within 10 s. Failures are retried after
 * 10 s, 1 min and 5 min; after 20 failed deliveries in a row the hook turns
 * itself off and the owner of the hook is notified.
 *
 * SSRF: targets are resolved before sending. Link-local / metadata ranges are
 * always refused. Loopback and private ranges are allowed only for hooks that
 * belong to the instance owner (home-lab integrations), never for other users.
 * Redirects are not followed.
 */

export const EVENTS = ["item.created", "item.updated", "item.deleted", "share.created", "share.downloaded", "ping"] as const;
export type HookEvent = (typeof EVENTS)[number];
const RETRY_MS = [10_000, 60_000, 5 * 60_000];
const DISABLE_AFTER = 20;
const KEEP_DELIVERIES = 50;
const TIMEOUT_MS = 10_000;

type Hook = typeof webhooks.$inferSelect;

function v4ToInt(ip: string) {
  return ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}
function inV4(ip: string, cidr: string) {
  const [base, bits] = cidr.split("/");
  const mask = Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base!) & mask);
}

/** "blocked" for metadata/link-local/unspecified, "private" for LAN/loopback, "public" otherwise. */
export function classifyIp(ip: string): "blocked" | "private" | "public" {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1]!;
  if (net.isIPv4(ip)) {
    if (["0.0.0.0/8", "169.254.0.0/16", "100.100.100.200/32", "224.0.0.0/4", "240.0.0.0/4"].some((c) => inV4(ip, c))) return "blocked";
    if (["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"].some((c) => inV4(ip, c))) return "private";
    return "public";
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6.startsWith("fe80") || v6.startsWith("ff")) return "blocked";
  if (v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd")) return "private";
  return "public";
}

/** Validate a target URL for a hook owned by someone; returns an error message or null. */
export async function checkTarget(rawUrl: string, allowPrivate: boolean): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return "Enter a full URL, e.g. https://example.com/hook";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "Webhooks must use http or https.";
  if (u.username || u.password) return "Put credentials in the signing secret, not in the URL.";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let addrs: string[];
  try {
    addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    return `Cannot resolve ${host}.`;
  }
  if (addrs.length === 0) return `Cannot resolve ${host}.`;
  for (const a of addrs) {
    const cls = classifyIp(a);
    if (cls === "blocked") return `${host} points to a reserved address (${a}).`;
    if (cls === "private" && !allowPrivate) return `${host} is on a private network (${a}). Only the instance owner can send webhooks to local addresses.`;
  }
  return null;
}

function ownerOf(hook: Hook) {
  return db.select({ id: users.id, role: users.role, name: users.name }).from(users).where(eq(users.id, hook.userId)).get();
}

export function sign(secret: string, ts: number, body: string) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

async function deliver(hook: Hook, deliveryId: string, event: string, body: string, attempt: number): Promise<boolean> {
  const started = Date.now();
  let ok = false;
  let statusCode: number | null = null;
  let error = "";
  try {
    const owner = ownerOf(hook);
    if (!owner) throw new Error("hook owner no longer exists");
    const problem = await checkTarget(hook.url, owner.role === "owner");
    if (problem) throw new Error(problem);
    const ts = Math.floor(Date.now() / 1000);
    const secret = decryptString(hook.secretEnc);
    const res = await fetch(hook.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "user-agent": "FYRDrop-Webhook/1",
        "x-fyrdrop-event": event,
        "x-fyrdrop-delivery": deliveryId,
        "x-fyrdrop-timestamp": String(ts),
        "x-fyrdrop-signature": sign(secret, ts, body),
      },
      body,
    });
    statusCode = res.status;
    ok = res.status >= 200 && res.status < 300;
    if (!ok) error = res.status >= 300 && res.status < 400 ? "redirects are not followed" : `HTTP ${res.status}`;
    await res.body?.cancel().catch(() => {});
  } catch (err: any) {
    error = err?.name === "TimeoutError" ? "timed out after 10 s" : String(err?.message ?? err).slice(0, 300);
  }
  const now = Date.now();
  db.insert(webhookDeliveries).values({ webhookId: hook.id, deliveryId, event, ok: ok ? 1 : 0, statusCode, error, attempt, durationMs: now - started, createdAt: now }).run();
  const failures = ok ? 0 : sql`${webhooks.failures} + 1`;
  const updated = db
    .update(webhooks)
    .set({ failures, lastStatus: ok ? `ok ${statusCode}` : error.slice(0, 120), lastDeliveryAt: now })
    .where(eq(webhooks.id, hook.id))
    .returning({ failures: webhooks.failures, enabled: webhooks.enabled })
    .get();
  if (!ok && updated && updated.failures >= DISABLE_AFTER && updated.enabled === 1) {
    db.update(webhooks).set({ enabled: 0 }).where(eq(webhooks.id, hook.id)).run();
    notify(hook.userId, "system.alert", { title: `Webhook "${hook.name}" was turned off`, body: `${DISABLE_AFTER} deliveries in a row failed. Last error: ${error}`, link: "/profile#developer" });
    logEvent({ event: "system.webhook-disabled", ok: false, detail: `Webhook "${hook.name}" disabled after ${DISABLE_AFTER} failures`, actor: { name: "webhooks" }, target: hook.name });
  }
  // Keep only the recent history per hook.
  const edge = db.select({ id: webhookDeliveries.id }).from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id)).orderBy(desc(webhookDeliveries.id)).limit(1).offset(KEEP_DELIVERIES).get();
  if (edge) db.delete(webhookDeliveries).where(and(eq(webhookDeliveries.webhookId, hook.id), lt(webhookDeliveries.id, edge.id + 1))).run();
  return ok;
}

function schedule(hookId: string, deliveryId: string, event: string, body: string, attempt: number) {
  const run = async () => {
    const hook = db.select().from(webhooks).where(eq(webhooks.id, hookId)).get();
    if (!hook || (hook.enabled !== 1 && event !== "ping")) return;
    const ok = await deliver(hook, deliveryId, event, body, attempt);
    if (!ok && attempt <= RETRY_MS.length && event !== "ping") {
      const t = setTimeout(() => schedule(hookId, deliveryId, event, body, attempt + 1), RETRY_MS[attempt - 1]);
      t.unref?.();
    }
  };
  void run().catch((err) => console.error("[webhook]", err));
}

function wants(hook: Hook, event: string) {
  if (hook.enabled !== 1) return false;
  const list = hook.events.split(",").filter(Boolean);
  return list.length === 0 || list.includes(event);
}

/** Queue `event` for every enabled hook of `userId` that subscribes to it. */
export function emit(userId: string | null | undefined, event: HookEvent, data: Record<string, unknown>) {
  if (!userId) return;
  let hooks: Hook[];
  try {
    hooks = db.select().from(webhooks).where(eq(webhooks.userId, userId)).all().filter((h) => wants(h, event));
  } catch {
    return;
  }
  if (hooks.length === 0) return;
  for (const h of hooks) {
    const deliveryId = crypto.randomUUID();
    const body = JSON.stringify({ id: deliveryId, event, createdAt: Date.now(), data });
    schedule(h.id, deliveryId, event, body, 1);
  }
}

/** Send a ping right now and report the outcome (used by the "Test" button). */
export async function ping(hook: Hook) {
  const deliveryId = crypto.randomUUID();
  const body = JSON.stringify({ id: deliveryId, event: "ping", createdAt: Date.now(), data: { message: "Hello from FYRDrop", hook: hook.name } });
  const ok = await deliver(hook, deliveryId, "ping", body, 1);
  const last = db.select().from(webhookDeliveries).where(eq(webhookDeliveries.deliveryId, deliveryId)).get();
  return { ok, statusCode: last?.statusCode ?? null, error: last?.error ?? "" };
}

/** Item fields safe to put in a webhook payload (no content, no storage refs). */
export function itemPayload(row: { id: string; type: string; name: string; mime: string; size: number; groupId: string; category: string; labels: string; audience: string; createdAt: number; expiresAt: number | null; uploadedBy: string }) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    mime: row.mime,
    size: row.size,
    groupId: row.groupId,
    category: row.category,
    labels: row.labels ? row.labels.split(",") : [],
    audience: row.audience,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}
