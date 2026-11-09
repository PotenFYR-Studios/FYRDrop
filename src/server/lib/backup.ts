import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { db, dirs, sqlite } from "../db";
import { items, kv, storageUnits, users } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { resolveUnitPath, PRIMARY_UNIT } from "./storage";
import { getSettings } from "./settings";
import { logEvent } from "./audit";
import { STAGING_DIR, STAGING_MARKER } from "./restore-boot";
import { notifyOwners } from "./notify";

/**
 * Backup and restore.
 *
 * A backup is a POSIX tar (ustar + PAX for long names) with this layout:
 *   manifest.json            - always the first entry
 *   db/fyrdrop.db            - consistent snapshot (VACUUM INTO)
 *   keys/*                   - master key, session secret, cluster identity
 *   config.json, tls/*, certs/*, thumbs/*
 *   files/<unitId>/<name>    - stored (already encrypted) item payloads, optional
 *
 * With a passphrase the tar is wrapped in an authenticated container:
 *   "FYBE" | v(1) | salt(16) | noncePrefix(8) | check(16) | frames...
 *   frame  = u32 BE (len | 0x80000000 on the last frame) | ciphertext | tag(16)
 * Key = scrypt(passphrase, salt); check = HMAC(key, "fyrdrop-backup") tells a
 * wrong passphrase apart from a damaged file. The nonce is prefix || u32 counter and the
 * last-frame flag is authenticated, so truncation and reordering are detected.
 *
 * Restore never touches the live database: the archive is verified and
 * unpacked into DATA_DIR/restore_staging, and the swap happens at the next
 * boot before SQLite is opened (see restore-boot.ts).
 */

export const BACKUP_DIR = () => path.join(dirs.data, "backups");
const FORMAT = 1;
const ENC_MAGIC = Buffer.from("FYBE");
const FRAME = 1024 * 1024;
const LAST = 0x80000000;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const ENC_HEAD = 4 + 1 + 16 + 8 + 16;
const keyCheck = (key: Buffer) => crypto.createHmac("sha256", key).update("fyrdrop-backup").digest().subarray(0, 16);

export const NAME_RE = /^fyrdrop-[0-9A-Za-z_-]{1,80}\.(tar|fyb)$/;

export interface Manifest {
  format: number;
  app: "fyrdrop";
  version: string;
  createdAt: number;
  appName: string;
  includesFiles: boolean;
  encrypted: boolean;
  counts: { items: number; users: number; files: number; bytes: number };
  units: { id: string; name: string }[];
  note: string;
}

/* ------------------------------- byte sinks ------------------------------- */

interface Sink {
  write(buf: Buffer): Promise<void>;
  close(): Promise<void>;
  bytes: number;
}

class FileSink implements Sink {
  bytes = 0;
  private constructor(private fh: fsp.FileHandle) {}
  static async open(p: string) {
    return new FileSink(await fsp.open(p, "w", 0o600));
  }
  async write(buf: Buffer) {
    let off = 0;
    while (off < buf.length) {
      const { bytesWritten } = await this.fh.write(buf, off, buf.length - off);
      off += bytesWritten;
    }
    this.bytes += buf.length;
  }
  async close() {
    await this.fh.sync().catch(() => {});
    await this.fh.close();
  }
}

