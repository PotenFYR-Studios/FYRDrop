import { useCallback, useEffect, useState } from "react";
import { api, humanSize, type Item } from "../../api";
import { Icon, mimeIcon, type IconName } from "../../icons";
import { Bars, Badge, Card, Donut, ItemMeta, PageHeader, StatCard, useToast } from "../../ui";

const TYPE_COLORS: Record<string, string> = {
  file: "#6366f1",
  image: "#22d3ee",
  text: "#34d399",
  url: "#fbbf24",
};

/** Top-download rows only carry the coarse item type, so map it back to a pseudo-MIME for the icon lookup. */
const typeIcon = (type: string, name: string): IconName =>
  mimeIcon(type === "image" ? "image/png" : type === "text" ? "text/plain" : "", name);

type Stats = {
  totals: { items: number; downloads: number; storageBytes: number; devices: number; certs: number; expiringCerts: number };
  byType: { type: string; count: number; bytes: number; downloads: number }[];
  timeline: { date: string; count: number; bytes: number }[];
  topDownloads: { id: string; name: string; type: string; downloads: number }[];
  recent: Item[];
};

/** Admin analytics: usage totals, upload timeline, content mix, top and recent items. */
export default function Analytics() {
  const { push } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);

  const reload = useCallback(() => {
    api
      .stats()
      .then(setStats)
      .catch((e) => push("err", e.message ?? "Failed to load stats"));
  }, [push]);

  useEffect(reload, [reload]);

  if (!stats) return <div className="py-16 text-center text-sm text-slate-500">Loading analytics…</div>;

  const t = stats.totals;
  return (
    <div>
      <PageHeader title="Analytics" subtitle="Usage across this instance." />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Items" value={t.items} icon="folder" />
        <StatCard label="Downloads" value={t.downloads} icon="download" />
        <StatCard label="Storage" value={humanSize(t.storageBytes)} icon="drive" />
        <StatCard label="Devices" value={t.devices} icon="radio" />
        <StatCard label="Certificates" value={t.certs} icon="key" />
        <StatCard label="Expiring certs" value={t.expiringCerts} icon="alert" />
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card className="p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">Uploads, last 14 days</h2>
          <p className="mb-4 text-xs text-slate-500">All item types, per calendar day.</p>
          <Bars data={stats.timeline.map((d) => ({ date: d.date, count: d.count }))} height={140} />
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">Content mix</h2>
          <Donut
            segments={stats.byType.map((b) => ({ label: b.type, value: b.count, color: TYPE_COLORS[b.type] ?? "#94a3b8" }))}
          />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">Top downloads</h2>
          {stats.topDownloads.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">Nothing downloaded yet.</p>
          ) : (
            <ol className="space-y-2">
              {stats.topDownloads.map((d, i) => (
                <li key={d.id} className="flex items-center gap-3 rounded-xl border border-[#2a3247] bg-[#12161f] px-3.5 py-2.5">
                  <span className={`w-5 text-center text-xs font-bold ${i === 0 ? "text-amber-300" : "text-slate-500"}`}>{i + 1}</span>
                  <Icon name={typeIcon(d.type, d.name)} size={15} className="shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{d.name}</span>
                  <Badge tone="info">{d.type}</Badge>
                  <span className="flex items-center gap-1 text-xs font-medium text-cyan-300">
                    <Icon name="download" size={12} /> {d.downloads}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">Recent items</h2>
          {stats.recent.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">No items yet.</p>
          ) : (
            <ul className="divide-y divide-[#1c2334]">
              {stats.recent.map((item) => (
                <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-1.5 truncate text-sm text-slate-200">
                    {item.pinned && <Icon name="star" size={12} className="shrink-0 text-amber-300" />}
                    <span className="truncate">{item.name}</span>
                  </div>
                  {item.preview && <div className="truncate text-[11px] text-slate-500">{item.preview}</div>}
                  <ItemMeta item={item} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
