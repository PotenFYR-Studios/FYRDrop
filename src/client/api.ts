/** Typed API client for FYRDrop. Cookie-based auth (httpOnly, SameSite=Lax). */

export type Scope = "everyone" | "selected" | "group" | "private";

export interface Item {
  id: string;
  type: "file" | "text" | "image" | "url";
  name: string;
  mime: string;
  size: number;
  uploadedBy: string;
  userId: string | null;
  pinned: number;
  downloads: number;
  createdAt: number;
  deletedAt?: number | null;
  expiresAt: number | null;
  hasContent: boolean;
  preview?: string;
  thumbName?: string | null;
  groupId: string;
  category: string;
  labels: string;
  /** Shared by items that were added together; empty for a single item. */
  batchId: string;
  batchName: string;
  audience: Scope;
  audienceUsers: string;
  audienceGroups: string;
  writeAccess: Scope;
  writeUsers: string;
  writeGroups: string;
  deleteAccess: Scope;
  deleteUsers: string;
  deleteGroups: string;
  canWrite: boolean;
  canDelete: boolean;
  canManage: boolean;
}

export interface UserProfile {
  id: string;
  username: string | null;
  name: string;
  avatar: string | null;
  color: string;
  role: "owner" | "user";
  isBlocked: number;
  mustChangePassword: number;
  hasPassword: boolean;
  email?: string | null;
  emailVerified?: number;
  totpEnabled?: number;
  recoveryCodesLeft?: number;
  createdAt: number;
  lastSeenAt: number;
}

export interface DirectoryUser {
  id: string;
  username: string | null;
  name: string;
  avatar: string | null;
  color: string;
  role: "owner" | "user";
}

export interface DeviceSession {
  token: string;
  deviceName: string;
  hostName: string;
  userAgent: string;
  ip: string;
  /** socket | proxy | loopback | docker */
  ipSource: string;
  /** IPv4 the page reported for itself over WebRTC, when available. */
  reportedIp: string;
  /** MAC from the server's neighbour table (bare metal, same L2 only). */
  mac: string;
  macNote: string;
  meta: Record<string, unknown>;
  user: UserProfile | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  isCurrent: boolean;
  active: boolean;
}

/** A paired device as the owner sees it: session details plus the account behind it. */
export interface AdminDevice {
  token: string;
  deviceName: string;
  hostName: string;
  ip: string;
  ipSource: string;
  reportedIp: string;
  mac: string;
  userAgent: string;
  macNote: string;
  meta: Record<string, unknown>;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  active: boolean;
  isCurrent: boolean;
  account: Pick<UserProfile, "id" | "name" | "username" | "role" | "avatar" | "color" | "isBlocked"> | null;
}

export interface DeviceCounts {
  total: number;
  active: number;
  unassigned: number;
  accounts: number;
}

export type LogCategory =
  | "auth"
  | "account"
  | "device"
  | "item"
  | "share"
  | "cert"
  | "storage"
  | "cluster"
  | "federation"
  | "security"
  | "system";

export interface LogEntry {
  id: number;
  ts: number;
  event: string;
  ok: boolean;
  detail: string;
  ip: string;
  category: LogCategory;
  severity: "info" | "warn" | "error";
  actorId: string | null;
  actorName: string;
  target: string;
  meta: unknown;
}

export interface LogPage {
  entries: LogEntry[];
  nextBefore: number | null;
  counts: Record<string, number>;
  totals: { events: number; failed: number; warnings: number; errors: number };
  categories: LogCategory[];
}

export interface CertInfo {
  id: string;
  name: string;
  kind: "generated" | "uploaded";
  commonName: string;
  organization: string;
  serial: string;
  keyBits: number;
  notBefore: number;
  notAfter: number;
  hasKey: boolean;
  createdAt: number;
  daysLeft: number;
}

export interface ShareLink {
  token: string;
  itemId: string;
  url: string;
  createdAt: number;
  deletedAt?: number | null;
  expiresAt: number | null;
  maxDownloads: number | null;
  downloads: number;
  createdBy: string;
  note: string | null;
  hasPin: boolean;
  active: boolean;
}

export interface MyShareLink extends ShareLink {
  allowedUsers: string;
  item: { id: string; name: string; type: string; mime: string; size: number };
  views: number;
  lastAccessAt: number | null;
}
export interface ShareStats {
  totals: { views: number; downloads: number; uniqueVisitors: number; pinFailures: number; unlocks: number; blocked: number };
  daily: { date: string; views: number; downloads: number }[];
  devices: { label: string; count: number }[];
  referrers: { label: string; count: number }[];
  recent: { ts: number; kind: string; device: string; referrer: string }[];
  firstAt: number | null;
  lastAt: number | null;
}

export interface Status {
  needsSetup: boolean;
  appName: string;
  ownerName: string;
  maxUploadMb: number;
  registrationOpen: boolean;
  /** True when a device must enter the instance PIN before the sign-in screen. */
  pinRequired: boolean;
  version: string;
}

export interface Me {
  paired: boolean;
  deviceName: string;
  user: UserProfile | null;
  mustChangePassword: boolean;
}


