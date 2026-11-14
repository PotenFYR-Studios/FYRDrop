import { useCallback, useEffect, useMemo, useState } from "react";
import { api, copyText, newBatchId, type Item } from "../api";
import { Btn, Card, Empty, Input, ItemMeta, PageHeader, Spinner, Textarea, useSync, useToast } from "../ui";
import { Icon } from "../icons";
import ShareWizard from "./ShareWizard";
import { AccessChips, AccessDialog, AccessPicker, defaultAccess, toPayload, type AccessState } from "../components/Access";
import { BundleCard, groupBundles } from "../components/Bundles";

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

const normalize = (raw: string) => (/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);

/** One link per line (spaces and commas also separate), duplicates dropped. */
function parseLinks(raw: string) {
  const parts = [...new Set(raw.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];
  return { good: parts.filter(looksLikeUrl).map(normalize), bad: parts.filter((x) => !looksLikeUrl(x)) };
}

const MAX_LINKS = 50;

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

  const parsed = useMemo(() => parseLinks(url), [url]);
  const many = parsed.good.length > 1;

  const add = async () => {
    if (parsed.good.length === 0 || parsed.bad.length > 0) {
      push("err", parsed.bad.length ? `Not a valid http(s) link: ${parsed.bad[0]}` : "Paste at least one link");
      return;
    }
    if (parsed.good.length > MAX_LINKS) {
      push("err", `Add at most ${MAX_LINKS} links at a time`);
      return;
    }
    setBusy(true);
    const payload = toPayload(access);
    // Several links added together become one bundle; the title names the bundle.
    const batch = many ? { batchId: newBatchId(), batchName: title.trim() } : undefined;
    let saved = 0;
    let lastError = "";
    for (const link of parsed.good) {
      try {
        await api.shareUrl(many ? hostOf(link) : title.trim() || hostOf(link), link, 0, payload, batch);
        saved++;
      } catch (e: any) {
        lastError = e?.message ?? "Failed to save link";
      }
    }
    setBusy(false);
    if (saved === parsed.good.length) {
      push("ok", many ? `${saved} links saved as one bundle` : "Link saved");
      setTitle("");
      setUrl("");
      setAccess(defaultAccess());
    } else {
      push("err", saved ? `${saved} of ${parsed.good.length} saved. ${lastError}` : lastError);
    }
    void reload();
  };

  const targetOf = (item: Item) => item.preview ?? "";

  const copy = async (text: string, done: string) => {
    const ok = !!text && (await copyText(text));
    push(ok ? "ok" : "err", ok ? done : "Clipboard blocked by the browser");
  };

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

  const openAll = (items: Item[]) => {
    const targets = items.map(targetOf).filter(Boolean);
    if (targets.length > 5 && !window.confirm(`Open ${targets.length} links in new tabs?`)) return;
    for (const t of targets) window.open(t, "_blank", "noopener,noreferrer");
    // With noopener the browser never says whether a tab was blocked, so explain instead.
    if (targets.length > 1) push("info", `Opening ${targets.length} links. If only one tab appears, allow pop-ups for this site.`);
  };

  const renderLink = (l: Item, inBundle: boolean) => {
    const target = targetOf(l);
    const host = hostOf(target);
    return (
      <div key={l.id} className={`group flex items-start gap-3 ${inBundle ? "px-4 py-3" : ""}`}>
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
            <a href={target} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-xs text-cyan-400 transition hover:text-cyan-300 hover:underline">
              {target}
            </a>
          )}
          {!inBundle && <ItemMeta item={l} />}
          {!inBundle && (
            <div className="mt-1.5">
              <AccessChips item={l} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 opacity-70 transition group-hover:opacity-100">
          {target && (
            <Btn size="sm" variant="soft" onClick={() => void copy(target, "Link copied")} ariaLabel="Copy link">
              <Icon name="copy" size={14} />
            </Btn>
          )}
          {target && (
            <Btn size="sm" variant="soft" href={target} target="_blank" ariaLabel="Open link">
              <Icon name="external" size={14} />
            </Btn>
          )}
          {l.canManage && (
            <Btn size="sm" variant="soft" onClick={() => setAccessItem(l)} ariaLabel="Access">
              <Icon name="shield" size={14} />
            </Btn>
          )}
          {l.canManage && (
            <Btn size="sm" variant="soft" onClick={() => setShareItem(l)} ariaLabel="Share">
              <Icon name="share" size={14} />
            </Btn>
          )}
          {l.canDelete && (
            <button onClick={() => void remove(l)} title="Delete" aria-label="Delete link" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300">
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const entries = groupBundles(links);

  return (
    <div className="anim-page">
      <PageHeader title="Links" subtitle="Keep links here and open them from any device. Paste several at once and they stay together as one bundle." />

      <Card className="mb-6 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="sm:w-56">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={many ? "Bundle name (optional)" : "Title (optional)"} maxLength={120} />
          </div>
          <div className="flex-1">
            <Textarea
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                // Enter saves; Shift+Enter adds another line.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void add();
                }
              }}
              rows={Math.min(8, Math.max(1, url.split("\n").length))}
              placeholder="https://example.com/page  (paste several, one per line, to save them as a bundle)"
              inputMode="url"
              aria-label="Link or links"
              className="min-h-0 resize-none"
            />
          </div>
          <Btn onClick={() => void add()} disabled={busy || parsed.good.length === 0 || parsed.bad.length > 0} className="sm:w-32">
            <Icon name="plus" size={15} />
            {busy ? "Adding…" : many ? `Add ${parsed.good.length}` : "Add"}
          </Btn>
        </div>
        {parsed.bad.length > 0 ? (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
            <Icon name="alert" size={13} />
            Not a valid http(s) link: <span className="mono truncate">{parsed.bad.slice(0, 3).join(", ")}</span>
          </div>
        ) : many ? (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-indigo-300">
            <Icon name="grid" size={13} />
            {parsed.good.length} links will be saved together as one bundle.
          </div>
        ) : null}
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
          {entries.map((e) =>
            e.kind === "bundle" ? (
              <BundleCard
                key={e.bundle.key}
                bundle={e.bundle}
                zip={false}
                onChanged={() => void reload()}
                extraActions={
                  <>
                    <Btn size="sm" variant="soft" onClick={() => openAll(e.bundle.items)} title="Open every link in a new tab">
                      <Icon name="external" size={14} /> <span className="hidden sm:inline">Open all</span>
                    </Btn>
                    <Btn size="sm" variant="soft" onClick={() => void copy(e.bundle.items.map(targetOf).filter(Boolean).join("\n"), "All links copied")} title="Copy every link, one per line" ariaLabel="Copy all links">
                      <Icon name="copy" size={14} />
                    </Btn>
                  </>
                }
              >
                {e.bundle.items.map((l) => renderLink(l, true))}
              </BundleCard>
            ) : (
              <Card key={e.item.id} className="p-4">
                {renderLink(e.item, false)}
              </Card>
            ),
          )}
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
