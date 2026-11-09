import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import crypto from "node:crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import QRCode from "qrcode";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { db } from "../db";
import { passwordResets, users, webauthnCredentials } from "../db/schema";
import { requireDevice, requireOwner, requireSession, revokeUserSessions, type UserRow } from "../lib/auth";
import { encryptString, decryptString } from "../lib/crypto";
import { hashSecret, verifySecret, validatePassword } from "../lib/secrets";
import { rateLimit, recordFailure, clearFailures, lockoutRemaining } from "../lib/security";
import { requestHost, requestProto, type AppEnv } from "../lib/net";
import { getSettings } from "../lib/settings";
import { auditRequest } from "../lib/audit";
import { EMAIL_RE, mailEnabled, normalizeEmail, publicLink, renderMail, sendMail } from "../lib/mail";
import { consumeRecovery, hashRecovery, newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from "../lib/totp";
import { MAX_ATTEMPTS, acceptTotpStep, dropTicket, getTicket, passkeyCount, secondFactorMethods } from "../lib/second-factor";
import { forgetInitialPassword } from "../lib/bootstrap";
import { finishAccountLogin } from "./auth";
import { notify } from "../lib/notify";

const securityNote = (userId: string, title: string) => notify(userId, "security.account", { title, body: "If this was not you, reset your password right away and tell the owner of this instance.", link: "/profile" });

/**
 * Account security: second factor (TOTP, passkeys, recovery codes), email
 * address verification and password reset by email.
 */
export const accountRoutes = new Hono<AppEnv>();
accountRoutes.use("*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "Payload too large." }, 413) }));

const appName = () => getSettings()?.appName ?? "FYRDrop";
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
async function body<T>(c: Context): Promise<T> {
  return ((await c.req.json<T>().catch(() => null)) ?? {}) as T;
}
const fresh = (id: string) => db.select().from(users).where(eq(users.id, id)).get()!;

/** Sensitive changes need the account password again. */
async function reauth(c: Context, u: UserRow, password: unknown): Promise<Response | null> {
  const key = `acct:${u.username}`;
  const wait = lockoutRemaining(key);
  if (wait > 0) return c.json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.` }, 429);
  if (typeof password !== "string" || !(await verifySecret(password, u.passwordHash))) {
    recordFailure(key);
    return c.json({ error: "Password is wrong." }, 403);
  }
  return null;
}

/* --------------------------- relying party (passkeys) ---------------------- */

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
function relyingParty(c: Context): { rpId: string; origin: string } | { error: string } {
  const host = requestHost(c);
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.replace(/:\d+$/, "");
  if (!hostname || IPV4.test(hostname) || hostname.includes(":")) {
    return { error: "Passkeys need a host name, not an IP address. Open FYRDrop as https://localhost, a .local name or your domain." };
  }
  const proto = requestProto(c);
  if (proto !== "https" && hostname !== "localhost") return { error: "Passkeys need HTTPS." };
  return { rpId: hostname.toLowerCase(), origin: `${proto}://${host}` };
}

/* ---------------------------- sign-in: 2nd factor -------------------------- */

/** Passkey challenge for a pending sign-in ticket. */
accountRoutes.post("/login/passkey-options", rateLimit({ name: "2fa-opt", windowMs: 60_000, max: 20 }), requireDevice, async (c) => {
  const b = await body<{ ticket?: string }>(c);
  const t = getTicket(b.ticket, c.get("session").token);
  if (!t) return c.json({ error: "Sign-in expired - enter your password again.", restart: true }, 401);
  const rp = relyingParty(c);
  if ("error" in rp) return c.json({ error: rp.error }, 400);
  const creds = db.select().from(webauthnCredentials).where(and(eq(webauthnCredentials.userId, t.userId), eq(webauthnCredentials.rpId, rp.rpId))).all();
  if (creds.length === 0) return c.json({ error: "No passkey for this account is registered on this address." }, 404);
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    userVerification: "preferred",
    allowCredentials: creds.map((k) => ({ id: k.id, transports: (k.transports ? k.transports.split(",") : undefined) as any })),
  });
  t.challenge = options.challenge;
  t.rpId = rp.rpId;
  t.origin = rp.origin;
  return c.json(options);
});

