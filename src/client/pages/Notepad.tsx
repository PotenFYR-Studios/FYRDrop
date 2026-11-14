import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copyText, api, humanSize, type Item } from "../api";
import { Btn, Card, Empty, Input, ItemMeta, Label, PageHeader, Spinner, Textarea, useSync, useToast } from "../ui";
import { Icon } from "../icons";
import { AccessChips, AccessDialog, AccessPicker, defaultAccess, toPayload, type AccessState } from "../components/Access";


/* --------------------------- Import / export --------------------------- */

const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function saveBlob(name: string, mime: string, data: string | Blob) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "note";

function noteHtml(title: string, body: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body{font:16px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;color:#111}
  h1{font-size:28px;line-height:1.3;margin:0 0 24px;padding-bottom:12px;border-bottom:1px solid #ddd}
  pre{white-space:pre-wrap;word-wrap:break-word;font:inherit;margin:0}
</style></head>
<body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(body)}</pre></body></html>`;
}

function stripHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript").forEach((n) => n.remove());
  return (doc.body?.innerText ?? "").trim();
}

function stripRtf(rtf: string) {
  return rtf
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\par[d]?/gi, "\n")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extract word/document.xml from a .docx (a zip) without extra dependencies. */
async function docxText(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  let offset = 0;
  while (offset + 30 < bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = bytes.subarray(dataStart, dataStart + compSize);
    if (name === "word/document.xml") {
      let xml: string;
      if (method === 0) xml = new TextDecoder().decode(data);
      else if (method === 8 && typeof DecompressionStream !== "undefined") {
        const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        xml = await new Response(stream).text();
      } else throw new Error("Unsupported docx compression");
      return xml
        .replace(/<w:tab[^>]*\/>/gi, "\t")
        .replace(/<w:br[^>]*\/>/gi, "\n")
        .replace(/<\/w:p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    offset = dataStart + compSize;
  }
  throw new Error("No word/document.xml found");
}

/** Extract the text layer of a PDF in the browser. pdf.js is loaded on demand so it stays out of the main bundle. */
async function pdfText(buf: ArrayBuffer): Promise<string> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  } catch (e: any) {
    if (e?.name === "PasswordException") throw new Error("This PDF is password protected. Remove the password and try again.");
    throw new Error("Could not open that PDF. It may be damaged.");
  }
  try {
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let out = "";
      let lastY: number | null = null;
      for (const it of tc.items as any[]) {
        if (typeof it.str !== "string") continue;
        const y = Array.isArray(it.transform) ? it.transform[5] : null;
        // A jump in baseline without an explicit EOL still means a new line.
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !out.endsWith("\n")) out += "\n";
        out += it.str;
        if (it.hasEOL) out += "\n";
        if (y !== null) lastY = y;
      }
      pages.push(out.replace(/[ \t]+\n/g, "\n").trim());
      page.cleanup();
    }
    const text = pages.filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) throw new Error("This PDF has no text layer (it is probably a scan). Run OCR on it first.");
    return text;
  } finally {
    await doc.destroy();
  }
}

async function extractDocument(file: File): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (ext === "docx") return docxText(await file.arrayBuffer());
  if (ext === "pdf") return pdfText(await file.arrayBuffer());
  const raw = await file.text();
  if (["html", "htm"].includes(ext)) return stripHtml(raw);
  if (ext === "rtf") return stripRtf(raw);
  return raw;
}

export default function Notepad() {
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [full, setFull] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessState>(defaultAccess());
  const [accessItem, setAccessItem] = useState<Item | null>(null);
  const [importing, setImporting] = useState(false);

  const importDocument = async (file: File) => {
    setImporting(true);
    try {
      const text = await extractDocument(file);
      if (!text.trim()) throw new Error("That document had no readable text.");
      setTitle((t) => t.trim() || file.name.replace(/\.[^.]+$/, ""));
      setContent(text);
      push("ok", `${file.name} loaded into the editor`);
    } catch (e: any) {
      push("err", e?.message ?? "Could not read that document");
    } finally {
      setImporting(false);
    }
  };

  const noteContent = async (n: Item) => {
    if (full[n.id] !== undefined) return full[n.id]!;
    const res = await fetch(`/api/items/${n.id}/preview`, { credentials: "include" });
    if (!res.ok) throw new Error("Could not read this note");
    const text = await res.text();
    setFull((f) => ({ ...f, [n.id]: text }));
    return text;
  };

  const exportNote = async (n: Item, format: "txt" | "md" | "html" | "doc" | "pdf") => {
    try {
      const body = await noteContent(n);
      const base = safeName(n.name);
      if (format === "txt") saveBlob(`${base}.txt`, "text/plain;charset=utf-8", body);
      else if (format === "md") saveBlob(`${base}.md`, "text/markdown;charset=utf-8", `# ${n.name}

${body}
`);
      else if (format === "html") saveBlob(`${base}.html`, "text/html;charset=utf-8", noteHtml(n.name, body));
      else if (format === "doc") saveBlob(`${base}.doc`, "application/msword;charset=utf-8", noteHtml(n.name, body));
      else {
        const win = window.open("", "_blank", "width=820,height=900");
        if (!win) throw new Error("Allow pop-ups to print this note as PDF");
        win.document.write(noteHtml(n.name, body));
        win.document.close();
        win.focus();
        setTimeout(() => win.print(), 350);
      }
      push("ok", format === "pdf" ? "Print dialog opened - choose Save as PDF" : `Exported ${base}.${format === "doc" ? "doc" : format}`);
    } catch (e: any) {
      push("err", e?.message ?? "Export failed");
    }
  };

  const reload = useCallback(async () => {
    try {
      const res = await api.items("text");
      setNotes(res.items.slice().sort((a, b) => b.createdAt - a.createdAt));
    } catch (e: any) {
      push("err", e.message ?? "Failed to load notes");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useSync(() => void reload());

  const share = async () => {
    if (!content.trim()) {
      push("err", "Note content is empty");
      return;
    }
    setBusy(true);
    try {
      const p = toPayload(access);
      const r = await api.shareText(title.trim() || content.trim().slice(0, 40), content, 0, p);
      push("ok", "Note shared");
      setTitle("");
      setContent("");
      setAccess(defaultAccess());
      setNotes((list) => [r.item, ...list]);
    } catch (e: any) {
      push("err", e.message ?? "Failed to share note");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: Item) => {
    if (!window.confirm(`Delete note "${item.name}"?`)) return;
    try {
      await api.deleteItem(item.id);
      push("ok", "Note deleted");
      void reload();
    } catch (e: any) {
      push("err", e.message ?? "Delete failed");
    }
  };

  const toggleExpanded = async (id: string) => {
    const willOpen = !expanded.has(id);
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (willOpen && full[id] === undefined) {
      try {
        const res = await fetch(`/api/items/${id}/preview`, { credentials: "include" });
        if (res.ok) {
          const text = await res.text();
          setFull((f) => ({ ...f, [id]: text }));
          setDrafts((d) => ({ ...d, [id]: text }));
        }
      } catch {
        /* preview stays collapsed */
      }
    }
  };

  const saveEdit = async (item: Item) => {
    const draft = drafts[item.id];
    if (draft === undefined) return;
    setSavingId(item.id);
    try {
      const r = await api.editNote(item.id, draft, item.name);
      setNotes((list) => list.map((x) => (x.id === item.id ? r.item : x)));
      setFull((f) => ({ ...f, [item.id]: draft }));
      push("ok", "Note saved");
    } catch (e: any) {
      push("err", e.message ?? "You do not have write access to this note");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="anim-page">
      <PageHeader title="Notepad" subtitle="Notes you can share and edit. Each note has its own access settings." />

      <Card className="mb-6 p-5">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled note" maxLength={120} />
            </div>
            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#2a3247] px-3 py-2 text-xs text-slate-300 transition hover:text-white ${importing ? "opacity-60" : ""}`}>
              <Icon name="upload" size={13} /> {importing ? "Reading…" : "Import document"}
              <input
                type="file"
                className="hidden"
                accept=".txt,.md,.markdown,.html,.htm,.csv,.json,.xml,.log,.rtf,.docx,.pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importDocument(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <div>
            <Label>Content</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onPaste={(e) => e.stopPropagation()}
              placeholder="Write anything - a snippet, a password hint, a draft… (Ctrl+V pastes here)"
              rows={9}
            />
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
              <span>{content.length.toLocaleString()} characters</span>
              <span>{humanSize(new TextEncoder().encode(content).length)}</span>
            </div>
          </div>
          <details className="rounded-xl border border-[#232a3a] bg-[#12161f] p-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-300">Who can read / write / delete</summary>
            <div className="mt-3">
              <AccessPicker value={access} onChange={setAccess} />
            </div>
          </details>
          <div className="flex justify-end">
            <Btn onClick={() => void share()} disabled={busy || !content.trim()}>
              <Icon name="upload" size={14} />
              {busy ? "Sharing…" : "Share note"}
            </Btn>
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size={26} />
        </div>
      ) : notes.length === 0 ? (
        <Empty icon="note" title="No notes yet" hint="Write your first note above - it syncs to every device in realtime." />
      ) : (
        <div className="space-y-3">
          {notes.map((n) => {
            const open = expanded.has(n.id);
            const preview = full[n.id] ?? n.preview ?? "";
            const draft = drafts[n.id] ?? preview;
            return (
              <Card key={n.id} className="group p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button onClick={() => void toggleExpanded(n.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-white" title={n.name}>
                      <Icon name="note" size={15} className="shrink-0 text-slate-500" />
                      <span className="truncate">{n.name}</span>
                    </div>
                    {!open && (
                      <div className="mt-1.5 line-clamp-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-400">
                        {preview || <span className="italic text-slate-600">(empty preview)</span>}
                      </div>
                    )}
                    <ItemMeta item={n} />
                    <div className="mt-1.5">
                      <AccessChips item={n} />
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5 opacity-80 transition group-hover:opacity-100">
                    <ExportMenu onPick={(fmt) => void exportNote(n, fmt)} />
                    {n.canManage && (
                      <Btn size="sm" variant="soft" onClick={() => setAccessItem(n)}>
                        <Icon name="shield" size={14} /> Access
                      </Btn>
                    )}
                    <Btn
                      size="sm"
                      variant="soft"
                      onClick={() =>
                        void copyText(preview).then((ok) => (ok ? push("ok", "Copied to clipboard") : push("err", "Clipboard blocked by the browser")))
                      }
                    >
                      <Icon name="copy" size={14} /> Copy
                    </Btn>
                    {n.canDelete && (
                      <button
                        onClick={() => void remove(n)}
                        title="Delete"
                        aria-label="Delete note"
                        className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                </div>
                {open && (
                  <div className="mt-3 space-y-2">
                    <Textarea
                      value={draft}
                      readOnly={!n.canWrite}
                      onChange={(e) => setDrafts((d) => ({ ...d, [n.id]: e.target.value }))}
                      rows={10}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500">
                        {n.canWrite ? "Shared notes are editable by anyone with write access." : "Read-only - you don't have write access to this note."}
                      </span>
                      <div className="flex gap-2">
                        <Btn size="sm" variant="ghost" onClick={() => void toggleExpanded(n.id)}>
                          Close
                        </Btn>
                        {n.canWrite && (
                          <Btn size="sm" onClick={() => void saveEdit(n)} disabled={savingId === n.id || draft === full[n.id]}>
                            <Icon name="check" size={14} /> {savingId === n.id ? "Saving…" : "Save changes"}
                          </Btn>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <AccessDialog
        item={accessItem}
        open={accessItem !== null}
        onClose={() => setAccessItem(null)}
        onSaved={(updated) => setNotes((list) => list.map((x) => (x.id === updated.id ? updated : x)))}
      />
    </div>
  );
}

function ExportMenu({ onPick }: { onPick: (f: "txt" | "md" | "html" | "doc" | "pdf") => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      if (ref.current?.contains(e.target)) return;
      if ((e.target as HTMLElement).closest("[data-export-menu]")) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={ref}
        onClick={toggle}
        className="inline-flex items-center gap-1 rounded-lg border border-[#2a3247] bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-300 transition hover:text-white"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="download" size={13} /> Export
      </button>
      {open && pos &&
        createPortal(
          <div
            data-export-menu
            role="menu"
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-[60] w-44 overflow-hidden rounded-xl border border-[#2a3247] bg-[#0d1119] py-1 shadow-2xl"
          >
            {(
              [
                ["txt", "Plain text"],
                ["md", "Markdown"],
                ["html", "HTML"],
                ["doc", "Word document"],
                ["pdf", "PDF (print)"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onPick(key);
                }}
                className="block w-full px-3 py-2 text-left text-xs text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
              >
                {label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
