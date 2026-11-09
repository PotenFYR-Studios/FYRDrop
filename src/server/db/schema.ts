import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

/** Single-row app configuration, created by the first-startup wizard. */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  appName: text("app_name").notNull().default("FYRDrop"),
  ownerName: text("owner_name").notNull().default(""),
  pinHash: text("pin_hash").notNull(),
  /** AES-encrypted PIN so the boot banner can show it (explicit operator choice). */
  pinEnc: text("pin_enc").notNull().default(""),
  maxUploadMb: integer("max_upload_mb").notNull().default(512),
  /** Comma-separated CIDR/IP whitelist; empty = allow all. */
  ipWhitelist: text("ip_whitelist").notNull().default(""),
  ipWhitelistEnabled: integer("ip_whitelist_enabled").notNull().default(0),
  registrationOpen: integer("registration_open").notNull().default(1),
  /** Instance storage quota in MB (0 = unlimited). Cluster peers see free space. */
  storageQuotaMb: integer("storage_quota_mb").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Device sessions created after a successful PIN login. */
export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  deviceName: text("device_name").notNull().default("Unknown device"),
  /** Reverse-DNS host name, when the network publishes one. */
  hostName: text("host_name").notNull().default(""),
  userAgent: text("user_agent").notNull().default(""),
  ip: text("ip").notNull().default(""),
  /** How `ip` was obtained: socket, proxy, loopback or docker. */
  ipSource: text("ip_source").notNull().default("socket"),
  /** IPv4 the page reported for itself (WebRTC ICE candidate). */
  reportedIp: text("reported_ip").notNull().default(""),
  /** MAC from the server's neighbour table (bare metal, same L2 only). */
  mac: text("mac").notNull().default(""),
  /** JSON: platform, browser, screen, timezone, cores, memory, ... */
  deviceMeta: text("device_meta").notNull().default(""),
  /** Bound profile user (set after the profile wizard). */
  userId: text("user_id"),
  /** Admin-annotated MAC address for LAN devices. */
  macNote: text("mac_note").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

/** Shared content: uploaded files, pasted text, images and links. */
export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  /** "file" | "text" | "image" | "url" */
  type: text("type").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull().default(""),
  size: integer("size").notNull().default(0),
  /** Stored filename inside DATA_DIR/files (files & images only). */
  storedName: text("stored_name"),
  /** Stored thumbnail filename inside DATA_DIR/thumbs (images only). */
  thumbName: text("thumb_name"),
  /** Text body (text items only) / target URL (url items only). */
  content: text("content"),
  /** Device name that created this item. */
  uploadedBy: text("uploaded_by").notNull().default("Unknown"),
  /** Owning profile (for per-user stats and purge). */
  userId: text("user_id"),
  /** Cluster node that pushed this item (for reclaim on unlink). */
  clusterOrigin: text("cluster_origin"),
  /** "everyone" | "selected" | "private" - who can see this item. */
  /** Home group (organisation), not an access rule by itself. */
  groupId: text("group_id").notNull().default(""),
  category: text("category").notNull().default(""),
  /** Comma separated labels. */
  labels: text("labels").notNull().default(""),
  audience: text("audience").notNull().default("everyone"),
  /** Comma-separated user ids when audience = selected. */
  audienceUsers: text("audience_users").notNull().default(""),
  audienceGroups: text("audience_groups").notNull().default(""),
  /** Edit access: "everyone" | "selected" | "private". */
  writeAccess: text("write_access").notNull().default("everyone"),
  writeUsers: text("write_users").notNull().default(""),
  writeGroups: text("write_groups").notNull().default(""),
  /** Delete access: "everyone" | "selected" | "private". */
  deleteAccess: text("delete_access").notNull().default("everyone"),
  deleteUsers: text("delete_users").notNull().default(""),
  deleteGroups: text("delete_groups").notNull().default(""),
  /** Quick link: pinned to dashboard. */
  pinned: integer("pinned").notNull().default(0),
  downloads: integer("downloads").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  /** Unix timestamp; null = never expires. */
  expiresAt: integer("expires_at"),
});

/** Public share links for individual items (no PIN needed, token-gated). */
export const shareLinks = sqliteTable("share_links", {
  token: text("token").primaryKey(),
  itemId: text("item_id").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at"),
  maxDownloads: integer("max_downloads"),
  downloads: integer("downloads").notNull().default(0),
  createdBy: text("created_by").notNull().default("Unknown"),
  /** Optional per-link PIN (argon2 hash) - public page asks before download. */
  pinHash: text("pin_hash"),
  /** Free-text recipient/note shown on the public page. */
  note: text("note"),
  /** Comma-separated user ids allowed to open it; empty = anyone with the link. */
  allowedUsers: text("allowed_users").notNull().default(""),
});

