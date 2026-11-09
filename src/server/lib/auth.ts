import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, lt, ne } from "drizzle-orm";
import { db } from "../db";
import { auditLog, sessions, revokedTokens, users } from "../db/schema";
import { effectiveTtlDays } from "./config";
import { clientIp, requestProto } from "./net";

/**
 * Stateless signed session tokens (HMAC-SHA256) - no DB write on the hot path.
 * Format: v1.<sessionId>.<expiresAtMs>.<hmac(sessionId.expiresAtMs)>
 *
 * Two-stage sign-in:
 *   1. Instance PIN  -> a "paired device" session (userId = null)
 *   2. Account login / registration -> the session is ROTATED into a new
 *      session bound to that user (prevents session fixation).
 * The device row in `sessions` is the registry (admin "connections" page);
 * revocation adds the sessionId to `revoked_tokens` (tiny table, memory cache).
 */

export const SESSION_COOKIE = "fyrdrop_session";
const TTL_DAYS = () => effectiveTtlDays();

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SessionCtx = SessionRow & { token: string; user: UserRow | null };

let signingSecret: Buffer | null = null;
const revokedCache = new Set<string>();
let revokedLoaded = false;
const lastSeenThrottle = new Map<string, number>();
const blockedAuditThrottle = new Map<string, number>();

function secret(): Buffer {
  if (signingSecret) return signingSecret;
  const f = path.resolve(process.env.DATA_DIR ?? "./data", "keys", "session.secret");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48), { mode: 0o600 });
  signingSecret = fs.readFileSync(f);
  return signingSecret;
}

function hmac(data: string) {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url");
}

/** Sign an arbitrary short value (share-link grants etc.). */
export function signValue(purpose: string, value: string, ttlMs: number) {
  const exp = Date.now() + ttlMs;
  return `${exp}.${hmac(`${purpose}:${value}:${exp}`)}`;
}

export function verifySignedValue(purpose: string, value: string, grant: string | undefined | null): boolean {
  if (!grant) return false;
  const [expStr, sig] = grant.split(".");
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(`${purpose}:${value}:${exp}`));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function ensureRevokedLoaded() {
  if (revokedLoaded) return;
  for (const row of db.select({ id: revokedTokens.sessionId }).from(revokedTokens).all()) revokedCache.add(row.id);
  revokedLoaded = true;
}

export function createSession(opts: {
  deviceName: string;
  userAgent: string;
  ip: string;
  userId?: string | null;
  hostName?: string;
  ipSource?: string;
  reportedIp?: string;
  mac?: string;
  deviceMeta?: string;
}) {
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + TTL_DAYS() * 86_400_000;
  db.insert(sessions)
    .values({
      token: sessionId,
      deviceName: (opts.deviceName || "Unknown device").slice(0, 60),
      hostName: (opts.hostName ?? "").slice(0, 80),
      userAgent: opts.userAgent.slice(0, 400),
      ip: opts.ip.slice(0, 64),
      ipSource: (opts.ipSource ?? "socket").slice(0, 16),
      reportedIp: (opts.reportedIp ?? "").slice(0, 64),
      mac: (opts.mac ?? "").slice(0, 32),
      deviceMeta: (opts.deviceMeta ?? "").slice(0, 2000),
      userId: opts.userId ?? null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    })
    .run();
  const payload = `${sessionId}.${expiresAt}`;
  return { sessionId, token: `v1.${payload}.${hmac(payload)}` };
}

export function verifyToken(token: string): { sessionId: string; expiresAt: number } | null {
  if (token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const sessionId = parts[1]!;
  const expiresAtStr = parts[2]!;
  const sig = parts[3]!;
  const expected = hmac(`${sessionId}.${expiresAtStr}`);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  ensureRevokedLoaded();
  if (revokedCache.has(sessionId)) return null;
  return { sessionId, expiresAt };
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: requestProto(c) === "https",
    path: "/",
    maxAge: TTL_DAYS() * 86_400,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: requestProto(c) === "https" });
}

export function revokeSession(sessionId: string) {
  db.delete(sessions).where(eq(sessions.token, sessionId)).run();
  db.insert(revokedTokens).values({ sessionId, revokedAt: Date.now(), prunable: 1 }).onConflictDoNothing().run();
  revokedCache.add(sessionId);
  lastSeenThrottle.delete(sessionId);
}

/** Sign a user out everywhere (optionally keeping the caller's own session). */
export function revokeUserSessions(userId: string, exceptSessionId?: string) {
  const rows = db
    .select({ token: sessions.token })
    .from(sessions)
    .where(exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.token, exceptSessionId)) : eq(sessions.userId, userId))
    .all();
  for (const r of rows) revokeSession(r.token);
  return rows.length;
}

