import { useCallback, useEffect, useState } from "react";
import { api, type Item } from "../api";
import { Btn, Card, Empty, Input, ItemMeta, PageHeader, Spinner, useSync, useToast } from "../ui";
import { Icon } from "../icons";
import ShareWizard from "./ShareWizard";
import { AccessChips, AccessDialog, AccessPicker, defaultAccess, toPayload, type AccessState } from "../components/Access";

function hostOf(raw: string) {
  try {
    return new URL(raw).host;
  } catch {
    return raw.replace(/^https?:\/\//, "").split("/")[0] ?? raw;
  }
}

function looksLikeUrl(raw: string) {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return false;
  try {
    // Same rules as the server: parseable URL, http(s) scheme, non-empty host.
    // localhost, IPs and host:port are all valid.
    const u = new URL(v.startsWith("http://") || v.startsWith("https://") ? v : `https://${v}`);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

export default function Links() {
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [shareItem, setShareItem] = useState<Item | null>(null);
  const [accessItem, setAccessItem] = useState<Item | null>(null);
  const [access, setAccess] = useState<AccessState>(defaultAccess());

  const reload = useCallback(async () => {
    try {
      const res = await api.items("url");
      setLinks(res.items.slice().sort((a, b) => b.createdAt - a.createdAt));
    } catch (e: any) {
      push("err", e.message ?? "Failed to load links");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useSync(() => void reload());

  const add = async () => {
    if (!looksLikeUrl(url)) {
      push("err", "That doesn't look like a valid http(s) URL");
      return;
    }
    setBusy(true);
    try {
      let normalized = url.trim();
      if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
      const created = await api.shareUrl(title.trim() || hostOf(normalized), normalized, 0, toPayload(access));
      push("ok", "Link saved");
      setTitle("");
      setUrl("");
      setAccess(defaultAccess());
      setLinks((list) => [created.item, ...list]);
    } catch (e: any) {
      push("err", e.message ?? "Failed to save link");
    } finally {
      setBusy(false);
    }
  };

  const targetOf = (item: Item) => item.preview ?? "";

  const remove = async (item: Item) => {
    if (!window.confirm(`Delete link "${item.name}"?`)) return;
    try {
      await api.deleteItem(item.id);
      push("ok", "Link deleted");
      setLinks((list) => list.filter((x) => x.id !== item.id));
    } catch (e: any) {
      push("err", e.message ?? "Delete failed");
    }
  };

  return (
    <div className="anim-page">
      <PageHeader title="Links" subtitle="Keep links here and open them from any device." />

      <Card className="mb-6 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-56">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" maxLength={120} />
          </div>
          <div className="flex-1">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              placeholder="https://example.com/page"
              inputMode="url"
            />
          </div>
          <Btn onClick={() => void add()} disabled={busy || !url.trim()} className="sm:w-28">
            <Icon name="plus" size={15} />
            {busy ? "Adding…" : "Add"}
          </Btn>
        </div>
        {url.trim() && !looksLikeUrl(url) && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
            <Icon name="alert" size={13} />
            Enter a valid http(s) URL
          </div>
        )}
        <details className="mt-3 rounded-xl border border-[#232a3a] bg-[#12161f] p-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-300">Who can read / write / delete</summary>
          <div className="mt-3">
            <AccessPicker value={access} onChange={setAccess} />
          </div>
        </details>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size={26} />
        </div>
      ) : links.length === 0 ? (
        <Empty icon="link" title="No links saved yet" hint="Paste a URL above and it becomes available everywhere." />
      ) : (
        <div className="space-y-3">
          {links.map((l) => {
            const target = targetOf(l);
            const host = hostOf(target);
            return (
              <Card key={l.id} className="group p-4">
                <div className="flex items-start gap-3">
                  <span
                    className="mono mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#2a3247] bg-white/[0.04] text-[11px] font-semibold uppercase text-cyan-300"
                    aria-hidden="true"
                    title={host}
                  >
                    {(host.replace(/^www\./, "")[0] ?? "?").toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white" title={l.name}>{l.name}</div>
                    {target && (
                      <a
                        href={target}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 block truncate text-xs text-cyan-400 transition hover:text-cyan-300 hover:underline"
                      >
                        {target}
                      </a>
                    )}
                    <ItemMeta item={l} />
                    <div className="mt-1.5"><AccessChips item={l} /></div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 opacity-70 transition group-hover:opacity-100">
                    {target && (
                      <Btn size="sm" variant="soft" onClick={() => void navigator.clipboard.writeText(target).then(() => push("ok", "Link copied")).catch(() => push("err", "Clipboard blocked by the browser"))} ariaLabel="Copy link">
                        <Icon name="copy" size={14} />
                      </Btn>
                    )}
                    {target && (
                      <Btn size="sm" variant="soft" href={target} target="_blank" ariaLabel="Open link">
                        <Icon name="external" size={14} />
                      </Btn>
                    )}
                    {l.canManage && (
                      <Btn size="sm" variant="soft" onClick={() => setAccessItem(l)}>
                        <Icon name="shield" size={14} />
                      </Btn>
                    )}
                    {l.canManage && (
                      <Btn size="sm" variant="soft" onClick={() => setShareItem(l)} ariaLabel="Share">
                        <Icon name="share" size={14} />
                      </Btn>
                    )}
                    {l.canDelete && (
                      <button
                        onClick={() => void remove(l)}
                        title="Delete"
                        aria-label="Delete link"
                        className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AccessDialog
        item={accessItem}
        open={accessItem !== null}
        onClose={() => setAccessItem(null)}
        onSaved={(updated) => setLinks((list) => list.map((x) => (x.id === updated.id ? updated : x)))}
      />
      <ShareWizard item={shareItem} open={shareItem !== null} onClose={() => setShareItem(null)} />
    </div>
  );
}
