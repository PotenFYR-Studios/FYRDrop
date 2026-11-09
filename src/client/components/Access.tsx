import { useEffect, useMemo, useState } from "react";
import { api, humanSize, isHttpUrl, type GroupSummary, type Item, type UserProfile } from "../api";
import { Btn, Input, Label, Modal, useToast } from "../ui";
import { Icon } from "../icons";
import { mimeIcon } from "../icons";

export type Scope = "everyone" | "selected" | "group" | "private";

export interface AccessState {
  read: { scope: Scope; users: string[]; groups: string[] };
  write: { scope: Scope; users: string[]; groups: string[] };
  delete: { scope: Scope; users: string[]; groups: string[] };
}

export function defaultAccess(): AccessState {
  return {
    // Anyone can read by default; only the uploader (and owner) can change or
    // remove it. Matches the server-side default for new items.
    read: { scope: "everyone", users: [], groups: [] },
    write: { scope: "private", users: [], groups: [] },
    delete: { scope: "private", users: [], groups: [] },
  };
}

export function accessFromItem(item: Item): AccessState {
  const split = (v: string) => (v ? v.split(",").filter(Boolean) : []);
  return {
    read: { scope: item.audience, users: split(item.audienceUsers), groups: split(item.audienceGroups ?? "") },
    write: { scope: item.writeAccess, users: split(item.writeUsers), groups: split(item.writeGroups ?? "") },
    delete: { scope: item.deleteAccess, users: split(item.deleteUsers), groups: split(item.deleteGroups ?? "") },
  };
}

export function toPayload(a: AccessState) {
  return {
    read: { scope: a.read.scope, userIds: a.read.users, groupIds: a.read.groups },
    write: { scope: a.write.scope, userIds: a.write.users, groupIds: a.write.groups },
    delete: { scope: a.delete.scope, userIds: a.delete.users, groupIds: a.delete.groups },
  };
}

const SCOPE_LABEL: Record<Scope, string> = { everyone: "Everyone", selected: "Selected", group: "Group", private: "Private" };

function ScopeBadge({ label, scope }: { label: string; scope: Scope }) {
  const tone =
    scope === "everyone" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : scope === "selected" ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
    : scope === "group" ? "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300"
    : "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}>{label}: {SCOPE_LABEL[scope]}</span>;
}

export function AccessChips({ item }: { item: Item }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <ScopeBadge label="R" scope={item.audience} />
      <ScopeBadge label="W" scope={item.writeAccess} />
      <ScopeBadge label="D" scope={item.deleteAccess} />
    </span>
  );
}

