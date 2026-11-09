import crypto from "node:crypto";

/**
 * Password / PIN hashing (argon2id).
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet minimum
 * (m=19 MiB, t=2, p=1). Bun's default is 64 MiB which is too heavy for a
 * Raspberry Pi serving several logins at once. Hashing is always async so a
 * login never blocks the event loop.
 */

const ARGON = { algorithm: "argon2id" as const, memoryCost: 19_456, timeCost: 2 };

export function hashSecret(secret: string): Promise<string> {
  return Bun.password.hash(secret, ARGON);
}

export async function verifySecret(secret: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    // Equalise timing with a real verification so missing users can't be detected.
    await Bun.password.verify(secret, DUMMY_HASH).catch(() => false);
    return false;
  }
  try {
    return await Bun.password.verify(secret, hash);
  } catch {
    return false;
  }
}

// Computed once at boot; only used for timing equalisation.
const DUMMY_HASH = Bun.password.hashSync(crypto.randomBytes(16).toString("hex"), ARGON);

export const PIN_RE = /^\d{4,10}$/;
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$/;

export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== "string") return "Password is required.";
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 128) return "Password is too long (max 128 characters).";
  if (/^\d+$/.test(pw) && pw.length < 10) return "An all-digit password needs at least 10 digits.";
  return null;
}

export function normalizeUsername(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function randomPassword(len = 14): string {
  // Unambiguous alphabet (no 0/O, 1/l/I) so it is easy to read off a console.
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

export function timingSafeEqualStr(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}
