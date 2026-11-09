import { useCallback, useEffect, useState } from "react";
import { api, humanSize } from "../../api";
import { Icon, type IconName } from "../../icons";
import { Badge, Btn, Card, Donut, Empty, Input, Modal, PageHeader, useToast, useSync } from "../../ui";

type Usage = { bytes: number; count: number };
type Orphan = { dir: string; name: string; bytes: number };
type StorageInfo = {
  db: Usage & { path: string };
  files: Usage;
  thumbs: Usage;
  certs: Usage;
  orphans: Orphan[];
  orphansBytes: number;
  cluster: {
    nodes: { id: string; name: string; baseUrl: string; bytes: number; items: number; lastSeenAt: number | null; status: string }[];
    pooledBytes: number;
  };
};

/** Admin storage: on-disk breakdown, orphaned files and one-click cleanup. */
export default function Storage() {
  const { push } = useToast();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .storage()
      .then(setInfo)
      .catch((e) => push("err", e.message ?? "Failed to load storage info"));
  }, [push]);

  useEffect(reload, [reload]);
  useSync(reload);

  const cleanup = async (mode: "expired" | "orphans" | "all", label: string) => {
    const msg =
      mode === "expired"
        ? "Purge every expired item and its files?"
        : mode === "orphans"
          ? `Delete ${info?.orphans.length ?? 0} orphaned file(s) (${humanSize(info?.orphansBytes ?? 0)})?`
          : "Full cleanup: purge expired items AND delete orphaned files?";
    if (!window.confirm(msg)) return;
    setBusy(mode);
    try {
      const res = await api.cleanup(mode);
      push(
        "ok",
        `${label}: ${res.expiredRemoved ?? 0} expired removed, ${res.orphansRemoved ?? 0} orphans removed, ${humanSize(res.bytesFreed ?? 0)} freed`,
      );
      reload();
    } catch (e: any) {
      push("err", e.message ?? "Cleanup failed");
    } finally {
      setBusy(null);
    }
  };

  if (!info) return <div className="py-16 text-center text-sm text-slate-500">Scanning storage…</div>;

  const breakdown: { label: string; value: number; color: string; count: number; sub: string; icon: IconName }[] = [
    { label: "Database", value: info.db.bytes, color: "#6366f1", count: 1, sub: info.db.path, icon: "database" },
    { label: "Files", value: info.files.bytes, color: "#22d3ee", count: info.files.count, sub: `${info.files.count} file(s)`, icon: "file" },
    { label: "Thumbnails", value: info.thumbs.bytes, color: "#34d399", count: info.thumbs.count, sub: `${info.thumbs.count} thumb(s)`, icon: "image" },
    { label: "Certificates", value: info.certs.bytes, color: "#fbbf24", count: info.certs.count, sub: `${info.certs.count} cert file(s)`, icon: "key" },
  ];
  const totalBytes = breakdown.reduce((s, b) => s + b.value, 0);

  return (
    <div>
      <PageHeader
        title="Storage"
        subtitle={`${humanSize(totalBytes)} on disk${info.orphans.length ? ` · ${info.orphans.length} orphaned file(s)` : ""}`}
        actions={
          <div className="flex gap-2">
            <Btn size="sm" variant="soft" onClick={() => void cleanup("expired", "Purge expired")} disabled={busy !== null}>
              {busy === "expired" ? (
                "Purging…"
              ) : (
                <>
                  <Icon name="trash" size={14} /> Purge expired
                </>
              )}
            </Btn>
            <Btn size="sm" variant="soft" onClick={() => void cleanup("orphans", "Delete orphans")} disabled={busy !== null || info.orphans.length === 0}>
              {busy === "orphans" ? (
                "Deleting…"
              ) : (
                <>
                  <Icon name="trash" size={14} /> Delete orphans
                </>
              )}
            </Btn>
            <Btn size="sm" variant="danger" onClick={() => void cleanup("all", "Full cleanup")} disabled={busy !== null}>
              {busy === "all" ? (
                "Cleaning…"
              ) : (
                <>
                  <Icon name="refresh" size={14} /> Full cleanup
                </>
              )}
            </Btn>
          </div>
        }
      />

      <div className="mb-6 grid gap-5 lg:grid-cols-[360px_1fr]">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">This node</h2>
          <Donut segments={breakdown.map((b) => ({ label: b.label, value: b.value, color: b.color }))} />
          <div className="mt-4 space-y-2 border-t border-[#1c2334] pt-4 text-xs">
            {breakdown.map((b) => (
              <div key={b.label} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
                  <Icon name={b.icon} size={13} className="text-slate-500" />
                  <span className="text-slate-300">{b.label}</span>
                </span>
                <span className="text-right text-slate-400">
                  {humanSize(b.value)} <span className="text-slate-500">· {b.sub}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Cluster storage</h2>
            <Badge tone="info">pooled {humanSize(info.cluster?.pooledBytes ?? totalBytes)}</Badge>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-3 py-2">
              <span className="flex items-center gap-2 text-slate-200">
                <Icon name="monitor" size={14} className="text-indigo-300" /> This node
              </span>
              <span className="text-slate-400">{humanSize(totalBytes)}</span>
            </div>
            {(info.cluster?.nodes ?? []).length === 0 && (
              <p className="px-1 py-2 text-slate-500">
                No peer nodes yet. Link another FYRDrop in <span className="text-slate-300">Admin → Cluster</span> to pool storage across instances.
              </p>
            )}
            {(info.cluster?.nodes ?? []).map((n) => (
              <div key={n.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#232a3a] px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-slate-200">
                  <Icon name="globe" size={14} className="shrink-0 text-slate-500" />
                  <span className="truncate">{n.name}</span>
                  <span className="truncate text-[10px] text-slate-500">{new URL(n.baseUrl).host}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-slate-400">
                  <span className="text-[10px] text-slate-500">{n.items} items</span>
                  {humanSize(n.bytes)}
                  <Badge tone={n.status === "ok" ? "ok" : n.status === "joined" ? "info" : "warn"}>{n.status}</Badge>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Pooled storage is the sum of this node's disk usage and each peer's last reported manifest - refresh a node in Admin → Cluster to update it.
          </p>
        </Card>
      </div>

      <Card className="mb-5 p-5">
        <UnitsPanel />
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">Orphaned files</h2>
          {info.orphans.length > 0 && <Badge tone="warn">{humanSize(info.orphansBytes)} reclaimable</Badge>}
        </div>
        {info.orphans.length === 0 ? (
          <Empty icon="check" title="No orphans" hint="Every file on disk belongs to an item." />
        ) : (
          <ul className="divide-y divide-[#1c2334]">
            {info.orphans.map((o) => (
              <li key={`${o.dir}/${o.name}`} className="flex items-center justify-between gap-3 py-2.5 text-xs first:pt-0 last:pb-0">
                <span className="flex min-w-0 items-center gap-2 text-slate-500">
                  <Icon name="file" size={13} className="shrink-0" />
                  <span className="truncate font-mono text-slate-300" title={o.name}>
                    {o.name}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <Badge tone="default">
                    <Icon name="folder" size={11} />
                    {o.dir}
                  </Badge>
                  <span className="text-slate-400">{humanSize(o.bytes)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function UnitsPanel() {
  const { push } = useToast();
  const [units, setUnits] = useState<any[]>([]);
  const [quotaMb, setQuotaMb] = useState(0);
  const [available, setAvailable] = useState(0);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState("");
  const [browse, setBrowse] = useState<any>(null);
  const [browseBusy, setBrowseBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.units().then((r) => { setUnits(r.units); setQuotaMb(r.quotaMb); setAvailable(r.availableBytes); }).catch(() => {});
  }, []);

  useEffect(load, [load]);

  const navigate = async (p?: string) => {
    setBrowseBusy(true);
    try {
      const r = await api.browse(p);
      setBrowse(r);
      if (r.path) setPicked(r.path);
    } catch (e: any) {
      push("err", e.message ?? "Cannot read that folder");
    } finally {
      setBrowseBusy(false);
    }
  };

  const openPicker = () => { setOpen(true); if (!browse) void navigate(""); };

  const addUnit = async () => {
    if (!name.trim() || !picked.trim()) { push("err", "Give the unit a name and pick a folder"); return; }
    setSaving(true);
    try {
      await api.addUnit(name.trim(), picked.trim());
      push("ok", "Storage unit added");
      setOpen(false); setName(""); setBrowse(null); setPicked(""); load();
    } catch (e: any) {
      push("err", e.message ?? "Could not add the unit");
    } finally { setSaving(false); }
  };

  const saveQuota = async () => {
    try {
      await api.saveSettings({ storageQuotaMb: Number(quotaMb) || 0 });
      push("ok", quotaMb > 0 ? "Quota set to " + quotaMb + " MB" : "Quota removed (unlimited)");
      load();
    } catch (e: any) { push("err", e.message ?? "Could not save quota"); }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Icon name="drive" size={16} className="text-indigo-300" /> Storage units
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="info">{humanSize(available)} available</Badge>
          <Btn size="sm" onClick={openPicker}><Icon name="plus" size={14} /> Add unit</Btn>
        </div>
      </div>
      <div className="space-y-2">
        {units.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#232a3a] bg-[#12161f] px-3 py-2 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <Icon name={u.id === "primary" ? "database" : "drive"} size={14} className="text-slate-500" />
              <span className="text-slate-200">{u.name}</span>
              <Badge tone={u.id === "primary" ? "info" : "default"}>{u.id === "primary" ? "primary" : "extra"}</Badge>
              <span className="mono truncate text-[10px] text-slate-500" title={u.path}>{u.path}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">{humanSize(u.bytes)} used</span>
              <span className="text-slate-500">· {humanSize(u.freeBytes)} free</span>
              {u.exists === false && <Badge tone="bad">offline</Badge>}
              {u.id !== "primary" && (
                <Btn size="sm" variant="ghost" onClick={async () => {
                  if (!confirm("Remove storage unit " + u.name + "? It must be empty.")) return;
                  try { await api.removeUnit(u.id); push("ok", "Unit removed"); load(); }
                  catch (e: any) { push("err", e.message ?? "Remove failed"); }
                }}><Icon name="trash" size={13} /></Btn>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-[#1c2334] pt-4">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Instance quota (MB, 0 = unlimited)</div>
          <Input type="number" min={0} value={quotaMb} onChange={(e) => setQuotaMb(Number(e.target.value))} className="w-40 py-1.5 text-xs" />
        </div>
        <Btn size="sm" variant="soft" onClick={() => void saveQuota()}><Icon name="check" size={14} /> Save quota</Btn>
        <p className="text-[11px] text-slate-500">Quota gates uploads and cluster pushes; free space is reported to peer nodes.</p>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a storage unit" wide>
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Unit name</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Media drive" maxLength={60} />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Folder on this host</span>
              {browse?.freeBytes > 0 && <span className="text-[11px] text-slate-500">{humanSize(browse.freeBytes)} free here</span>}
            </div>
            <div className="rounded-xl border border-[#2a3247] bg-[#0f131b]">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-[#232a3a] px-2.5 py-2 text-[11px]">
                <Btn size="sm" variant="ghost" disabled={!browse || browseBusy} onClick={() => void navigate(browse?.parent ?? "")}>
                  <Icon name="arrowLeft" size={13} /> Up
                </Btn>
                <span className="mono truncate text-slate-400">{browse?.path || "Select a drive"}</span>
              </div>
              <div className="max-h-56 overflow-y-auto p-1.5">
                {browseBusy && <div className="p-2 text-xs text-slate-500">Reading…</div>}
                {(browse?.entries ?? []).map((e: any) => (
                  <button key={e.path} onClick={() => void navigate(e.path)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-300 transition hover:bg-white/5">
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon name="folder" size={14} className="shrink-0 text-indigo-300/80" />
                      <span className="truncate">{e.name}</span>
                    </span>
                    {e.writable === false && <Badge tone="warn">read-only</Badge>}
                  </button>
                ))}
                {browse && (browse.entries ?? []).length === 0 && <div className="p-2 text-xs text-slate-500">No subfolders.</div>}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input value={picked} onChange={(e) => setPicked(e.target.value)} placeholder="Or type an absolute path" className="mono flex-1 py-1.5 text-xs" />
              <Btn size="sm" variant="soft" onClick={() => void navigate(picked || "")}><Icon name="arrowRight" size={13} /> Go</Btn>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn onClick={() => void addUnit()} disabled={saving || !name.trim() || !picked.trim()}>
              {saving ? "Adding…" : "Add unit"}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
