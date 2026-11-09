import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, timeAgo, type GroupDetail, type GroupSummary } from "../api";
import { Icon } from "../icons";
import { Avatar, Badge, Btn, Card, Empty, Input, Label, Modal, PageHeader, Spinner, useToast } from "../ui";

export default function Groups() {
  const { push } = useToast();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [memberName, setMemberName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.groups();
      setGroups(r.groups);
    } catch (e: any) {
      push("err", e?.message ?? "Could not load groups");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.createGroup({ name: name.trim(), description: description.trim() || undefined });
      push("ok", `Created ${name.trim()}`);
      setCreating(false);
      setName("");
      setDescription("");
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Could not create the group");
    } finally {
      setBusy(false);
    }
  };

  const open = async (g: GroupSummary) => {
    try {
      setDetail(await api.group(g.id));
      setMemberName("");
    } catch (e: any) {
      push("err", e?.message ?? "Could not open the group");
    }
  };

  const addMember = async () => {
    if (!detail || !memberName.trim()) return;
    setBusy(true);
    try {
      await api.addGroupMember(detail.group.id, memberName.trim());
      push("ok", "Member added");
      setMemberName("");
      await open(detail.group);
    } catch (e: any) {
      push("err", e?.message ?? "Could not add that account");
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    if (!detail) return;
    try {
      await api.removeGroupMember(detail.group.id, userId);
      await open(detail.group);
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Could not remove the member");
    }
  };

  const removeGroup = async () => {
    if (!detail) return;
    if (!window.confirm(`Delete "${detail.group.name}"? Its items move back to Default.`)) return;
    try {
      await api.deleteGroup(detail.group.id);
      setDetail(null);
      push("ok", "Group deleted, items moved to Default");
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Could not delete the group");
    }
  };

  return (
    <div className="anim-page">
      <PageHeader
        title="Groups"
        subtitle="Put files in a group. Add people to the group and they can read everything in it."
        actions={
          <Btn size="sm" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> New group
          </Btn>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size={26} />
        </div>
      ) : groups.length === 0 ? (
        <Empty icon="users" title="No groups yet" hint="Create a group and add people to share whole folders at once." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => void open(g)}
              className="group rounded-2xl border border-[#232a3a] bg-[#0d1119] p-4 text-left transition hover:border-indigo-500/50"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border" style={{ borderColor: g.color + "55", background: g.color + "18", color: g.color }}>
                  <Icon name="users" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-white">{g.name}</span>
                    {g.isDefault && <Badge tone="default">default</Badge>}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">{g.description || "no description"}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-400">
                <span>{g.itemCount} items</span>
                <span className="text-slate-600">·</span>
                <span>{g.memberCount} members</span>
                <span className="ml-auto text-slate-600">{g.mine ? "you own it" : "member"}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New group">
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Project Atlas" />
          </div>
          <div>
            <Label>Description</Label>
            <Input value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="What belongs here?" />
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setCreating(false)}>Cancel</Btn>
            <Btn onClick={() => void create()} disabled={busy || !name.trim()}>
              {busy ? <Spinner size={14} /> : <Icon name="plus" size={14} />} Create
            </Btn>
          </div>
        </div>
      </Modal>

      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail ? detail.group.name : "Group"} wide>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>{detail.group.itemCount} items</span>
              <span className="text-slate-600">·</span>
              <span>{detail.members.length} members</span>
              <span className="text-slate-600">·</span>
              <span>created {timeAgo(detail.group.createdAt)}</span>
              <Btn size="sm" variant="soft" href={`/files?group=${detail.group.id}`} className="ml-auto">
                <Icon name="folder" size={13} /> Open files
              </Btn>
            </div>

            <div>
              <Label>Members</Label>
              <div className="divide-y divide-[#161c28] rounded-xl border border-[#232a3a] bg-[#12161f]">
                {detail.members.map((m) => (
                  <div key={m.userId} className="flex items-center gap-2 px-3 py-2">
                    {m.user ? <Avatar user={m.user} size={24} /> : <span className="h-6 w-6 rounded-full bg-white/10" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-slate-200">{m.user?.name ?? m.userId}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {m.user?.username ? `@${m.user.username}` : ""} {m.role === "owner" ? "· owner" : ""}
                      </div>
                    </div>
                    {m.role !== "owner" && (detail.canManage || m.userId === detail.group.ownerId) && (
                      <button onClick={() => void removeMember(m.userId)} className="rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300" title="Remove from group">
                        <Icon name="x" size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {detail.canManage && (
              <>
                <div className="flex gap-2">
                  <Input value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Add by username" onKeyDown={(e) => e.key === "Enter" && void addMember()} />
                  <Btn size="sm" onClick={() => void addMember()} disabled={busy || !memberName.trim()}>
                    <Icon name="userPlus" size={13} /> Add
                  </Btn>
                </div>
                <p className="text-[11px] text-slate-500">Members can read items in this group. Editing and deleting stay with the uploader unless the item's access says otherwise.</p>
                <div className="flex items-center justify-between border-t border-[#1c2334] pt-3">
                  <Link to={`/files?group=${detail.group.id}`} className="text-xs text-indigo-300 hover:text-indigo-200">Show items in Files</Link>
                  {!detail.group.isDefault && (
                    <Btn size="sm" variant="danger" onClick={() => void removeGroup()}>
                      <Icon name="trash" size={13} /> Delete group
                    </Btn>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
