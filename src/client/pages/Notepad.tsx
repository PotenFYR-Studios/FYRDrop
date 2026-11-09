import { useCallback, useEffect, useState } from "react";
import { api, humanSize, type Item } from "../api";
import { Btn, Card, Empty, Input, ItemMeta, Label, PageHeader, Spinner, Textarea, useSync, useToast } from "../ui";
import { Icon } from "../icons";
import { AccessChips, AccessDialog, AccessPicker, defaultAccess, toPayload, type AccessState } from "../components/Access";

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
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled note" maxLength={120} />
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
                    {n.canManage && (
                      <Btn size="sm" variant="soft" onClick={() => setAccessItem(n)}>
                        <Icon name="shield" size={14} /> Access
                      </Btn>
                    )}
                    <Btn
                      size="sm"
                      variant="soft"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(preview)
                          .then(() => push("ok", "Copied to clipboard"))
                          .catch(() => push("err", "Clipboard blocked by the browser"))
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