export interface ClusterNode {
  id: string;
  name: string;
  baseUrl: string;
  publicKey: string;
  fingerprint: string;
  status: string;
  pin: string;
  linkedAt: number | null;
  lastSeenAt: number | null;
  lastStatus: string;
  lastStorageBytes: number;
  lastItemCount: number;
  createdAt: number;
  needsRepair?: boolean;
}

export interface ClusterPendingIn {
  nodeId: string;
  name: string;
  url: string;
  ip: string;
  createdAt: number;
  expiresAt: number;
}

export interface ClusterPendingOut {
  nodeId: string;
  name: string;
  url: string;
  stage: "requested" | "confirmed";
  createdAt: number;
  expiresAt: number;
}

export interface ClusterDiscovered {
  nodeId: string;
  name: string;
  url: string;
  ip: string;
  fingerprint: string;
  publicKey: string;
  port: number;
  seenAt: number;
  source: "beacon" | "scan";
}

export interface ClusterOverview {
  identity: {
    nodeId: string;
    shortId: string;
    fingerprint: string;
    name: string;
    url: string;
    storageBytes: number;
    itemCount: number;
    encryption: string;
  };
  nodes: ClusterNode[];
  pending: { incoming: ClusterPendingIn[]; outgoing: ClusterPendingOut[] };
  discovered: ClusterDiscovered[];
  aggregate: { nodes: number; storageBytes: number; itemCount: number };
}




export interface RemoteUser {
  id: string;
  userId: string;
  nodeId: string;
  nodeName: string;
  name: string;
  username: string | null;
  role: string;
  avatar: string | null;
  color: string;
}

export interface RemoteItem {
  id: string;
  remoteId: string;
  remoteNode: string;
  remoteNodeName: string;
  type: string;
  name: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: number;
  category: string;
  labels: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  description: string;
  color: string;
  ownerId: string;
  isDefault: boolean;
  createdAt: number;
  mine: boolean;
  itemCount: number;
  memberCount: number;
}

export interface GroupMember {
  groupId: string;
  userId: string;
  role: string;
  addedBy: string;
  createdAt: number;
  user: UserProfile | null;
}

export interface GroupDetail {
  group: GroupSummary;
  members: GroupMember[];
  canManage: boolean;
}

export interface UpdatePending {
  from: string;
  to: string;
  mode: "git" | "source";
  tag: string;
  createdAt: number;
}

export interface UpdateStatus {
  current: string;
  mode: "docker" | "git" | "source";
  repo: string;
  pending: UpdatePending | null;
  history: { from: string; to: string; at: number }[];
  lastFailure: { at: number; error: string } | null;
  dockerHint: string | null;
}

export interface UpdateRelease {
  tag: string;
  version: string;
  notes: string;
  url: string;
  publishedAt: string;
}

export interface UpdateCheck {
  current: string;
  mode: "docker" | "git" | "source";
  latest: UpdateRelease | null;
  error: string | null;
  updateAvailable: boolean;
}

export interface AccessPayload {
  read: { scope: Scope; userIds: string[]; groupIds?: string[] };
  write: { scope: Scope; userIds: string[]; groupIds?: string[] };
  delete: { scope: Scope; userIds: string[]; groupIds?: string[] };
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, data: any) {
    super(data?.error ?? (status === 0 ? "Network error - is the server reachable?" : `HTTP ${status}`));
    this.status = status;
    this.data = data;
  }
}

/** Global hook so the app can react to auth loss (session revoked, blocked, …). */
let authLost: ((reason: "pin" | "account" | "password") => void) | null = null;
export function onAuthLost(fn: typeof authLost) {
  authLost = fn;
}

async function req<T = any>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: { ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    throw new ApiError(0, null);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (!path.startsWith("/api/auth/")) {
      if (res.status === 401 && data?.needsPin) authLost?.("pin");
      else if (res.status === 401 && data?.needsAccount) authLost?.("account");
      else if (res.status === 403 && data?.mustChangePassword) authLost?.("password");
    }
    throw new ApiError(res.status, data);
  }
  return data as T;
}

const post = (body?: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body ?? {}) });
const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });

export const api = {
  status: () => req<Status>("/api/auth/status"),

  // stage 1: instance PIN
  detectDevice: () => req<{ deviceName: string; hostName: string; ip: string; ipSource: string }>("/api/auth/device"),
  login: (pin: string, device: Record<string, unknown>) =>
    req<{ ok: boolean; appName: string; needsAccount: boolean; deviceName: string }>("/api/auth/login", post({ pin, device })),
  logout: () => req("/api/auth/logout", post()),
  me: () => req<Me>("/api/auth/me"),

  // stage 2: accounts
  accountLogin: (username: string, password: string) =>
    req<{ ok: boolean; user?: UserProfile; mustChangePassword?: boolean; needs2fa?: boolean; ticket?: string; methods?: string[] }>("/api/auth/account/login", post({ username, password })),
  verifySecondFactor: (p: { ticket: string; code?: string; recoveryCode?: string; passkey?: unknown }) =>
    req<{ ok: boolean; user: UserProfile; mustChangePassword: boolean }>("/api/account/login/verify", post(p)),
  passkeyLoginOptions: (ticket: string) => req<any>("/api/account/login/passkey-options", post({ ticket })),
  forgotPassword: (login: string) => req<{ ok: boolean; mailEnabled: boolean }>("/api/account/password/forgot", post({ login })),
  resetPasswordWithToken: (token: string, newPassword: string) => req<{ ok: boolean; username: string }>("/api/account/password/reset", post({ token, newPassword })),
  accountSecurity: () => req<AccountSecurity>("/api/account/security"),
  totpSetup: (password: string) => req<{ secret: string; uri: string; qr: string }>("/api/account/totp/setup", post({ password })),
  totpEnable: (code: string) => req<{ ok: boolean; recoveryCodes: string[] }>("/api/account/totp/enable", post({ code })),
  totpDisable: (password: string) => req("/api/account/totp/disable", post({ password })),
  regenerateRecovery: (password: string) => req<{ ok: boolean; recoveryCodes: string[] }>("/api/account/recovery/regenerate", post({ password })),
  passkeyOptions: (password: string, name: string) => req<any>("/api/account/passkeys/options", post({ password, name })),
  passkeyRegister: (response: unknown) => req<{ ok: boolean; recoveryCodes?: string[] }>("/api/account/passkeys/register", post({ response })),
  passkeyDelete: (id: string, password: string) => req(`/api/account/passkeys/${encodeURIComponent(id)}/delete`, post({ password })),
  setEmail: (email: string, password: string) => req<{ ok: boolean; sentTo: string }>("/api/account/email", post({ email, password })),
  verifyEmail: (code: string) => req<{ ok: boolean; email: string }>("/api/account/email/verify", post({ code })),
  removeEmail: (password: string) => req("/api/account/email/remove", post({ password })),
  notifications: () => req<{ items: AppNotification[]; unread: number }>("/api/notifications"),
  markNotificationsRead: (ids: number[] | "all") => req("/api/notifications/read", post(ids === "all" ? { all: true } : { ids })),
  clearReadNotifications: () => req("/api/notifications/read", { method: "DELETE" }),
  notificationPrefs: () =>
    req<{ prefs: { inapp: Record<string, boolean>; email: Record<string, boolean> }; kinds: { key: string; label: string; group: string }[]; emailReady: boolean }>("/api/notifications/prefs"),
  saveNotificationPrefs: (p: { inapp?: Record<string, boolean>; email?: Record<string, boolean> }) =>
    req<{ ok: boolean; prefs: { inapp: Record<string, boolean>; email: Record<string, boolean> } }>("/api/notifications/prefs", post(p)),
  apiKeys: () => req<{ keys: ApiKeyView[]; scopes: string[] }>("/api/keys"),
  createApiKey: (name: string, scopes: string[], expiresDays: number) => req<{ key: ApiKeyView; token: string }>("/api/keys", post({ name, scopes, expiresDays })),
  revokeApiKey: (id: string) => req(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
  webhooks: () => req<{ webhooks: WebhookView[]; events: string[]; canTargetPrivate: boolean }>("/api/webhooks"),
  createWebhook: (p: { name: string; url: string; events: string[] }) => req<{ webhook: WebhookView; secret: string }>("/api/webhooks", post(p)),
  updateWebhook: (id: string, p: Partial<{ name: string; url: string; events: string[]; enabled: boolean }>) => req<{ webhook: WebhookView }>(`/api/webhooks/${id}`, patch(p)),
  rotateWebhookSecret: (id: string) => req<{ ok: boolean; secret: string }>(`/api/webhooks/${id}/rotate-secret`, post()),
  testWebhook: (id: string) => req<{ ok: boolean; statusCode: number | null; error: string }>(`/api/webhooks/${id}/test`, post()),
  webhookDeliveries: (id: string) =>
    req<{ deliveries: { id: number; event: string; ok: number; statusCode: number | null; error: string; attempt: number; durationMs: number; createdAt: number }[] }>(`/api/webhooks/${id}/deliveries`),
  deleteWebhook: (id: string) => req(`/api/webhooks/${id}`, { method: "DELETE" }),
  replication: () => req<ReplicationState>("/api/cluster/replication"),
  saveReplicaPolicy: (p: Partial<ReplicaPolicy>) => req<{ ok: boolean; policy: ReplicaPolicy }>("/api/cluster/replication/policy", post(p)),
  runReplication: () => req<ReplicationState & { report: ReplicationReport }>("/api/cluster/replication/run", post()),
  adminReset2fa: (userId: string) => req(`/api/account/admin/${encodeURIComponent(userId)}/reset-2fa`, post()),
  mailConfig: () => req<{ config: MailConfigView }>("/api/mail"),
  saveMailConfig: (p: Partial<MailConfigView> & { password?: string | null }) => req<{ ok: boolean; config: MailConfigView }>("/api/mail", post(p)),
  testMail: (to: string) => req<{ ok: boolean; sentTo: string }>("/api/mail/test", post({ to })),
  register: (p: { username: string; name: string; password: string; avatar: string | null; color: string }) =>
    req<{ ok: boolean; user: UserProfile }>("/api/auth/account/register", post(p)),
  switchAccount: () => req("/api/auth/account/logout", post()),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean; signedOut: number }>("/api/auth/account/password", post({ currentPassword, newPassword })),

  ownerSettings: () => req<{ appName: string; ownerName: string; maxUploadMb: number; pin: string; pinEnabled: boolean; registrationOpen: boolean; ipWhitelist: string; ipWhitelistEnabled: boolean; storageQuotaMb: number }>("/api/auth/settings"),
  saveSettings: (p: Record<string, unknown>) => req("/api/auth/settings", post(p)),

  // profile
  updateProfile: (p: { name?: string; avatar?: string | null; color?: string }) => req<{ user: UserProfile }>("/api/users/me", patch(p)),
  directory: () => req<{ users: DirectoryUser[] }>("/api/users/directory"),
  allUsers: () =>
    req<{ users: (UserProfile & { itemCount: number; storageBytes: number; downloads: number; devices: number; lastIp: string })[] }>("/api/users/all"),
  editUser: (id: string, p: { name?: string; color?: string }) => req(`/api/users/${id}`, patch(p)),
  signOutUser: (id: string) => req<{ count: number }>(`/api/users/${id}/signout`, post()),
  resetPassword: (id: string) => req<{ temporaryPassword: string }>(`/api/users/${id}/reset-password`, post()),
  setUserBlocked: (id: string, blocked: boolean) => req(`/api/users/${id}/block`, post({ blocked })),
  setUserQuota: (id: string, quotaMb: number) => req<{ ok: boolean }>(`/api/users/${id}`, patch({ quotaMb })),
  deleteUser: (id: string, purge = false) => req<{ ok: boolean; purged: number }>(`/api/users/${id}${purge ? "?purge=1" : ""}`, { method: "DELETE" }),

  // storage units + host filesystem browser (owner)
  units: () => req<{ units: any[]; quotaMb: number; availableBytes: number }>("/api/admin/units"),
  addUnit: (name: string, path: string) => req("/api/admin/units", post({ name, path })),
  removeUnit: (id: string) => req(`/api/admin/units/${id}`, { method: "DELETE" }),
  browse: (path?: string) => req<any>(`/api/admin/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`),

  // items
  items: (type?: Item["type"], signal?: AbortSignal) => req<{ items: Item[] }>(`/api/items${type ? `?type=${type}` : ""}`, { signal }),
  pinned: (signal?: AbortSignal) => req<{ items: Item[] }>("/api/items/pinned/all", { signal }),
  upload: (
    files: File[],
    expiresDays: number,
    access: AccessPayload,
    signal?: AbortSignal,
    meta?: { groupId?: string; category?: string; labels?: string; batchId?: string; batchName?: string },
  ) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    form.append("expiresDays", String(expiresDays));
    form.append("access", JSON.stringify(access));
    if (meta?.groupId) form.append("groupId", meta.groupId);
    if (meta?.category) form.append("category", meta.category);
    if (meta?.labels) form.append("labels", meta.labels);
    if (meta?.batchId) form.append("batchId", meta.batchId);
    if (meta?.batchName) form.append("batchName", meta.batchName);
    return req<{ items: Item[] }>("/api/items/upload", { method: "POST", body: form, signal });
  },
  shareText: (title: string, content: string, expiresDays: number, access: AccessPayload) =>
    req<{ item: Item }>("/api/items/text", post({ title, content, expiresDays, access })),
  shareUrl: (title: string, url: string, expiresDays: number, access: AccessPayload, batch?: { batchId?: string; batchName?: string }) =>
    req<{ item: Item }>("/api/items/url", post({ title, url, expiresDays, access, ...batch })),
  // bundles: things added together
  renameBundle: (batchId: string, name: string) => req<{ ok: boolean; name: string; count: number }>(`/api/items/batch/${batchId}`, patch({ name })),
  ungroupBundle: (batchId: string) => req<{ ok: boolean; count: number }>(`/api/items/batch/${batchId}`, patch({ ungroup: true })),
  deleteBundle: (batchId: string) => req<{ ok: boolean; trashed: number; skipped: number }>(`/api/items/batch/${batchId}`, { method: "DELETE" }),
  beginChunked: (
    name: string,
    size: number,
    mime: string,
    chunkSize: number,
    access: AccessPayload,
    meta?: { groupId?: string; category?: string; labels?: string; fingerprint?: string; resumeId?: string; batchId?: string; batchName?: string },
  ) => req<PendingUpload & { resumed: boolean }>("/api/items/upload/begin", post({ name, size, mime, chunkSize, access, ...meta })),
  pendingUploads: () => req<{ uploads: PendingUpload[] }>("/api/items/upload/pending"),
  sendChunk: (uploadId: string, index: number, data: Blob, signal?: AbortSignal) =>
    req(`/api/items/upload/chunk/${uploadId}/${index}`, { method: "PUT", body: data, signal }),
  finishChunked: (uploadId: string, expiresDays: number) => req<{ item: Item }>("/api/items/upload/finish", post({ uploadId, expiresDays })),
  abortChunked: (uploadId: string) => req("/api/items/upload/abort", post({ uploadId })),
  setPin: (id: string, pinned: boolean) => req(`/api/items/${id}/pin`, patch({ pinned })),
  rename: (id: string, name: string) => req<{ item: Item }>(`/api/items/${id}/name`, patch({ name })),
  deleteItem: (id: string) => req(`/api/items/${id}`, { method: "DELETE" }),
  setAccess: (id: string, access: AccessPayload) => req<{ item: Item }>(`/api/items/${id}/access`, patch(access)),
  editNote: (id: string, content: string, title?: string) => req<{ item: Item }>(`/api/items/${id}/content`, patch({ content, title })),

  // share links
  createShare: (id: string, opts: { expiresDays?: number; maxDownloads?: number; pin?: string; note?: string; allowedUserIds?: string[]; alias?: string }) =>
    req<{ token: string; url: string }>(`/api/items/${id}/share`, post(opts)),
  itemShares: (id: string) => req<{ links: ShareLink[] }>(`/api/items/${id}/share`),
  myShares: () => req<{ links: MyShareLink[] }>("/api/items/shares/mine"),
  shareStats: (id: string, token: string, days = 30) => req<ShareStats>(`/api/items/${id}/share/${encodeURIComponent(token)}/stats?days=${days}`),
  revokeShare: (id: string, token: string) => req(`/api/items/${id}/share/${token}`, { method: "DELETE" }),

  // certs
  certs: () => req<{ certs: CertInfo[] }>("/api/certs"),
  generateCert: (opts: { name: string; commonName: string; organization?: string; days?: number; keyBits?: number; sans?: string[] }) =>
    req<{ cert: CertInfo }>("/api/certs/generate", post(opts)),
  uploadCert: (cert: File, key: File | null, name: string) => {
    const form = new FormData();
    form.append("cert", cert);
    if (key) form.append("key", key);
    form.append("name", name);
    return req<{ cert: CertInfo }>("/api/certs/upload", { method: "POST", body: form });
  },
  deleteCert: (id: string) => req(`/api/certs/${id}`, { method: "DELETE" }),

  // sessions / devices
  sessions: () => req<{ sessions: DeviceSession[] }>("/api/sessions"),
  revokeSession: (token: string) => req(`/api/sessions/${token}`, { method: "DELETE" }),
  setMacNote: (token: string, macNote: string) => req(`/api/sessions/${token}`, patch({ macNote })),
  devices: () => req<{ devices: AdminDevice[]; counts: DeviceCounts }>("/api/admin/devices"),
  editDevice: (token: string, p: { deviceName?: string; macNote?: string }) => req<{ ok: boolean; deviceName: string; macNote: string }>(`/api/sessions/${token}`, patch(p)),
  adminLogs: (p: { q?: string; category?: string; severity?: string; actor?: string; before?: number; limit?: number; days?: number } = {}) => {
    const qs = new URLSearchParams();
    if (p.q) qs.set("q", p.q);
    if (p.category && p.category !== "all") qs.set("category", p.category);
    if (p.severity && p.severity !== "all") qs.set("severity", p.severity);
    if (p.actor) qs.set("actor", p.actor);
    if (p.before) qs.set("before", String(p.before));
    if (p.limit) qs.set("limit", String(p.limit));
    if (p.days) qs.set("days", String(p.days));
    const s = qs.toString();
    return req<LogPage>(`/api/admin/logs${s ? `?${s}` : ""}`);
  },

  // admin
  stats: () => req<any>("/api/admin/stats"),
  storage: () => req<any>("/api/admin/storage"),
  cleanup: (mode: "expired" | "orphans" | "all") => req<any>("/api/admin/cleanup", post({ mode })),
  security: (q?: string) => req<any>(`/api/admin/security${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  config: () => req<ConfigState>("/api/admin/config"),
  saveConfig: (p: Record<string, unknown>) => req<ConfigState & { ok: boolean; restartRequired: string[]; overriddenByEnv: string[] }>("/api/admin/config", post(p)),
  restartServer: () => req<{ ok: boolean; restarting: boolean }>("/api/admin/restart", post()),
  tls: () => req<TlsView>("/api/admin/tls"),
  saveTls: (p: { mode: "off" | "auto" | "custom"; names?: string[]; regenerate?: boolean; certPem?: string; keyPem?: string; httpRedirectPort?: number; hsts?: boolean }) =>
    req<TlsView & { ok: boolean }>("/api/admin/tls", post(p)),


  // overview (all signed-in users)
  overview: () => req<any>("/api/overview"),

  // linked-instance content
  remoteUsers: () => req<{ users: RemoteUser[] }>("/api/remote/users"),
  remoteItems: () => req<{ items: RemoteItem[] }>("/api/remote/items"),

  // groups
  search: (q: string) => req<{ items: { id: string; name: string; type: string; mime: string; category: string; labels: string; groupId: string }[]; groups: { id: string; name: string }[] }>(`/api/items/search?q=${encodeURIComponent(q)}`),
  trash: () => req<{ items: Item[] }>("/api/items/trash/list"),
  restoreItem: (id: string) => req<{ ok: boolean }>(`/api/items/${id}/restore`, post()),
  purgeItem: (id: string) => req<{ ok: boolean }>(`/api/items/${id}/purge`, { method: "DELETE" }),
  groups: () => req<{ groups: GroupSummary[] }>("/api/groups"),
  createGroup: (p: { name: string; description?: string; color?: string }) => req<{ group: GroupSummary }>("/api/groups", post(p)),
  group: (id: string) => req<GroupDetail>(`/api/groups/${id}`),
  updateGroup: (id: string, p: { name?: string; description?: string; color?: string }) => req<{ group: GroupSummary }>(`/api/groups/${id}`, patch(p)),
  deleteGroup: (id: string) => req<{ ok: boolean; movedTo: string }>(`/api/groups/${id}`, { method: "DELETE" }),
  addGroupMember: (id: string, username: string) => req<{ ok: boolean }>(`/api/groups/${id}/members`, post({ username })),
  removeGroupMember: (id: string, userId: string) => req(`/api/groups/${id}/members/${userId}`, { method: "DELETE" }),

  // updates (owner)
  // backup & restore (owner)
  backups: () => req<BackupState>("/api/backups"),
  createBackup: (p: { includeFiles: boolean; passphrase?: string; note?: string }) =>
    req<{ ok: boolean; running?: boolean; backup?: BackupInfo }>("/api/backups", post(p)),
  deleteBackup: (name: string) => req(`/api/backups/file/${encodeURIComponent(name)}`, { method: "DELETE" }),
  backupSchedule: (p: Partial<Pick<BackupSchedule, "enabled" | "everyHours" | "keep" | "includeFiles">>) =>
    req<{ ok: boolean; schedule: BackupSchedule }>("/api/backups/schedule", post(p)),
  inspectBackup: (name: string, passphrase?: string) => req<{ ok: boolean; manifest: BackupManifest }>("/api/backups/inspect", post({ name, passphrase })),
  restoreBackup: (name: string, passphrase: string | undefined, restart: boolean) =>
    req<{ ok: boolean; staged: boolean; restarting: boolean; manifest: BackupManifest }>("/api/backups/restore", post({ name, passphrase, confirm: "RESTORE", restart })),
  cancelRestore: () => req("/api/backups/restore", { method: "DELETE" }),
  adminGroups: () => req<{ groups: { id: string; name: string; description: string; color: string; ownerId: string; owner: { id: string; name: string; username: string | null } | null; isDefault: boolean; itemCount: number; createdAt: number }[] }>("/api/admin/groups"),
  adminDeleteGroup: (id: string) => req(`/api/admin/groups/${id}`, { method: "DELETE" }),
  updateStatus: () => req<UpdateStatus>("/api/admin/update"),
  updateCheck: () => req<UpdateCheck>("/api/admin/update/check", post()),
  updateStage: (tag: string) => req<{ ok: boolean; pending: UpdatePending }>("/api/admin/update/stage", post({ tag })),
  updateCancel: () => req("/api/admin/update/cancel", post()),
  updateRestart: () => req<{ ok: boolean; restarting: boolean; to: string }>("/api/admin/update/restart", post()),

  // cluster (owner)
  cluster: () => req<ClusterOverview>("/api/cluster"),
  clusterRequest: (url: string) => req<{ ok: boolean; error?: string }>("/api/cluster/request", post({ url })),
  clusterApproveIncoming: (nodeId: string) => req<{ ok: boolean; waitingForPeer: boolean }>(`/api/cluster/incoming/${nodeId}/approve`, post()),
  clusterRejectIncoming: (nodeId: string) => req(`/api/cluster/incoming/${nodeId}/reject`, post()),
  clusterApproveOutgoing: (nodeId: string) => req<{ ok: boolean; error?: string; node?: ClusterNode }>(`/api/cluster/outgoing/${nodeId}/approve`, post()),
  clusterRejectOutgoing: (nodeId: string) => req(`/api/cluster/outgoing/${nodeId}/reject`, post()),
  clusterScan: () => req<{ ok: boolean; found: ClusterDiscovered[]; discovered: ClusterDiscovered[] }>("/api/cluster/scan", post()),
  clusterRefresh: () => req<{ ok: boolean; results: { id: string; ok: boolean; error?: string }[]; nodes: ClusterNode[] }>("/api/cluster/refresh", post()),
  clusterFetch: (id: string, itemId: string) => req(`/api/cluster/${id}/fetch/${itemId}`, post()),
  updateItemMeta: (id: string, p: { groupId?: string; category?: string; labels?: string }) =>
    req<{ item: Item }>(`/api/items/${id}/meta`, patch(p)),
  replicateItem: (id: string) => req<{ ok: boolean; node: { id: string; name: string }; remoteId: string }>(`/api/items/${id}/replicate`, post()),
  clusterPush: (id: string, itemId: string) => req(`/api/cluster/${id}/push/${itemId}`, post()),
  clusterLeave: (id: string, force = false) => req<{ ok: boolean; reclaimed: number; warning?: string }>(`/api/cluster/${id}${force ? "?force=1" : ""}`, { method: "DELETE" }),

  // webrtc
  presence: () => req("/api/webrtc/presence", post()),
  leavePresence: () => req("/api/webrtc/presence/leave", post()),
  rtcPeers: () => req<{ peers: { token: string; deviceName: string; userName: string; color: string; mine: boolean; lastSeen: number }[] }>("/api/webrtc/peers"),
  signal: (to: string, kind: "offer" | "answer" | "ice" | "bye", payload: unknown) => req("/api/webrtc/signal", post({ to, kind, payload })),

  // public share page
  shareMeta: (token: string, ref?: string) => req<any>(`/api/share/${encodeURIComponent(token)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`),
  unlockShare: (token: string, pin: string) => req<{ ok: boolean; grant: string; preview?: string }>(`/api/share/${encodeURIComponent(token)}/unlock`, post({ pin })),
};

export interface TlsCert {
  subject: string;
  issuer: string;
  selfSigned: boolean;
  names: string[];
  notBefore: number;
  notAfter: number;
  daysLeft: number;
  expired: boolean;
  fingerprint: string;
}
/** How the instance is served, for the HTTPS card in Admin -> Settings. */
export interface TlsView {
  running: { scheme: "http" | "https"; source: "off" | "self-signed" | "custom"; problem: string; cert: TlsCert | null };
  requestScheme: "http" | "https";
  mode: "off" | "auto" | "custom";
  lockedBy: string;
  pendingRestart: boolean;
  selfSigned: TlsCert | null;
  custom: (TlsCert & { from: "paths" | "upload"; problem: string }) | null;
  suggestedNames: string[];
  host: string;
  port: number;
  hsts: boolean;
  httpRedirectPort: number;
}

/** A link that downloads several items as one .zip. */
export function zipUrl(ids: string[]) {
  return `/api/items/zip?ids=${ids.join(",")}`;
}
export function bundleZipUrl(batchId: string) {
  return `/api/items/zip?batch=${batchId}`;
}

/** Random id shared by the things added in one go (works without a secure context, i.e. over plain HTTP). */
export function newBatchId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Copy text to the clipboard. The async clipboard API only exists on HTTPS
 * and localhost, so plain-HTTP LAN addresses fall back to a hidden textarea.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A chunked upload the server is still holding parts for (resumable after a reload or restart). */
export interface PendingUpload {
  uploadId: string;
  name: string;
  mime: string;
  size: number;
  fingerprint: string;
  chunkSize: number;
  chunkCount: number;
  received: number[];
  receivedBytes: number;
  createdAt: number;
  lastActivity: number;
  finishing: boolean;
}

/** Identifies "the same file" across page reloads without reading its bytes. */
export function fileFingerprint(file: File) {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return `${rel}|${file.size}|${file.lastModified}`;
}

/** Abort reason that stops sending but keeps the server parts, so the upload can resume later. */
export const PAUSE = "pause";

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
  encrypted: boolean;
  includesFiles: boolean;
  note: string;
  auto: boolean;
}
export interface BackupManifest {
  format: number;
  version: string;
  createdAt: number;
  appName: string;
  includesFiles: boolean;
  encrypted: boolean;
  counts: { items: number; users: number; files: number; bytes: number };
  note: string;
}
export interface BackupSchedule {
  enabled: boolean;
  everyHours: number;
  keep: number;
  includeFiles: boolean;
  lastRunAt: number;
  lastError: string;
}
export interface BackupState {
  backups: BackupInfo[];
  running: boolean;
  lastError: string;
  schedule: BackupSchedule;
  staged: { at: number; by: string; from: string; manifest: BackupManifest } | null;
  lastRestore: { at: number; ok: boolean; from?: string; error?: string; previous?: string } | null;
}

/** Upload a backup archive from this computer in sequential chunks. */
export async function uploadBackupFile(file: File, onProgress: (pct: number) => void) {
  const begun = await req<{ uploadId: string; chunkSize: number }>("/api/backups/upload/begin", post({ name: file.name, size: file.size }));
  const cs = Math.min(begun.chunkSize, 16 * 1024 * 1024);
  for (let off = 0, i = 0; off < file.size; off += cs, i++) {
    await req(`/api/backups/upload/${begun.uploadId}/${i}`, { method: "PUT", body: file.slice(off, off + cs) });
    onProgress(Math.round(((off + cs) / file.size) * 100));
  }
  return req<{ ok: boolean; name: string; encrypted: boolean }>(`/api/backups/upload/${begun.uploadId}/finish`, post());
}

export interface ApiKeyView {
  id: string;
  name: string;
  scopes: string[];
  preview: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
}
export interface WebhookView {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  failures: number;
  lastStatus: string;
  lastDeliveryAt: number | null;
  createdAt: number;
}
export interface ReplicaPolicy {
  enabled: boolean;
  copies: number;
  include: "all" | "label";
  label: string;
  maxItemMb: number;
  headroomPct: number;
  maxMbPerRun: number;
  verifyEveryHours: number;
}
export interface ReplicationReport {
  at: number;
  durationMs: number;
  reason: string;
  placed: number;
  removed: number;
  moved: number;
  verified: number;
  replacedBad: number;
  repaired: number;
  failed: number;
  bytesSent: number;
  budgetHit: boolean;
  errors: string[];
  nodes: { id: string; name: string; reachable: boolean; freeBytes: number; capacityBytes: number }[];
}
export interface ReplicationState {
  policy: ReplicaPolicy;
  running: boolean;
  report: ReplicationReport | null;
  summary: { eligible: number; protected: number; under: number; over: number; tooLarge: number; maxCopies: number };
  nodes: { id: string; name: string; replicas: number; bytes: number; lastSeenAt: number | null; status: string }[];
}
export interface ConfigField {
  key: string;
  label: string;
  group: string;
  help: string;
  env: string[];
  restart: boolean;
  secret: boolean;
  value: unknown;
  isSet?: boolean;
  envOverride: { name: string; value: string } | null;
  pending: boolean;
}
export interface ConfigState {
  config: Record<string, unknown>;
  interfaces: { name: string; address: string }[];
  restartFields: string[];
  fields: ConfigField[];
  envOnly: { env: string; label: string; help: string; value: string }[];
  pendingRestart: string[];
}
export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string;
  createdAt: number;
  readAt: number | null;
}
export interface AccountSecurity {
  totpEnabled: boolean;
  recoveryCodesLeft: number;
  passkeys: { id: string; name: string; rpId: string; createdAt: number; lastUsedAt: number | null }[];
  passkeysAvailable: boolean;
  passkeysProblem: string;
  currentRpId: string;
  email: string | null;
  emailVerified: boolean;
  pendingEmail: string | null;
  mailEnabled: boolean;
}
export interface MailConfigView {
  enabled: boolean;
  host: string;
  port: number;
  security: "tls" | "starttls" | "none";
  user: string;
  from: string;
  publicUrl: string;
  hasPassword: boolean;
  outbox: boolean;
}

export const MULTIPART_THRESHOLD = 16 * 1024 * 1024;
const CHUNK = 8 * 1024 * 1024;

/**
 * Upload with automatic chunking for big files.
 * Chunked uploads are resumable: the server keeps received parts, and starting the
 * same file again (same fingerprint, or an explicit resumeId) skips what is already there.
 * Aborting with reason PAUSE, a network failure or closing the tab keeps the parts;
 * a plain abort (the user pressed cancel) discards them.
 */
export async function uploadFile(
  file: File,
  opts: {
    expiresDays?: number;
    onProgress?: (pct: number) => void;
    access: AccessPayload;
    signal?: AbortSignal;
    groupId?: string;
    category?: string;
    labels?: string;
    resumeId?: string;
    onResumed?: (fromPct: number) => void;
    /** Set on every file of a multi-file upload so they stay together as one bundle. */
    batchId?: string;
    batchName?: string;
  },
) {
  const onProgress = opts.onProgress ?? (() => {});
  if (file.size <= MULTIPART_THRESHOLD && !opts.resumeId) {
    onProgress(15);
    const res = await api.upload([file], opts.expiresDays ?? 0, opts.access, opts.signal, {
      groupId: opts.groupId,
      category: opts.category,
      labels: opts.labels,
      batchId: opts.batchId,
      batchName: opts.batchName,
    });
    onProgress(100);
    return res.items[0]!;
  }
  const begun = await api.beginChunked(file.name, file.size, file.type || "application/octet-stream", CHUNK, opts.access, {
    groupId: opts.groupId,
    category: opts.category,
    labels: opts.labels,
    fingerprint: fileFingerprint(file),
    resumeId: opts.resumeId,
    batchId: opts.batchId,
    batchName: opts.batchName,
  });
  const { uploadId, chunkCount, chunkSize } = begun;
  const have = new Set(begun.received);
  let done = have.size;
  const pct = () => Math.round((done / chunkCount) * 96);
  if (begun.resumed && done > 0) opts.onResumed?.(pct());
  onProgress(pct());
  try {
    for (let i = 0; i < chunkCount; i++) {
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (have.has(i)) continue;
      const blob = file.slice(i * chunkSize, Math.min((i + 1) * chunkSize, file.size));
      // Retry transient failures (flaky Wi-Fi) without restarting the whole file.
      for (let attempt = 0; ; attempt++) {
        try {
          await api.sendChunk(uploadId, i, blob, opts.signal);
          break;
        } catch (e: any) {
          if (e?.name === "AbortError" || attempt >= 4 || (e instanceof ApiError && e.status >= 400 && e.status < 500)) throw e;
          await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
        }
      }
      done++;
      onProgress(pct());
    }
    const res = await api.finishChunked(uploadId, opts.expiresDays ?? 0);
    onProgress(100);
    return res.item;
  } catch (e: any) {
    // Only an explicit cancel throws the server parts away; anything else stays resumable.
    const cancelled = e?.name === "AbortError" && opts.signal?.reason !== PAUSE;
    const rejected = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 409 && e.status !== 429;
    if (cancelled || rejected) void api.abortChunked(uploadId).catch(() => {});
    else if (e?.name !== "AbortError") throw new ApiError(e?.status ?? 0, { error: `${e?.message ?? "Upload failed"} - it can be resumed from the Files page.` });
    throw e;
  }
}

/** Run async jobs with bounded parallelism (keeps memory flat on phones / Pi clients). */
export async function runLimited<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
}

export function humanSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Math.max(0, bytes || 0);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const future = diff < 0;
  const s = Math.max(1, Math.round(Math.abs(diff) / 1000));
  const v = s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
  return future ? `in ${v}` : `${v} ago`;
}

export function isHttpUrl(raw: string | undefined | null): raw is string {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