/** Self-signed / uploaded TLS certificates offered to other devices. */
export const certs = sqliteTable("certs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** "generated" | "uploaded" */
  kind: text("kind").notNull(),
  commonName: text("common_name").notNull().default(""),
  organization: text("organization").notNull().default(""),
  serial: text("serial").notNull().default(""),
  keyBits: integer("key_bits").notNull().default(2048),
  notBefore: integer("not_before").notNull(),
  notAfter: integer("not_after").notNull(),
  certFile: text("cert_file").notNull(),
  keyFile: text("key_file"),
  createdAt: integer("created_at").notNull(),
});

/** People who use this instance (bound to devices after PIN login). */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  /** Unique, lowercase sign-in handle. */
  username: text("username"),
  /** Mandatory display name (profile wizard). */
  name: text("name").notNull(),
  /** argon2id hash of the account password (null = legacy profile, must set one). */
  passwordHash: text("password_hash"),
  /** 1 = the next sign-in must choose a new password (bootstrap admin, admin reset). */
  mustChangePassword: integer("must_change_password").notNull().default(0),
  /** Optional avatar - small data URL (<= 200 KB). */
  avatar: text("avatar"),
  color: text("color").notNull().default("#6366f1"),
  /** "owner" (hosting machine) | "user" - first profile created on this instance owns it. */
  role: text("role").notNull().default("user"),
  isBlocked: integer("is_blocked").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
});

/** Remote FYRDROP instances this one can broadcast/push to. */
export const peers = sqliteTable("peers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  /** Shared secret this peer expects in X-FYRDrop-Token. */
  token: text("token").notNull(),
  enabled: integer("enabled").notNull().default(1),
  lastSyncAt: integer("last_sync_at"),
  lastStatus: text("last_status").notNull().default("never"),
  createdAt: integer("created_at").notNull(),
});

/** SessionIds revoked before expiry (stateless-token revocation list). */
export const revokedTokens = sqliteTable("revoked_tokens", {
  sessionId: text("session_id").primaryKey(),
  revokedAt: integer("revoked_at").notNull(),
  prunable: integer("prunable").notNull().default(0),
});

/** Security audit trail: logins, setup, federation inbound, blocks. */
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: integer("ts").notNull(),
  ip: text("ip").notNull().default(""),
  event: text("event").notNull(),
  ok: integer("ok").notNull().default(1),
  detail: text("detail").notNull().default(""),
  /** Grouping for the activity log UI: auth, account, device, item, share, cert, storage, cluster, federation, security, system. */
  category: text("category").notNull().default("system"),
  /** info | warn | error */
  severity: text("severity").notNull().default("info"),
  /** Account that caused the event (null for anonymous device-level actions). */
  actorId: text("actor_id"),
  actorName: text("actor_name").notNull().default(""),
  /** Subject of the event: an item, account, device or peer name. */
  target: text("target").notNull().default(""),
  /** Optional JSON blob with extra context (old/new values, counts, peer, ...). */
  meta: text("meta").notNull().default(""),
});

/** Peer FYRDROP instances in this cluster (mutually keyed, signed requests). */
export const clusterNodes = sqliteTable("cluster_nodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  /** Per-link AES-256-GCM key derived by ECDH, encrypted at rest. */
  secret: text("secret").notNull(),
  /** Peer's long-term X25519 public key (PEM), used for the fingerprint. */
  publicKey: text("public_key").notNull().default(""),
  /** Short fingerprint both admins can compare. */
  fingerprint: text("fingerprint").notNull().default(""),
  /** linked | needs-repair */
  status: text("status").notNull().default("linked"),
  linkedAt: integer("linked_at"),
  lastSeenAt: integer("last_seen_at"),
  lastStatus: text("last_status").notNull().default("never"),
  lastStorageBytes: integer("last_storage_bytes").notNull().default(0),
  lastItemCount: integer("last_item_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

/** Extra storage paths (local mounts) - uploads land on the unit with most free space. */
export const storageUnits = sqliteTable("storage_units", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Absolute or DATA_DIR-relative path. */
  path: text("path").notNull(),
  enabled: integer("enabled").notNull().default(1),
  createdAt: integer("created_at").notNull(),
});

/** Per-user quick links (pins are personal, not global). */
export const userPins = sqliteTable(
  "user_pins",
  {
    userId: text("user_id").notNull(),
    itemId: text("item_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.itemId] }) }),
);

/** Generic key/value store for future settings without a migration. */
export const kv = sqliteTable("kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const schemaMeta = { settings, sessions, items, certs, kv, pk: primaryKey };

/** User-created groups. Every account gets one "Default" group. */
export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("#6366f1"),
  ownerId: text("owner_id").notNull(),
  isDefault: integer("is_default").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const groupMembers = sqliteTable("group_members", {
  groupId: text("group_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("member"),
  addedBy: text("added_by").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});
