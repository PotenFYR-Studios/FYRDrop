import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { api, humanSize, isHttpUrl, runLimited, uploadFile, type Item } from "../api";
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
  const [tab, setTab] = useState<Tab>("all");
  const [expiresDays, setExpiresDays] = useState(0);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const [shareItem, setShareItem] = useState<Item | null>(null);
  const [preview, setPreview] = useState<Item | null>(null);
  const [accessItem, setAccessItem] = useState<Item | null>(null);
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

  const visible = items.filter((i) => (tab === "all" ? true : i.type === tab));

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
        className={`mb-6 border-2 border-dashed p-8 text-center transition-all duration-200 ${
          dragging ? "scale-[1.01] border-indigo-500 bg-indigo-500/10" : "border-[#2a3247] hover:border-indigo-500/50"
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
        <div className="flex justify-center">
          <Icon name="upload" size={30} className={dragging ? "text-indigo-400" : "text-slate-500"} />
        </div>
        <div className="mt-2 font-medium text-white">{dragging ? "Release to upload" : "Drag & drop, paste, or click to browse"}</div>
        <div className="mt-1 text-sm text-slate-500">Multiple files · Ctrl+V works on this page</div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500">Expires in</span>
          {[0, 1, 7, 30].map((d) => (
            <button
              key={d}
              onClick={(e) => {
                e.stopPropagation();
                setExpiresDays(d);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                expiresDays === d
                  ? "border-indigo-500 bg-indigo-500/20 text-white"
                  : "border-[#2a3247] text-slate-400 hover:border-indigo-500/50 hover:text-slate-200"
              }`}
            >
              {d === 0 ? "Never" : `${d}d`}
            </button>
          ))}
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

      <div className="mb-4 flex gap-2">
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
