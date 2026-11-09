import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { kv, settings, users } from "../db/schema";
import { encryptString, decryptString } from "./crypto";
import { randomPassword } from "./secrets";
import { invalidateSettings } from "./settings";

/**
 * First-boot provisioning.
 *
 * - Instance PIN: generated once; hashed for login and AES-encrypted so the
 *   CLI banner can display it (a deliberate self-hosted convenience,
 *   controlled by config.showPinInLogs).
 * - Owner account: username "admin" with a generated one-time password that
 *   is shown in the banner until the owner signs in and replaces it.
 */

export interface BootstrapResult {
  created: boolean;
  pin: string | null;
}

const INITIAL_PW_KEY = "admin:initialPassword";

const ARGON = { algorithm: "argon2id" as const, memoryCost: 19_456, timeCost: 2 };

export const AVATAR_SVG = (letter: string, from: string, to: string) =>
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="128" height="128" rx="64" fill="url(#g)"/><text x="64" y="83" font-family="Segoe UI,sans-serif" font-size="56" font-weight="600" fill="#fff" text-anchor="middle">${letter}</text></svg>`,
  ).toString("base64");

export function generatePin(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function setInitialPassword(userId: string) {
  const pw = randomPassword(14);
  db.update(users)
    .set({ passwordHash: Bun.password.hashSync(pw, ARGON), mustChangePassword: 1 })
    .where(eq(users.id, userId))
    .run();
  const value = encryptString(pw);
  db.insert(kv).values({ key: INITIAL_PW_KEY, value }).onConflictDoUpdate({ target: kv.key, set: { value } }).run();
  return pw;
}

function ensureOwner() {
  const all = db.select().from(users).all();
  let owner = all.find((u) => u.role === "owner");
  if (!owner) {
    const now = Date.now();
    const taken = new Set(all.map((u) => u.username));
    const username = taken.has("admin") ? `admin${crypto.randomInt(100, 999)}` : "admin";
    owner = {
      id: crypto.randomUUID(),
      username,
      name: "Administrator",
      passwordHash: null,
      mustChangePassword: 1,
      avatar: AVATAR_SVG("A", "#6366f1", "#22d3ee"),
      color: "#6366f1",
      role: "owner",
      isBlocked: 0,
      createdAt: now,
      lastSeenAt: now,
    };
    db.insert(users).values(owner).run();
  }
  if (!owner.passwordHash) setInitialPassword(owner.id);
}

export function ensureBootstrap(): BootstrapResult {
  const existing = db.select().from(settings).limit(1).get();
  if (existing) {
    ensureOwner();
    if (!existing.pinEnc) {
      // Pre-upgrade installs stored only the PIN hash; rotate so the banner can show it.
      const rotated = generatePin();
      storePin(rotated);
      console.log(`  note: PIN rotated for banner display - new PIN: ${rotated}`);
      return { created: false, pin: rotated };
    }
    return { created: false, pin: currentPin() };
  }

  const pin = generatePin();
  const now = Date.now();
  db.insert(settings)
    .values({
      appName: "FYRDrop",
      ownerName: "admin",
      pinHash: Bun.password.hashSync(pin, ARGON),
      pinEnc: encryptString(pin),
      maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 512),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  invalidateSettings();
  ensureOwner();
  return { created: true, pin };
}

export function currentPin(): string | null {
  const s = db.select().from(settings).limit(1).get();
  if (!s?.pinEnc) return null;
  try {
    return decryptString(s.pinEnc);
  } catch {
    return null;
  }
}

/** The one-time owner password, while the owner still has to replace it. */
export function initialAdminPassword(): { username: string; password: string } | null {
  const owner = db.select().from(users).all().find((u) => u.role === "owner");
  if (!owner || !owner.mustChangePassword) return null;
  const row = db.select().from(kv).where(eq(kv.key, INITIAL_PW_KEY)).limit(1).get();
  if (!row) return null;
  try {
    return { username: owner.username ?? "admin", password: decryptString(row.value) };
  } catch {
    return null;
  }
}

/** Called once the owner chose a real password. */
export function forgetInitialPassword() {
  db.delete(kv).where(eq(kv.key, INITIAL_PW_KEY)).run();
}

export function storePin(pin: string) {
  const s = db.select().from(settings).limit(1).get();
  if (!s) return;
  db.update(settings)
    .set({ pinHash: Bun.password.hashSync(pin, ARGON), pinEnc: encryptString(pin), updatedAt: Date.now() })
    .where(eq(settings.id, s.id))
    .run();
  invalidateSettings();
}
