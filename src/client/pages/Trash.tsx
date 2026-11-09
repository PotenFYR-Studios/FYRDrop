import { useCallback, useEffect, useState } from "react";
import { api, humanSize, timeAgo, type Item } from "../api";
import { Icon, mimeIcon } from "../icons";
import { Btn, Card, Empty, PageHeader, Spinner, useToast } from "../ui";

export default function Trash() {
  const { push } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.trash();
      setItems(r.items);
    } catch (e: any) {
      push("err", e?.message ?? "Could not load trash");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (it: Item) => {
    setBusy(it.id);
    try {
      await api.restoreItem(it.id);
      push("ok", `Restored ${it.name}`);
      setItems((list) => list.filter((x) => x.id !== it.id));
    } catch (e: any) {
      push("err", e?.message ?? "Could not restore");
    } finally {
      setBusy(null);
    }
  };

  const purge = async (it: Item) => {
    if (!window.confirm(`Delete "${it.name}" forever? This cannot be undone.`)) return;
    setBusy(it.id);
    try {
      await api.purgeItem(it.id);
      push("ok", "Deleted forever");
      setItems((list) => list.filter((x) => x.id !== it.id));
    } catch (e: any) {
      push("err", e?.message ?? "Could not delete");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="anim-page">
      <PageHeader title="Trash" subtitle="Deleted items stay here for 30 days. Restore them, or remove them for good." />
      {loading ? (
        <div className="flex justify-center py-16"><Spinner size={26} /></div>
      ) : items.length === 0 ? (
        <Empty icon="trash" title="Trash is empty" hint="Items you delete land here for 30 days before they are removed." />
      ) : (
        <Card className="divide-y divide-[#161c28] overflow-hidden">
          {items.map((it) => (
            <div key={it.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Icon name={mimeIcon(it.mime, it.name)} size={18} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-200">{it.name}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-500">
                  <span>{humanSize(it.size)}</span>
                  {it.deletedAt && <><span>·</span><span>deleted {timeAgo(it.deletedAt)}</span></>}
                </div>
              </div>
              <Btn size="sm" variant="soft" onClick={() => void restore(it)} disabled={busy === it.id}>
                <Icon name="refresh" size={13} /> Restore
              </Btn>
              <Btn size="sm" variant="danger" onClick={() => void purge(it)} disabled={busy === it.id}>
                <Icon name="trash" size={13} /> Delete forever
              </Btn>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
