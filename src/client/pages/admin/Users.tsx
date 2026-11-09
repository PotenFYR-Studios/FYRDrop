import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, humanSize, timeAgo, type UserProfile } from "../../api";
import { Icon } from "../../icons";
import { Avatar, Badge, Btn, Card, CopyBtn, Empty, Input, Modal, PageHeader, useToast, useSync } from "../../ui";

type UserStat = UserProfile & {
  itemCount: number;
  storageBytes: number;
  downloads: number;
  devices: number;
  lastIp: string;
};

const COLORS = ["#6366f1", "#22d3ee", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#f472b6"];

/** Owner-only user management: usage stats, edit, block, sign-out, reset, delete. */
export default function Users() {
  const { push } = useToast();
  const [users, setUsers] = useState<UserStat[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [params] = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [editing, setEditing] = useState<UserStat | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(COLORS[0]!);
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ name: string; username: string; password: string } | null>(null);

  const reload = useCallback(() => {
    api
      .allUsers()
      .then((r) => setUsers(r.users as UserStat[]))
      .catch((e) => push("err", e.message ?? "Failed to load users"))
      .finally(() => setLoaded(true));
  }, [push]);

  useEffect(reload, [reload]);
  useSync(reload);

  const act = async (u: UserStat, label: string, fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      await fn();
      push("ok", `${label} · ${u.name}`);
      reload();
    } catch (e: any) {
      push("err", e.message ?? `${label} failed`);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (u: UserStat) => {
    setEditing(u);
    setEditName(u.name);
    setEditColor(u.color);
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api.editUser(editing.id, { name: editName.trim(), color: editColor });
      push("ok", "Account updated");
      setEditing(null);
      reload();
    } catch (e: any) {
      push("err", e.message ?? "Update failed");
    }
  };

  const filtered = users.filter((u) => u.name.toLowerCase().includes(query.trim().toLowerCase()));
  const totals = users.reduce(
    (acc, u) => ({ items: acc.items + u.itemCount, bytes: acc.bytes + u.storageBytes, devices: acc.devices + u.devices }),
    { items: 0, bytes: 0, devices: 0 },
  );

  return (
    <div className="anim-page">
      <PageHeader
        title="Users"
        subtitle="Accounts on this instance. The owner account can manage everything."
        actions={
          <div className="flex items-center gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search accounts…" className="w-44 py-1.5 text-xs" />
            <Badge tone="info">{users.length} accounts</Badge>
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center justify-between p-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Accounts</div>
            <div className="text-xl font-semibold text-white">{users.length}</div>
          </div>
          <Icon name="users" size={20} className="text-indigo-300" />
        </Card>
        <Card className="flex items-center justify-between p-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Their items</div>
            <div className="text-xl font-semibold text-white">{totals.items}</div>
          </div>
          <Icon name="folder" size={20} className="text-cyan-300" />
        </Card>
        <Card className="flex items-center justify-between p-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Their storage</div>
            <div className="text-xl font-semibold text-white">{humanSize(totals.bytes)}</div>
          </div>
          <Icon name="drive" size={20} className="text-emerald-300" />
        </Card>
      </div>

      {loaded && filtered.length === 0 ? (
        <Empty icon="users" title="No accounts" hint="Accounts appear here after someone registers on a paired device." />
      ) : (
        <div className="space-y-3">
          {filtered.map((u) => (
            <Card key={u.id} className={`p-4 ${u.isBlocked ? "opacity-70" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar user={u} size={42} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-white">{u.name}</span>
                      {u.username && <span className="text-[11px] text-slate-500">@{u.username}</span>}
                      <Badge tone={u.role === "owner" ? "info" : "default"}>{u.role}</Badge>
                      {u.isBlocked === 1 && <Badge tone="bad">blocked</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                      <span>{u.itemCount} items</span>
                      <span>{humanSize(u.storageBytes)}</span>
                      <Link to={`/admin/devices?user=${u.id}`} className="inline-flex items-center gap-1 text-slate-400 transition hover:text-slate-200" title="Show this account's devices">
                        <Icon name="smartphone" size={11} />
                        {u.devices} device{u.devices === 1 ? "" : "s"}
                      </Link>
                      <span>{u.downloads} downloads</span>
                      {u.lastIp && <span className="mono">last IP {u.lastIp}</span>}
                      <span>joined {timeAgo(u.createdAt)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Btn size="sm" variant="soft" onClick={() => openEdit(u)} disabled={busy}>
                    <Icon name="settings" size={13} /> Edit
                  </Btn>
                  <Link to={`/admin/devices?user=${u.id}`} className="inline-flex items-center gap-1.5 rounded-xl border border-[#2a3247] bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/10">
                    <Icon name="smartphone" size={13} /> Devices
                  </Link>
                  <Btn size="sm" variant="soft" disabled={busy} onClick={() => void act(u, "Signed out", () => api.signOutUser(u.id), `Sign ${u.name} out of every device?`)}>
                    <Icon name="logout" size={13} /> Sign out
                  </Btn>
                  <Btn
                    size="sm"
                    variant="soft"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm(`Issue a temporary password for ${u.name}? Every device signed into the account will be signed out.`)) return;
                      setBusy(true);
                      try {
                        const r = await api.resetPassword(u.id);
                        setTempPassword({ name: u.name, username: u.username ?? "", password: r.temporaryPassword });
                        reload();
                      } catch (e: any) {
                        push("err", e.message ?? "Reset failed");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Icon name="key" size={13} /> Reset password
                  </Btn>
                  {u.role !== "owner" && (
                    <>
                      <Btn
                        size="sm"
                        variant={u.isBlocked ? "soft" : "danger"}
                        disabled={busy}
                        onClick={() => void act(u, u.isBlocked ? "Unblocked" : "Blocked", () => api.setUserBlocked(u.id, u.isBlocked === 0), `${u.isBlocked ? "Unblock" : "Block"} ${u.name}?`)}
                      >
                        <Icon name={u.isBlocked ? "check" : "lock"} size={13} /> {u.isBlocked ? "Unblock" : "Block"}
                      </Btn>
                      <Btn size="sm" variant="ghost" disabled={busy} onClick={() => void act(u, "Deleted", () => api.deleteUser(u.id, false), `Delete the account ${u.name}? Their devices are signed out and their items stay on disk.`)}>
                        <Icon name="trash" size={13} />
                      </Btn>
                      <Btn
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => void act(u, "Deleted + purged", () => api.deleteUser(u.id, true), `Delete ${u.name} AND all ${u.itemCount} of their items permanently?`)}
                      >
                        <Icon name="alert" size={13} /> Purge
                      </Btn>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={`Edit ${editing?.name ?? ""}`}>
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Display name</div>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={40} />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Accent colour</div>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setEditColor(c)}
                  className={`h-8 w-8 rounded-full border-2 transition ${editColor === c ? "scale-110 border-white" : "border-transparent"}`}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Btn>
            <Btn onClick={() => void saveEdit()} disabled={!editName.trim()}>
              <Icon name="check" size={14} /> Save
            </Btn>
          </div>
        </div>
      </Modal>
      <Modal open={tempPassword !== null} onClose={() => setTempPassword(null)} title="Temporary password">
        {tempPassword && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              Hand this to <span className="font-medium text-white">{tempPassword.name}</span>. It is shown once and must be changed at
              their next sign-in.
            </p>
            <div className="rounded-xl border border-[#2a3247] bg-[#12161f] p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Username</div>
              <div className="mono text-sm text-slate-200">{tempPassword.username || "-"}</div>
              <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">Temporary password</div>
              <div className="mono break-all text-base text-cyan-300">{tempPassword.password}</div>
            </div>
            <div className="flex justify-end gap-2">
              <CopyBtn text={`${tempPassword.username} / ${tempPassword.password}`} label="Copy both" />
              <Btn onClick={() => setTempPassword(null)}>Done</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