function deriveKey(pass: string, salt: Buffer): Promise<Buffer> {
  return new Promise((res, rej) => crypto.scrypt(pass.normalize("NFKC"), salt, 32, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
}

class EncryptSink implements Sink {
  bytes = 0;
  private buf: Buffer[] = [];
  private len = 0;
  private counter = 0;
  private constructor(private inner: Sink, private key: Buffer, private prefix: Buffer) {}
  static async create(inner: Sink, pass: string) {
    const salt = crypto.randomBytes(16);
    const prefix = crypto.randomBytes(8);
    const key = await deriveKey(pass, salt);
    await inner.write(Buffer.concat([ENC_MAGIC, Buffer.from([1]), salt, prefix, keyCheck(key)]));
    return new EncryptSink(inner, key, prefix);
  }
  private nonce() {
    const n = Buffer.alloc(12);
    this.prefix.copy(n, 0);
    n.writeUInt32BE(this.counter++, 8);
    return n;
  }
  private async emit(plain: Buffer, last: boolean) {
    const c = crypto.createCipheriv("aes-256-gcm", this.key, this.nonce());
    c.setAAD(Buffer.from([last ? 1 : 0]));
    const ct = Buffer.concat([c.update(plain), c.final()]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE((ct.length | (last ? LAST : 0)) >>> 0);
    await this.inner.write(Buffer.concat([head, ct, c.getAuthTag()]));
  }
  async write(b: Buffer) {
    this.bytes += b.length;
    this.buf.push(b);
    this.len += b.length;
    while (this.len >= FRAME) {
      const all = Buffer.concat(this.buf);
      await this.emit(all.subarray(0, FRAME), false);
      const rest = all.subarray(FRAME);
      this.buf = rest.length ? [rest] : [];
      this.len = rest.length;
    }
  }
  async close() {
    await this.emit(Buffer.concat(this.buf), true);
    this.buf = [];
    await this.inner.close();
  }
}

/* ------------------------------- byte sources ----------------------------- */

interface Source {
  /** Exactly n bytes, or fewer only at end of stream. */
  read(n: number): Promise<Buffer>;
  close(): Promise<void>;
}

class FileSource implements Source {
  private pos = 0;
  constructor(private fh: fsp.FileHandle, start = 0) {
    this.pos = start;
  }
  async read(n: number) {
    const out = Buffer.alloc(n);
    let got = 0;
    while (got < n) {
      const { bytesRead } = await this.fh.read(out, got, n - got, this.pos);
      if (bytesRead === 0) break;
      got += bytesRead;
      this.pos += bytesRead;
    }
    return got === n ? out : out.subarray(0, got);
  }
  async close() {
    await this.fh.close();
  }
}

export class BadPassphrase extends Error {}

class DecryptSource implements Source {
  private pending: Buffer = Buffer.alloc(0);
  private ended = false;
  private counter = 0;
  constructor(private inner: Source, private key: Buffer, private prefix: Buffer) {}
  private async frame() {
    const head = await this.inner.read(4);
    if (head.length < 4) throw new Error("Backup is truncated (missing final frame).");
    const word = head.readUInt32BE(0);
    const last = (word & LAST) !== 0;
    const len = word & ~LAST & 0x7fffffff;
    if (len > FRAME + 64) throw new Error("Backup is corrupt (frame too large).");
    const ct = await this.inner.read(len);
    const tag = await this.inner.read(16);
    if (ct.length < len || tag.length < 16) throw new Error("Backup is truncated.");
    const n = Buffer.alloc(12);
    this.prefix.copy(n, 0);
    n.writeUInt32BE(this.counter++, 8);
    const d = crypto.createDecipheriv("aes-256-gcm", this.key, n);
    d.setAAD(Buffer.from([last ? 1 : 0]));
    d.setAuthTag(tag);
    let plain: Buffer;
    try {
      plain = Buffer.concat([d.update(ct), d.final()]);
    } catch {
      throw new Error("Backup is damaged (authentication failed).");
    }
    this.pending = this.pending.length ? Buffer.concat([this.pending, plain]) : Buffer.from(plain);
    if (last) this.ended = true;
  }
  async read(n: number) {
    while (this.pending.length < n && !this.ended) await this.frame();
    const out = this.pending.subarray(0, Math.min(n, this.pending.length));
    this.pending = this.pending.subarray(out.length);
    return Buffer.from(out);
  }
  async close() {
    await this.inner.close();
  }
}

export async function isEncryptedBackup(file: string) {
  const fh = await fsp.open(file, "r");
  try {
    const b = Buffer.alloc(4);
    await fh.read(b, 0, 4, 0);
    return b.equals(ENC_MAGIC);
  } finally {
    await fh.close();
  }
}

async function openSource(file: string, passphrase?: string): Promise<Source> {
  const fh = await fsp.open(file, "r");
  const head = Buffer.alloc(ENC_HEAD);
  const { bytesRead } = await fh.read(head, 0, ENC_HEAD, 0);
  if (bytesRead >= 4 && head.subarray(0, 4).equals(ENC_MAGIC)) {
    if (bytesRead < ENC_HEAD || head[4] !== 1) {
      await fh.close();
      throw new Error("Unsupported backup container version.");
    }
    if (!passphrase) {
      await fh.close();
      throw new BadPassphrase("This backup is encrypted - enter its passphrase.");
    }
    const key = await deriveKey(passphrase, head.subarray(5, 21));
    if (!crypto.timingSafeEqual(keyCheck(key), head.subarray(29, 45))) {
      await fh.close();
      throw new BadPassphrase("Wrong passphrase.");
    }
    return new DecryptSource(new FileSource(fh, ENC_HEAD), key, Buffer.from(head.subarray(21, 29)));
  }
  return new FileSource(fh, 0);
}

/* ---------------------------------- tar ----------------------------------- */

function octal(n: number, width: number) {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

function header(name: string, size: number, mtime: number, type: "0" | "5" | "x") {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, "utf8");
  h.write(octal(type === "5" ? 0o755 : 0o600, 8), 100);
  h.write(octal(0, 8), 108);
  h.write(octal(0, 8), 116);
  h.write(octal(size, 12), 124);
  h.write(octal(Math.floor(mtime / 1000), 12), 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + " ", 148);
  return h;
}

function pad(size: number) {
  const r = size % 512;
  return r ? Buffer.alloc(512 - r) : Buffer.alloc(0);
}

function paxRecord(key: string, value: string) {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return `${len}${body}`;
}

class TarWriter {
  constructor(private sink: Sink) {}
  private async head(name: string, size: number, mtime: number, type: "0" | "5") {
    if (Buffer.byteLength(name) > 99) {
      const pax = Buffer.from(paxRecord("path", name));
      await this.sink.write(header(`PaxHeader/${crypto.randomBytes(6).toString("hex")}`, pax.length, mtime, "x"));
      await this.sink.write(Buffer.concat([pax, pad(pax.length)]));
    }
    await this.sink.write(header(name, size, mtime, type));
  }
  async buffer(name: string, data: Buffer, mtime = Date.now()) {
    await this.head(name, data.length, mtime, "0");
    await this.sink.write(Buffer.concat([data, pad(data.length)]));
  }
  async file(name: string, file: string) {
    const st = await fsp.stat(file);
    await this.head(name, st.size, st.mtimeMs, "0");
    const fh = await fsp.open(file, "r");
    try {
      const chunk = Buffer.alloc(FRAME);
      let left = st.size;
      let pos = 0;
      while (left > 0) {
        const { bytesRead } = await fh.read(chunk, 0, Math.min(chunk.length, left), pos);
        if (bytesRead === 0) throw new Error(`${file} shrank while it was being backed up`);
        await this.sink.write(Buffer.from(chunk.subarray(0, bytesRead)));
        left -= bytesRead;
        pos += bytesRead;
      }
    } finally {
      await fh.close();
    }
    await this.sink.write(pad(st.size));
    return st.size;
  }
  async finish() {
    await this.sink.write(Buffer.alloc(1024));
  }
}

type TarEntry = { name: string; size: number; type: string };

/** Streams tar entries; `body` must be consumed (or skipped) before the next entry. */
async function* readTar(src: Source): AsyncGenerator<TarEntry & { chunks: () => AsyncGenerator<Buffer> }> {
  let paxPath: string | null = null;
  while (true) {
    const h = await src.read(512);
    if (h.length < 512) throw new Error("Backup is truncated (tar header).");
    if (h.every((b) => b === 0)) return;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
    const stored = parseInt(h.subarray(148, 156).toString("ascii").replace(/\0.*$/, "").trim(), 8);
    if (sum !== stored) throw new Error("Not a FYRDrop backup (bad tar checksum).");
    const cstr = (a: number, b: number) => h.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
    let name = cstr(0, 100);
    const prefix = cstr(345, 500);
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(cstr(124, 136).trim() || "0", 8);
    const type = cstr(156, 157) || "0";
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("Backup is corrupt (entry size).");
    const padding = (512 - (size % 512)) % 512;
    if (type === "x") {
      const body = (await src.read(size)).toString("utf8");
      await src.read(padding);
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body);
      if (m) paxPath = m[1]!;
      continue;
    }
    if (paxPath) {
      name = paxPath;
      paxPath = null;
    }
    let consumed = false;
    const chunks = async function* () {
      let left = size;
      while (left > 0) {
        const b = await src.read(Math.min(FRAME, left));
        if (b.length === 0) throw new Error("Backup is truncated (entry body).");
        left -= b.length;
        yield b;
      }
      await src.read(padding);
      consumed = true;
    };
    yield { name, size, type, chunks };
    if (!consumed) for await (const _ of chunks()) void _;
  }
}

/* -------------------------------- creating -------------------------------- */

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  } catch {
    return [];
  }
}