const ctxCache = new WeakMap<Request, SessionCtx | null>();

export function sessionFromContext(c: Context): SessionCtx | undefined {
  const raw = c.req.raw;
  if (ctxCache.has(raw)) return ctxCache.get(raw) ?? undefined;
  const result = loadSession(c);
  ctxCache.set(raw, result ?? null);
  return result;
}

function loadSession(c: Context): SessionCtx | undefined {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return undefined;
  const info = verifyToken(token);
  if (!info) return undefined;
  const row = db.select().from(sessions).where(eq(sessions.token, info.sessionId)).limit(1).get();
  if (!row) return undefined;
  const now = Date.now();
  const last = lastSeenThrottle.get(info.sessionId) ?? 0;
  if (now - last > 60_000) {
    lastSeenThrottle.set(info.sessionId, now);
    db.update(sessions).set({ lastSeenAt: now, ip: clientIp(c) }).where(eq(sessions.token, info.sessionId)).run();
  }
  let user: UserRow | null = null;
  if (row.userId) {
    user = db.select().from(users).where(eq(users.id, row.userId)).limit(1).get() ?? null;
    // Profile deleted underneath the session -> treat as a plain paired device.
  }
  return { ...row, token: info.sessionId, user };
}

function auditBlocked(c: Context, name: string) {
  const ip = clientIp(c);
  const key = `${ip}:${name}`;
  const now = Date.now();
  if (now - (blockedAuditThrottle.get(key) ?? 0) < 5 * 60_000) return;
  blockedAuditThrottle.set(key, now);
  db.insert(auditLog).values({ ts: now, ip, event: "user.blocked-request", ok: 0, detail: `Blocked account "${name.slice(0, 80)}" kept a valid session`, category: "security", severity: "warn", actorName: name.slice(0, 80), target: name.slice(0, 160) }).run();
}

/** Shared gate; returns an error Response or null when the session is acceptable. */
function gate(c: Context, level: "device" | "user" | "owner"): Response | null {
  const session = sessionFromContext(c);
  if (!session) return c.json({ error: "Unauthorized - enter the instance PIN.", needsPin: true }, 401);
  if (session.user?.isBlocked) {
    auditBlocked(c, session.user.name);
    return c.json({ error: "This account has been blocked by the administrator." }, 403);
  }
  if (level !== "device") {
    if (!session.user) return c.json({ error: "Sign in to your account first.", needsAccount: true }, 401);
    if (session.user.mustChangePassword || !session.user.passwordHash) {
      return c.json({ error: "Choose a new password to continue.", mustChangePassword: true }, 403);
    }
    if (level === "owner" && session.user.role !== "owner") return c.json({ error: "Owner access required." }, 403);
  }
  c.set("session", session);
  return null;
}

/** A paired device (PIN accepted). The account may not be chosen yet. */
export const requireDevice: MiddlewareHandler = async (c, next) => gate(c, "device") ?? next();

/** A signed-in account (PIN + account login), password up to date. */
export const requireSession: MiddlewareHandler = async (c, next) => gate(c, "user") ?? next();

/** Admin surfaces are owner-only - everyone else is a normal user. */
export const requireOwner: MiddlewareHandler = async (c, next) => gate(c, "owner") ?? next();

export function isOwner(session: SessionCtx | undefined) {
  return session?.user?.role === "owner";
}

/** Strip secrets before a user row leaves the server. */
export function publicUser(u: UserRow | null | undefined) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return { ...rest, hasPassword: !!passwordHash };
}

/** Periodic maintenance: expired sessions, old revocations, throttle maps. */
export function cleanupSessions() {
  const now = Date.now();
  const expired = db.select({ token: sessions.token }).from(sessions).where(lt(sessions.expiresAt, now)).all();
  for (const s of expired) {
    db.delete(sessions).where(eq(sessions.token, s.token)).run();
    lastSeenThrottle.delete(s.token);
  }
  // A token can never outlive the max TTL (365 d), so older revocations are dead weight.
  const horizon = now - 366 * 86_400_000;
  const pruned = db.delete(revokedTokens).where(lt(revokedTokens.revokedAt, horizon)).returning({ id: revokedTokens.sessionId }).all();
  for (const p of pruned) revokedCache.delete(p.id);
  for (const [k, t] of lastSeenThrottle) if (now - t > 10 * 60_000) lastSeenThrottle.delete(k);
  for (const [k, t] of blockedAuditThrottle) if (now - t > 10 * 60_000) blockedAuditThrottle.delete(k);
  return expired.length;
}

declare module "hono" {
  interface ContextVariableMap {
    session: SessionCtx;
  }
}
