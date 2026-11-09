import { useCallback, useEffect, useState } from "react";
import { api, humanSize, type Item } from "../api";
import { Badge, Card, Empty, ItemMeta, PageHeader, Spinner, StatCard, useSync, useToast } from "../ui";
import { Icon, mimeIcon, type IconName } from "../icons";
import { Link } from "react-router-dom";
import { useAuth } from "../App";

/** Pick a glyph for any item: notes, links and images by type, files by mime. */
function typeIcon(item: Item): IconName {
  if (item.type === "text") return "note";
  if (item.type === "image") return "image";
  if (item.type === "url") return "link";
  return mimeIcon(item.mime, item.name);
}

export default function Dashboard() {
  const { push } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [pinned, setPinned] = useState<Item[]>([]);
  const [devices, setDevices] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [all, pin, sess] = await Promise.all([api.items(), api.pinned(), api.sessions()]);
      setItems(all.items);
      setPinned(pin.items);
      setDevices(sess.sessions.filter((s) => s.active).length || sess.sessions.length);
    } catch (e: any) {
      push("err", e.message ?? "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useSync(() => void reload());

  const storage = items.reduce((s, i) => s + i.size, 0);
  const downloads = items.reduce((s, i) => s + i.downloads, 0);
  const recent = items.slice(0, 8);

  const togglePin = async (item: Item) => {
    try {
      await api.setPin(item.id, !item.pinned);
      push("ok", item.pinned ? "Unpinned" : "Pinned to quick links");
    } catch (e: any) {
      push("err", e.message ?? "Failed to update pin");
    }
  };

  return (
    <div className="anim-page">
      <PageHeader title="Dashboard" subtitle="Files, notes, links and images from all your devices." />

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size={26} />
        </div>
      ) : (
        <div className="space-y-7">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Items" value={items.length} sub="across all types" icon="folder" />
            <StatCard label="Storage used" value={humanSize(storage)} sub="sum of all items" icon="drive" />
            <StatCard label="Downloads" value={downloads} sub="total download count" icon="download" />
            <Link to={user?.role === "owner" ? "/admin/devices" : "/profile"} className="block" title="Open devices">
              <StatCard label="Devices" value={devices} sub={user?.role === "owner" ? "active sessions, view all" : "signed in to your account"} icon="smartphone" />
            </Link>
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                <Icon name="star" size={18} className="text-amber-400" />
                Quick Links
              </h2>
              <Badge tone="info">{pinned.length} pinned</Badge>
            </div>
            {pinned.length === 0 ? (
              <Empty icon="star" title="Nothing pinned yet" hint="Pin a file, note, link or image to reach it from here." />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pinned.map((p) => (
                  <Card key={p.id} className="group p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="shrink-0 text-slate-400">
                          <Icon name={typeIcon(p)} size={20} />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white" title={p.name}>{p.name}</div>
                          <div className="flex items-center gap-1 text-[11px] text-slate-500">
                            <span>{humanSize(p.size)}</span>
                            <span aria-hidden="true">·</span>
                            <Icon name="download" size={11} />
                            <span>{p.downloads}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => void togglePin(p)}
                        title={p.pinned ? "Unpin" : "Pin"}
                        aria-label={p.pinned ? "Unpin" : "Pin"}
                        className={`shrink-0 rounded-lg p-1 transition hover:scale-110 hover:bg-white/5 ${p.pinned ? "text-amber-400" : "text-slate-600"}`}
                      >
                        <Icon name="star" size={15} filled={!!p.pinned} />
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                <Icon name="clock" size={18} className="text-slate-400" />
                Recent activity
              </h2>
              <div className="flex items-center gap-3">
                {user?.role === "owner" && (
                  <Link to="/admin/logs" className="inline-flex items-center gap-1 text-xs text-slate-500 transition hover:text-slate-300">
                    <Icon name="history" size={12} /> Activity
                  </Link>
                )}
                <Link to="/files" className="inline-flex items-center gap-1 text-xs text-indigo-400 transition hover:text-indigo-300">
                  View all
                  <Icon name="arrowRight" size={13} />
                </Link>
              </div>
            </div>
            {recent.length === 0 ? (
              <Empty title="No items yet" hint="Upload a file, drop a note or share a link to get started." />
            ) : (
              <Card className="divide-y divide-[#1c2334] overflow-hidden">
                {recent.map((it) => (
                  <div key={it.id} className="flex items-center gap-3 p-4 transition hover:bg-white/[0.03]">
                    <span className="shrink-0 text-slate-500">
                      <Icon name={typeIcon(it)} size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-100" title={it.name}>{it.name}</div>
                      <ItemMeta item={it} />
                    </div>
                    {it.pinned ? (
                      <Badge tone="warn">
                        <Icon name="star" size={11} filled />
                        pinned
                      </Badge>
                    ) : null}
                  </div>
                ))}
              </Card>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
