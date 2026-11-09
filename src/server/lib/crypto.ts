import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { dirs } from "../db";

/**
 * Data-at-rest encryption: AES-256-GCM with a per-instance master key
 * (DATA_DIR/keys/master.key, mode 0600, created on first boot).
 *
 * Two container layouts:
 *   FYE1 | iv(12) | tag(16) | ciphertext   - whole-buffer writes
 *   FYE2 | iv(12) | ciphertext | tag(16)   - streamed writes (tag known only at the end)
 * Anything without a magic prefix is legacy plaintext and passed through.
 */

const MAGIC1 = Buffer.from("FYE1");
const MAGIC2 = Buffer.from("FYE2");
const IV_LEN = 12;
const TAG_LEN = 16;
const HEAD = 4 + IV_LEN;

let masterKey: Buffer | null = null;

export function getMasterKey(): Buffer {
  if (masterKey) return masterKey;
  const keyDir = path.join(dirs.data, "keys");
  fs.mkdirSync(keyDir, { recursive: true });
  const keyFile = path.join(keyDir, "master.key");
  if (!fs.existsSync(keyFile)) {
    fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600 });
  }
  masterKey = fs.readFileSync(keyFile);
  if (masterKey.length !== 32) throw new Error("Corrupt master key");
  return masterKey;
}

function cipher() {
  const iv = crypto.randomBytes(IV_LEN);
  const c = crypto.createCipheriv("aes-256-gcm", getMasterKey(), iv);
  return { iv, c };
}

export function encryptBuffer(plain: Buffer): Buffer {
  const { iv, c } = cipher();
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC1, iv, c.getAuthTag(), ct]);
}

function magicOf(buf: Buffer): 1 | 2 | 0 {
  if (buf.length < 4) return 0;
  const m = buf.subarray(0, 4);
  return m.equals(MAGIC1) ? 1 : m.equals(MAGIC2) ? 2 : 0;
}

export function isEncrypted(buf: Buffer): boolean {
  return magicOf(buf) !== 0;
}

export function decryptBuffer(blob: Buffer): Buffer {
  const kind = magicOf(blob);
  if (kind === 0) return blob; // legacy plaintext passthrough
  const iv = blob.subarray(4, HEAD);
  const d = crypto.createDecipheriv("aes-256-gcm", getMasterKey(), iv);
  if (kind === 1) {
    d.setAuthTag(blob.subarray(HEAD, HEAD + TAG_LEN));
    return Buffer.concat([d.update(blob.subarray(HEAD + TAG_LEN)), d.final()]);
  }
  d.setAuthTag(blob.subarray(blob.length - TAG_LEN));
  return Buffer.concat([d.update(blob.subarray(HEAD, blob.length - TAG_LEN)), d.final()]);
}

export function encryptString(plain: string): string {
  return encryptBuffer(Buffer.from(plain, "utf8")).toString("base64");
}

export function decryptString(blob: string): string {
  try {
    return decryptBuffer(Buffer.from(blob, "base64")).toString("utf8");
  } catch {
    return blob; // legacy plaintext
  }
}

function writer(out: fs.WriteStream) {
  return (buf: Buffer) =>
    new Promise<void>((resolve, reject) => {
      if (out.write(buf)) return resolve();
      const onDrain = () => {
        out.off("error", onErr);
        resolve();
      };
      const onErr = (e: Error) => {
        out.off("drain", onDrain);
        reject(e);
      };
      out.once("drain", onDrain);
      out.once("error", onErr);
    });
}

/**
 * Concatenate chunk files and encrypt them straight into `destFile` (FYE2,
 * single pass, bounded memory, backpressure-aware). Returns plaintext bytes.
 */
export async function encryptPartsToFile(parts: string[], destFile: string): Promise<number> {
  const { iv, c } = cipher();
  const out = fs.createWriteStream(destFile, { mode: 0o600 });
  const write = writer(out);
  let plain = 0;
  try {
    await write(Buffer.concat([MAGIC2, iv]));
    for (const p of parts) {
      for await (const chunk of fs.createReadStream(p, { highWaterMark: 256 * 1024 })) {
        plain += (chunk as Buffer).length;
        await write(c.update(chunk as Buffer));
      }
    }
    c.final();
    await write(c.getAuthTag());
    await new Promise<void>((resolve, reject) => {
      out.once("error", reject);
      out.end(() => resolve());
    });
    return plain;
  } catch (err) {
    out.destroy();
    fs.rmSync(destFile, { force: true });
    throw err;
  }
}

