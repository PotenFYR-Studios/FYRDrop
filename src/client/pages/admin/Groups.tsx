import { useEffect, useState } from "react";
import { api } from "../../api";
import { Icon } from "../../icons";
import { Badge, Btn, Card, Empty, PageHeader, Spinner, useToast } from "../../ui";

type AdminGroup = {
  id: string;
  name: string;
  description: string;
  color: string;
  ownerId: string;
  owner: { id: string; name: string; username: string | null } | null;
  isDefault: boolean;
  itemCount: number;
  createdAt: number;
};

export default function AdminGroups() {
  const { push } = useToast();
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await api.adminGroups();
      setGroups(r.groups);
    } catch (e: any) {
      push("err", e?.message ?? "Could not load groups");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const remove = async (g: AdminGroup) => {
    if (!window.confirm(`Delete "${g.name}"? Its items move to the owner's Default group.`)) return;
    try {
      await api.adminDeleteGroup(g.id);
      push("ok", "Group deleted");
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Could not delete");
    }
  };

  return (
    <div className="anim-page">
      <PageHeader title="Groups" subtitle="Every group on this instance, who owns it and how many items it holds." />
      {loading ? (
        <div className="flex justify-center py-16"><Spinner size={26} /></div>
      ) : groups.length === 0 ? (
        <Empty icon="users" title="No groups" hint="Users create groups from their own Groups page." />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-[#161c28]">
            {groups.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="h-8 w-8 rounded-lg border" style={{ borderColor: g.color + "55", background: g.color + "18" }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm text-white">{g.name}</span>
                    {g.isDefault && <Badge tone="default">default</Badge>}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">
                    {g.owner ? `${g.owner.name}${g.owner.username ? ` (@${g.owner.username})` : ""}` : g.ownerId} · {g.itemCount} items
                  </div>
                </div>
                {!g.isDefault && (
                  <Btn size="sm" variant="danger" onClick={() => void remove(g)}>
                    <Icon name="trash" size={13} /> Delete
                  </Btn>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
