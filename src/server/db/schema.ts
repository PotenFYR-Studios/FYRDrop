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
  /** Set on copies kept for another node: the item id on that node. Hidden from lists. */
  replicaOf: text("replica_of"),
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
  /** Set when the item is moved to trash; null means live. */
  deletedAt: integer("deleted_at"),
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
  /** Account that created the link (null on links made before this column existed). */
  createdById: text("created_by_id"),
});

/** One row per open / unlock / download of a share link (no IP stored; see share-stats.ts). */
export const shareEvents = sqliteTable("share_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull(),
  itemId: text("item_id").notNull(),
  /** view | unlock | pin_failed | download | blocked */
  kind: text("kind").notNull(),
  ts: integer("ts").notNull(),
  /** Daily-salted hash of IP + user agent; cannot be linked across days. */
  visitor: text("visitor").notNull().default(""),
  device: text("device").notNull().default(""),
  referrer: text("referrer").notNull().default(""),
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
  /** Personal storage cap in MB; 0 means the instance quota only. */
  quotaMb: integer("quota_mb").notNull().default(0),
  /** Optional avatar - small data URL (<= 200 KB). */
  avatar: text("avatar"),
  color: text("color").notNull().default("#6366f1"),
  /** "owner" (hosting machine) | "user" - first profile created on this instance owns it. */
  role: text("role").notNull().default("user"),
  isBlocked: integer("is_blocked").notNull().default(0),
  /** Contact address for password reset and notifications. */
  email: text("email"),
  emailVerified: integer("email_verified").notNull().default(0),
  /** TOTP secret (base32), sealed with the master key. */
  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled").notNull().default(0),
  /** Comma separated SHA-256 hashes of unused recovery codes. */
  recoveryCodes: text("recovery_codes").notNull().default(""),
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
  /** Peer instance PIN, sealed with the local key, shown to the owner after linking. */
  pinEnc: text("pin_enc").notNull().default(""),
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

/** Directory of accounts on linked instances, used when granting access to a person on another node. */
export const clusterUsers = sqliteTable("cluster_users", {
  nodeId: text("node_id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull().default(""),
  username: text("username"),
  role: text("role").notNull().default("user"),
  avatar: text("avatar"),
  color: text("color").notNull().default("#6366f1"),
  updatedAt: integer("updated_at").notNull(),
});


/** Chunked uploads in progress. Parts live in DATA_DIR/uploads_tmp; rows survive restarts so uploads can resume. */
export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull().default("application/octet-stream"),
  size: integer("size").notNull(),
  chunkSize: integer("chunk_size").notNull(),
  /** Client file fingerprint (name|size|lastModified) used to resume after a reload. */
  fingerprint: text("fingerprint").notNull().default(""),
  /** JSON: access, groupId, category, labels. */
  meta: text("meta").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
  lastActivity: integer("last_activity").notNull(),
});

/** Passkeys / security keys registered as a second factor. */
export const webauthnCredentials = sqliteTable("webauthn_credentials", {
  /** Credential id (base64url). */
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  /** Relying-party id (host name) the credential is bound to. */
  rpId: text("rp_id").notNull(),
  /** COSE public key, base64url. */
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  transports: text("transports").notNull().default(""),
  name: text("name").notNull().default("Passkey"),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
});

/** Single-use password reset links (only the SHA-256 of the token is stored). */
export const passwordResets = sqliteTable("password_resets", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
});

/** Per-account inbox (bell menu). */
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  link: text("link").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  readAt: integer("read_at"),
});

/** Personal API keys (only a SHA-256 of the secret is stored). */
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  secretHash: text("secret_hash").notNull(),
  /** Comma separated: read, write. */
  scopes: text("scopes").notNull().default("read"),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
  expiresAt: integer("expires_at"),
  revokedAt: integer("revoked_at"),
});

/** Outgoing webhooks: signed JSON POSTs when an account's items change. */
export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  /** HMAC signing secret, sealed with the master key. */
  secretEnc: text("secret_enc").notNull(),
  /** Comma separated event names; empty = all. */
  events: text("events").notNull().default(""),
  enabled: integer("enabled").notNull().default(1),
  /** Consecutive failed deliveries; the hook turns itself off at 20. */
  failures: integer("failures").notNull().default(0),
  lastStatus: text("last_status").notNull().default("never"),
  lastDeliveryAt: integer("last_delivery_at"),
  createdAt: integer("created_at").notNull(),
});

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  webhookId: text("webhook_id").notNull(),
  deliveryId: text("delivery_id").notNull(),
  event: text("event").notNull(),
  ok: integer("ok").notNull().default(0),
  statusCode: integer("status_code"),
  error: text("error").notNull().default(""),
  attempt: integer("attempt").notNull().default(1),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

/** Copies of local items kept on linked nodes (origin side bookkeeping). */
export const replicas = sqliteTable(
  "replicas",
  {
    itemId: text("item_id").notNull(),
    nodeId: text("node_id").notNull(),
    /** The copy's item id on that node. */
    remoteId: text("remote_id").notNull(),
    size: integer("size").notNull().default(0),
    /** SHA-256 of the plaintext, checked against the peer during verification. */
    sha256: text("sha256").notNull(),
    status: text("status").notNull().default("ok"),
    lastError: text("last_error").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    verifiedAt: integer("verified_at"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.itemId, t.nodeId] }) }),
);