let running: Promise<BackupInfo> | null = null;
export const backupRunning = () => running !== null;

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
  encrypted: boolean;
  includesFiles: boolean;
  note: string;
  auto: boolean;
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function createBackup(opts: { includeFiles: boolean; passphrase?: string; note?: string; auto?: boolean; version: string }): Promise<BackupInfo> {
  if (running) throw new Error("A backup is already running.");
  running = doCreate(opts).finally(() => {
    running = null;
  });
  return running;
}

async function doCreate(opts: { includeFiles: boolean; passphrase?: string; note?: string; auto?: boolean; version: string }): Promise<BackupInfo> {
  fs.mkdirSync(BACKUP_DIR(), { recursive: true });
  const encrypted = !!opts.passphrase;
  const base = `fyrdrop-${stamp()}${opts.auto ? "-auto" : ""}${opts.includeFiles ? "-full" : ""}`;
  const name = `${base}.${encrypted ? "fyb" : "tar"}`;
  const final = path.join(BACKUP_DIR(), name);
  const partial = `${final}.partial`;
  const snap = path.join(BACKUP_DIR(), `.snapshot-${crypto.randomBytes(6).toString("hex")}.db`);
  const note = (opts.note ?? "").slice(0, 200);
  let sink: Sink | null = null;
  try {
    // Consistent point-in-time copy of the live database without stopping writes.
    sqlite.query("VACUUM INTO ?").run(snap);
    const units = db.select().from(storageUnits).all();
    const fileSets = opts.includeFiles
      ? units.map((u) => ({ id: u.id, dir: u.id === PRIMARY_UNIT ? dirs.files : resolveUnitPath(u.path), names: [] as string[] }))
      : [];
    let fileBytes = 0;
    let fileCount = 0;
    for (const f of fileSets) {
      f.names = listDir(f.dir);
      for (const n of f.names) {
        try {
          fileBytes += fs.statSync(path.join(f.dir, n)).size;
          fileCount++;
        } catch {
          /* vanished */
        }
      }
    }
    const manifest: Manifest = {
      format: FORMAT,
      app: "fyrdrop",
      version: opts.version,
      createdAt: Date.now(),
      appName: getSettings()?.appName ?? "FYRDrop",
      includesFiles: opts.includeFiles,
      encrypted,
      counts: {
        items: db.select({ n: sql<number>`count(*)` }).from(items).get()?.n ?? 0,
        users: db.select({ n: sql<number>`count(*)` }).from(users).get()?.n ?? 0,
        files: fileCount,
        bytes: fileBytes,
      },
      units: units.map((u) => ({ id: u.id, name: u.name })),
      note,
    };

    const fileSink = await FileSink.open(partial);
    sink = encrypted ? await EncryptSink.create(fileSink, opts.passphrase!) : fileSink;
    const tar = new TarWriter(sink);
    await tar.buffer("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
    await tar.file("db/fyrdrop.db", snap);
    const keysDir = path.join(dirs.data, "keys");
    for (const n of listDir(keysDir)) await tar.file(`keys/${n}`, path.join(keysDir, n));
    const cfg = path.join(dirs.data, "config.json");
    if (fs.existsSync(cfg)) await tar.file("config.json", cfg);
    const tlsDir = path.join(dirs.data, "tls");
    for (const n of listDir(tlsDir)) await tar.file(`tls/${n}`, path.join(tlsDir, n));
    for (const n of listDir(dirs.certs)) await tar.file(`certs/${n}`, path.join(dirs.certs, n));
    for (const n of listDir(dirs.thumbs)) await tar.file(`thumbs/${n}`, path.join(dirs.thumbs, n));
    for (const f of fileSets) {
      for (const n of f.names) {
        try {
          await tar.file(`files/${f.id}/${n}`, path.join(f.dir, n));
        } catch (err: any) {
          // A file deleted mid-backup is fine; anything else is not.
          if (err?.code !== "ENOENT") throw err;
        }
      }
    }
    await tar.finish();
    await sink.close();
    sink = null;
    fs.renameSync(partial, final);
    const info: BackupInfo = { name, size: fs.statSync(final).size, createdAt: manifest.createdAt, encrypted, includesFiles: opts.includeFiles, note, auto: !!opts.auto };
    writeIndex({ ...readIndex(), [name]: { note, auto: !!opts.auto, includesFiles: opts.includeFiles, createdAt: manifest.createdAt } });
    return info;
  } catch (err) {
    if (sink) await sink.close().catch(() => {});
    fs.rmSync(partial, { force: true });
    throw err;
  } finally {
    fs.rmSync(snap, { force: true });
  }
}

/* ------------------------------ listing/index ----------------------------- */

type IndexRow = { note: string; auto: boolean; includesFiles: boolean; createdAt: number };
const indexPath = () => path.join(BACKUP_DIR(), "index.json");
function readIndex(): Record<string, IndexRow> {
  try {
    return JSON.parse(fs.readFileSync(indexPath(), "utf8"));
  } catch {
    return {};
  }
}
function writeIndex(v: Record<string, IndexRow>) {
  fs.mkdirSync(BACKUP_DIR(), { recursive: true });
  fs.writeFileSync(indexPath(), JSON.stringify(v, null, 2));
}

export function listBackups(): BackupInfo[] {
  const idx = readIndex();
  const out: BackupInfo[] = [];
  for (const name of listDir(BACKUP_DIR())) {
    if (!NAME_RE.test(name)) continue;
    const st = fs.statSync(path.join(BACKUP_DIR(), name));
    const meta = idx[name];
    out.push({
      name,
      size: st.size,
      createdAt: meta?.createdAt ?? st.mtimeMs,
      encrypted: name.endsWith(".fyb"),
      includesFiles: meta?.includesFiles ?? name.includes("-full"),
      note: meta?.note ?? "",
      auto: meta?.auto ?? name.includes("-auto"),
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function backupPath(name: string): string | null {
  if (!NAME_RE.test(name)) return null;
  const p = path.join(BACKUP_DIR(), name);
  return fs.existsSync(p) ? p : null;
}

export function deleteBackup(name: string) {
  const p = backupPath(name);
  if (!p) return false;
  fs.rmSync(p, { force: true });
  const idx = readIndex();
  delete idx[name];
  writeIndex(idx);
  return true;
}

/** Name an uploaded archive so it shows up next to local backups. */
export function adoptUploaded(tmp: string, originalName: string, encrypted: boolean) {
  fs.mkdirSync(BACKUP_DIR(), { recursive: true });
  const clean = originalName.replace(/\.(tar|fyb)$/i, "").replace(/[^0-9A-Za-z_-]+/g, "-").slice(0, 40) || "upload";
  const name = `fyrdrop-uploaded-${stamp()}-${clean.replace(/^fyrdrop-/, "")}.${encrypted ? "fyb" : "tar"}`;
  fs.renameSync(tmp, path.join(BACKUP_DIR(), name));
  writeIndex({ ...readIndex(), [name]: { note: `Uploaded from ${originalName.slice(0, 80)}`, auto: false, includesFiles: false, createdAt: Date.now() } });
  return name;
}

/* ------------------------------ inspect/restore --------------------------- */

const ALLOWED = /^(manifest\.json|db\/fyrdrop\.db|config\.json|keys\/[^/]+|tls\/[^/]+|certs\/[^/]+|thumbs\/[^/]+|files\/[0-9A-Za-z_-]{1,64}\/[^/]+)$/;

function safeName(n: string) {
  return ALLOWED.test(n) && !n.split("/").some((p) => p === ".." || p === "." || p === "" || p.includes("\\") || p.includes("\0"));
}

export async function inspectBackup(file: string, passphrase?: string): Promise<Manifest> {
  const src = await openSource(file, passphrase);
  try {
    for await (const e of readTar(src)) {
      if (e.name !== "manifest.json") throw new Error("Not a FYRDrop backup (manifest missing).");
      if (e.size > 1024 * 1024) throw new Error("Manifest is too large.");
      const parts: Buffer[] = [];
      for await (const b of e.chunks()) parts.push(b);
      const m = JSON.parse(Buffer.concat(parts).toString("utf8")) as Manifest;
      if (m.app !== "fyrdrop" || typeof m.format !== "number") throw new Error("Not a FYRDrop backup.");
      if (m.format > FORMAT) throw new Error(`This backup was made by a newer FYRDrop (format ${m.format}). Update first.`);
      return m;
    }
    throw new Error("Backup is empty.");
  } finally {
    await src.close();
  }
}

/**
 * Verify the whole archive and unpack it into the staging directory. Nothing
 * live is touched; the next boot swaps it in. Returns the manifest.
 */
export async function stageRestore(file: string, passphrase: string | undefined, actor: string): Promise<Manifest> {
  const staging = STAGING_DIR(dirs.data);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const src = await openSource(file, passphrase);
  let manifest: Manifest | null = null;
  let sawDb = false;
  let sawMaster = false;
  try {
    for await (const e of readTar(src)) {
      if (e.type === "5") continue;
      if (e.type !== "0" && e.type !== "\0") throw new Error(`Unsupported entry type in backup: ${e.name}`);
      if (!safeName(e.name)) throw new Error(`Refusing unexpected path in backup: ${e.name.slice(0, 120)}`);
      if (e.name === "manifest.json") {
        const parts: Buffer[] = [];
        for await (const b of e.chunks()) parts.push(b);
        manifest = JSON.parse(Buffer.concat(parts).toString("utf8"));
        if (manifest?.app !== "fyrdrop" || (manifest?.format ?? 99) > FORMAT) throw new Error("Not a compatible FYRDrop backup.");
        continue;
      }
      if (!manifest) throw new Error("Not a FYRDrop backup (manifest missing).");
      const dest = path.join(staging, ...e.name.split("/"));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const sink = await FileSink.open(dest);
      try {
        for await (const b of e.chunks()) await sink.write(b);
      } finally {
        await sink.close();
      }
      if (e.name === "db/fyrdrop.db") sawDb = true;
      if (e.name === "keys/master.key") sawMaster = true;
    }
    if (!manifest) throw new Error("Backup is empty.");
    if (!sawDb) throw new Error("Backup has no database.");
    if (!sawMaster) throw new Error("Backup has no master key - stored files could not be decrypted.");
    // The snapshot must open and look like ours.
    const { Database } = await import("bun:sqlite");
    const probe = new Database(path.join(staging, "db", "fyrdrop.db"), { readonly: true });
    try {
      const ok = probe.query("PRAGMA integrity_check").get() as { integrity_check?: string } | null;
      if (ok?.integrity_check !== "ok") throw new Error("The database in this backup is damaged.");
      probe.query("SELECT COUNT(*) FROM items").get();
      probe.query("SELECT COUNT(*) FROM users").get();
    } finally {
      probe.close();
    }
    fs.writeFileSync(path.join(staging, STAGING_MARKER), JSON.stringify({ at: Date.now(), by: actor, from: path.basename(file), manifest }, null, 2));
    return manifest;
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  } finally {
    await src.close();
  }
}

export function cancelStagedRestore() {
  fs.rmSync(STAGING_DIR(dirs.data), { recursive: true, force: true });
}

export function stagedRestore(): { at: number; by: string; from: string; manifest: Manifest } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(STAGING_DIR(dirs.data), STAGING_MARKER), "utf8"));
  } catch {
    return null;
  }
}

export function lastRestoreResult(): { at: number; ok: boolean; from?: string; error?: string; previous?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dirs.data, "restore_result.json"), "utf8"));
  } catch {
    return null;
  }
}

