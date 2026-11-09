import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { apiKeys } from "../db/schema";

/**
 * Personal API keys: `fyd_<id>_<secret>`.
 * Only SHA-256(secret) is stored; the id half finds the row without a scan.
 * A key acts as its owner with the scopes it was given:
 *   read  - GET/HEAD only
 *   write - also create, change and delete items, shares, groups
 * Keys never reach admin endpoints or account security settings, and cannot
 * create or manage other keys or webhooks.
 */

export const SCOPES = ["read", "write"] as const;
export type ApiScope = (typeof SCOPES)[number];
const TOKEN_RE = /^fyd_([A-Za-z0-9]{10})_([A-Za-z0-9_-]{32,64})$/;
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function randomId(n: number) {
  const b = crypto.randomBytes(n);
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHA[b[i]! % ALPHA.length];
  return s;
}

export function createApiKey(userId: string, name: string, scopes: ApiScope[], expiresAt: number | null) {
  const id = randomId(10);
  const secret = crypto.randomBytes(32).toString("base64url");
  db.insert(apiKeys)
    .values({ id, userId, name: name.slice(0, 60) || "API key", secretHash: sha256(secret), scopes: scopes.join(","), createdAt: Date.now(), expiresAt })
    .run();
  return { id, token: `fyd_${id}_${secret}` };
}

export type ApiKeyRow = typeof apiKeys.$inferSelect;
const lastUsed = new Map<string, number>();

/** The live key behind an `Authorization: Bearer fyd_...` header, or null. */
export function verifyApiKey(header: string | undefined): ApiKeyRow | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const t = m ? TOKEN_RE.exec(m[1]!) : null;
  if (!t) return null;
  const row = db.select().from(apiKeys).where(and(eq(apiKeys.id, t[1]!), isNull(apiKeys.revokedAt))).get();
  if (!row) return null;
  const a = Buffer.from(sha256(t[2]!));
  const b = Buffer.from(row.secretHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (row.expiresAt && row.expiresAt <= Date.now()) return null;
  const now = Date.now();
  if (now - (lastUsed.get(row.id) ?? 0) > 60_000) {
    lastUsed.set(row.id, now);
    db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id)).run();
  }
  return row;
}

export function keyScopes(row: Pick<ApiKeyRow, "scopes">): Set<string> {
  return new Set(row.scopes.split(",").filter(Boolean));
}

export function publicKey(row: ApiKeyRow) {
  const { secretHash, ...rest } = row;
  return { ...rest, scopes: rest.scopes.split(",").filter(Boolean), preview: `fyd_${row.id}_…` };
}
