import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api, humanSize, isHttpUrl, runLimited, uploadFile, type GroupSummary, type Item, type RemoteItem } from "../api";
import { Badge, Btn, Card, Empty, ItemMeta, PageHeader, Progress, Spinner, useSync, useToast } from "../ui";
import { Icon, mimeIcon } from "../icons";
import ShareWizard from "./ShareWizard";
import { AccessChips, AccessDialog, PreviewModal, UploadAccessDialog, type AccessState, toPayload } from "../components/Access";

type UploadJob = { id: string; name: string; pct: number };
type Tab = "all" | "file" | "image";

export default function Files() {
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [remoteItems, setRemoteItems] = useState<RemoteItem[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [expiresDays, setExpiresDays] = useState(0);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const [shareItem, setShareItem] = useState<Item | null>(null);
  const [preview, setPreview] = useState<Item | null>(null);
  const [accessItem, setAccessItem] = useState<Item | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupId, setGroupId] = useState("");
  const [category, setCategory] = useState("");
  const [labels, setLabels] = useState("");
  const [params] = useSearchParams();
  const groupFilter = params.get("group") ?? "";
  const inputRef = useRef<HTMLInputElement>(null);
  const jobsRef = useRef(new Map<string, AbortController>());

  // Leaving the page cancels anything still in flight instead of letting it
  // complete invisibly.
  useEffect(
    () => () => {
      for (const c of jobsRef.current.values()) c.abort();
      jobsRef.current.clear();
    },
    [],
  );

  const reload = useCallback(async () => {
    try {
      const [files, imgs] = await Promise.all([api.items("file"), api.items("image")]);
      const all = [...files.items, ...imgs.items].sort((a, b) => b.createdAt - a.createdAt);
      setItems(all);
    } catch (e: any) {
      push("err", e.message ?? "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useSync(() => void reload());

  // Paste files/images straight into the page (Ctrl+V), not just drag & drop.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        setPending(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const visible = items.filter((i) => {
    if (tab !== "all" && i.type !== tab) return false;
    if (groupFilter && i.groupId !== groupFilter) return false;
    return true;
  });

  useEffect(() => {
    api
      .groups()
      .then((r) => setGroups(r.groups))
      .catch(() => {});
    api
      .remoteItems()
      .then((r) => setRemoteItems(r.items))
      .catch(() => {});
  }, []);

  const runUpload = async (files: File[], access: AccessState) => {
    if (files.length === 0) return;
    const payload = toPayload(access);
    let failed = 0;
    // Two at a time keeps memory and the uplink sane on phones / small servers.
    await runLimited(files, 2, async (file) => {
      const job: UploadJob = { id: `${file.name}-${file.size}-${Math.random()}`, name: file.name, pct: 0 };
      const controller = new AbortController();
      jobsRef.current.set(job.id, controller);
      setJobs((j) => [...j, job]);
      try {
        await uploadFile(file, {
          expiresDays,
          access: payload,
          groupId: groupId || undefined,
          category: category.trim() || undefined,
          labels: labels.trim() || undefined,
          signal: controller.signal,
          onProgress: (pct) => setJobs((j) => j.map((x) => (x.id === job.id ? { ...x, pct } : x))),
        });
      } catch (e: any) {
        failed++;
        if (e?.name === "AbortError") push("info", `${file.name}: cancelled`);
        else push("err", `${file.name}: ${e.message ?? "upload failed"}`);
      } finally {
        jobsRef.current.delete(job.id);
        setJobs((j) => j.filter((x) => x.id !== job.id));
      }
    });
    if (failed === 0) push("ok", files.length === 1 ? "Upload complete" : `${files.length} files uploaded`);
    else if (failed < files.length) push("info", "Upload finished with errors");
    void reload();
  };

  const replicate = async (it: Item) => {
    try {
      const r = await api.replicateItem(it.id);
      push("ok", `Copy placed on ${r.node.name}`);
    } catch (e: any) {
      push("err", e?.message ?? "Could not place a copy");
    }
  };

  const cancelUpload = (jobId: string) => {
    jobsRef.current.get(jobId)?.abort();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) setPending(files);
  };

  const onDragOver = (e: DragEvent) => {
    // A file drag always exposes "Files"; text/link drags must keep working.
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dragging) setDragging(true);
  };

  const openItem = (item: Item) => {
    if (item.type === "url") {
      if (isHttpUrl(item.preview)) window.open(item.preview, "_blank", "noopener,noreferrer");
      else push("err", "This link has no valid destination");
      return;
    }
    setPreview(item);
  };

  const togglePin = async (item: Item) => {
    try {
      await api.setPin(item.id, !item.pinned);
    } catch (e: any) {
      push("err", e.message ?? "Failed to update pin");
    }
  };

  const remove = async (item: Item) => {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteItem(item.id);
      push("ok", "Deleted");
      void reload();
    } catch (e: any) {
      push("err", e.message ?? "Delete failed");
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "file", label: "Files" },
    { key: "image", label: "Images" },
  ];

  return (
    <div className="anim-page">
      <PageHeader title="Files" subtitle="Upload, paste or drop files. Set who can access them before they go up." />

      <Card
        className={`mb-5 border-2 border-dashed p-5 transition-all duration-200 sm:p-6 ${
          dragging ? "border-indigo-500 bg-indigo-500/10" : "border-[#2a3247] hover:border-indigo-500/50"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) setPending(files);
            e.target.value = "";
          }}
        />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${dragging ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-300" : "border-[#2a3247] bg-white/[0.03] text-slate-400"}`}>
              <Icon name="upload" size={20} />
            </span>
            <div className="min-w-0">
              <div className="font-medium text-white">{dragging ? "Release to upload" : "Drag and drop, paste, or click to browse"}</div>
              <div className="mt-0.5 text-xs text-slate-500">Multiple files · Ctrl+V works on this page · choose a group before uploading</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1 rounded-xl border border-[#2a3247] bg-[#12161f] p-1">
              <span className="px-2 text-[10px] uppercase tracking-wide text-slate-500">Expires</span>
              {[0, 1, 7, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setExpiresDays(d)}
                  className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                    expiresDays === d ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {d === 0 ? "Never" : `${d}d`}
                </button>
              ))}
            </div>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="h-8 rounded-lg border border-[#2a3247] bg-[#12161f] px-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
              aria-label="Group"
            >
              <option value="">Default group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Category"
              maxLength={60}
              className="h-8 w-24 rounded-lg border border-[#2a3247] bg-[#12161f] px-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-500"
              aria-label="Category"
            />
            <input
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              placeholder="labels, comma separated"
              className="h-8 w-44 rounded-lg border border-[#2a3247] bg-[#12161f] px-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-500"
              aria-label="Labels"
            />
          </div>
        </div>
      </Card>

      {jobs.length > 0 && (
        <Card className="mb-6 space-y-3 p-4">
          {jobs.map((job) => (
            <div key={job.id}>
              <div className="mb-1 flex justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-slate-200" title={job.name}>
                  <Icon name="upload" size={12} className="shrink-0 text-slate-500" />
                  <span className="truncate">{job.name}</span>
                </span>
                <span className="text-slate-500">{job.pct}%</span>
                <button
                  onClick={() => cancelUpload(job.id)}
                  className="rounded p-0.5 text-slate-500 transition hover:bg-white/5 hover:text-red-300"
                  aria-label={`Cancel ${job.name}`}
                  title="Cancel upload"
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
              <Progress pct={job.pct} />
            </div>
          ))}
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-xl border px-4 py-1.5 text-sm font-medium transition ${
              tab === t.key
                ? "border-indigo-500 bg-indigo-500/15 text-white"
                : "border-[#2a3247] text-slate-400 hover:border-indigo-500/50 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-500">
          {visible.length} {visible.length === 1 ? "item" : "items"}
          {visible.length > 0 ? ` · ${humanSize(visible.reduce((n, i) => n + i.size, 0))}` : ""}
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size={26} />
        </div>
      ) : visible.length === 0 ? (
        <Empty icon="folder" title="No files here yet" hint="Upload something above and it will appear on every device instantly." />
      ) : (
        <Card className="divide-y divide-[#1c2334] overflow-hidden">
          {visible.map((it) => (
            <div key={it.id} className="group flex items-center gap-3 p-4 transition hover:bg-white/[0.03]">
              <button onClick={() => openItem(it)} className="shrink-0 text-slate-500 transition hover:text-indigo-300" title="Open preview">
                <Icon name={mimeIcon(it.mime, it.name)} size={20} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => openItem(it)} className="truncate text-left text-sm font-medium text-slate-100 hover:text-white hover:underline" title={`Open ${it.name}`}>
                    {it.name}
                  </button>
                  {it.pinned ? (
                    <Badge tone="warn">
                      <Icon name="star" size={11} filled />
                    </Badge>
                  ) : null}
                  <AccessChips item={it} />
                  {it.category && <span className="rounded-full border border-[#2a3247] px-2 py-0.5 text-[10px] text-slate-400">{it.category}</span>}
                  {it.labels
                    ? it.labels.split(",").filter(Boolean).slice(0, 3).map((l) => (
                        <span key={l} className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-500">#{l}</span>
                      ))
                    : null}
                </div>
                <ItemMeta item={it} />
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-70 transition group-hover:opacity-100 sm:gap-1.5">
                <Btn size="sm" variant="soft" onClick={() => openItem(it)}>
                  <Icon name="eye" size={14} /> Open
                </Btn>
                {it.canManage && (
                  <Btn size="sm" variant="soft" onClick={() => setAccessItem(it)}>
                    <Icon name="shield" size={14} /> Access
                  </Btn>
                )}
                {it.canManage && (
                  <Btn size="sm" variant="soft" onClick={() => void replicate(it)} ariaLabel="Place a copy on the emptiest cluster node" title="Place a copy on the emptiest cluster node">
                    <Icon name="globe" size={14} />
                  </Btn>
                )}
                {it.canManage && it.type !== "url" && (
                  <Btn size="sm" variant="soft" onClick={() => setShareItem(it)} ariaLabel="Share">
                    <Icon name="share" size={14} />
                  </Btn>
                )}
                <Btn size="sm" variant="soft" href={`/api/items/${it.id}/download`} ariaLabel={`Download ${it.name}`}>
                  <Icon name="download" size={14} />
                </Btn>
                <button
                  onClick={() => void togglePin(it)}
                  title={it.pinned ? "Unpin" : "Pin"}
                  aria-label={it.pinned ? "Unpin" : "Pin"}
                  className={`rounded-lg p-1.5 transition hover:bg-white/5 ${it.pinned ? "text-amber-400" : "text-slate-500 hover:text-amber-300"}`}
                >
                  <Icon name="star" size={16} filled={!!it.pinned} />
                </button>
                {it.canDelete && (
                  <button
                    onClick={() => void remove(it)}
                    title="Delete"
                    aria-label="Delete"
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {remoteItems.length > 0 && (
        <Card className="mt-6 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[#1c2334] bg-white/[0.02] px-4 py-2.5">
            <Icon name="globe" size={15} className="text-cyan-300" />
            <span className="text-sm font-medium text-slate-200">From linked instances</span>
            <Badge tone="info">{remoteItems.length}</Badge>
          </div>
          <div className="divide-y divide-[#161c28]">
            {remoteItems.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Icon name={mimeIcon(r.mime, r.name)} size={18} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-100">{r.name}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-500">
                    <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-300">{r.remoteNodeName}</span>
                    <span>{humanSize(r.size)}</span>
                    {r.category && <span>· {r.category}</span>}
                  </div>
                </div>
                <Btn size="sm" variant="soft" href={`/api/remote/${r.remoteNode}/item/${r.remoteId}/download`}>
                  <Icon name="download" size={14} /> Download
                </Btn>
              </div>
            ))}
          </div>
        </Card>
      )}

      <UploadAccessDialog
        files={pending}
        open={pending.length > 0}
        onClose={() => setPending([])}
        onConfirm={(access) => {
          const files = pending;
          setPending([]);
          void runUpload(files, access);
        }}
      />
      <PreviewModal item={preview} open={preview !== null} onClose={() => setPreview(null)} />
      <AccessDialog
        item={accessItem}
        open={accessItem !== null}
        onClose={() => setAccessItem(null)}
        onSaved={(updated) => {
          setItems((list) => list.map((x) => (x.id === updated.id ? updated : x)));
          setShareItem((s) => (s && s.id === updated.id ? updated : s));
        }}
      />
      <ShareWizard item={shareItem} open={shareItem !== null} onClose={() => setShareItem(null)} />
    </div>
  );
}
