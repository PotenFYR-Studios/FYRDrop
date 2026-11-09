import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

const dataDir = process.env.DATA_DIR ?? "./data";

export const dirs = {
  data: path.resolve(dataDir),
  files: path.resolve(dataDir, "files"),
  thumbs: path.resolve(dataDir, "thumbs"),
  certs: path.resolve(dataDir, "certs"),
  tmp: path.resolve(dataDir, "uploads_tmp"),
};

export function ensureDirs() {
  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const dbFile = path.join(dirs.data, "fyrdrop.db");

ensureDirs();

/** SQLite connection used by drizzle. */
export const sqlite = new Database(dbFile, { create: true });
// WAL + NORMAL sync is crash-safe and far gentler on SD cards (Raspberry Pi).
// A small page cache keeps RSS low; busy_timeout avoids SQLITE_BUSY under bursts.
sqlite.exec(
  "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA cache_size = -4000; PRAGMA temp_store = MEMORY;",
);

export const db = drizzle(sqlite, { schema });

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_name TEXT NOT NULL DEFAULT 'FYRDrop',
  owner_name TEXT NOT NULL DEFAULT '',
  pin_hash TEXT NOT NULL,
  max_upload_mb INTEGER NOT NULL DEFAULT 512,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  device_name TEXT NOT NULL DEFAULT 'Unknown device',
  user_agent TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  stored_name TEXT,
  thumb_name TEXT,
  content TEXT,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS items_type_idx ON items (type);
CREATE TABLE IF NOT EXISTS peers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  token TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_sync_at INTEGER,
  last_status TEXT NOT NULL DEFAULT 'never',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS revoked_tokens (
  session_id TEXT PRIMARY KEY,
  revoked_at INTEGER NOT NULL,
  prunable INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT,
  color TEXT NOT NULL DEFAULT '#6366f1',
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 1,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS cluster_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  secret TEXT NOT NULL,
  last_seen_at INTEGER,
  last_status TEXT NOT NULL DEFAULT 'never',
  last_storage_bytes INTEGER NOT NULL DEFAULT 0,
  last_item_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS storage_units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  max_downloads INTEGER,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'Unknown'
);
CREATE TABLE IF NOT EXISTS certs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  common_name TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  key_bits INTEGER NOT NULL DEFAULT 2048,
  not_before INTEGER NOT NULL,
  not_after INTEGER NOT NULL,
  cert_file TEXT NOT NULL,
  key_file TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- column additions run AFTER all CREATEs so fresh databases have the tables first
ALTER TABLE items ADD COLUMN uploaded_by TEXT NOT NULL DEFAULT 'Unknown';
ALTER TABLE items ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN user_id TEXT;
ALTER TABLE sessions ADD COLUMN mac_note TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN host_name TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN ip_source TEXT NOT NULL DEFAULT 'socket';
ALTER TABLE sessions ADD COLUMN reported_ip TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN mac TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN device_meta TEXT NOT NULL DEFAULT '';
ALTER TABLE cluster_nodes ADD COLUMN public_key TEXT NOT NULL DEFAULT '';
ALTER TABLE cluster_nodes ADD COLUMN fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE cluster_nodes ADD COLUMN status TEXT NOT NULL DEFAULT 'linked';
ALTER TABLE cluster_nodes ADD COLUMN linked_at INTEGER;
ALTER TABLE share_links ADD COLUMN pin_hash TEXT;
ALTER TABLE share_links ADD COLUMN note TEXT;
ALTER TABLE settings ADD COLUMN ip_whitelist TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN ip_whitelist_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN registration_open INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE items ADD COLUMN cluster_origin TEXT;
ALTER TABLE items ADD COLUMN user_id TEXT;
ALTER TABLE share_links ADD COLUMN allowed_users TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN storage_quota_mb INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN pin_enc TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN audience TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE items ADD COLUMN group_id TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN deleted_at INTEGER;
ALTER TABLE items ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN labels TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN audience_groups TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN write_groups TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN delete_groups TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN audience_users TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN write_access TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE items ADD COLUMN write_users TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN delete_access TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE items ADD COLUMN delete_users TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_log ADD COLUMN category TEXT NOT NULL DEFAULT 'system';
ALTER TABLE audit_log ADD COLUMN severity TEXT NOT NULL DEFAULT 'info';
ALTER TABLE audit_log ADD COLUMN actor_id TEXT;
ALTER TABLE audit_log ADD COLUMN actor_name TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_log ADD COLUMN target TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_log ADD COLUMN meta TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#6366f1',
  owner_id TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  added_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS cluster_users (
  node_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  username TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  avatar TEXT,
  color TEXT NOT NULL DEFAULT '#6366f1',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, user_id)
);
CREATE TABLE IF NOT EXISTS user_pins (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS items_created_idx ON items (created_at);
CREATE INDEX IF NOT EXISTS items_user_idx ON items (user_id);
CREATE INDEX IF NOT EXISTS items_expires_idx ON items (expires_at);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS share_links_item_idx ON share_links (item_id);
CREATE INDEX IF NOT EXISTS audit_ts_idx ON audit_log (ts);
CREATE INDEX IF NOT EXISTS audit_category_idx ON audit_log (category, ts);
CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_log (actor_id, ts);
CREATE INDEX IF NOT EXISTS user_pins_item_idx ON user_pins (item_id);
CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members (user_id);
CREATE INDEX IF NOT EXISTS items_group_idx ON items (group_id);
CREATE INDEX IF NOT EXISTS items_deleted_idx ON items (deleted_at);
`;

/** Create tables when missing (idempotent, safe on every boot). */
export function migrate() {
  ensureDirs();
  for (const stmt of MIGRATIONS.split(";")) {
    const s = stmt.trim();
    if (!s) continue;
    try {
      sqlite.exec(s + ";");
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("already exists") && !msg.includes("duplicate column name")) throw err;
    }
  }
  backfillUsernames();
  // Legacy global pins become a personal pin of the uploader.
  if (!sqlite.query("SELECT 1 FROM kv WHERE key = 'migr:pins'").get()) {
    sqlite.exec(
      "INSERT OR IGNORE INTO user_pins (user_id, item_id, created_at) SELECT user_id, id, created_at FROM items WHERE pinned = 1 AND user_id IS NOT NULL;" +
        "INSERT OR REPLACE INTO kv (key, value) VALUES ('migr:pins', '1');",
    );
  }
  // Backfill: the oldest profile on the hosting machine owns the instance.
  const hasOwner = sqlite.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").get();
  if ((hasOwner?.n ?? 0) === 0) {
    const first = sqlite.query<{ id: string }, []>("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get();
    if (first) sqlite.query("UPDATE users SET role = 'owner' WHERE id = ?").run(first.id);
  }
}

/** Give every profile a unique lowercase username (derived from its display name). */
function backfillUsernames() {
  const rows = sqlite.query<{ id: string; name: string; username: string | null }, []>("SELECT id, name, username FROM users").all();
  const taken = new Set(rows.map((r) => r.username).filter(Boolean) as string[]);
  for (const r of rows) {
    if (r.username) continue;
    const base =
      r.name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9._-]+/g, "")
        .replace(/^[._-]+|[._-]+$/g, "")
        .slice(0, 24) || "user";
    const seed = base.length >= 3 ? base : `${base}user`;
    let candidate = seed;
    let n = 2;
    while (taken.has(candidate)) candidate = `${seed}${n++}`;
    taken.add(candidate);
    sqlite.query("UPDATE users SET username = ? WHERE id = ?").run(candidate, r.id);
  }
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (username)");
}

/** Purge expired items (runs from the maintenance timer, never on a request path). */
export function purgeExpired(now = Date.now()): number {
  const expired = sqlite
    .query<{ id: string; stored_name: string | null; thumb_name: string | null }, [number]>(
      "SELECT id, stored_name, thumb_name FROM items WHERE expires_at IS NOT NULL AND expires_at <= ?",
    )
    .all(now);
  for (const row of expired) {
    if (row.stored_name) {
      // refs are "<unitId>:<filename>"; legacy refs resolve to the primary dir
      const idx = row.stored_name.indexOf(":");
      const unitId = idx === -1 ? null : row.stored_name.slice(0, idx);
      const filename = idx === -1 ? row.stored_name : row.stored_name.slice(idx + 1);
      let dir = dirs.files;
      if (unitId) {
        const unit = sqlite.query<{ path: string }, [string]>("SELECT path FROM storage_units WHERE id = ?").get(unitId);
        if (unit?.path) dir = path.isAbsolute(unit.path) ? unit.path : path.resolve(unit.path);
      }
      fs.rmSync(path.join(dir, path.basename(filename)), { force: true });
    }
    if (row.thumb_name) fs.rmSync(path.join(dirs.thumbs, path.basename(row.thumb_name)), { force: true });
    sqlite.query("DELETE FROM share_links WHERE item_id = ?").run(row.id);
    sqlite.query("DELETE FROM user_pins WHERE item_id = ?").run(row.id);
    sqlite.query("DELETE FROM items WHERE id = ?").run(row.id);
  }
  // Trash older than 30 days is removed for good (bytes included).
  const cutoff = now - 30 * 24 * 3600_000;
  const trashed = sqlite
    .query<{ id: string; stored_name: string | null; thumb_name: string | null }, [number]>(
      "SELECT id, stored_name, thumb_name FROM items WHERE deleted_at IS NOT NULL AND deleted_at <= ?",
    )
    .all(cutoff);
  for (const row of trashed) {
    if (row.stored_name) {
      const idx = row.stored_name.indexOf(":");
      const unitId = idx === -1 ? null : row.stored_name.slice(0, idx);
      const filename = idx === -1 ? row.stored_name : row.stored_name.slice(idx + 1);
      let dir = dirs.files;
      if (unitId) {
        const unit = sqlite.query<{ path: string }, [string]>("SELECT path FROM storage_units WHERE id = ?").get(unitId);
        if (unit?.path) dir = path.isAbsolute(unit.path) ? unit.path : path.resolve(unit.path);
      }
      fs.rmSync(path.join(dir, path.basename(filename)), { force: true });
    }
    if (row.thumb_name) fs.rmSync(path.join(dirs.thumbs, path.basename(row.thumb_name)), { force: true });
    sqlite.query("DELETE FROM share_links WHERE item_id = ?").run(row.id);
    sqlite.query("DELETE FROM user_pins WHERE item_id = ?").run(row.id);
    sqlite.query("DELETE FROM items WHERE id = ?").run(row.id);
  }
  // Dead share links are useless rows; keep the table small.
  sqlite.query("DELETE FROM share_links WHERE expires_at IS NOT NULL AND expires_at <= ?").run(now);
  return expired.length;
}
