import { useState, type ReactNode } from "react";
import { api, bundleZipUrl, humanSize, timeAgo, type Item } from "../api";
import { Btn, useToast } from "../ui";
import { Icon, mimeIcon } from "../icons";

/**
 * Things added in one go (several files, images or links) share a bundle id.
 * Lists show such a group as one card instead of scattering its members;
 * anything added on its own stays a plain row.
 */

export interface Bundle {
  /** Stable React key: uploader + bundle id. */
  key: string;
  batchId: string;
  name: string;
  items: Item[];
  size: number;
  createdAt: number;
  uploadedBy: string;
}

export type Entry = { kind: "single"; item: Item } | { kind: "bundle"; bundle: Bundle };

/**
 * Fold a list into singles and bundles, keeping the list's order (a bundle
 * sits where its first member was). A bundle with one visible member is shown
 * as a normal item.
 */
export function groupBundles(items: Item[]): Entry[] {
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    if (!it.batchId) continue;
    const key = `${it.userId ?? ""}:${it.batchId}`;
    const list = groups.get(key);
    if (list) list.push(it);
    else groups.set(key, [it]);
  }
  const out: Entry[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const key = it.batchId ? `${it.userId ?? ""}:${it.batchId}` : "";
    const members = key ? groups.get(key)! : null;
    if (!members || members.length < 2) {
      out.push({ kind: "single", item: it });
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const sorted = members.slice().sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
    out.push({
      kind: "bundle",
      bundle: {
        key,
        batchId: it.batchId,
        name: sorted.find((m) => m.batchName)?.batchName ?? "",
        items: sorted,
        size: sorted.reduce((n, m) => n + m.size, 0),
        createdAt: Math.max(...sorted.map((m) => m.createdAt)),
        uploadedBy: sorted[0]!.uploadedBy,
      },
    });
  }
  return out;
}

/** "3 images, 2 files" */
export function bundleSummary(items: Item[]) {
  const count = (t: Item["type"]) => items.filter((i) => i.type === t).length;
  const part = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : "");
  return [part(count("image"), "image", "images"), part(count("file"), "file", "files"), part(count("url"), "link", "links"), part(count("text"), "note", "notes")]
    .filter(Boolean)
    .join(", ");
}

export function bundleTitle(b: Bundle) {
  return b.name || `${bundleSummary(b.items)} added together`;
}

/** Up to four previews: image thumbnails where there are any, type icons otherwise. */
function Stack({ items }: { items: Item[] }) {
  const shown = items.slice(0, 4);
  return (
    <span className="relative grid h-11 w-11 shrink-0 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-xl border border-[#2a3247] bg-[#0f131b] p-0.5">
      {shown.map((it) =>
        it.type === "image" && it.thumbName ? (
          <img key={it.id} src={`/api/items/${it.id}/thumb`} alt="" loading="lazy" className={`h-full w-full rounded-[5px] object-cover ${shown.length === 1 ? "col-span-2 row-span-2" : ""}`} />
        ) : (
          <span key={it.id} className="flex items-center justify-center rounded-[5px] bg-white/[0.04] text-slate-400">
            <Icon name={it.type === "url" ? "link" : mimeIcon(it.mime, it.name)} size={11} />
          </span>
        ),
      )}
    </span>
  );
}

export function BundleCard({
  bundle,
  children,
  onChanged,
  zip = true,
  extraActions,
  select,
  defaultOpen = false,
}: {
  bundle: Bundle;
  /** The member rows, rendered by the page so they look like its normal items. */
  children: ReactNode;
  onChanged: () => void;
  /** Offer "download as zip" (files and images). */
  zip?: boolean;
  extraActions?: ReactNode;
  /** Whole-bundle checkbox for pages with multi-select. */
  select?: { state: "none" | "some" | "all"; onToggle: () => void };
  defaultOpen?: boolean;
}) {
  const { push } = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const canManage = bundle.items.some((i) => i.canManage);
  const canDelete = bundle.items.some((i) => i.canDelete);
  const title = bundleTitle(bundle);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      push("ok", await fn());
      onChanged();
    } catch (e: any) {
      push("err", e?.message ?? "That did not work");
    } finally {
      setBusy(false);
    }
  };

  const rename = () => {
    const name = window.prompt("Bundle name", bundle.name);
    if (name === null) return;
    void run(async () => {
      await api.renameBundle(bundle.batchId, name.trim());
      return name.trim() ? "Bundle renamed" : "Bundle name cleared";
    });
  };

  const ungroup = () => {
    if (!window.confirm(`Ungroup "${title}"? The ${bundle.items.length} items stay, but are listed one by one.`)) return;
    void run(async () => {
      await api.ungroupBundle(bundle.batchId);
      return "Bundle ungrouped";
    });
  };

  const remove = () => {
    if (!window.confirm(`Move all ${bundle.items.length} items in "${title}" to trash? They stay recoverable for 30 days.`)) return;
    void run(async () => {
      const r = await api.deleteBundle(bundle.batchId);
      return r.skipped ? `${r.trashed} moved to trash, ${r.skipped} kept (no delete access)` : `${r.trashed} items moved to trash`;
    });
  };

  return (
    <div className={`overflow-hidden rounded-2xl border transition ${open ? "border-indigo-500/40 bg-indigo-500/[0.03]" : "border-[#232a3a] bg-[#0f131b]/60 hover:border-[#2f3850]"}`}>
      <div className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
        {select && (
          <input
            type="checkbox"
            checked={select.state === "all"}
            ref={(el) => {
              if (el) el.indeterminate = select.state === "some";
            }}
            onChange={select.onToggle}
            className="h-3.5 w-3.5 shrink-0 accent-indigo-500"
            aria-label={`Select every item in ${title}`}
          />
        )}
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-[13rem] flex-1 items-center gap-3 text-left" aria-expanded={open}>
          <Stack items={bundle.items} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium text-slate-100">{title}</span>
              <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300">bundle · {bundle.items.length}</span>
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              {bundle.name && <span>{bundleSummary(bundle.items)}</span>}
              <span>{humanSize(bundle.size)}</span>
              <span className="inline-flex items-center gap-1">
                <Icon name="users" size={11} />
                {bundle.uploadedBy}
              </span>
              <span>{timeAgo(bundle.createdAt)}</span>
            </span>
          </span>
          <span className={`shrink-0 text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
            <Icon name="chevronDown" size={16} />
          </span>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {extraActions}
          {zip && (
            <Btn size="sm" variant="soft" href={bundleZipUrl(bundle.batchId)} title="Download everything in this bundle as one .zip" ariaLabel={`Download ${title} as zip`}>
              <Icon name="archive" size={14} /> <span className="hidden sm:inline">Zip</span>
            </Btn>
          )}
          {canManage && (
            <Btn size="sm" variant="soft" onClick={rename} disabled={busy} title="Rename bundle" ariaLabel="Rename bundle">
              <Icon name="pencil" size={14} />
            </Btn>
          )}
          {canManage && (
            <Btn size="sm" variant="soft" onClick={ungroup} disabled={busy} title="Ungroup: list the items one by one" ariaLabel="Ungroup bundle">
              <Icon name="list" size={14} />
            </Btn>
          )}
          {canDelete && (
            <button onClick={remove} disabled={busy} title="Move the whole bundle to trash" aria-label="Delete bundle" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50">
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      </div>
      {open && <div className="anim-pop divide-y divide-[#1c2334] border-t border-[#1c2334]">{children}</div>}
    </div>
  );
}
