import crypto from "node:crypto";
import fs from "node:fs";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db";
import { clusterNodes, items, kv, replicas } from "../db/schema";
import { decryptString, encryptString, readDecrypted } from "./crypto";
import { getIdentity, open, seal, signRequest } from "./cluster";
import { availableBytes, deleteStoredFile, markUsageDirty, pathForRef, writeStoredFile } from "./storage";
import { storedFileName } from "./files";
import { deleteThumb } from "./thumbs";
import { logEvent } from "./audit";
import { notifyOwners } from "./notify";
import { publish } from "./events";

/**
 * Replica policy and continuous rebalancing across linked cluster nodes.
 *
 * The instance that owns an item ("origin") decides where copies live and
 * records every copy in `replicas` (node, remote id, SHA-256 of the content).
 * One pass of the rebalancer:
 *   1. asks every linked node for its free space,
 *   2. drops copies of items that were deleted, expired or no longer match the policy,
 *   3. verifies copies whose last check is older than the policy says (hash on the peer),
 *   4. repairs local items whose stored file went missing, from a healthy copy,
 *   5. places missing copies on the node with the most free space,
 *   6. trims extra copies (policy lowered, or a node came back after an outage),
 *   7. moves copies off nodes that fell below their free-space headroom.
 * Copies on a peer are private items marked `replica_of`: hidden from that
 * peer's lists, never replicated again, and handed back on unlink.
 * Transfers use the sealed cluster channel, so items over 64 MB are skipped.
 */

export const TRANSFER_MAX = 64 * 1024 * 1024;
const POLICY_KEY = "cluster:replica-policy";
const REPORT_KEY = "cluster:replica-report";
const STALE_NODE_MS = 24 * 3600_000;

export interface ReplicaPolicy {
  enabled: boolean;
  /** Copies on other nodes, in addition to the original. */
  copies: number;
  /** "all" items, or only items carrying `label`. */
  include: "all" | "label";
  label: string;
  maxItemMb: number;
  /** Keep at least this share of a node's capacity free. */
  headroomPct: number;
  /** Upper bound on bytes sent per pass, so a pass never saturates the link. */
  maxMbPerRun: number;
  verifyEveryHours: number;
}

const DEFAULT_POLICY: ReplicaPolicy = { enabled: false, copies: 1, include: "all", label: "replicate", maxItemMb: 64, headroomPct: 10, maxMbPerRun: 512, verifyEveryHours: 24 };

