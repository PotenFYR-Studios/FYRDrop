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

export interface Status {
  needsSetup: boolean;
  appName: string;
  ownerName: string;
  maxUploadMb: number;
  registrationOpen: boolean;
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
    req<{ ok: boolean; user: UserProfile; mustChangePassword: boolean }>("/api/auth/account/login", post({ username, password })),
  register: (p: { username: string; name: string; password: string; avatar: string | null; color: string }) =>
    req<{ ok: boolean; user: UserProfile }>("/api/auth/account/register", post(p)),
  switchAccount: () => req("/api/auth/account/logout", post()),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean; signedOut: number }>("/api/auth/account/password", post({ currentPassword, newPassword })),

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
    meta?: { groupId?: string; category?: string; labels?: string },
  ) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    form.append("expiresDays", String(expiresDays));
    form.append("access", JSON.stringify(access));
    if (meta?.groupId) form.append("groupId", meta.groupId);
    if (meta?.category) form.append("category", meta.category);
    if (meta?.labels) form.append("labels", meta.labels);
    return req<{ items: Item[] }>("/api/items/upload", { method: "POST", body: form, signal });
  },
  shareText: (title: string, content: string, expiresDays: number, access: AccessPayload) =>
    req<{ item: Item }>("/api/items/text", post({ title, content, expiresDays, access })),
  shareUrl: (title: string, url: string, expiresDays: number, access: AccessPayload) =>
    req<{ item: Item }>("/api/items/url", post({ title, url, expiresDays, access })),
  beginChunked: (name: string, size: number, mime: string, chunkSize: number, access: AccessPayload, meta?: { groupId?: string; category?: string; labels?: string }) =>
    req<{ uploadId: string; chunkSize: number; chunkCount: number }>("/api/items/upload/begin", post({ name, size, mime, chunkSize, access, ...meta })),
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
  config: () => req<{ config: any; restartFields: string[] }>("/api/admin/config"),
  saveConfig: (p: Record<string, unknown>) => req<{ ok: boolean; config: any }>("/api/admin/config", post(p)),

  // federation (owner)
  peers: () => req<{ peers: any[] }>("/api/federation/peers"),
  addPeer: (name: string, baseUrl: string, token: string) => req<{ peer: any }>("/api/federation/peers", post({ name, baseUrl, token })),
  deletePeer: (id: string) => req(`/api/federation/peers/${id}`, { method: "DELETE" }),
  sendToPeer: (peerId: string, itemId: string) => req(`/api/federation/peers/${peerId}/send/${itemId}`, post()),
  broadcast: (itemId: string) => req(`/api/federation/broadcast/${itemId}`, post()),

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
  shareMeta: (token: string) => req<any>(`/api/share/${encodeURIComponent(token)}`),
  unlockShare: (token: string, pin: string) => req<{ ok: boolean; grant: string; preview?: string }>(`/api/share/${encodeURIComponent(token)}/unlock`, post({ pin })),
};

export const MULTIPART_THRESHOLD = 16 * 1024 * 1024;
const CHUNK = 8 * 1024 * 1024;

/** Upload with automatic chunking for big files. Abortable; aborted chunked uploads are cleaned up server-side. */
export async function uploadFile(
  file: File,
  opts: { expiresDays?: number; onProgress?: (pct: number) => void; access: AccessPayload; signal?: AbortSignal; groupId?: string; category?: string; labels?: string },
) {
  const onProgress = opts.onProgress ?? (() => {});
  if (file.size <= MULTIPART_THRESHOLD) {
    onProgress(15);
    const res = await api.upload([file], opts.expiresDays ?? 0, opts.access, opts.signal, {
      groupId: opts.groupId,
      category: opts.category,
      labels: opts.labels,
    });
    onProgress(100);
    return res.items[0]!;
  }
  const { uploadId, chunkCount, chunkSize } = await api.beginChunked(file.name, file.size, file.type || "application/octet-stream", CHUNK, opts.access, {
    groupId: opts.groupId,
    category: opts.category,
    labels: opts.labels,
  });
  try {
    for (let i = 0; i < chunkCount; i++) {
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const blob = file.slice(i * chunkSize, Math.min((i + 1) * chunkSize, file.size));
      // Retry transient failures (flaky Wi-Fi) without restarting the whole file.
      for (let attempt = 0; ; attempt++) {
        try {
          await api.sendChunk(uploadId, i, blob, opts.signal);
          break;
        } catch (e: any) {
          if (e?.name === "AbortError" || attempt >= 2 || (e instanceof ApiError && e.status >= 400 && e.status < 500)) throw e;
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      onProgress(Math.round(((i + 1) / chunkCount) * 96));
    }
    const res = await api.finishChunked(uploadId, opts.expiresDays ?? 0);
    onProgress(100);
    return res.item;
  } catch (e) {
    void api.abortChunked(uploadId).catch(() => {});
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