/** Complete a sign-in with a TOTP code, a recovery code or a passkey assertion. */
accountRoutes.post("/login/verify", rateLimit({ name: "2fa", windowMs: 60_000, max: 20 }), requireDevice, async (c) => {
  const b = await body<{ ticket?: string; code?: string; recoveryCode?: string; passkey?: any }>(c);
  const ticketId = String(b.ticket ?? "");
  const t = getTicket(ticketId, c.get("session").token);
  if (!t) return c.json({ error: "Sign-in expired - enter your password again.", restart: true }, 401);
  const u = db.select().from(users).where(eq(users.id, t.userId)).get();
  if (!u || u.isBlocked) {
    dropTicket(ticketId);
    return c.json({ error: "This account cannot sign in.", restart: true }, 403);
  }
  const fail = (msg: string) => {
    t.attempts++;
    auditRequest(c, "account.login-2fa-failed", false, `Wrong second factor for "${u.username}"`, { actor: { id: u.id, name: u.name }, target: u.username ?? "", meta: { attempts: t.attempts } });
    if (t.attempts >= MAX_ATTEMPTS) {
      dropTicket(ticketId);
      recordFailure(`acct:${u.username}`);
      return c.json({ error: "Too many wrong codes - sign in again.", restart: true }, 401);
    }
    return c.json({ error: msg }, 401);
  };

  let via = "";
  if (typeof b.code === "string" && b.code.trim()) {
    if (u.totpEnabled !== 1 || !u.totpSecret) return fail("This account has no authenticator app.");
    const step = verifyTotp(decryptString(u.totpSecret), b.code);
    if (step === null || !acceptTotpStep(u.id, step)) return fail("That code is wrong or was already used.");
    via = "authenticator code";
  } else if (typeof b.recoveryCode === "string" && b.recoveryCode.trim()) {
    const rest = consumeRecovery(u.recoveryCodes, b.recoveryCode);
    if (rest === null) return fail("That recovery code is wrong or was already used.");
    db.update(users).set({ recoveryCodes: rest }).where(eq(users.id, u.id)).run();
    via = "recovery code";
  } else if (b.passkey && typeof b.passkey === "object") {
    if (!t.challenge || !t.rpId || !t.origin) return fail("Ask for a passkey challenge first.");
    const cred = db.select().from(webauthnCredentials).where(and(eq(webauthnCredentials.id, String(b.passkey.id ?? "")), eq(webauthnCredentials.userId, u.id))).get();
    if (!cred) return fail("That passkey is not registered for this account.");
    let ok = false;
    try {
      const v = await verifyAuthenticationResponse({
        response: b.passkey,
        expectedChallenge: t.challenge,
        expectedOrigin: t.origin,
        expectedRPID: t.rpId,
        requireUserVerification: false,
        credential: { id: cred.id, publicKey: isoBase64URL.toBuffer(cred.publicKey), counter: cred.counter, transports: (cred.transports ? cred.transports.split(",") : undefined) as any },
      });
      ok = v.verified;
      if (ok) db.update(webauthnCredentials).set({ counter: v.authenticationInfo.newCounter, lastUsedAt: Date.now() }).where(eq(webauthnCredentials.id, cred.id)).run();
    } catch {
      ok = false;
    }
    t.challenge = undefined;
    if (!ok) return fail("The passkey could not be verified.");
    via = `passkey "${cred.name}"`;
  } else {
    return c.json({ error: "Enter a code." }, 400);
  }
  dropTicket(ticketId);
  clearFailures(`acct:${u.username}`);
  return finishAccountLogin(c, fresh(u.id), via);
});

/* ------------------------------ security overview -------------------------- */

accountRoutes.get("/security", requireSession, (c) => {
  const u = c.get("session").user!;
  const keys = db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, u.id)).all();
  const rp = relyingParty(c);
  return c.json({
    totpEnabled: u.totpEnabled === 1,
    recoveryCodesLeft: u.recoveryCodes ? u.recoveryCodes.split(",").filter(Boolean).length : 0,
    passkeys: keys.map((k) => ({ id: k.id, name: k.name, rpId: k.rpId, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })),
    passkeysAvailable: !("error" in rp),
    passkeysProblem: "error" in rp ? rp.error : "",
    currentRpId: "error" in rp ? "" : rp.rpId,
    email: u.email,
    emailVerified: u.emailVerified === 1,
    pendingEmail: emailCodes.get(u.id)?.email ?? null,
    mailEnabled: mailEnabled(),
  });
});