/* -------------------------------- schedule -------------------------------- */

export interface Schedule {
  enabled: boolean;
  everyHours: number;
  keep: number;
  includeFiles: boolean;
  lastRunAt: number;
  lastError: string;
}
const SCHEDULE_KEY = "backup:schedule";
const DEFAULT_SCHEDULE: Schedule = { enabled: false, everyHours: 24, keep: 7, includeFiles: false, lastRunAt: 0, lastError: "" };

export function getSchedule(): Schedule {
  const row = db.select().from(kv).where(eq(kv.key, SCHEDULE_KEY)).get();
  try {
    return { ...DEFAULT_SCHEDULE, ...(row ? JSON.parse(row.value) : {}) };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

export function setSchedule(patch: Partial<Schedule>): Schedule {
  const next = { ...getSchedule(), ...patch };
  next.everyHours = Math.min(Math.max(Math.round(next.everyHours) || 24, 1), 24 * 30);
  next.keep = Math.min(Math.max(Math.round(next.keep) || 7, 1), 100);
  db.insert(kv).values({ key: SCHEDULE_KEY, value: JSON.stringify(next) }).onConflictDoUpdate({ target: kv.key, set: { value: JSON.stringify(next) } }).run();
  return next;
}

/** Maintenance hook: run the automatic backup when due and prune old automatic ones. */
export function sweepBackups(version: string) {
  const s = getSchedule();
  if (!s.enabled || running) return;
  if (Date.now() - s.lastRunAt < s.everyHours * 3600_000) return;
  setSchedule({ lastRunAt: Date.now() });
  createBackup({ includeFiles: s.includeFiles, auto: true, version, note: "Scheduled backup" })
    .then((info) => {
      setSchedule({ lastError: "" });
      const autos = listBackups().filter((b) => b.auto);
      for (const old of autos.slice(s.keep)) deleteBackup(old.name);
      logEvent({ event: "system.backup", ok: true, detail: `Scheduled backup ${info.name} created`, actor: { name: "maintenance" }, target: info.name, meta: { size: info.size, includesFiles: info.includesFiles } });
    })
    .catch((err) => {
      setSchedule({ lastError: String(err?.message ?? err).slice(0, 300) });
      logEvent({ event: "system.backup", ok: false, detail: `Scheduled backup failed: ${String(err?.message ?? err).slice(0, 200)}`, actor: { name: "maintenance" }, target: "backup" });
      notifyOwners({ title: "A scheduled backup failed", body: String(err?.message ?? err).slice(0, 300), link: "/admin/backups" });
    });
}