function ScopeRow({
  label,
  hint,
  value,
  people,
  groups,
  onChange,
}: {
  label: string;
  hint: string;
  value: { scope: Scope; users: string[]; groups: string[] };
  people: UserProfile[];
  groups: GroupSummary[];
  onChange: (v: { scope: Scope; users: string[]; groups: string[] }) => void;
}) {
  const toggle = (id: string) => {
    const has = value.users.includes(id);
    onChange({ ...value, users: has ? value.users.filter((x) => x !== id) : [...value.users, id] });
  };
  return (
    <div className="rounded-xl border border-[#232a3a] bg-[#12161f] p-3">
      <div className="text-xs font-semibold text-slate-200">{label}</div>
      <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</div>
      <div className="mt-2.5 grid grid-cols-4 gap-1" role="group" aria-label={label}>
        {(["everyone", "selected", "group", "private"] as const).map((s) => {
          const active = value.scope === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ ...value, scope: s })}
              aria-pressed={active}
              className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${
                active
                  ? "border-indigo-500 bg-indigo-500/20 text-white"
                  : "border-[#2a3247] text-slate-400 hover:border-indigo-500/40 hover:text-slate-200"
              }`}
            >
              {SCOPE_LABEL[s]}
            </button>
          );
        })}
      </div>
      {value.scope === "group" && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {groups.length === 0 ? (
            <span className="text-[11px] text-slate-500">You are not in any group yet. Create one on the Groups page.</span>
          ) : (
            groups.map((g) => {
              const on = value.groups.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...value,
                      groups: on ? value.groups.filter((x) => x !== g.id) : [...value.groups, g.id],
                    })
                  }
                  aria-pressed={on}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                    on ? "border-fuchsia-500 bg-fuchsia-500/20 text-white" : "border-[#2a3247] text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {g.name}
                </button>
              );
            })
          )}
        </div>
      )}
      {value.scope === "selected" && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {people.length === 0 ? (
            <span className="text-[11px] text-slate-500">No other accounts yet.</span>
          ) : (
            people.map((p) => {
              const on = value.users.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  aria-pressed={on}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                    on ? "border-indigo-500 bg-indigo-500/20 text-white" : "border-[#2a3247] text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {p.name}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/** Three-row read/write/delete picker used by uploads and existing items. */
export function AccessPicker({ value, onChange }: { value: AccessState; onChange: (v: AccessState) => void }) {
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  useEffect(() => {
    api
      .allUsers()
      .then((r) => setPeople(r.users))
      .catch(() => {});
    api
      .groups()
      .then((r) => setGroups(r.groups))
      .catch(() => {});
  }, []);
  return (
    <div className="space-y-2">
      <ScopeRow label="Read" hint="Who can view and download" value={value.read} people={people} groups={groups} onChange={(v) => onChange({ ...value, read: v })} />
      <ScopeRow label="Write" hint="Who can edit notes and rename" value={value.write} people={people} groups={groups} onChange={(v) => onChange({ ...value, write: v })} />
      <ScopeRow label="Delete" hint="Who can remove this item" value={value.delete} people={people} groups={groups} onChange={(v) => onChange({ ...value, delete: v })} />
    </div>
  );
}

export function AccessDialog({ item, open, onClose, onSaved }: { item: Item | null; open: boolean; onClose: () => void; onSaved: (item: Item) => void }) {
  const { push } = useToast();
  const [value, setValue] = useState<AccessState>(defaultAccess());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && item) setValue(accessFromItem(item));
  }, [open, item]);
  const save = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const r = await api.setAccess(item.id, toPayload(value));
      onSaved(r.item);
      push("ok", "Access updated");
      onClose();
    } catch (e: any) {
      push("err", e.message ?? "Failed to update access");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Access: ${item?.name ?? ""}`}>
      <div className="space-y-4">
        <AccessPicker value={value} onChange={setValue} />
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => void save()} disabled={busy}>
            <Icon name="check" size={14} /> {busy ? "Saving…" : "Save access"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/** Confirm-share dialog shown after files are selected, before the upload finalizes. */
export function UploadAccessDialog({
  files,
  open,
  onClose,
  onConfirm,
}: {
  files: File[];
  open: boolean;
  onClose: () => void;
  onConfirm: (a: AccessState) => void;
}) {
  const [value, setValue] = useState<AccessState>(defaultAccess());
  useEffect(() => {
    if (open) setValue(defaultAccess());
  }, [open]);
  const total = useMemo(() => files.reduce((n, f) => n + f.size, 0), [files]);
  return (
    <Modal open={open} onClose={onClose} title={`Share ${files.length} file${files.length === 1 ? "" : "s"}`}>
      <div className="space-y-4">
        <div className="rounded-xl border border-[#232a3a] bg-[#12161f] p-3 text-xs text-slate-400">
          <div className="mb-1 flex items-center gap-1.5 text-slate-200">
            <Icon name="upload" size={14} /> {files.length} file{files.length === 1 ? "" : "s"} · {humanSize(total)}
          </div>
          <div className="truncate">{files.map((f) => f.name).join(", ")}</div>
        </div>
        <AccessPicker value={value} onChange={setValue} />
        <p className="text-[11px] leading-relaxed text-slate-500">
          Anyone can read these by default. Only you can edit or delete them. You can change that later from the item's Access menu.
        </p>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => onConfirm(value)}>
            <Icon name="upload" size={14} /> Upload &amp; share
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/** In-app preview: images/PDF/video/audio/text render in the DOM; URLs open a new window. */
export function PreviewModal({ item, open, onClose }: { item: Item | null; open: boolean; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setText(null);
    setFailed(false);
    if (!open || !item) return;
    if (item.type === "text") {
      fetch(`/api/items/${item.id}/preview`, { credentials: "include" })
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then(setText)
        .catch(() => setFailed(true));
    }
  }, [open, item]);

  if (!item) return null;
  const src = `/api/items/${item.id}/preview`;
  const mime = item.mime ?? "";
  return (
    <Modal open={open} onClose={onClose} title={item.name} wide>
      <div className="space-y-3">
        <div className="flex max-h-[65vh] min-h-[200px] items-center justify-center overflow-auto rounded-xl border border-[#2a3247] bg-black/40 p-2">
          {item.type === "image" ? (
            <img src={src} alt={item.name} className="max-h-[62vh] max-w-full object-contain" />
          ) : mime.startsWith("video/") ? (
            <video src={src} controls className="max-h-[62vh] max-w-full" />
          ) : mime.startsWith("audio/") ? (
            <audio src={src} controls className="w-full px-4" />
          ) : mime === "application/pdf" ? (
            <iframe src={src} title={item.name} className="h-[62vh] w-full rounded-lg bg-white" />
          ) : item.type === "text" ? (
            failed ? (
              <span className="p-6 text-sm text-red-300">Preview unavailable - download the note instead.</span>
            ) : (
              <pre className="h-full max-h-[60vh] w-full overflow-auto whitespace-pre-wrap break-words p-4 text-left text-sm text-slate-200">{text ?? "Loading…"}</pre>
            )
          ) : (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-slate-400">
              <Icon name={mimeIcon(mime, item.name)} size={34} className="text-slate-500" />
              No inline preview for this type - download it to open locally.
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">{humanSize(item.size)} · {item.mime}</span>
          <div className="flex gap-2">
            <Btn size="sm" variant="soft" href={`/api/items/${item.id}/download`} download={item.name}>
              <Icon name="download" size={14} /> Download
            </Btn>
            {item.type === "url" && (
              <Btn
                size="sm"
                disabled={!isHttpUrl(item.preview)}
                onClick={() => isHttpUrl(item.preview) && window.open(item.preview, "_blank", "noopener,noreferrer")}
              >
                <Icon name="external" size={14} /> Open link
              </Btn>
            )}
          </div>
        </div>
        {item.type === "url" && (
          <div className="rounded-lg border border-[#232a3a] bg-[#12161f] p-2 text-[11px] text-slate-500">
            URL items open in a new browser window.
          </div>
        )}
      </div>
    </Modal>
  );
}
