import crypto from "node:crypto";

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) - what every authenticator app speaks. */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("bad base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1]! & 0x0f;
  const code = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

export function totpAt(secretB32: string, time = Date.now()): string {
  return hotp(base32Decode(secretB32), Math.floor(time / 1000 / STEP));
}

/**
 * Accepts the current step and one either side (clock drift). Returns the
 * matched counter so callers can refuse a code that was already used.
 */
export function verifyTotp(secretB32: string, code: string, time = Date.now()): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secretB32);
  const now = Math.floor(time / 1000 / STEP);
  for (const d of [0, -1, 1]) {
    const expected = hotp(key, now + d);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return now + d;
  }
  return null;
}

export function otpauthUri(opts: { secret: string; account: string; issuer: string }) {
  const label = encodeURIComponent(`${opts.issuer}:${opts.account}`);
  return `otpauth://totp/${label}?secret=${opts.secret}&issuer=${encodeURIComponent(opts.issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}

/* ------------------------------ recovery codes ---------------------------- */

const RC_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const b = crypto.randomBytes(10);
    let s = "";
    for (let i = 0; i < 10; i++) s += RC_ALPHABET[b[i]! % RC_ALPHABET.length];
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const hashRecovery = (code: string) =>
  crypto.createHash("sha256").update(code.trim().toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");

/** Returns the remaining hash list if `code` matched one, else null. */
export function consumeRecovery(stored: string, code: string): string | null {
  const list = stored.split(",").filter(Boolean);
  const h = hashRecovery(code);
  const idx = list.findIndex((x) => x.length === h.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h)));
  if (idx < 0) return null;
  list.splice(idx, 1);
  return list.join(",");
}