/* ----------------------------------- TOTP ---------------------------------- */

const pendingTotp = new Map<string, { secret: string; expiresAt: number }>();

accountRoutes.post("/totp/setup", requireSession, async (c) => {
  const u = c.get("session").user!;
  const b = await body<{ password?: string }>(c);
  const bad = await reauth(c, u, b.password);
  if (bad) return bad;
  const secret = newTotpSecret();
  pendingTotp.set(u.id, { secret, expiresAt: Date.now() + 15 * 60_000 });
  const uri = otpauthUri({ secret, account: u.username ?? u.name, issuer: appName() });
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return c.json({ secret, uri, qr });
});

accountRoutes.post("/totp/enable", rateLimit({ name: "totp-en", windowMs: 60_000, max: 10 }), requireSession, async (c) => {
  const u = c.get("session").user!;
  const b = await body<{ code?: string }>(c);
  const p = pendingTotp.get(u.id);
  if (!p || p.expiresAt < Date.now()) return c.json({ error: "Setup expired - start again." }, 400);
  const step = verifyTotp(p.secret, String(b.code ?? ""));
  if (step === null || !acceptTotpStep(u.id, step)) return c.json({ error: "That code is wrong. Check the time on your phone and try again." }, 400);
  pendingTotp.delete(u.id);
  const codes = newRecoveryCodes();
  db.update(users).set({ totpSecret: encryptString(p.secret), totpEnabled: 1, recoveryCodes: codes.map(hashRecovery).join(",") }).where(eq(users.id, u.id)).run();
  securityNote(u.id, "Authenticator app sign-in was turned on");
  auditRequest(c, "account.2fa-enabled", true, `${u.name} turned on the authenticator app`, { target: u.username ?? "" });
  return c.json({ ok: true, recoveryCodes: codes });
});

accountRoutes.post("/totp/disable", requireSession, async (c) => {
  const u = c.get("session").user!;
  const b = await body<{ password?: string }>(c);
  const bad = await reauth(c, u, b.password);
  if (bad) return bad;
  const keepRecovery = passkeyCount(u.id) > 0;
  db.update(users).set({ totpSecret: null, totpEnabled: 0, ...(keepRecovery ? {} : { recoveryCodes: "" }) }).where(eq(users.id, u.id)).run();
  securityNote(u.id, "Authenticator app sign-in was turned off");
  auditRequest(c, "account.2fa-disabled", true, `${u.name} turned off the authenticator app`, { target: u.username ?? "", severity: "warn" });
  return c.json({ ok: true });
});

accountRoutes.post("/recovery/regenerate", requireSession, async (c) => {
  const u = c.get("session").user!;
  const b = await body<{ password?: string }>(c);
  const bad = await reauth(c, u, b.password);
  if (bad) return bad;
  if (secondFactorMethods(u).filter((m) => m !== "recovery").length === 0) return c.json({ error: "Turn on an authenticator app or add a passkey first." }, 400);
  const codes = newRecoveryCodes();
  db.update(users).set({ recoveryCodes: codes.map(hashRecovery).join(",") }).where(eq(users.id, u.id)).run();
  auditRequest(c, "account.recovery-regenerated", true, `${u.name} generated new recovery codes`, { target: u.username ?? "" });
  return c.json({ ok: true, recoveryCodes: codes });
});

/* --------------------------------- passkeys -------------------------------- */

const pendingReg = new Map<string, { challenge: string; rpId: string; origin: string; expiresAt: number; name: string }>();

