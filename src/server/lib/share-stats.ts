import crypto from "node:crypto";
import type { Context } from "hono";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { kv, shareEvents } from "../db/schema";
import { clientIp } from "./net";
import { parseUserAgent } from "./device";

/**
 * Per-share-link analytics without tracking people.
 *
 * Each open, PIN attempt and download is one row. No IP address is stored:
 * a visitor is SHA-256(daily salt, IP, user agent) cut to 16 hex chars, and
 * the salt changes every UTC day and is never shown, so the same person cannot
 * be followed across days or matched to an address. Rows go after 180 days.
 */

export type ShareEventKind = "view" | "unlock" | "pin_failed" | "download" | "blocked";
const RETENTION = 180 * 86_400_000;
let salt: { day: string; value: string } | null = null;

function dailySalt() {
  const day = new Date().toISOString().slice(0, 10);
  if (salt?.day === day) return salt.value;
  const key = `share-salt:${day}`;
  let row = db.select().from(kv).where(eq(kv.key, key)).get();
  if (!row) {
    const value = crypto.randomBytes(32).toString("hex");
    db.insert(kv).values({ key, value }).onConflictDoNothing().run();
    db.delete(kv).where(and(sql`${kv.key} LIKE 'share-salt:%'`, sql`${kv.key} <> ${key}`)).run();
    row = db.select().from(kv).where(eq(kv.key, key)).get()!;
  }
  salt = { day, value: row.value };
  return row.value;
}

function refHost(raw: string | undefined | null) {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.slice(0, 120) : "";
  } catch {
    return "";
  }
}

export function recordShareEvent(c: Context, token: string, itemId: string, kind: ShareEventKind, referrer?: string | null) {
  try {
    const ua = c.req.header("user-agent") ?? "";
    const p = parseUserAgent(ua);
    const visitor = crypto.createHash("sha256").update(`${dailySalt()}|${clientIp(c)}|${ua}`).digest("hex").slice(0, 16);
    const device = /bot|crawl|spider|preview|slurp|facebookexternalhit|whatsapp|telegram|discord|slack/i.test(ua)
      ? "Link preview / bot"
      : `${p.browser} on ${p.os}`;
    db.insert(shareEvents).values({ token, itemId, kind, ts: Date.now(), visitor, device: device.slice(0, 60), referrer: refHost(referrer) }).run();
  } catch (err) {
    console.error("[share-stats]", err);
  }
}

const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export function shareStats(token: string, days = 30) {
  const since = Date.now() - days * 86_400_000;
  const rows = db.select().from(shareEvents).where(eq(shareEvents.token, token)).orderBy(desc(shareEvents.id)).all();
  const count = (k: ShareEventKind) => rows.filter((r) => r.kind === k).length;
  const daily = new Map<string, { views: number; downloads: number }>();
  for (let i = days - 1; i >= 0; i--) daily.set(dayKey(Date.now() - i * 86_400_000), { views: 0, downloads: 0 });
  const tally = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const devices = new Map<string, number>();
  const referrers = new Map<string, number>();
  const visitorDays = new Set<string>();
  for (const r of rows) {
    if (r.kind === "view" || r.kind === "download") visitorDays.add(`${dayKey(r.ts)}:${r.visitor}`);
    if (r.kind === "view") {
      tally(devices, r.device);
      tally(referrers, r.referrer || "direct / unknown");
    }
    if (r.ts >= since) {
      const d = daily.get(dayKey(r.ts));
      if (d && r.kind === "view") d.views++;
      if (d && r.kind === "download") d.downloads++;
    }
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, n]) => ({ label, count: n }));
  return {
    totals: {
      views: count("view"),
      downloads: count("download"),
      uniqueVisitors: visitorDays.size,
      pinFailures: count("pin_failed"),
      unlocks: count("unlock"),
      blocked: count("blocked"),
    },
    daily: [...daily].map(([date, v]) => ({ date, ...v })),
    devices: top(devices),
    referrers: top(referrers),
    recent: rows.slice(0, 25).map((r) => ({ ts: r.ts, kind: r.kind, device: r.device, referrer: r.referrer })),
    firstAt: rows.at(-1)?.ts ?? null,
    lastAt: rows[0]?.ts ?? null,
  };
}

/** Totals for many links at once (list views). */
export function shareTotals(tokens: string[]) {
  const out = new Map<string, { views: number; downloads: number; lastAt: number | null }>();
  if (tokens.length === 0) return out;
  const rows = db
    .select({ token: shareEvents.token, kind: shareEvents.kind, n: sql<number>`count(*)`, last: sql<number>`max(${shareEvents.ts})` })
    .from(shareEvents)
    .where(and(inArray(shareEvents.token, tokens.slice(0, 900)), inArray(shareEvents.kind, ["view", "download"])))
    .groupBy(shareEvents.token, shareEvents.kind)
    .all();
  for (const r of rows) {
    const o = out.get(r.token) ?? { views: 0, downloads: 0, lastAt: null };
    if (r.kind === "view") o.views = r.n;
    else o.downloads = r.n;
    o.lastAt = Math.max(o.lastAt ?? 0, r.last);
    out.set(r.token, o);
  }
  return out;
}

export function deleteShareEvents(token: string) {
  db.delete(shareEvents).where(eq(shareEvents.token, token)).run();
}

export function sweepShareEvents() {
  db.delete(shareEvents).where(lt(shareEvents.ts, Date.now() - RETENTION)).run();
}

