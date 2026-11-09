import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { api, humanSize, runLimited, uploadFile, type Item } from "../api";
import { Btn, Card, Empty, ItemMeta, Modal, PageHeader, Progress, Spinner, useSync, useToast } from "../ui";
import { Icon } from "../icons";
import ShareWizard from "./ShareWizard";
import { AccessChips, AccessDialog, UploadAccessDialog, type AccessState, toPayload } from "../components/Access";

export default function Gallery() {
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [images, setImages] = useState<Item[]>([]);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [shareItem, setShareItem] = useState<Item | null>(null);
  const [accessItem, setAccessItem] = useState<Item | null>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [jobs, setJobs] = useState<{ id: string; pct: number }[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const res = await api.items("image");
      setImages(res.items.slice().sort((a, b) => b.createdAt - a.createdAt));
    } catch (e: any) {
      push("err", e.message ?? "Failed to load gallery");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useSync(() => void reload());

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        setPending(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const close = useCallback(() => setOpenIdx(null), []);
  const current = openIdx !== null ? images[openIdx] ?? null : null;

  useEffect(() => {
    if (openIdx === null) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setOpenIdx((i) => (i === null ? null : Math.min(images.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setOpenIdx((i) => (i === null ? null : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [openIdx, images.length]);

  const upload = async (files: File[], access: AccessState) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) {
      push("err", "Only image files can be added to the gallery");
      return;
    }
    const payload = toPayload(access);
    const newJobs = imgs.map((f) => ({ id: `${f.name}-${Math.random()}`, pct: 0 }));
    setJobs(newJobs);
    // Two at a time: phones keep their memory, the server keeps its threads.
    await runLimited(imgs, 2, async (file, i) => {
      try {
        await uploadFile(file, {
          expiresDays: 0,
          access: payload,
          onProgress: (pct) => setJobs((j) => j.map((x, xi) => (xi === i ? { ...x, pct } : x))),
        });
      } catch (e: any) {
        push("err", `${file.name}: ${e.message ?? "upload failed"}`);
      }
    });
    setJobs([]);
    push("ok", `Added ${imgs.length} image${imgs.length === 1 ? "" : "s"}`);
    void reload();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) setPending(files);
    else if (e.dataTransfer.files.length) push("err", "Drop image files only");
  };

  const remove = async (item: Item) => {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteItem(item.id);
      close();
      push("ok", "Image deleted");
      void reload();
    } catch (e: any) {
      push("err", e.message ?? "Delete failed");
    }
  };

  return (
    <div className="anim-page">
      <PageHeader
        title="Gallery"
        subtitle="Upload or drop images. Thumbnails show up on every paired device."
        actions={
          <Btn size="sm" onClick={() => inputRef.current?.click()}>
            <Icon name="upload" size={14} /> Add images
          </Btn>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) setPending(files);
          e.target.value = "";
        }}
      />

      <Card
        className={`mb-6 border-2 border-dashed p-6 text-center transition-all duration-200 ${
          dragging ? "scale-[1.01] border-indigo-500 bg-indigo-500/10" : "border-[#2a3247] hover:border-indigo-500/50"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="flex justify-center">
          <Icon name="image" size={26} className={dragging ? "text-indigo-400" : "text-slate-500"} />
        </div>
        <div className="mt-2 text-sm font-medium text-white">{dragging ? "Release to add" : "Drop images here, or paste with Ctrl+V"}</div>
        <div className="mt-1 text-[11px] text-slate-500">You choose read / write / delete access before the upload is finalized.</div>
        {jobs.length > 0 && (
          <div className="mx-auto mt-4 max-w-md space-y-2">
            {jobs.map((j) => (
              <Progress key={j.id} pct={j.pct} />
            ))}
          </div>
        )}
      </Card>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size={26} />
        </div>
      ) : images.length === 0 ? (
        <Empty icon="image" title="No images yet" hint="Drop images above to add them here." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {images.map((img, idx) => (
            <Card key={img.id} className="group relative overflow-hidden" onClick={() => setOpenIdx(idx)}>
              <div className="aspect-square overflow-hidden">
                <img
                  src={`/api/items/${img.id}/thumb`}
                  alt={img.name}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </div>
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-black/20 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <div className="truncate text-sm font-medium text-white" title={img.name}>{img.name}</div>
                <div className="text-[11px] text-slate-300">{humanSize(img.size)}</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={current !== null} onClose={close} title={current?.name ?? ""} wide>
        {current && (
          <div className="space-y-4">
            <div className="flex items-center justify-center overflow-hidden rounded-xl border border-[#2a3247] bg-black/40">
              <img src={`/api/items/${current.id}/preview`} alt={current.name} className="max-h-[60vh] w-auto max-w-full object-contain" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Btn size="sm" variant="soft" onClick={() => setOpenIdx(Math.max(0, (openIdx ?? 0) - 1))} disabled={(openIdx ?? 0) <= 0}>
                <Icon name="arrowLeft" size={14} /> Prev
              </Btn>
              <span className="text-xs text-slate-500">
                {(openIdx ?? 0) + 1} / {images.length} · use arrow keys
              </span>
              <Btn size="sm" variant="soft" onClick={() => setOpenIdx(Math.min(images.length - 1, (openIdx ?? 0) + 1))} disabled={(openIdx ?? 0) >= images.length - 1}>
                Next <Icon name="arrowRight" size={14} />
              </Btn>
            </div>
            <ItemMeta item={current} />
            <AccessChips item={current} />
            <div className="flex flex-wrap gap-2">
              <Btn size="sm" href={`/api/items/${current.id}/download`} download={current.name}>
                <Icon name="download" size={14} /> Download
              </Btn>
              {current.canManage && (
                <Btn size="sm" variant="soft" onClick={() => setAccessItem(current)}>
                  <Icon name="shield" size={14} /> Access
                </Btn>
              )}
              {current.canManage && (
                <Btn size="sm" variant="soft" onClick={() => setShareItem(current)}>
                  <Icon name="share" size={14} /> Share
                </Btn>
              )}
              {current.canDelete && (
                <Btn size="sm" variant="danger" onClick={() => void remove(current)}>
                  <Icon name="trash" size={14} /> Delete
                </Btn>
              )}
            </div>
          </div>
        )}
      </Modal>

      <UploadAccessDialog
        files={pending}
        open={pending.length > 0}
        onClose={() => setPending([])}
        onConfirm={(access) => {
          const files = pending;
          setPending([]);
          void upload(files, access);
        }}
      />
      <AccessDialog
        item={accessItem}
        open={accessItem !== null}
        onClose={() => setAccessItem(null)}
        onSaved={(updated) => setImages((list) => list.map((x) => (x.id === updated.id ? updated : x)))}
      />
      <ShareWizard item={shareItem} open={shareItem !== null} onClose={() => setShareItem(null)} />
    </div>
  );
}
