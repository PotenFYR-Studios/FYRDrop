import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dirs } from "../db";

/**
 * Cluster identity, pairing and transport security.
 *
 * Pairing is two-sided: the joining admin asks, the target admin approves, and
 * then the joining admin approves again. Only after both approvals does either
 * side store a link.
 *
 * The link key never travels over the wire. Each side generates an ephemeral
 * X25519 keypair for the pairing and combines three Diffie-Hellman results
 * (ephemeral/ephemeral, ephemeral/static, static/ephemeral), so both sides end
 * up with the same 32-byte secret that a passive listener cannot recover. The
 * static key fingerprints are shown in both admin panels; comparing them rules
 * out an active man in the middle.
 *
 * Every request after pairing is sealed with AES-256-GCM and signed with
 * HMAC-SHA256 using the link key, so payloads stay private and tamper-proof
 * even when the instance is served over plain HTTP. TLS is still recommended.
 */

export interface NodeIdentity {
  id: string;
  secret: string;
  name?: string;
  publicKey: string;
  privateKey: string;
}

interface StoredIdentity {
  id: string;
  secret?: string;
  name?: string;
  x25519?: { publicKey: string; privateKey: string };
}

let identity: NodeIdentity | null = null;

export function getIdentity(): NodeIdentity {
  if (identity) return identity;
  const f = path.join(dirs.data, "keys", "cluster.json");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  let stored: StoredIdentity;
  if (fs.existsSync(f)) stored = JSON.parse(fs.readFileSync(f, "utf8")) as StoredIdentity;
  else stored = { id: crypto.randomUUID().replace(/-/g, ""), secret: crypto.randomBytes(32).toString("hex") };
  if (!stored.x25519) {
    stored.x25519 = crypto.generateKeyPairSync("x25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
  }
  if (!stored.id) stored.id = crypto.randomUUID().replace(/-/g, "");
  fs.writeFileSync(f, JSON.stringify(stored, null, 2), { mode: 0o600 });
  identity = {
    id: stored.id,
    secret: stored.secret ?? "",
    name: stored.name,
    publicKey: stored.x25519.publicKey,
    privateKey: stored.x25519.privateKey,
  };
  return identity;
}

export function keyFingerprint(publicKey: string) {
  const der = crypto.createPublicKey(publicKey).export({ type: "spki", format: "der" });
  const hex = crypto.createHash("sha256").update(der).digest("hex");
  return hex.match(/.{1,4}/g)!.slice(0, 8).join("-");
}

export function pairFingerprint(a: string, b: string) {
  const parts = [a, b]
    .map((k) => crypto.createPublicKey(k).export({ type: "spki", format: "der" }).toString("base64"))
    .sort();
  const hex = crypto.createHash("sha256").update(parts.join("|")).digest("hex");
  return hex.match(/.{1,4}/g)!.slice(0, 8).join("-");
}

export function newEphemeral() {
  return crypto.generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function dh(privatePem: string, publicPem: string): Buffer {
  return crypto.diffieHellman({
    privateKey: crypto.createPrivateKey(privatePem),
    publicKey: crypto.createPublicKey(publicPem),
  });
}

export function deriveLinkKey(
  self: { nodeId: string; ephPriv: string; ephPub: string; staticPriv: string; staticPub: string },
  peer: { nodeId: string; ephPub: string; staticPub: string },
) {
  // Three DH results; sort them so both roles concatenate identically.
  const shared = [dh(self.ephPriv, peer.ephPub), dh(self.ephPriv, peer.staticPub), dh(self.staticPriv, peer.ephPub)]
    .map((b) => b.toString("hex"))
    .sort()
    .join("");
  const salt = [self.nodeId, peer.nodeId].sort().join("|");
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(shared, "hex"), Buffer.from(salt), Buffer.from("fyrdrop-cluster-v2"), 32),
  );
}

export interface Sealed {
  v: 2;
  n: string;
  c: string;
  t: string;
}

export function seal(key: Buffer, value: unknown): Sealed {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value ?? null), "utf8"), cipher.final()]);
  return { v: 2, n: iv.toString("base64"), c: ct.toString("base64"), t: cipher.getAuthTag().toString("base64") };
}

export function open(key: Buffer, env: unknown): any {
  const e = env as Sealed;
  if (!e || e.v !== 2 || typeof e.n !== "string" || typeof e.c !== "string" || typeof e.t !== "string") throw new Error("bad envelope");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(e.n, "base64"));
  decipher.setAuthTag(Buffer.from(e.t, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(e.c, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(plain);
}

export function signRequest(key: Buffer, nodeId: string, method: string, pathWithQuery: string, body: string) {
  const ts = Date.now();
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const payload = `${nodeId}.${ts}.${method.toUpperCase()}.${pathWithQuery}.${bodyHash}`;
  return {
    "x-cluster-node": nodeId,
    "x-cluster-ts": String(ts),
    "x-cluster-sig": crypto.createHmac("sha256", key).update(payload).digest("hex"),
    "x-cluster-nonce": crypto.randomBytes(12).toString("base64url"),
  };
}

export function verifySignedRequest(
  key: Buffer,
  headers: { node?: string; ts?: string; sig?: string },
  method: string,
  pathWithQuery: string,
  body: string,
): { ok: boolean; reason?: string } {
  const { node, ts, sig } = headers;
  if (!node || !ts || !sig) return { ok: false, reason: "missing cluster signature headers" };
  const tsMs = Number(ts);
  if (!Number.isFinite(tsMs)) return { ok: false, reason: "invalid timestamp" };
  if (Math.abs(Date.now() - tsMs) > 5 * 60_000) return { ok: false, reason: "timestamp outside replay window" };
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const payload = `${node}.${ts}.${method.toUpperCase()}.${pathWithQuery}.${bodyHash}`;
  const expected = crypto.createHmac("sha256", key).update(payload).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}

export interface Announcement {
  v: 2;
  nodeId: string;
  name: string;
  url: string;
  publicKey: string;
  fingerprint: string;
  port: number;
}

export function announcement(url: string, name: string, port: number): Announcement {
  const id = getIdentity();
  return { v: 2, nodeId: id.id, name, url, publicKey: id.publicKey, fingerprint: keyFingerprint(id.publicKey), port };
}
