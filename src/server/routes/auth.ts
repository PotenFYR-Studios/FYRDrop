import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, users } from "../db/schema";
import { publish } from "../lib/events";
import { encryptString } from "../lib/crypto";
import { forgetInitialPassword, currentPin } from "../lib/bootstrap";
import {
  createSession,
  setSessionCookie,
  clearSessionCookie,
  revokeSession,
  revokeUserSessions,
  sessionFromContext,
  requireDevice,
  requireOwner,
  publicUser,
} from "../lib/auth";
import { clientIp, clientIpInfo } from "../lib/net";
import { getSettings, updateSettings } from "../lib/settings";
import { hashSecret, verifySecret, PIN_RE, USERNAME_RE, normalizeUsername, validatePassword } from "../lib/secrets";
import { rateLimit, recordFailure, clearFailures, lockoutRemaining } from "../lib/security";
import { auditRequest, type LogInput } from "../lib/audit";
import { identifyDevice, parseUserAgent } from "../lib/device";
import { cleanAvatar, cleanColor } from "./users";
import type { AppEnv } from "../lib/net";

export const authRoutes = new Hono<AppEnv>();

// Auth payloads are tiny; refuse anything big before parsing (cheap DoS guard).
authRoutes.use("*", bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json({ error: "Payload too large." }, 413) }));

const VERSION = "1.0.0";

type AuditExtra = Omit<LogInput, "event" | "ok" | "detail" | "ip">;

function audit(c: Context, event: string, ok: boolean, detail: string, extra: AuditExtra = {}) {
  auditRequest(c, event, ok, detail, extra);
}

async function json<T>(c: Context): Promise<T | null> {
  return (await c.req.json<T>().catch(() => null)) as T | null;
}

/** Public: instance identity for the login screen. No side effects. */
authRoutes.get("/status", (c) => {
  const s = getSettings();
  return c.json({
    needsSetup: !s,
    appName: s?.appName ?? "FYRDrop",
    ownerName: s?.ownerName ?? "",
    maxUploadMb: s?.maxUploadMb ?? Number(process.env.MAX_UPLOAD_MB ?? 512),
    registrationOpen: s ? s.registrationOpen === 1 : true,
    version: VERSION,
  });
});

/**
 * What the server can tell about this browser before it is paired. Read-only:
 * no session is created, so the sign-in screen can show the real host name that
 * will be stored. Rate limited because it may trigger a reverse lookup.
 */
authRoutes.get("/device", rateLimit({ name: "deviceinfo", windowMs: 60_000, max: 30 }), async (c) => {
  const ipInfo = clientIpInfo(c);
  const identity = await identifyDevice({ ua: c.req.header("user-agent") ?? "", ip: ipInfo.ip });
  return c.json({
    deviceName: identity.name,
    hostName: identity.hostName,
    ip: ipInfo.ip,
    ipSource: ipInfo.source,
  });
});

/** Legacy first-run wizard. The instance is provisioned at boot, so this only reports that. */
authRoutes.post("/setup", (c) => c.json({ error: "This instance is already set up. Sign in instead." }, 409));

