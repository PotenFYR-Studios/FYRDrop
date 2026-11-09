import { useCallback, useEffect, useState } from "react";
import { api, humanSize, timeAgo, type MyShareLink, type ShareStats } from "../api";
import { Icon, mimeIcon } from "../icons";
import { Badge, Bars, Btn, Card, CopyBtn, Empty, Modal, PageHeader, Spinner, StatCard, useSync, useToast } from "../ui";

const KIND_LABEL: Record<string, string> = { view: "opened", download: "downloaded", unlock: "entered the PIN", pin_failed: "wrong PIN", blocked: "blocked (not on the list)" };

/** Every share link you made or that points at your items, with per-link analytics. */
export default function Shares() {
  const { push } = useToast();
  const [links, setLinks] = useState<MyShareLink[] | null>(null);
  const [statsOf, setStatsOf] = useState<MyShareLink | null>(null);

  const load = useCallback(async () => {
    try {
      setLinks((await api.myShares()).links);
    } catch (e: any) {
      push("err", e?.message ?? "Could not load share links");
    }
  }, [push]);
  useEffect(() => {
    void load();
  }, [load]);
  useSync(() => void load(), { scopes: ["items"] });

  const revoke = async (l: MyShareLink) => {
    if (!window.confirm(`Revoke the link to "${l.item.name}"? People with the link lose access, and its statistics are deleted.`)) return;
    try {
      await api.revokeShare(l.item.id, l.token);
      push("ok", "Link revoked");
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Could not revoke");
    }
  };

  return (
    <div className="anim-page">
      <PageHeader title="Share links" subtitle="Who opened your links, how often they were downloaded, and from where. No IP addresses are kept." />
      {links === null ? (
        <div className="flex justify-center py-16"><Spinner size={26} /></div>
      ) : links.length === 0 ? (
        <Empty icon="share" title="No share links yet" hint="Share a file or note from its menu to get a public link." />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-[#161c28]">
            {links.map((l) => (
              <div key={l.token} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#2a3247] bg-white/[0.03] text-slate-300">
                  <Icon name={mimeIcon(l.item.mime, l.item.name)} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm text-white">{l.item.name}</span>
                    {l.active ? <Badge tone="ok">active</Badge> : <Badge tone="warn">ended</Badge>}
                    {l.hasPin && <Badge>PIN</Badge>}
                    {l.allowedUsers && <Badge tone="info">accounts only</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                    <span>{l.views} opens</span>
                    <span>
                      {l.downloads}
                      {l.maxDownloads ? ` / ${l.maxDownloads}` : ""} downloads
                    </span>
                    <span>{l.lastAccessAt ? `last ${timeAgo(l.lastAccessAt)}` : "not opened yet"}</span>
                    <span>made {timeAgo(l.createdAt)} by {l.createdBy}</span>
                    {l.expiresAt && <span>{l.expiresAt > Date.now() ? `expires ${timeAgo(l.expiresAt)}` : "expired"}</span>}
                    {l.item.size > 0 && <span>{humanSize(l.item.size)}</span>}
                  </div>
                </div>
                <CopyBtn text={`${window.location.origin}${l.url}`} label="Copy link" />
                <Btn size="sm" variant="soft" onClick={() => setStatsOf(l)}>
                  <Icon name="chart" size={13} /> Stats
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => void revoke(l)} ariaLabel={`Revoke link to ${l.item.name}`}>
                  <Icon name="trash" size={13} />
                </Btn>
              </div>
            ))}
          </div>
        </Card>
      )}
      <StatsDialog link={statsOf} onClose={() => setStatsOf(null)} />
    </div>
  );
}

function StatsDialog({ link, onClose }: { link: MyShareLink | null; onClose: () => void }) {
  const [st, setSt] = useState<ShareStats | null>(null);
  const [days, setDays] = useState(30);
  const [err, setErr] = useState("");

  useEffect(() => {
    setSt(null);
    setErr("");
    if (!link) return;
    api.shareStats(link.item.id, link.token, days).then(setSt, (e) => setErr(e?.message ?? "Could not load"));
  }, [link, days]);

  if (!link) return null;
  return (
    <Modal open onClose={onClose} title={`Statistics · ${link.item.name}`} wide>
      {err ? (
        <p className="text-sm text-red-300">{err}</p>
      ) : !st ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Opens" value={st.totals.views} icon="eye" />
            <StatCard label="Downloads" value={st.totals.downloads} icon="download" />
            <StatCard label="Visitors" value={st.totals.uniqueVisitors} sub="unique per day" icon="users" />
            <StatCard label="Wrong PINs" value={st.totals.pinFailures} sub={st.totals.blocked ? `${st.totals.blocked} blocked` : undefined} icon="lock" />
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex-1 text-sm font-medium text-white">Opens per day</span>
              {[7, 30, 90].map((d) => (
                <button key={d} onClick={() => setDays(d)} className={`rounded-lg px-2 py-0.5 text-[11px] ${days === d ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>
                  {d}d
                </button>
              ))}
            </div>
            <Bars data={st.daily.map((d) => ({ date: d.date, count: d.views }))} height={110} />
            <div className="mb-2 mt-4 text-sm font-medium text-white">Downloads per day</div>
            <Bars data={st.daily.map((d) => ({ date: d.date, count: d.downloads }))} height={70} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TopList title="Devices" rows={st.devices} />
            <TopList title="Came from" rows={st.referrers} />
          </div>
          <div>
            <div className="mb-2 text-sm font-medium text-white">Latest activity</div>
            {st.recent.length === 0 ? (
              <p className="text-xs text-slate-500">Nobody has opened this link yet.</p>
            ) : (
              <div className="max-h-56 divide-y divide-[#1c2334] overflow-y-auto rounded-xl border border-[#232a3a] text-xs">
                {st.recent.map((e, i) => (
                  <div key={i} className="flex flex-wrap gap-2 px-3 py-1.5">
                    <span className="w-20 shrink-0 text-slate-500">{timeAgo(e.ts)}</span>
                    <span className={e.kind === "pin_failed" || e.kind === "blocked" ? "text-amber-300" : "text-slate-200"}>{KIND_LABEL[e.kind] ?? e.kind}</span>
                    <span className="text-slate-500">{e.device}{e.referrer ? ` · via ${e.referrer}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function TopList({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-white">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">No data yet.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.label} className="text-xs">
              <div className="mb-0.5 flex justify-between gap-2">
                <span className="truncate text-slate-300">{r.label}</span>
                <span className="text-slate-500">{r.count}</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5">
                <div className="h-full rounded-full bg-indigo-500/70" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
