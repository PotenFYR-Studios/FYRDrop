import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Icon, mimeIcon } from "../icons";

type Hit = { id: string; name: string; type: string; mime: string; category: string; labels: string; groupId: string };

export default function CommandPalette() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Hit[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("fyrdrop:search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("fyrdrop:search", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setItems([]);
    setGroups([]);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setItems([]);
      setGroups([]);
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await api.search(q.trim());
        setItems(r.items);
        setGroups(r.groups);
      } catch {
        /* ignore */
      } finally {
        setBusy(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  if (!open) return null;

  const go = (it: Hit) => {
    const path = it.type === "text" ? "/notepad" : it.type === "url" ? "/links" : it.type === "image" ? "/gallery" : "/files";
    setOpen(false);
    nav(path);
  };

  const first = items[0];

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[#2a3247] bg-[#0d1119] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-[#1c2334] px-4 py-3">
          <Icon name="search" size={16} className="text-slate-500" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && first) go(first);
            }}
            placeholder="Search files, notes, links, groups…"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
          />
          <kbd className="rounded border border-[#2a3247] px-1.5 py-0.5 text-[10px] text-slate-500">esc</kbd>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {q.trim().length < 2 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500">Type at least two characters. Ctrl+K opens this anywhere.</p>
          ) : busy && items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500">Searching…</p>
          ) : items.length === 0 && groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500">No matches for "{q}".</p>
          ) : (
            <>
              {items.map((it) => (
                <button key={it.id} onClick={() => go(it)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/[0.06]">
                  <Icon name={mimeIcon(it.mime, it.name)} size={16} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{it.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-600">{it.type}</span>
                </button>
              ))}
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => {
                    setOpen(false);
                    nav(`/files?group=${g.id}`);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/[0.06]"
                >
                  <Icon name="users" size={16} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{g.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-600">group</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