/** Stage 1 - pair this device with the instance PIN. */
authRoutes.post("/login", rateLimit({ name: "pin", windowMs: 60_000, max: 10 }), async (c) => {
  const s = getSettings();
  if (!s) return c.json({ error: "Setup required.", needsSetup: true }, 409);
  const body = await json<{ pin?: string; deviceName?: string; device?: unknown }>(c);
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  const ipInfo = clientIpInfo(c);
  const ua = c.req.header("user-agent") ?? "";
  // Older clients only send deviceName; new ones send a full device hints object.
  const hints = body?.device ?? (body?.deviceName ? { name: body.deviceName } : undefined);
  // Cheap label for failed attempts: reverse DNS costs a network round trip and
  // should not slow down (or amplify) wrong-PIN responses.
  const quick = parseUserAgent(ua);
  const attemptedName =
    (typeof (hints as { name?: unknown } | undefined)?.name === "string" && (hints as { name: string }).name.trim().slice(0, 60)) ||
    (quick.os === "Unknown OS" ? "Unknown device" : `${quick.browser} on ${quick.os}`);
  if (!PIN_RE.test(pin)) return c.json({ error: "PIN must be 4-10 digits." }, 400);
  const lockKey = `pin:${clientIp(c)}`;
  const wait = lockoutRemaining(lockKey);
  if (wait > 0) return c.json({ error: `Too many wrong PINs. Try again in ${Math.ceil(wait / 1000)}s.` }, 429);
  if (!(await verifySecret(pin, s.pinHash))) {
    recordFailure(lockKey);
    audit(c, "login.failed", false, `PIN rejected for ${attemptedName}`, {
      actor: { name: attemptedName },
      target: attemptedName,
      meta: { device: attemptedName, ip: ipInfo.ip, ipSource: ipInfo.source },
    });
    return c.json({ error: "Wrong PIN." }, 401);
  }
  clearFailures(lockKey);
  // Only now spend time resolving the host name and neighbour table.
  const identity = await identifyDevice({ ua, ip: ipInfo.ip, hints });
  const deviceName = identity.name;
  // Re-pairing replaces any previous session cookie on this browser.
  const prev = sessionFromContext(c);
  if (prev) revokeSession(prev.token);
  const { token } = createSession({
    deviceName,
    hostName: identity.hostName,
    userAgent: ua,
    ip: ipInfo.ip,
    ipSource: ipInfo.source,
    reportedIp: String((identity.meta.reportedIp as string) ?? ""),
    mac: identity.mac,
    deviceMeta: JSON.stringify(identity.meta),
  });
  setSessionCookie(c, token);
  audit(c, "login.ok", true, `${deviceName} paired with the instance PIN`, {
    actor: { name: deviceName },
    target: deviceName,
    meta: { device: deviceName, host: identity.hostName, ip: ipInfo.ip, ipSource: ipInfo.source },
  });
  publish({ scope: "sessions", action: "login" });
  return c.json({ ok: true, appName: s.appName, needsAccount: true, deviceName });
});

/** Who is on this device right now (paired device, optional account). */
authRoutes.get("/me", requireDevice, (c) => {
  const session = c.get("session");
  const u = session.user;
  return c.json({
    paired: true,
    deviceName: session.deviceName,
    hostName: session.hostName,
    ipSource: session.ipSource,
    reportedIp: session.reportedIp,
    mac: session.mac,
    user: publicUser(u),
    mustChangePassword: !!u && (!!u.mustChangePassword || !u.passwordHash),
  });
});

/** Bind the current device session to an account by rotating it into a fresh session. */
function rotateInto(c: Context, userId: string) {
  const prev = c.get("session");
  revokeSession(prev.token);
  const ipInfo = clientIpInfo(c);
  const { token } = createSession({
    deviceName: prev.deviceName,
    hostName: prev.hostName,
    userAgent: c.req.header("user-agent") ?? prev.userAgent,
    ip: ipInfo.ip,
    ipSource: ipInfo.source,
    reportedIp: prev.reportedIp,
    mac: prev.mac,
    deviceMeta: prev.deviceMeta,
    userId,
  });
  setSessionCookie(c, token);
  db.update(users).set({ lastSeenAt: Date.now() }).where(eq(users.id, userId)).run();
}

/** Stage 2a - sign in to an existing account (user or admin). */
authRoutes.post("/account/login", rateLimit({ name: "acct", windowMs: 60_000, max: 15 }), requireDevice, async (c) => {
  const body = await json<{ username?: string; password?: string }>(c);
  const username = normalizeUsername(body?.username);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password || password.length > 128) return c.json({ error: "Username and password are required." }, 400);
  const lockKey = `acct:${username}`;
  const wait = lockoutRemaining(lockKey);
  if (wait > 0) return c.json({ error: `Account temporarily locked. Try again in ${Math.ceil(wait / 1000)}s.` }, 429);
  const u = db.select().from(users).where(eq(users.username, username)).limit(1).get();
  const ok = await verifySecret(password, u?.passwordHash);
  if (!u || !ok) {
    recordFailure(lockKey);
    audit(c, "account.login-failed", false, `Wrong password for "${username}"`, { actor: { name: username }, target: username, meta: { device: c.get("session").deviceName } });
    return c.json({ error: "Wrong username or password." }, 401);
  }
  if (u.isBlocked) {
    audit(c, "account.login-blocked", false, `Blocked account "${username}" tried to sign in`, { actor: { name: username }, target: username, meta: { device: c.get("session").deviceName } });
    return c.json({ error: "This account has been blocked by the administrator." }, 403);
  }
  clearFailures(lockKey);
  rotateInto(c, u.id);
  audit(c, "account.login", true, `${u.name} signed in on "${c.get("session").deviceName}"`, { actor: { id: u.id, name: u.name }, target: c.get("session").deviceName, meta: { username, device: c.get("session").deviceName } });
  publish({ scope: "sessions", action: "account-login" });
  return c.json({ ok: true, user: publicUser(u), mustChangePassword: !!u.mustChangePassword });
});

