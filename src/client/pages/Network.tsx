import { useCallback, useEffect, useState } from "react";
import { api, humanSize, timeAgo } from "../api";
import { useAuth } from "../App";
import { Icon } from "../icons";
import { Badge, Btn, Card, Empty, Input, PageHeader, Spinner, useToast } from "../ui";

/** Network overview: cluster identity, peers, pooled storage + system config (owner). */
export default function Network() {
  const { user } = useAuth();
  const { push } = useToast();
  const isOwner = user?.role === "owner";
  const [data, setData] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api
      .overview()
      .then(setData)
      .catch((e) => push("err", e.message ?? "Failed to load overview"));
    if (isOwner) {
      api.config().then((r) => setConfig(r.config)).catch(() => {});
    }
  }, [isOwner, push]);

  useEffect(load, [load]);

  const saveConfig = async (patch: any) => {
    setSaving(true);
    try {
      const r = await api.saveConfig(patch);
      setConfig(r.config);
      push("ok", "Saved - restart FYRDrop to apply network changes");
    } catch (e: any) {
      push("err", e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={26} />
      </div>
    );
  }

  const nodes = data.nodes ?? [];
  const storage = data.storage ?? {};
  const stats = data.stats ?? {};

  return (
    <div className="anim-page">
      <PageHeader
        title="Network"
        subtitle="This instance, its cluster peers, pooled storage and live statistics."
        actions={<Badge tone="info">{user?.role ?? "user"}</Badge>}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Pooled storage</div>
          <div className="mt-1 text-xl font-semibold text-white">{humanSize(storage.pooledBytes ?? 0)}</div>
          <div className="text-[11px] text-slate-500">{humanSize(storage.localBytes ?? 0)} on this node</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Items</div>
          <div className="mt-1 text-xl font-semibold text-white">{stats.items ?? 0}</div>
          <div className="text-[11px] text-slate-500">{stats.downloads ?? 0} downloads</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Devices / users</div>
          <div className="mt-1 text-xl font-semibold text-white">
            {stats.devices ?? 0} / {stats.users ?? 0}
          </div>
          <div className="text-[11px] text-slate-500">{nodes.length} peer node(s)</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Free space</div>
          <div className="mt-1 text-xl font-semibold text-white">{humanSize(storage.availableBytes ?? 0)}</div>
          <div className="text-[11px] text-slate-500">{stats.activeShares ?? 0} active share links</div>
        </Card>
      </div>

      <Card className="mb-5 p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Icon name="logo" size={16} className="text-indigo-300" /> This instance
        </div>
        <div className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
          <Field label="Name" value={data.identity?.name} />
          <Field label="Node ID" value={data.identity?.shortId} mono />
          <Field label="Key fingerprint" value={data.identity?.fingerprint} mono />
        </div>
      </Card>

      <Card className="mb-5 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Icon name="globe" size={16} className="text-indigo-300" /> Cluster peers
          </div>
          <Badge tone="info">{nodes.length}</Badge>
        </div>
        {nodes.length === 0 ? (
          <Empty icon="globe" title="No peer nodes" hint={isOwner ? "Link another FYRDrop in Admin → Cluster." : "Ask the owner to link another FYRDrop instance."} />
        ) : (
          <div className="space-y-2">
            {nodes.map((n: any) => (
              <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#232a3a] bg-[#12161f] px-3 py-2 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon name="monitor" size={14} className="text-slate-500" />
                  <span className="text-slate-200">{n.name}</span>
                  <span className="mono truncate text-[10px] text-slate-500">{n.baseUrl}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <span>{n.items} items</span>
                  <span>· {humanSize(n.bytes)}</span>
                  <Badge tone={n.status === "ok" ? "ok" : n.status === "joined" ? "info" : "warn"}>{n.status}</Badge>
                  <span className="text-[10px] text-slate-500">{n.lastSeenAt ? timeAgo(n.lastSeenAt) : "never"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {isOwner && config && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Icon name="settings" size={16} className="text-indigo-300" /> System configuration
            </div>
            <Badge tone="warn">restart required</Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Network mode</div>
              <div className="flex gap-1.5">
                {(["auto", "off", "custom"] as const).map((m) => (
                  <Btn key={m} size="sm" variant={config.networkMode === m ? "primary" : "soft"} disabled={saving} onClick={() => void saveConfig({ networkMode: m })}>
                    {m}
                  </Btn>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-slate-500">auto = self-signed HTTPS · off = HTTP behind proxy</p>
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Port</div>
              <Input type="number" value={config.port} onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })} className="py-1.5 text-xs" />
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">TLS common name</div>
              <Input value={config.tlsCommonName} onChange={(e) => setConfig({ ...config, tlsCommonName: e.target.value })} className="py-1.5 text-xs" />
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Session TTL (days)</div>
              <Input type="number" value={config.sessionTtlDays} onChange={(e) => setConfig({ ...config, sessionTtlDays: Number(e.target.value) })} className="py-1.5 text-xs" />
            </div>
            <div className="flex items-end">
              <Btn size="sm" onClick={() => void saveConfig({ port: config.port, tlsCommonName: config.tlsCommonName, sessionTtlDays: config.sessionTtlDays, trustProxy: config.trustProxy, showPinInLogs: config.showPinInLogs })} disabled={saving}>
                <Icon name="check" size={14} /> Save config
              </Btn>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">These values are stored in <span className="mono">data/config.json</span> and applied on next start. Environment variables override them.</p>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`truncate text-slate-200 ${mono ? "mono" : ""}`}>{value ?? "-"}</div>
    </div>
  );
}
