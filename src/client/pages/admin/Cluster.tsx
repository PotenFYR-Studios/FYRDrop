import { useCallback, useEffect, useState } from "react";
import { api, humanSize, timeAgo, type ClusterDiscovered, type ClusterOverview } from "../../api";
import { Badge, Btn, Card, Empty, Input, Label, PageHeader, Spinner, StatCard, useToast } from "../../ui";
import { Icon } from "../../icons";
import ReplicationCard from "../../components/ReplicationCard";

export default function Cluster() {
  const { push } = useToast();
  const [data, setData] = useState<ClusterOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.cluster());
    } catch (e: any) {
      push("err", e?.message ?? "Could not load the cluster");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<any>, ok?: string) => {
    setBusy(key);
    try {
      const res = await fn();
      if (ok) push("ok", ok);
      await load();
      return res;
    } catch (e: any) {
      push("err", e?.message ?? "That did not work");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const request = async (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    await run(`request:${trimmed}`, () => api.clusterRequest(trimmed), "Request sent. The other admin has to approve it.");
    setManualUrl("");
  };

  const unlink = async (id: string, name: string) => {
    if (!window.confirm(`Unlink "${name}"?\n\nItems it stored for you are reclaimed first, then the link key is destroyed on both sides.`)) return;
    const res = await run(`unlink:${id}`, () => api.clusterLeave(id), `Unlinked ${name}`);
    if (res === null && window.confirm("Reclaim failed. Unlink anyway and discard what could not be reclaimed?")) {
      await run(`unlink:${id}`, () => api.clusterLeave(id, true), `Unlinked ${name}`);
    }
  };

  const scan = async () => {
    setScanning(true);
    try {
      const res = await api.clusterScan();
      push(res.found.length ? "ok" : "info", res.found.length ? `Found ${res.found.length} instance(s)` : "No other instance answered");
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={26} />
      </div>
    );
  }

  const { identity, nodes, pending, discovered, aggregate } = data;
  const linkedIds = new Set(nodes.map((n) => n.id));
  const fresh = discovered.filter((d) => !linkedIds.has(d.nodeId));

  return (
    <div className="anim-page">
      <PageHeader
        title="Cluster"
        subtitle="Link another FYRDrop instance. Both admins approve, and everything after that is sealed with a key that never crosses the network."
        actions={
          <Badge tone="ok">
            <Icon name="shieldCheck" size={11} /> encrypted transport
          </Badge>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Instances" value={aggregate.nodes} sub="including this one" icon="globe" />
        <StatCard label="Linked" value={nodes.length} sub="mutual approval" icon="link" />
        <StatCard label="Pooled items" value={aggregate.itemCount} sub="this instance and peers" icon="folder" />
        <StatCard label="Pooled storage" value={humanSize(aggregate.storageBytes)} sub="disk used across instances" icon="database" />
      </div>

      {pending.incoming.length > 0 && (
        <Card className="mb-4 border-amber-500/30 p-0">
          <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5">
            <Icon name="alert" size={15} className="text-amber-300" />
            <span className="text-sm font-medium text-amber-100">Waiting for your approval</span>
            <Badge tone="warn">{pending.incoming.length}</Badge>
          </div>
          <div className="divide-y divide-[#161c28]">
            {pending.incoming.map((p) => (
              <div key={p.nodeId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-100">{p.name} wants to link</div>
                  <div className="mono mt-0.5 text-[11px] text-slate-500">
                    {p.url} · from {p.ip} · {timeAgo(p.createdAt)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Btn size="sm" variant="soft" disabled={busy === `in:${p.nodeId}`} onClick={() => void run(`in:${p.nodeId}`, () => api.clusterRejectIncoming(p.nodeId), "Request rejected")}>
                    Reject
                  </Btn>
                  <Btn size="sm" disabled={busy === `in:${p.nodeId}`} onClick={() => void run(`in:${p.nodeId}`, () => api.clusterApproveIncoming(p.nodeId), "Approved. The other admin has to approve as well.")}>
                    {busy === `in:${p.nodeId}` ? <Spinner size={13} /> : <Icon name="check" size={13} />} Approve
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {pending.outgoing.length > 0 && (
        <Card className="mb-4 p-0">
          <div className="flex items-center gap-2 border-b border-[#1c2334] bg-white/[0.02] px-4 py-2.5">
            <Icon name="clock" size={15} className="text-indigo-300" />
            <span className="text-sm font-medium text-slate-200">Your requests</span>
          </div>
          <div className="divide-y divide-[#161c28]">
            {pending.outgoing.map((p) => (
              <div key={p.nodeId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-100">{p.name}</div>
                  <div className="mono mt-0.5 text-[11px] text-slate-500">
                    {p.url} ·{" "}
                    {p.stage === "confirmed" ? (
                      <span className="text-emerald-300">the other admin approved - finish it</span>
                    ) : (
                      "waiting for the other admin"
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Btn size="sm" variant="soft" onClick={() => void run(`out:${p.nodeId}`, () => api.clusterRejectOutgoing(p.nodeId), "Request cancelled")}>
                    Cancel
                  </Btn>
                  <Btn size="sm" disabled={p.stage !== "confirmed" || busy === `out:${p.nodeId}`} onClick={() => void run(`out:${p.nodeId}`, () => api.clusterApproveOutgoing(p.nodeId), "Linked")}>
                    {busy === `out:${p.nodeId}` ? <Spinner size={13} /> : <Icon name="check" size={13} />} Approve and link
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-200">
            <Icon name="globe" size={15} className="text-indigo-300" /> Found on your network
            <span className="ml-auto text-[11px] text-slate-500">{fresh.length} available</span>
          </h3>
          {fresh.length === 0 ? (
            <p className="text-xs text-slate-500">
              Nothing new right now. Instances announce themselves every 20 seconds; use Scan to probe the local subnet as well.
            </p>
          ) : (
            <div className="space-y-2">
              {fresh.map((d) => (
                <DiscoveredRow key={d.nodeId} node={d} busy={busy === `request:${d.url}`} onConnect={() => void request(d.url)} />
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Btn size="sm" variant="soft" onClick={() => void scan()} disabled={scanning}>
              {scanning ? <Spinner size={13} /> : <Icon name="refresh" size={13} />} Scan network
            </Btn>
          </div>
          <div className="mt-4 border-t border-[#1c2334] pt-3">
            <Label>Link by address</Label>
            <div className="flex gap-2">
              <Input value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="http://192.168.1.20:3000" onKeyDown={(e) => e.key === "Enter" && void request(manualUrl)} />
              <Btn size="sm" disabled={!manualUrl.trim() || busy === `request:${manualUrl.trim()}`} onClick={() => void request(manualUrl)}>
                <Icon name="link" size={13} /> Request
              </Btn>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">The other admin sees your request and has to approve it before anything is shared.</p>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-200">
            <Icon name="shieldCheck" size={15} className="text-emerald-300" /> This instance
          </h3>
          <dl className="space-y-2 text-xs">
            <Row label="Name" value={identity.name} />
            <Row label="URL" value={identity.url} mono />
            <Row label="Node id" value={identity.nodeId} mono />
            <div>
              <dt className="text-slate-500">Key fingerprint</dt>
              <dd className="mono mt-0.5 break-all text-[11px] text-slate-300">{identity.fingerprint}</dd>
            </div>
            <Row label="Transport" value="AES-256-GCM payloads, X25519 key exchange" />
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Both admins approve a link and both see the same pair fingerprint. Compare it out of band if you want to rule out a
            man in the middle. Payloads are sealed, so a plain HTTP connection does not expose file contents or metadata bodies.
            TLS is still the better default for browser trust and for hiding that the traffic exists at all.
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-[#1c2334] bg-white/[0.02] px-4 py-2.5">
          <Icon name="link" size={15} className="text-slate-300" />
          <span className="text-sm font-medium text-slate-200">Linked instances</span>
          <Badge tone="info">{nodes.length}</Badge>
          <Btn size="sm" variant="ghost" className="ml-auto" onClick={() => void run("refresh", () => api.clusterRefresh(), "Peers refreshed")}>
            <Icon name="refresh" size={13} /> Refresh
          </Btn>
        </div>
        {nodes.length === 0 ? (
          <div className="p-4">
            <Empty icon="globe" title="No instances linked" hint="Find one above, send a request, and approve it on both sides." />
          </div>
        ) : (
          <div className="divide-y divide-[#161c28]">
            {nodes.map((n) => (
              <div key={n.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#2a3247] bg-white/[0.03] text-slate-300">
                  <Icon name="globe" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-white">{n.name}</span>
                    <Badge tone={n.needsRepair ? "warn" : n.lastStatus === "ok" ? "ok" : "info"}>
                      {n.needsRepair ? "needs re-pair" : n.lastStatus}
                    </Badge>
                  </div>
                  <div className="mono mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                    <span>{n.baseUrl}</span>
                    <span>·</span>
                    <span>{n.fingerprint || "fingerprint pending"}</span>
                    {n.lastSeenAt && (
                      <>
                        <span>·</span>
                        <span>seen {timeAgo(n.lastSeenAt)}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{n.lastItemCount} items</span>
                    <span>·</span>
                    <span>{humanSize(n.lastStorageBytes)}</span>
                    <span>·</span>
                    <span title="Instance PIN of this peer (shared over the sealed link)">
                      PIN <span className="mono text-amber-300">{n.pin || "not shared"}</span>
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Btn
                    size="sm"
                    variant="soft"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(n.fingerprint)
                        .then(() => push("ok", "Fingerprint copied"))
                        .catch(() => push("err", "Clipboard blocked"))
                    }
                    title="Copy the pair fingerprint so both admins can compare it"
                  >
                    <Icon name="copy" size={13} /> Copy fingerprint
                  </Btn>
                  <Btn size="sm" variant="ghost" className="text-red-300/80 hover:bg-red-500/10 hover:text-red-200" onClick={() => void unlink(n.id, n.name)} disabled={busy === `unlink:${n.id}`}>
                    <Icon name="power" size={13} /> Unlink
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ReplicationCard nodeCount={nodes.filter((n) => !n.needsRepair).length} />

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        Unlinking asks the peer to hand back everything it stored for you, deletes those copies, then destroys the link key on both
        sides. If the peer is unreachable you can force the unlink; the key is still destroyed locally and the peer drops the link
        when it next sees the missing key. Discovery uses multicast inside the Docker network, so bridge containers find each other
        but not instances on the LAN; use host networking or link by address for those.
      </p>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`mt-0.5 break-all ${mono ? "mono text-[11px]" : ""} text-slate-300`}>{value}</dd>
    </div>
  );
}

function DiscoveredRow({ node, busy, onConnect }: { node: ClusterDiscovered; busy: boolean; onConnect: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#232a3a] bg-[#12161f] px-3 py-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#2a3247] bg-white/[0.03] text-indigo-300">
        <Icon name="globe" size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-slate-200">{node.name}</div>
        <div className="mono truncate text-[11px] text-slate-500">
          {node.url} · {node.ip} · {node.source === "scan" ? "scan" : "beacon"} · {timeAgo(node.seenAt)}
        </div>
      </div>
      <Btn size="sm" onClick={onConnect} disabled={busy}>
        {busy ? <Spinner size={12} /> : <Icon name="link" size={12} />} Connect
      </Btn>
    </div>
  );
}