/** Stage 2b - first visit: create an account (normal user). */
authRoutes.post("/account/register", rateLimit({ name: "reg", windowMs: 10 * 60_000, max: 10 }), requireDevice, async (c) => {
  const s = getSettings();
  if (s && s.registrationOpen !== 1) return c.json({ error: "New accounts are disabled by the administrator." }, 403);
  const body = await json<{ username?: string; name?: string; password?: string; avatar?: string | null; color?: string }>(c);
  const username = normalizeUsername(body?.username);
  if (!USERNAME_RE.test(username)) {
    return c.json({ error: "Username must be 3-32 characters: lowercase letters, digits, dot, dash or underscore." }, 400);
  }
  const name = (typeof body?.name === "string" ? body.name.trim() : "") || username;
  if (name.length > 40) return c.json({ error: "Display name is too long (max 40 characters)." }, 400);
  const pwErr = validatePassword(body?.password);
  if (pwErr) return c.json({ error: pwErr }, 400);
  if (body!.password!.toLowerCase().includes(username)) return c.json({ error: "Password must not contain your username." }, 400);
  const avatar = cleanAvatar(body?.avatar);
  if (avatar === false) return c.json({ error: "Avatar must be a PNG/JPEG/WebP image under ~150 KB." }, 400);
  const passwordHash = await hashSecret(body!.password!);
  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    username,
    name,
    passwordHash,
    mustChangePassword: 0,
    avatar,
    color: cleanColor(body?.color),
    role: "user",
    isBlocked: 0,
    quotaMb: 0,
    createdAt: now,
    lastSeenAt: now,
  };
  try {
    db.insert(users).values(row).run();
  } catch {
    // Unique index - also closes the check-then-insert race between two registrations.
    return c.json({ error: "That username is already taken." }, 409);
  }
  rotateInto(c, row.id);
  audit(c, "account.registered", true, `${name} created the account "${username}"`, { actor: { id: row.id, name }, target: username, meta: { username, device: c.get("session").deviceName } });
  publish({ scope: "sessions", action: "profile-created" });
  return c.json({ ok: true, user: publicUser(row) }, 201);
});

/** Switch account: leave the account but keep this device paired (no PIN needed again). */
authRoutes.post("/account/logout", requireDevice, (c) => {
  const prev = c.get("session");
  revokeSession(prev.token);
  const { token } = createSession({ deviceName: prev.deviceName, userAgent: c.req.header("user-agent") ?? "", ip: clientIp(c) });
  setSessionCookie(c, token);
  publish({ scope: "sessions", action: "account-logout" });
  return c.json({ ok: true });
});

/** Change (or, for legacy profiles, set) the account password. */
authRoutes.post("/account/password", rateLimit({ name: "pw", windowMs: 60_000, max: 10 }), requireDevice, async (c) => {
  const session = c.get("session");
  const u = session.user;
  if (!u) return c.json({ error: "Sign in to your account first." }, 401);
  const body = await json<{ currentPassword?: string; newPassword?: string }>(c);
  if (u.passwordHash) {
    const ok = await verifySecret(typeof body?.currentPassword === "string" ? body.currentPassword : "", u.passwordHash);
    if (!ok) {
      recordFailure(`acct:${u.username}`);
      return c.json({ error: "Current password is wrong." }, 403);
    }
  }
  const pwErr = validatePassword(body?.newPassword);
  if (pwErr) return c.json({ error: pwErr }, 400);
  if (body!.newPassword === body!.currentPassword) return c.json({ error: "Choose a password you haven't used here before." }, 400);
  if (u.username && body!.newPassword!.toLowerCase().includes(u.username)) return c.json({ error: "Password must not contain your username." }, 400);
  db.update(users)
    .set({ passwordHash: await hashSecret(body!.newPassword!), mustChangePassword: 0 })
    .where(eq(users.id, u.id))
    .run();
  if (u.role === "owner") forgetInitialPassword();
  // Every other device signed into this account must re-authenticate.
  const kicked = revokeUserSessions(u.id, session.token);
  audit(c, "account.password-changed", true, `${u.name} changed the password`, { actor: { id: u.id, name: u.name }, target: u.username ?? "", meta: { signedOutDevices: kicked } });
  return c.json({ ok: true, signedOut: kicked });
});