/** Decrypt a stored file into a fresh buffer (small payloads only). */
export function readDecrypted(file: string): Buffer {
  return decryptBuffer(fs.readFileSync(file));
}

/** Decrypting Transform for either layout; holds back the trailing tag for FYE2. */
function decryptTransform() {
  let head: Buffer = Buffer.alloc(0);
  let mode: "probe" | "plain" | "v1" | "v2" = "probe";
  let decipher: crypto.DecipherGCM | null = null;
  let tail: Buffer = Buffer.alloc(0); // FYE2: last TAG_LEN bytes seen so far
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      try {
        if (mode === "plain") return cb(null, chunk);
        if (mode === "v1") return cb(null, decipher!.update(chunk));
        if (mode === "v2") {
          const buf = tail.length ? Buffer.concat([tail, chunk]) : chunk;
          if (buf.length <= TAG_LEN) {
            tail = buf;
            return cb(null, Buffer.alloc(0));
          }
          tail = Buffer.from(buf.subarray(buf.length - TAG_LEN));
          return cb(null, decipher!.update(buf.subarray(0, buf.length - TAG_LEN)));
        }
        head = Buffer.concat([head, chunk]);
        if (head.length < 4) return cb(null, Buffer.alloc(0));
        const kind = magicOf(head);
        if (kind === 0) {
          mode = "plain";
          const out = head;
          head = Buffer.alloc(0);
          return cb(null, out);
        }
        const need = kind === 1 ? HEAD + TAG_LEN : HEAD;
        if (head.length < need) return cb(null, Buffer.alloc(0));
        decipher = crypto.createDecipheriv("aes-256-gcm", getMasterKey(), head.subarray(4, HEAD));
        const rest = head.subarray(need);
        if (kind === 1) {
          decipher.setAuthTag(head.subarray(HEAD, HEAD + TAG_LEN));
          mode = "v1";
          head = Buffer.alloc(0);
          return cb(null, decipher.update(rest));
        }
        mode = "v2";
        head = Buffer.alloc(0);
        this._transform(Buffer.from(rest), "buffer" as BufferEncoding, cb);
      } catch (err) {
        cb(err as Error);
      }
    },
    flush(cb) {
      try {
        if (mode === "probe") return cb(null, head);
        if (mode === "plain") return cb();
        if (mode === "v2") decipher!.setAuthTag(tail);
        cb(null, decipher!.final());
      } catch (err) {
        cb(err as Error);
      }
    },
  });
}

/** Decrypt a stored file as a lazy stream (for large downloads). */
export function decryptedWebStream(file: string): ReadableStream {
  const node = fs.createReadStream(file, { highWaterMark: 256 * 1024 });
  const transformer = decryptTransform();
  // Propagate read errors and release the fd when the client aborts mid-download.
  node.on("error", (err) => transformer.destroy(err));
  transformer.on("close", () => node.destroy());
  node.pipe(transformer);
  return Readable.toWeb(transformer) as unknown as ReadableStream;
}

/** Fully verify a file decrypts (reads it once, keeps nothing). */
export async function verifyDecrypts(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    const t = decryptTransform();
    t.on("data", () => {});
    t.on("end", () => resolve(true));
    t.on("error", () => resolve(false));
    const rs = fs.createReadStream(file, { highWaterMark: 256 * 1024 });
    rs.on("error", () => resolve(false));
    rs.pipe(t);
  });
}

/**
 * One-time repair for files written by the old chunked-upload path: they used
 * the FYE2 layout but were labelled FYE1, so they could not be decrypted.
 * Relabel (4-byte header rewrite) only after the FYE2 interpretation verifies.
 */
export async function repairMislabelledFile(file: string): Promise<"ok" | "repaired" | "broken"> {
  if (await verifyDecrypts(file)) return "ok";
  const fd = fs.openSync(file, "r+");
  try {
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0);
    if (!head.equals(MAGIC1)) return "broken";
    fs.writeSync(fd, MAGIC2, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (await verifyDecrypts(file)) return "repaired";
  // Not the expected layout after all - restore the original header.
  const fd2 = fs.openSync(file, "r+");
  try {
    fs.writeSync(fd2, MAGIC1, 0, 4, 0);
  } finally {
    fs.closeSync(fd2);
  }
  return "broken";
}
