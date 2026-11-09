import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { db } from "../db";
import { auditLog as auditTable } from "../db/schema";
import { verifyToken, SESSION_COOKIE } from "./auth";
import { clientIp, requestHost } from "./net";
import { getSettings } from "./settings";

/**
 * OWASP hardening middleware collection:
 *  - securityHeaders: CSP + hardening headers on every response (A05)
 *  - csrfOriginCheck: state-changing requests must be same-origin (A01)
 *  - rateLimit: fixed-window counters per IP, bounded memory (A07)
 *  - ipWhitelist: optional network allow-list
 */

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "frame-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

export function securityHeaders(opts: { hsts: boolean }) {
  return async (c: Context, next: Next) => {
    await next();
    const h = c.res?.headers;
    if (!h) return;
    const setIfMissing = (k: string, v: string) => {
      if (!h.has(k)) h.set(k, v);
    };
    setIfMissing("X-Content-Type-Options", "nosniff");
    setIfMissing("X-Frame-Options", "DENY");
    setIfMissing("Referrer-Policy", "same-origin");
    setIfMissing("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
    setIfMissing("Cross-Origin-Opener-Policy", "same-origin");
    setIfMissing("Cross-Origin-Resource-Policy", "same-origin");
    setIfMissing("X-Permitted-Cross-Domain-Policies", "none");
    setIfMissing("Content-Security-Policy", CSP);
    if (opts.hsts) setIfMissing("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    if (c.req.path.startsWith("/api/")) setIfMissing("Cache-Control", "no-store");
    h.delete("X-Powered-By");
  };
}

/** IP whitelist (admin-configured). Gates new logins & anonymous endpoints;
 *  already-paired devices (valid session) keep access so admins can't lock themselves out. */
export function ipWhitelist() {
  return async (c: Context, next: Next) => {
    const s = getSettings();
    if (!s || !s.ipWhitelistEnabled || !s.ipWhitelist.trim()) return next();
    const ip = clientIp(c);
    const allowed = s.ipWhitelist.split(",").map((x: string) => x.trim()).filter(Boolean);
    const ok = ip === "127.0.0.1" || ip === "::1" || allowed.some((a) => (a.includes("/") ? ipInCidr(ip, a) : a === ip));
    if (ok) return next();
    const token = getCookie(c, SESSION_COOKIE);
    if (token && verifyToken(token)) return next();
    if (hit(`wl-audit:${ip}`, 60_000, 1)) {
      db.insert(auditTable).values({ ts: Date.now(), ip, event: "ip.whitelist-block", ok: 0, detail: `Blocked ${c.req.method} ${c.req.path.slice(0, 120)} from an IP outside the whitelist`, category: "security", severity: "warn", actorName: "ip whitelist", target: c.req.path.slice(0, 160) }).run();
    }
    return c.json({ error: "Your IP address is not whitelisted." }, 403);
  };
}

function ipToLong(ip: string) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function ipInCidr(ip: string, cidr: string) {
  const [range, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipLong = ipToLong(ip);
  const rangeLong = ipToLong(range ?? "");
  if (ipLong === null || rangeLong === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ipLong & mask) >>> 0) === ((rangeLong & mask) >>> 0);
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Paths authenticated by something other than the browser cookie (signed node-to-node calls). */
const CSRF_EXEMPT = ["/api/cluster-node/", "/api/federation/inbound"];

export function csrfOriginCheck() {
  return async (c: Context, next: Next) => {
    if (!MUTATING.has(c.req.method)) return next();
    if (CSRF_EXEMPT.some((p) => c.req.path.startsWith(p))) return next();
    const origin = c.req.header("origin") ?? c.req.header("referer");
    if (!origin) {
      // Non-browser clients (curl, health checks) send no Origin; they also carry no
      // ambient cookie, so they can't ride a victim's session.
      if (!getCookie(c, SESSION_COOKIE)) return next();
      // Browsers always send Origin on cross-site POSTs; a cookie-bearing request
      // without one must come from a same-origin navigation of an old browser.
      if (c.req.header("sec-fetch-site") && c.req.header("sec-fetch-site") !== "same-origin") {
        return c.json({ error: "Cross-origin request blocked." }, 403);
      }
      return next();
    }
    try {
      if (new URL(origin).host !== requestHost(c)) return c.json({ error: "Cross-origin request blocked." }, 403);
    } catch {
      return c.json({ error: "Invalid Origin header." }, 403);
    }
    return next();
  };
}

/* ---------- Rate limiting (fixed window, bounded) ---------- */

const windows = new Map<string, { count: number; resetAt: number }>();
const MAX_KEYS = 20_000;

/** Count one hit; returns true while under the limit. */
export function hit(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (!w && windows.size >= MAX_KEYS) sweepRateLimits(true);
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count++;
  return w.count <= max;
}

export function retryAfter(key: string) {
  const w = windows.get(key);
  return w ? Math.max(1, Math.ceil((w.resetAt - Date.now()) / 1000)) : 1;
}

export function sweepRateLimits(aggressive = false) {
  const now = Date.now();
  for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  if (aggressive && windows.size >= MAX_KEYS) {
    // Under a flood keep memory bounded: drop the oldest half.
    let i = 0;
    for (const k of windows.keys()) {
      if (i++ > MAX_KEYS / 2) break;
      windows.delete(k);
    }
  }
}

export function rateLimit(opts: { name: string; windowMs: number; max: number }) {
  return async (c: Context, next: Next) => {
    const key = `${opts.name}:${clientIp(c)}`;
    if (!hit(key, opts.windowMs, opts.max)) {
      c.header("Retry-After", String(retryAfter(key)));
      return c.json({ error: "Too many attempts - wait a moment and try again." }, 429);
    }
    return next();
  };
}

/* ---------- Account lockout (per username, survives IP rotation) ---------- */

const failures = new Map<string, { count: number; until: number; last: number }>();

export function lockoutRemaining(key: string): number {
  const f = failures.get(key);
  if (!f) return 0;
  return Math.max(0, f.until - Date.now());
}

export function recordFailure(key: string) {
  const now = Date.now();
  const f = failures.get(key) ?? { count: 0, until: 0, last: now };
  // Forget old streaks after an hour of quiet.
  if (now - f.last > 60 * 60_000) f.count = 0;
  f.count++;
  f.last = now;
  // 5 free attempts, then exponential lockout: 30 s, 60 s, 2 min … capped at 30 min.
  if (f.count >= 5) f.until = now + Math.min(30 * 60_000, 30_000 * 2 ** (f.count - 5));
  failures.set(key, f);
  if (failures.size > MAX_KEYS) for (const [k, v] of failures) if (now - v.last > 60 * 60_000) failures.delete(k);
}

export function clearFailures(key: string) {
  failures.delete(key);
}

export function sweepLockouts() {
  const now = Date.now();
  for (const [k, v] of failures) if (now - v.last > 60 * 60_000 && v.until < now) failures.delete(k);
}