/** Full sign-out: forget this device entirely (PIN needed next time). */
authRoutes.post("/logout", (c) => {
  const session = sessionFromContext(c);
  if (session) revokeSession(session.token);
  clearSessionCookie(c);
  publish({ scope: "sessions", action: "logout" });
  return c.json({ ok: true });
});

/** Owner view of instance settings, including the current PIN so it can be shown and rotated. */
authRoutes.get("/settings", requireOwner, (c) => {
  const s = getSettings();
  if (!s) return c.json({ error: "Setup required." }, 409);
  return c.json({
    appName: s.appName,
    ownerName: s.ownerName,
    maxUploadMb: s.maxUploadMb,
    pin: currentPin() ?? "",
    registrationOpen: s.registrationOpen === 1,
    ipWhitelist: s.ipWhitelist,
    ipWhitelistEnabled: s.ipWhitelistEnabled === 1,
    storageQuotaMb: s.storageQuotaMb,
  });
});

/** Instance settings (owner only): name, limits, PIN rotation, whitelist, registration. */
authRoutes.post("/settings", requireOwner, async (c) => {
  const s = getSettings();
  if (!s) return c.json({ error: "Setup required." }, 409);
  const body = await json<{
    appName?: string;
    ownerName?: string;
    currentPin?: string;
    newPin?: string;
    maxUploadMb?: number;
    ipWhitelist?: string;
    ipWhitelistEnabled?: boolean;
    registrationOpen?: boolean;
    storageQuotaMb?: number;
  }>(c);
  if (!body) return c.json({ error: "Invalid body." }, 400);
  const patch: Record<string, unknown> = {};
  if (typeof body.appName === "string") patch.appName = body.appName.trim().slice(0, 60) || "FYRDrop";
  if (typeof body.ownerName === "string") patch.ownerName = body.ownerName.trim().slice(0, 60);
  if (body.maxUploadMb !== undefined) {
    const v = Number(body.maxUploadMb);
    if (!Number.isFinite(v) || v < 1 || v > 1_048_576) return c.json({ error: "maxUploadMb must be between 1 and 1048576 (1 TB)." }, 400);
    patch.maxUploadMb = Math.round(v);
  }
  if (typeof body.ipWhitelist === "string") {
    const entries = body.ipWhitelist.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 200);
    for (const e of entries) {
      const [base, bits] = e.split("/");
      const okBase = /^\d{1,3}(\.\d{1,3}){3}$/.test(base ?? "") && base!.split(".").every((o) => Number(o) <= 255);
      const okBits = bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32);
      if (!okBase || !okBits) return c.json({ error: `"${e}" is not a valid IPv4 or CIDR entry.` }, 400);
    }
    patch.ipWhitelist = entries.join(",");
  }
  if (typeof body.ipWhitelistEnabled === "boolean") patch.ipWhitelistEnabled = body.ipWhitelistEnabled ? 1 : 0;
  if (typeof body.registrationOpen === "boolean") patch.registrationOpen = body.registrationOpen ? 1 : 0;
  if (body.storageQuotaMb !== undefined) {
    const v = Number(body.storageQuotaMb);
    if (!Number.isFinite(v) || v < 0 || v > 16_777_216) return c.json({ error: "storageQuotaMb must be between 0 and 16777216 (16 TB)." }, 400);
    patch.storageQuotaMb = Math.round(v);
  }
  if (body.newPin !== undefined) {
    const np = String(body.newPin).trim();
    if (!PIN_RE.test(np)) return c.json({ error: "New PIN must be 4-10 digits." }, 400);
    patch.pinHash = await hashSecret(np);
    patch.pinEnc = encryptString(np);
  }
  updateSettings(patch);
  const changed = Object.keys(patch).filter((k) => k !== "pinHash" && k !== "pinEnc").concat(patch.pinHash ? ["pin"] : []);
  audit(c, "settings.updated", true, `Instance settings updated: ${changed.join(", ") || "no changes"}`, {
    target: "instance settings",
    meta: { changed },
  });
  publish({ scope: "settings", action: "updated" });
  const fresh = getSettings();
  return c.json({ ok: true, appName: fresh?.appName, maxUploadMb: fresh?.maxUploadMb });
});

/** Account count for the login screen hint (no names - avoids user enumeration). */
authRoutes.get("/accounts/count", requireDevice, (c) => {
  const n = db.select({ n: sql<number>`count(*)` }).from(users).get()?.n ?? 0;
  return c.json({ count: n });
});