accountRoutes.post("/passkeys/options", requireSession, async (c) => {
  const u = c.get("session").user!;
  const b = await body<{ password?: string; name?: string }>(c);
  const bad = await reauth(c, u, b.password);
  if (bad) return bad;
  const rp = relyingParty(c);
  if ("error" in rp) return c.json({ error: rp.error }, 400);
  const existing = db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, u.id)).all();
  if (existing.length >= 10) return c.json({ error: "You already have 10 passkeys. Remove one first." }, 400);
  const options = await generateRegistrationOptions({
    rpName: appName(),
    rpID: rp.rpId,
    userID: isoUint8Array.fromUTF8String(u.id),
    userName: u.username ?? u.name,
    userDisplayName: u.name,
    attestationType: "none",
    excludeCredentials: existing.filter((k) => k.rpId === rp.rpId).map((k) => ({ id: k.id, transports: (k.transports ? k.transports.split(",") : undefined) as any })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  const name = (typeof b.name === "string" ? b.name.trim() : "").slice(0, 60) || "Passkey";
  pendingReg.set(u.id, { challenge: options.challenge, rpId: rp.rpId, origin: rp.origin, expiresAt: Date.now() + 5 * 60_000, name });
  return c.json(options);
});

accountRoutes.post("/passkeys/register", requireSession, async (c) => {
  const u = c.get("session").user!;
  const b = await body<{ response?: any }>(c);
  const p = pendingReg.get(u.id);
  pendingReg.delete(u.id);
  if (!p || p.expiresAt < Date.now()) return c.json({ error: "Registration expired - try again." }, 400);
  let info;
  try {
    const v = await verifyRegistrationResponse({ response: b.response, expectedChallenge: p.challenge, expectedOrigin: p.origin, expectedRPID: p.rpId, requireUserVerification: false });
    if (!v.verified || !v.registrationInfo) throw new Error("not verified");
    info = v.registrationInfo;
  } catch {
    return c.json({ error: "The passkey could not be verified." }, 400);
  }
  const cred = info.credential;
  db.insert(webauthnCredentials)
    .values({
      id: cred.id,
      userId: u.id,
      rpId: p.rpId,
      publicKey: isoBase64URL.fromBuffer(cred.publicKey),
      counter: cred.counter,
      transports: (cred.transports ?? []).join(","),
      name: p.name,
      createdAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();
  // First second factor: hand out recovery codes so a lost key is not a lockout.
  let recoveryCodes: string[] | undefined;
  if (!fresh(u.id).recoveryCodes) {
    recoveryCodes = newRecoveryCodes();
    db.update(users).set({ recoveryCodes: recoveryCodes.map(hashRecovery).join(",") }).where(eq(users.id, u.id)).run();
  }
  securityNote(u.id, `A passkey ("${p.name}") was added to your account`);
  auditRequest(c, "account.passkey-added", true, `${u.name} added the passkey "${p.name}"`, { target: u.username ?? "", meta: { rpId: p.rpId } });
  return c.json({ ok: true, recoveryCodes }, 201);
});

accountRoutes.post("/passkeys/:id/delete", requireSession, async (c) => {
  const u = c.get("session").user!;
  const b = await body<{ password?: string }>(c);
  const bad = await reauth(c, u, b.password);
  if (bad) return bad;
  const gone = db.delete(webauthnCredentials).where(and(eq(webauthnCredentials.id, c.req.param("id")), eq(webauthnCredentials.userId, u.id))).returning().all();
  if (gone.length === 0) return c.json({ error: "No such passkey." }, 404);
  if (secondFactorMethods(fresh(u.id)).filter((m) => m !== "recovery").length === 0) db.update(users).set({ recoveryCodes: "" }).where(eq(users.id, u.id)).run();
  securityNote(u.id, `The passkey "${gone[0]!.name}" was removed from your account`);
  auditRequest(c, "account.passkey-removed", true, `${u.name} removed the passkey "${gone[0]!.name}"`, { target: u.username ?? "", severity: "warn" });
  return c.json({ ok: true });
});

/** Owner: clear every second factor of an account that lost its devices. */
accountRoutes.post("/admin/:userId/reset-2fa", requireOwner, (c) => {
  const id = c.req.param("userId");
  const u = db.select().from(users).where(eq(users.id, id)).get();
  if (!u) return c.json({ error: "No such account." }, 404);
  db.update(users).set({ totpSecret: null, totpEnabled: 0, recoveryCodes: "" }).where(eq(users.id, id)).run();
  db.delete(webauthnCredentials).where(eq(webauthnCredentials.userId, id)).run();
  const kicked = revokeUserSessions(id);
  securityNote(id, "The owner reset your two-step sign-in");
  auditRequest(c, "account.2fa-reset", true, `Two-factor sign-in reset for ${u.name}`, { target: u.username ?? "", severity: "warn", meta: { signedOutDevices: kicked } });
  return c.json({ ok: true });
});

/* ----------------------------------- email --------------------------------- */

const emailCodes = new Map<string, { email: string; codeHash: string; expiresAt: number; attempts: number }>();

accountRoutes.post("/email", rateLimit({ name: "email-set", windowMs: 10 * 60_000, max: 5 }), requireSession, async (c) => {
  const u = c.get("session").user!;
  const b = await body<{ email?: string; password?: string }>(c);
  const bad = await reauth(c, u, b.password);
  if (bad) return bad;
  const email = normalizeEmail(b.email);
  if (!EMAIL_RE.test(email)) return c.json({ error: "That does not look like an email address." }, 400);
  if (!mailEnabled()) return c.json({ error: "Email is not set up on this instance yet - ask the owner." }, 409);
  const taken = db.select({ id: users.id }).from(users).where(and(eq(users.email, email), eq(users.emailVerified, 1))).get();
  if (taken && taken.id !== u.id) return c.json({ error: "That address is already used by another account." }, 409);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  emailCodes.set(u.id, { email, codeHash: sha256(`${u.id}:${code}`), expiresAt: Date.now() + 20 * 60_000, attempts: 0 });
  const m = renderMail({ appName: appName(), heading: "Confirm your email address", paragraphs: [`Hi ${u.name}, enter this code in ${appName()} to confirm the address:`, code, "It expires in 20 minutes. If you did not ask for this, ignore this email."] });
  try {
    await sendMail({ to: email, subject: `${appName()}: your confirmation code`, ...m });
  } catch (err: any) {
    return c.json({ error: `Could not send the email: ${String(err?.message ?? err).slice(0, 160)}` }, 502);
  }
  return c.json({ ok: true, sentTo: email });
});

accountRoutes.post("/email/verify", rateLimit({ name: "email-ver", windowMs: 60_000, max: 10 }), requireSession, async (c) => {
  const u = c.get("session").user!;
  const b = await body<{ code?: string }>(c);
  const p = emailCodes.get(u.id);
  if (!p || p.expiresAt < Date.now()) return c.json({ error: "No code is waiting - send a new one." }, 400);
  const code = String(b.code ?? "").replace(/\s/g, "");
  const ok = /^\d{6}$/.test(code) && crypto.timingSafeEqual(Buffer.from(sha256(`${u.id}:${code}`)), Buffer.from(p.codeHash));
  if (!ok) {
    if (++p.attempts >= 5) emailCodes.delete(u.id);
    return c.json({ error: p.attempts >= 5 ? "Too many wrong codes - send a new one." : "That code is wrong." }, 400);
  }
  emailCodes.delete(u.id);
  try {
    db.update(users).set({ email: p.email, emailVerified: 1 }).where(eq(users.id, u.id)).run();
  } catch {
    return c.json({ error: "That address is already used by another account." }, 409);
  }
  auditRequest(c, "account.email-verified", true, `${u.name} confirmed an email address`, { target: u.username ?? "" });
  return c.json({ ok: true, email: p.email });
});

accountRoutes.post("/email/remove", requireSession, async (c) => {
  const u = c.get("session").user!;
  const b = await body<{ password?: string }>(c);
  const bad = await reauth(c, u, b.password);
  if (bad) return bad;
  emailCodes.delete(u.id);
  db.update(users).set({ email: null, emailVerified: 0 }).where(eq(users.id, u.id)).run();
  auditRequest(c, "account.email-removed", true, `${u.name} removed their email address`, { target: u.username ?? "" });
  return c.json({ ok: true });
});

/* ------------------------------ password reset ----------------------------- */

const RESET_TTL = 30 * 60_000;
const resetThrottle = new Map<string, number>();

/** Always answers the same way, so it cannot be used to discover accounts. */
accountRoutes.post("/password/forgot", rateLimit({ name: "forgot", windowMs: 10 * 60_000, max: 5 }), requireDevice, async (c) => {
  const b = await body<{ login?: string }>(c);
  const login = String(b.login ?? "").trim().toLowerCase().slice(0, 254);
  const enabled = mailEnabled();
  const answer = c.json({ ok: true, mailEnabled: enabled });
  if (!login || !enabled) return answer;
  const u = db
    .select()
    .from(users)
    .where(or(eq(users.username, login), and(eq(users.email, login), eq(users.emailVerified, 1))))
    .get();
  if (!u || !u.email || u.emailVerified !== 1 || u.isBlocked) {
    auditRequest(c, "account.reset-requested", false, `Password reset asked for "${login.slice(0, 60)}" (no confirmed email)`, { target: login.slice(0, 60) });
    return answer;
  }
  const now = Date.now();
  if (now - (resetThrottle.get(u.id) ?? 0) < 2 * 60_000) return answer;
  resetThrottle.set(u.id, now);
  db.delete(passwordResets).where(or(eq(passwordResets.userId, u.id), lt(passwordResets.expiresAt, now))).run();
  const token = crypto.randomBytes(32).toString("base64url");
  db.insert(passwordResets).values({ tokenHash: sha256(token), userId: u.id, createdAt: now, expiresAt: now + RESET_TTL }).run();
  // The token travels in the fragment: never sent to a server, kept out of logs and referrers.
  const link = publicLink(`/reset-password#token=${token}`);
  const m = renderMail({
    appName: appName(),
    heading: "Reset your password",
    paragraphs: [`Someone (hopefully you) asked to reset the password of ${u.name} (@${u.username}).`, "The link works once and expires in 30 minutes. Your second factor, if you use one, is still required when you sign in."],
    button: { label: "Choose a new password", href: link },
    footer: "If you did not ask for this, ignore this email - your password stays the same.",
  });
  try {
    await sendMail({ to: u.email, subject: `${appName()}: reset your password`, ...m });
    auditRequest(c, "account.reset-requested", true, `Password reset link sent to ${u.name}`, { actor: { id: u.id, name: u.name }, target: u.username ?? "" });
  } catch (err: any) {
    auditRequest(c, "account.reset-requested", false, `Password reset email for ${u.name} failed: ${String(err?.message ?? err).slice(0, 120)}`, { target: u.username ?? "", severity: "error" });
  }
  return answer;
});

accountRoutes.post("/password/reset", rateLimit({ name: "reset", windowMs: 10 * 60_000, max: 10 }), async (c) => {
  const b = await body<{ token?: string; newPassword?: string }>(c);
  const token = String(b.token ?? "");
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return c.json({ error: "This reset link is not valid." }, 400);
  const now = Date.now();
  const row = db
    .select()
    .from(passwordResets)
    .where(and(eq(passwordResets.tokenHash, sha256(token)), gt(passwordResets.expiresAt, now), isNull(passwordResets.usedAt)))
    .get();
  if (!row) return c.json({ error: "This reset link has expired or was already used. Ask for a new one." }, 400);
  const u = db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!u || u.isBlocked) return c.json({ error: "This account cannot be reset." }, 403);
  const pwErr = validatePassword(b.newPassword);
  if (pwErr) return c.json({ error: pwErr }, 400);
  if (u.username && b.newPassword!.toLowerCase().includes(u.username)) return c.json({ error: "Password must not contain your username." }, 400);
  // Claim the token first so two parallel requests cannot both use it.
  const claimed = db.update(passwordResets).set({ usedAt: now }).where(and(eq(passwordResets.tokenHash, row.tokenHash), isNull(passwordResets.usedAt))).returning().all();
  if (claimed.length === 0) return c.json({ error: "This reset link was already used." }, 400);
  db.update(users).set({ passwordHash: await hashSecret(b.newPassword!), mustChangePassword: 0 }).where(eq(users.id, u.id)).run();
  if (u.role === "owner") forgetInitialPassword();
  const kicked = revokeUserSessions(u.id);
  clearFailures(`acct:${u.username}`);
  securityNote(u.id, "Your password was reset with an email link");
  auditRequest(c, "account.password-reset", true, `${u.name} reset the password by email`, { actor: { id: u.id, name: u.name }, target: u.username ?? "", severity: "warn", meta: { signedOutDevices: kicked } });
  return c.json({ ok: true, username: u.username });
});

/** Maintenance: forget expired codes and tickets. */
export function sweepAccount() {
  const now = Date.now();
  for (const [k, v] of pendingTotp) if (v.expiresAt < now) pendingTotp.delete(k);
  for (const [k, v] of pendingReg) if (v.expiresAt < now) pendingReg.delete(k);
  for (const [k, v] of emailCodes) if (v.expiresAt < now) emailCodes.delete(k);
  for (const [k, v] of resetThrottle) if (now - v > 10 * 60_000) resetThrottle.delete(k);
  db.delete(passwordResets).where(lt(passwordResets.expiresAt, now - 24 * 3600_000)).run();
}