export function getPolicy(): ReplicaPolicy {
  const row = db.select().from(kv).where(eq(kv.key, POLICY_KEY)).get();
  try {
    return { ...DEFAULT_POLICY, ...(row ? JSON.parse(row.value) : {}) };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export function setPolicy(patch: Partial<ReplicaPolicy>): ReplicaPolicy {
  const p = { ...getPolicy() };
  if (typeof patch.enabled === "boolean") p.enabled = patch.enabled;
  if (patch.copies !== undefined) p.copies = Math.min(Math.max(Math.round(Number(patch.copies)) || 0, 0), 5);
  if (patch.include === "all" || patch.include === "label") p.include = patch.include;
  if (typeof patch.label === "string") p.label = patch.label.trim().toLowerCase().slice(0, 40) || "replicate";
  if (patch.maxItemMb !== undefined) p.maxItemMb = Math.min(Math.max(Math.round(Number(patch.maxItemMb)) || 64, 1), 64);
  if (patch.headroomPct !== undefined) p.headroomPct = Math.min(Math.max(Number(patch.headroomPct) || 0, 0), 50);
  if (patch.maxMbPerRun !== undefined) p.maxMbPerRun = Math.min(Math.max(Math.round(Number(patch.maxMbPerRun)) || 512, 16), 100_000);
  if (patch.verifyEveryHours !== undefined) p.verifyEveryHours = Math.min(Math.max(Math.round(Number(patch.verifyEveryHours)) || 24, 1), 24 * 30);
  const value = JSON.stringify(p);
  db.insert(kv).values({ key: POLICY_KEY, value }).onConflictDoUpdate({ target: kv.key, set: { value } }).run();
  return p;
}

type Node = typeof clusterNodes.$inferSelect;
type Item = typeof items.$inferSelect;
type Replica = typeof replicas.$inferSelect;

async function call(node: Node, method: "GET" | "POST", path: string, payload?: unknown, timeoutMs = 30_000): Promise<any> {
  const key = Buffer.from(decryptString(node.secret), "base64");
  const body = payload === undefined ? "" : JSON.stringify(seal(key, payload));
  const headers: Record<string, string> = { ...signRequest(key, getIdentity().id, method, path, body) };
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(`${node.baseUrl}${path}`, { method, headers, body: body || undefined, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text);
      msg = String(j?.error ?? (j?.iv ? open(key, j)?.error : null) ?? msg);
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return text ? open(key, JSON.parse(text)) : null;
}

/* ------------------------------ content helpers --------------------------- */

function plainContent(row: Item): { buf?: Buffer; text?: string } | null {
  if (row.storedName) {
    const fp = pathForRef(row.storedName);
    if (!fs.existsSync(fp)) return null;
    return { buf: readDecrypted(fp) };
  }
  if (row.content) return { text: decryptString(row.content) };
  return { text: "" };
}

export function sha256Of(c: { buf?: Buffer; text?: string }) {
  return crypto.createHash("sha256").update(c.buf ?? Buffer.from(c.text ?? "", "utf8")).digest("hex");
}

function eligible(row: Item, p: ReplicaPolicy, now = Date.now()) {
  if (row.deletedAt || row.replicaOf || row.clusterOrigin) return false;
  if (row.expiresAt && row.expiresAt <= now) return false;
  if (row.size > Math.min(p.maxItemMb * 1024 * 1024, TRANSFER_MAX)) return false;
  if (p.include === "label") return row.labels.split(",").map((l) => l.trim().toLowerCase()).includes(p.label);
  return true;
}

/* -------------------------------- the pass -------------------------------- */

export interface Report {
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

let running: Promise<Report> | null = null;
export const rebalancing = () => running !== null;

export function lastReport(): Report | null {
  const row = db.select().from(kv).where(eq(kv.key, REPORT_KEY)).get();
  try {
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

export function runRebalance(reason: string): Promise<Report> {
  if (running) return running;
  running = pass(reason).finally(() => {
    running = null;
  });
  return running;
}

/** Maintenance hook: one pass when the policy is on (no-op while a pass runs). */
export function sweepReplication() {
  const p = getPolicy();
  const hasRows = !!db.select({ i: replicas.itemId }).from(replicas).limit(1).get();
  if (!p.enabled && !hasRows) return;
  void runRebalance("schedule").catch((err) => console.error("[replication]", err));
}

async function pass(reason: string): Promise<Report> {
  const started = Date.now();
  const policy = getPolicy();
  const report: Report = { at: started, durationMs: 0, reason, placed: 0, removed: 0, moved: 0, verified: 0, replacedBad: 0, repaired: 0, failed: 0, bytesSent: 0, budgetHit: false, errors: [], nodes: [] };
  const err = (msg: string) => {
    report.failed++;
    if (report.errors.length < 20) report.errors.push(msg.slice(0, 200));
  };
  let budget = policy.maxMbPerRun * 1024 * 1024;

  // 1. node status
  const nodes = db.select().from(clusterNodes).all().filter((n) => n.publicKey && n.status === "linked");
  const free = new Map<string, number>();
  const cap = new Map<string, number>();
  for (const n of nodes) {
    try {
      const m = await call(n, "GET", "/api/cluster-node/manifest", undefined, 10_000);
      const f = Number(m?.storage?.freeBytes ?? 0);
      const quota = Number(m?.storage?.quotaBytes ?? 0);
      free.set(n.id, f);
      // With a quota the node can never have more free than the quota, so that is its capacity.
      cap.set(n.id, quota > 0 ? quota : f + Number(m?.storage?.bytes ?? 0));
      db.update(clusterNodes).set({ lastStatus: "ok", lastSeenAt: Date.now(), lastStorageBytes: Number(m?.storage?.bytes) || 0, lastItemCount: Number(m?.storage?.count) || 0 }).where(eq(clusterNodes.id, n.id)).run();
    } catch (e) {
      err(`${n.name}: unreachable (${String((e as Error)?.message ?? e)})`);
    }
  }
  const reachable = (id: string) => free.has(id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const headroom = (id: string) => (cap.get(id) ?? 0) * (policy.headroomPct / 100);
  const fits = (id: string, size: number) => (free.get(id) ?? 0) - size >= headroom(id);
  // A node that has been gone for a day no longer counts as holding copies.
  const healthyNode = (id: string) => {
    const n = byId.get(id);
    return !!n && (reachable(id) || (n.lastSeenAt ?? 0) > Date.now() - STALE_NODE_MS);
  };

  const removeRemote = async (r: Replica): Promise<boolean> => {
    const node = byId.get(r.nodeId);
    if (!node || !reachable(node.id)) return false;
    try {
      await call(node, "POST", "/api/cluster-node/replica/delete", { ids: [r.remoteId] });
      db.delete(replicas).where(and(eq(replicas.itemId, r.itemId), eq(replicas.nodeId, r.nodeId))).run();
      free.set(node.id, (free.get(node.id) ?? 0) + r.size);
      return true;
    } catch (e) {
      err(`remove from ${node.name}: ${String((e as Error)?.message ?? e)}`);
      return false;
    }
  };

  const place = async (row: Item, node: Node, content: { buf?: Buffer; text?: string }, sha: string): Promise<boolean> => {
    if (row.size > budget) {
      report.budgetHit = true;
      return false;
    }
    try {
      const res = await call(
        node,
        "POST",
        "/api/cluster-node/replica/put",
        {
          originItemId: row.id,
          sha256: sha,
          item: { type: row.type, name: row.name, mime: row.mime, size: row.size, uploadedBy: row.uploadedBy, content: content.text ?? null, fileData: content.buf ? content.buf.toString("base64") : undefined },
        },
        300_000,
      );
      const now = Date.now();
      db.insert(replicas)
        .values({ itemId: row.id, nodeId: node.id, remoteId: String(res?.id ?? ""), size: row.size, sha256: sha, status: "ok", createdAt: now, verifiedAt: now })
        .onConflictDoUpdate({ target: [replicas.itemId, replicas.nodeId], set: { remoteId: String(res?.id ?? ""), size: row.size, sha256: sha, status: "ok", verifiedAt: now, lastError: "" } })
        .run();
      budget -= row.size;
      report.bytesSent += row.size;
      free.set(node.id, (free.get(node.id) ?? 0) - row.size);
      return true;
    } catch (e) {
      err(`place "${row.name}" on ${node.name}: ${String((e as Error)?.message ?? e)}`);
      return false;
    }
  };

  // 2. cleanup
  const allRows = db.select().from(replicas).all();
  const itemIds = [...new Set(allRows.map((r) => r.itemId))];
  const itemMap = new Map<string, Item>();
  for (let i = 0; i < itemIds.length; i += 500) for (const it of db.select().from(items).where(inArray(items.id, itemIds.slice(i, i + 500))).all()) itemMap.set(it.id, it);
  for (const r of allRows) {
    if (!byId.has(r.nodeId)) {
      db.delete(replicas).where(and(eq(replicas.itemId, r.itemId), eq(replicas.nodeId, r.nodeId))).run();
      continue;
    }
    const it = itemMap.get(r.itemId);
    const keep = it && (policy.enabled ? eligible(it, policy) && policy.copies > 0 : !it.deletedAt);
    if (!keep && (await removeRemote(r))) report.removed++;
  }

  if (policy.enabled) {
    // 3. verify
    const verifyBefore = Date.now() - policy.verifyEveryHours * 3600_000;
    const due = db.select().from(replicas).all().filter((r) => r.status === "ok" && (r.verifiedAt ?? 0) < verifyBefore && reachable(r.nodeId));
    const byNode = new Map<string, Replica[]>();
    for (const r of due) (byNode.get(r.nodeId) ?? byNode.set(r.nodeId, []).get(r.nodeId)!).push(r);
    for (const [nodeId, list] of byNode) {
      const node = byId.get(nodeId)!;
      for (let i = 0; i < Math.min(list.length, 200); i += 25) {
        const batch = list.slice(i, i + 25);
        try {
          const res = await call(node, "POST", "/api/cluster-node/replica/check", { ids: batch.map((r) => r.remoteId) }, 120_000);
          const found = new Map<string, any>((Array.isArray(res?.replicas) ? res.replicas : []).map((x: any) => [String(x.id), x]));
          for (const r of batch) {
            const f = found.get(r.remoteId);
            if (f?.exists && f.sha256 === r.sha256) {
              db.update(replicas).set({ verifiedAt: Date.now(), lastError: "" }).where(and(eq(replicas.itemId, r.itemId), eq(replicas.nodeId, r.nodeId))).run();
              report.verified++;
            } else {
              // Missing or altered: forget it here, delete the remote leftovers, re-place below.
              if (f?.exists) await call(node, "POST", "/api/cluster-node/replica/delete", { ids: [r.remoteId] }).catch(() => {});
              db.delete(replicas).where(and(eq(replicas.itemId, r.itemId), eq(replicas.nodeId, r.nodeId))).run();
              report.replacedBad++;
              logEvent({ event: "cluster.replica-bad", ok: false, detail: `Copy of "${itemMap.get(r.itemId)?.name ?? r.itemId}" on ${node.name} was ${f?.exists ? "altered" : "missing"}; it will be placed again`, actor: { name: "replication" }, target: node.name });
            }
          }
        } catch (e) {
          err(`verify on ${node.name}: ${String((e as Error)?.message ?? e)}`);
        }
      }
    }

    const live = db.select().from(items).where(and(isNull(items.deletedAt), isNull(items.replicaOf), isNull(items.clusterOrigin))).all().filter((r) => eligible(r, policy));
    const rowsByItem = new Map<string, Replica[]>();
    for (const r of db.select().from(replicas).all()) (rowsByItem.get(r.itemId) ?? rowsByItem.set(r.itemId, []).get(r.itemId)!).push(r);

    // 4. repair local losses from a healthy copy
    for (const row of live) {
      if (!row.storedName || fs.existsSync(pathForRef(row.storedName))) continue;
      const src = (rowsByItem.get(row.id) ?? []).find((r) => r.status === "ok" && reachable(r.nodeId));
      if (!src) {
        err(`"${row.name}" is missing locally and no reachable copy exists`);
        continue;
      }
      try {
        const res = await call(byId.get(src.nodeId)!, "POST", "/api/cluster-node/replica/get", { id: src.remoteId }, 300_000);
        const buf = typeof res?.fileData === "string" ? Buffer.from(res.fileData, "base64") : null;
        if (!buf || sha256Of({ buf }) !== src.sha256) throw new Error("copy failed its integrity check");
        const { ref } = writeStoredFile(storedFileName(row.name), buf);
        db.update(items).set({ storedName: ref }).where(eq(items.id, row.id)).run();
        row.storedName = ref;
        markUsageDirty();
        report.repaired++;
        logEvent({ event: "cluster.replica-repaired", ok: true, detail: `Restored the missing file of "${row.name}" from ${byId.get(src.nodeId)!.name}`, actor: { name: "replication" }, target: row.name });
      } catch (e) {
        err(`repair "${row.name}": ${String((e as Error)?.message ?? e)}`);
      }
    }

    // 5 + 6. place missing copies, trim extra ones
    for (const row of live) {
      const mine = (rowsByItem.get(row.id) ?? []).filter((r) => r.status === "ok");
      const healthy = mine.filter((r) => healthyNode(r.nodeId));
      if (healthy.length < policy.copies) {
        const have = new Set(mine.map((r) => r.nodeId));
        let content: { buf?: Buffer; text?: string } | null = null;
        let sha = "";
        for (let k = healthy.length; k < policy.copies; k++) {
          const target = nodes.filter((n) => reachable(n.id) && !have.has(n.id) && fits(n.id, row.size)).sort((a, b) => (free.get(b.id) ?? 0) - (free.get(a.id) ?? 0))[0];
          if (!target) break;
          if (!content) {
            content = plainContent(row);
            if (!content) {
              err(`"${row.name}": local file missing`);
              break;
            }
            sha = sha256Of(content);
          }
          if (await place(row, target, content, sha)) {
            report.placed++;
            have.add(target.id);
          } else if (report.budgetHit) break;
        }
      } else if (healthy.length > policy.copies) {
        const extra = healthy.filter((r) => reachable(r.nodeId)).sort((a, b) => (free.get(a.nodeId) ?? 0) - (free.get(b.nodeId) ?? 0));
        for (const r of extra.slice(0, healthy.length - policy.copies)) if (await removeRemote(r)) report.removed++;
      }
      if (report.budgetHit) break;
    }

    // 7. move copies off nodes under pressure
    if (!report.budgetHit) {
      for (const n of nodes) {
        if (!reachable(n.id) || fits(n.id, 0)) continue;
        const held = db.select().from(replicas).where(eq(replicas.nodeId, n.id)).all().sort((a, b) => b.size - a.size);
        for (const r of held) {
          if (fits(n.id, 0) || report.budgetHit) break;
          const row = db.select().from(items).where(eq(items.id, r.itemId)).get();
          if (!row) continue;
          const others = new Set(db.select({ nodeId: replicas.nodeId }).from(replicas).where(eq(replicas.itemId, r.itemId)).all().map((x) => x.nodeId));
          const target = nodes.filter((m) => m.id !== n.id && reachable(m.id) && !others.has(m.id) && fits(m.id, row.size)).sort((a, b) => (free.get(b.id) ?? 0) - (free.get(a.id) ?? 0))[0];
          if (!target) break;
          const content = plainContent(row);
          if (!content) continue;
          if ((await place(row, target, content, sha256Of(content))) && (await removeRemote(r))) report.moved++;
        }
      }
    }
  }

  report.nodes = nodes.map((n) => ({ id: n.id, name: n.name, reachable: reachable(n.id), freeBytes: free.get(n.id) ?? 0, capacityBytes: cap.get(n.id) ?? 0 }));
  report.durationMs = Date.now() - started;
  const value = JSON.stringify(report);
  db.insert(kv).values({ key: REPORT_KEY, value }).onConflictDoUpdate({ target: kv.key, set: { value } }).run();
  if (report.placed || report.removed || report.moved || report.repaired || report.replacedBad) {
    logEvent({ event: "cluster.rebalanced", ok: report.failed === 0, detail: `Replication pass: ${report.placed} placed, ${report.moved} moved, ${report.removed} removed, ${report.repaired} repaired, ${report.replacedBad} replaced`, actor: { name: "replication" }, target: "cluster", meta: { ...report, nodes: undefined } });
    publish({ scope: "settings", action: "replication" });
  }
  if (report.repaired === 0 && report.errors.some((e) => /missing locally and no reachable copy/.test(e))) {
    notifyOwners({ title: "Items lost their files and no copy could be reached", body: report.errors.filter((e) => /missing locally/.test(e)).slice(0, 5).join("\n"), link: "/admin/cluster" });
  }
  return report;
}

/** What the Cluster page shows. */
export function replicationSummary() {
  const policy = getPolicy();
  const nodes = db.select().from(clusterNodes).all();
  const rows = db.select().from(replicas).all();
  const live = db.select().from(items).where(and(isNull(items.deletedAt), isNull(items.replicaOf), isNull(items.clusterOrigin))).all();
  const counts = new Map<string, number>();
  for (const r of rows) if (r.status === "ok") counts.set(r.itemId, (counts.get(r.itemId) ?? 0) + 1);
  let eligibleN = 0;
  let protectedN = 0;
  let under = 0;
  let over = 0;
  let tooLarge = 0;
  for (const it of live) {
    const base = { ...policy, maxItemMb: 1e9 };
    if (!eligible(it, base)) continue;
    if (it.size > Math.min(policy.maxItemMb * 1024 * 1024, TRANSFER_MAX)) {
      tooLarge++;
      continue;
    }
    eligibleN++;
    const n = counts.get(it.id) ?? 0;
    if (n >= policy.copies) protectedN++;
    if (n < policy.copies) under++;
    if (n > policy.copies) over++;
  }
  return {
    policy,
    running: rebalancing(),
    report: lastReport(),
    summary: { eligible: eligibleN, protected: protectedN, under, over, tooLarge, maxCopies: nodes.length },
    nodes: nodes.map((n) => {
      const mine = rows.filter((r) => r.nodeId === n.id);
      return { id: n.id, name: n.name, replicas: mine.length, bytes: mine.reduce((a, r) => a + r.size, 0), lastSeenAt: n.lastSeenAt, status: n.lastStatus };
    }),
  };
}

/* ------------------------------- peer side -------------------------------- */

/** Store (or refresh) a copy that `nodeId` asked us to keep. */
export async function storeReplica(nodeId: string, payload: any): Promise<{ id: string } | { error: string; status: number }> {
  const originItemId = String(payload?.originItemId ?? "");
  const sha = String(payload?.sha256 ?? "");
  const it = payload?.item;
  if (!/^[0-9a-f-]{36}$/i.test(originItemId) || !/^[0-9a-f]{64}$/.test(sha) || !it) return { error: "Invalid replica payload.", status: 400 };
  const type = String(it.type ?? "");
  if (!["file", "image", "text", "url"].includes(type)) return { error: "Invalid item type.", status: 400 };
  const buf = typeof it.fileData === "string" ? Buffer.from(it.fileData, "base64") : undefined;
  const text = typeof it.content === "string" ? it.content : undefined;
  if (buf && buf.byteLength > TRANSFER_MAX) return { error: "Too large.", status: 413 };
  if ((type === "file" || type === "image") && !buf) return { error: "File data missing.", status: 400 };
  if (sha256Of({ buf, text }) !== sha) return { error: "Content does not match its hash.", status: 400 };
  const existing = db.select().from(items).where(and(eq(items.clusterOrigin, nodeId), eq(items.replicaOf, originItemId))).get();
  if (existing) {
    const c = plainContent(existing);
    if (c && sha256Of(c) === sha) return { id: existing.id };
    removeReplicaRow(existing);
  }
  if (availableBytes() < (buf?.byteLength ?? 64)) return { error: "Insufficient storage on this node.", status: 507 };
  let storedRef: string | null = null;
  if (buf) storedRef = writeStoredFile(storedFileName(String(it.name ?? "replica")), buf).ref;
  const id = crypto.randomUUID();
  db.insert(items)
    .values({
      id,
      type,
      name: String(it.name ?? "replica").slice(0, 200),
      mime: String(it.mime ?? "application/octet-stream").slice(0, 100),
      size: buf?.byteLength ?? Buffer.byteLength(text ?? ""),
      storedName: storedRef,
      thumbName: null,
      content: buf ? null : encryptString(text ?? ""),
      uploadedBy: `${String(it.uploadedBy ?? "peer").slice(0, 60)} (replica)`,
      userId: null,
      clusterOrigin: nodeId,
      replicaOf: originItemId,
      audience: "private",
      audienceUsers: "",
      writeAccess: "private",
      writeUsers: "",
      deleteAccess: "private",
      deleteUsers: "",
      pinned: 0,
      downloads: 0,
      createdAt: Date.now(),
      expiresAt: null,
    })
    .run();
  markUsageDirty();
  return { id };
}

function removeReplicaRow(row: Item) {
  if (row.storedName) deleteStoredFile(row.storedName);
  deleteThumb(row.thumbName);
  db.delete(items).where(eq(items.id, row.id)).run();
}

function heldFor(nodeId: string, ids: unknown): Item[] {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100);
  if (!list.length) return [];
  return db.select().from(items).where(and(inArray(items.id, list), eq(items.clusterOrigin, nodeId), isNotNull(items.replicaOf))).all();
}

export function checkReplicas(nodeId: string, ids: unknown) {
  const held = new Map(heldFor(nodeId, ids).map((r) => [r.id, r]));
  return (Array.isArray(ids) ? ids : []).slice(0, 100).map((raw) => {
    const id = String(raw);
    const row = held.get(id);
    if (!row) return { id, exists: false };
    const c = plainContent(row);
    return c ? { id, exists: true, size: row.size, sha256: sha256Of(c) } : { id, exists: false };
  });
}

export function deleteReplicas(nodeId: string, ids: unknown) {
  const rows = heldFor(nodeId, ids);
  for (const r of rows) removeReplicaRow(r);
  if (rows.length) markUsageDirty();
  return rows.length;
}

export function getReplica(nodeId: string, id: unknown) {
  const row = heldFor(nodeId, [id])[0];
  if (!row) return null;
  const c = plainContent(row);
  if (!c) return null;
  return { fileData: c.buf?.toString("base64"), content: c.text ?? null };
}
