import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, timeAgo, type LogEntry, type LogPage } from "../../api";
import { Icon, type IconName } from "../../icons";
import { Badge, Btn, Card, Empty, Input, PageHeader, Spinner, StatCard, useSync, useToast } from "../../ui";

type CategoryMeta = { icon: IconName; tint: string; label: string };

const CATEGORY: Record<string, CategoryMeta> = {
  all: { icon: "list", tint: "text-slate-300 bg-white/5 ring-white/10", label: "All" },
  auth: { icon: "key", tint: "text-indigo-300 bg-indigo-400/10 ring-indigo-400/20", label: "Sign-in" },
  account: { icon: "user", tint: "text-cyan-300 bg-cyan-400/10 ring-cyan-400/20", label: "Accounts" },
  device: { icon: "smartphone", tint: "text-emerald-300 bg-emerald-400/10 ring-emerald-400/20", label: "Devices" },
  item: { icon: "folder", tint: "text-sky-300 bg-sky-400/10 ring-sky-400/20", label: "Items" },
  share: { icon: "link", tint: "text-violet-300 bg-violet-400/10 ring-violet-400/20", label: "Share links" },
  cert: { icon: "shieldCheck", tint: "text-yellow-300 bg-yellow-400/10 ring-yellow-400/20", label: "Certificates" },
  storage: { icon: "drive", tint: "text-amber-300 bg-amber-400/10 ring-amber-400/20", label: "Storage" },
  cluster: { icon: "globe", tint: "text-teal-300 bg-teal-400/10 ring-teal-400/20", label: "Cluster" },
  federation: { icon: "network", tint: "text-fuchsia-300 bg-fuchsia-400/10 ring-fuchsia-400/20", label: "Federation" },
  security: { icon: "alert", tint: "text-red-300 bg-red-400/10 ring-red-400/20", label: "Security" },
  system: { icon: "cpu", tint: "text-slate-300 bg-slate-400/10 ring-slate-400/20", label: "System" },
};

const EVENT_LABEL: Record<string, string> = {
  "login.ok": "Device paired",
  "login.failed": "PIN rejected",
  "account.login": "Signed in",
  "account.login-failed": "Sign-in failed",
  "account.login-blocked": "Blocked account tried to sign in",
  "account.registered": "Account created",
  "account.password-changed": "Password changed",
  "user.signout-all": "Signed out every device",
  "user.password-reset": "Temporary password issued",
  "user.blocked": "Account blocked",
  "user.unblocked": "Account unblocked",
  "user.deleted": "Account deleted",
  "settings.updated": "Instance settings changed",
  "storage.cleanup": "Storage cleanup",
  "storage.unit-added": "Storage unit added",
  "storage.unit-removed": "Storage unit removed",
  "config.updated": "System config changed",
  "item.upload": "File uploaded",
  "item.note": "Note created",
  "item.link": "Link saved",
  "item.download": "File downloaded",
  "item.deleted": "Item deleted",
  "item.access": "Access changed",
  "item.renamed": "Item renamed",
  "item.audience": "Read access changed",
  "share.link-created": "Share link created",
  "share.link-revoked": "Share link revoked",
  "share.download": "Downloaded from a share link",
  "share.pin-failed": "Wrong share link PIN",
  "share.blocked": "Restricted share link blocked",
  "cert.generated": "Certificate generated",
  "cert.uploaded": "Certificate uploaded",
  "cert.deleted": "Certificate deleted",
  "cert.key-downloaded": "Private key downloaded",
  "device.updated": "Device details updated",
  "device.revoked": "Device revoked",
  "ip.whitelist-block": "Request blocked by IP whitelist",
  "user.blocked-request": "Blocked account kept a session",
  "federation.inbound": "Item received from a peer",
  "federation.inbound-rejected": "Federation request rejected",
  "system.expired-items": "Expired items purged",
};

function eventLabel(event: string) {
  if (EVENT_LABEL[event]) return EVENT_LABEL[event];
  const [group, ...rest] = event.split(".");
  const verb = (rest.join(".") || group || "event").replace(/[-_]/g, " ");
  return verb.charAt(0).toUpperCase() + verb.slice(1);
}

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(ts) === dayKey(today.getTime())) return "Today";
  if (dayKey(ts) === dayKey(yesterday.getTime())) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function clock(ts: number) {
  // 24-hour clock: one fixed-width line, no AM/PM wrapping in a narrow column.
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

const SEVERITY_TONE = { info: "ok", warn: "warn", error: "bad" } as const;

function LogRow({ entry }: { entry: LogEntry }) {
  const meta = CATEGORY[entry.category] ?? CATEGORY.system!;
  const [open, setOpen] = useState(false);
  const hasMeta = entry.meta != null && (typeof entry.meta !== "object" || Object.keys(entry.meta as object).length > 0);
  return (
    <div className="group relative flex gap-3 px-3 py-3 transition hover:bg-white/[0.03] sm:px-4">
      <div className="w-20 shrink-0 pt-0.5 text-right tabular-nums sm:w-24">
        <div className="mono whitespace-nowrap text-[11px] leading-4 text-slate-400">{clock(entry.ts)}</div>
        <div className="whitespace-nowrap text-[10px] leading-4 text-slate-500" title={new Date(entry.ts).toLocaleString()}>
          {timeAgo(entry.ts)}
        </div>
      </div>

      <div className="relative flex w-7 shrink-0 justify-center">
        <span className={`absolute inset-y-0 left-1/2 w-px ${entry.severity === "error" ? "bg-red-500/20" : entry.severity === "warn" ? "bg-amber-500/20" : "bg-[#232a3a]"}`} />
        <span className={`relative mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${meta.tint}`}>
          <Icon name={meta.icon} size={14} />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-slate-100">{eventLabel(entry.event)}</span>
          {!entry.ok && <Badge tone="bad">failed</Badge>}
          {entry.ok && entry.severity !== "info" && <Badge tone={SEVERITY_TONE[entry.severity]}>{entry.severity}</Badge>}
          <span className="mono rounded bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-slate-400">{entry.event}</span>
        </div>
        {entry.detail && <div className="mt-0.5 break-words text-[13px] leading-snug text-slate-400">{entry.detail}</div>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
          {entry.actorId ? (
            <Link
              to={`/admin/users?q=${encodeURIComponent(entry.actorName)}`}
              className="inline-flex items-center gap-1 text-slate-300 transition hover:text-white"
              title="Open this account"
            >
              <Icon name="user" size={11} />
              {entry.actorName || "account"}
            </Link>
          ) : entry.actorName ? (
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Icon name="monitor" size={11} />
              {entry.actorName}
            </span>
          ) : null}
          {entry.actorId && (
            <Link to={`/admin/devices?user=${entry.actorId}`} className="inline-flex items-center gap-1 transition hover:text-slate-300" title="Devices for this account">
              <Icon name="smartphone" size={11} /> devices
            </Link>
          )}
          {entry.target && (
            <span className="inline-flex min-w-0 items-center gap-1" title={entry.target}>
              <Icon name="arrowRight" size={11} />
              <span className="max-w-[16rem] truncate text-slate-400">{entry.target}</span>
            </span>
          )}
          {entry.ip && (
            <span className="mono inline-flex items-center gap-1" title="Client IP">
              <Icon name="wifi" size={11} /> {entry.ip}
            </span>
          )}
          <span className="rounded-full border border-[#2a3247] px-1.5 py-0.5 text-[10px] text-slate-400">{meta.label}</span>
          {hasMeta && (
            <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-slate-400 transition hover:text-slate-200" aria-expanded={open}>
              <Icon name="chevronDown" size={11} className={open ? "rotate-180 transition" : "transition"} /> details
            </button>
          )}
        </div>
        {open && hasMeta && (
          <pre className="mono mt-2 max-h-56 overflow-auto rounded-lg border border-[#232a3a] bg-[#0b0e14] p-2.5 text-[11px] leading-relaxed text-slate-400">
            {JSON.stringify(entry.meta, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

export default function Logs() {
  const { push } = useToast();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState<LogPage | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [query, setQuery] = useState(() => (params.get("q") ?? "").trim());
  const actor = params.get("actor") ?? "";
  const [category, setCategory] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [days, setDays] = useState(0);
  const [live, setLive] = useState(true);

  // 300 ms debounce so typing doesn't hammer the API.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(
    async (append = false) => {
      try {
        const r = await api.adminLogs({
          q: query,
          actor,
          category,
          severity,
          days,
          limit: 150,
          before: append ? (page?.nextBefore ?? undefined) : undefined,
        });
        setPage(r);
        setEntries((prev) => (append ? [...prev, ...r.entries] : r.entries));
      } catch (e: any) {
        push("err", e?.message ?? "Could not load the activity log");
      } finally {
        setLoading(false);
        setMore(false);
      }
    },
    [query, actor, category, severity, days, page?.nextBefore, push],
  );

  // Filter changes reload from the top.
  useEffect(() => {
    setLoading(true);
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, actor, category, severity, days]);

  useSync(() => {
    if (live) void load(false);
  }, { scopes: ["audit"] });

  const groups = useMemo(() => {
    const map = new Map<string, LogEntry[]>();
    for (const e of entries) {
      const k = dayKey(e.ts);
      const list = map.get(k);
      if (list) list.push(e);
      else map.set(k, [e]);
    }
    return [...map.values()];
  }, [entries]);

  const cats = page?.categories ?? [];
  const totals = page?.totals ?? { events: 0, failed: 0, warnings: 0, errors: 0 };

  return (
    <div className="anim-page">
      <PageHeader
        title="Activity log"
        subtitle="Sign-ins, uploads, downloads and admin actions, with the account and device behind each one."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLive((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition ${
                live ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-[#2a3247] text-slate-400 hover:text-slate-200"
              }`}
              title={live ? "New events appear automatically" : "Automatic refresh is off"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-slate-500"}`} />
              {live ? "Live" : "Paused"}
            </button>
            <Btn size="sm" variant="soft" onClick={() => void load(false)} disabled={loading}>
              <Icon name="refresh" size={14} /> Refresh
            </Btn>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Events (24h)" value={totals.events} sub="everything below" icon="history" />
        <StatCard label="Warnings" value={totals.warnings} sub="unusual, not necessarily bad" icon="alert" />
        <StatCard label="Errors" value={totals.errors} sub="blocked or rejected" icon="shieldCheck" />
        <StatCard label="Failed events" value={totals.failed} sub="the action did not succeed" icon="x" />
      </div>

      <Card className="mb-4 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              <Icon name="search" size={14} />
            </span>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events, accounts, targets or IPs" className="pl-9 py-2" />
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-[#2a3247] bg-[#0d1119] p-1">
            {[
              ["all", "Any status"],
              ["failed", "Failed"],
              ["warn", "Warnings"],
              ["error", "Errors"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSeverity(key!)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                  severity === key ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-xl border border-[#2a3247] bg-[#12161f] px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
            aria-label="Time range"
          >
            <option value={0}>All time</option>
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>

        {actor && (
          <div className="mt-2">
            <button
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete("actor");
                setParams(next, { replace: true });
              }}
              className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-[11px] text-indigo-200"
            >
              Only this account's events (clear)
            </button>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["all", ...cats].map((key) => {
            const meta = CATEGORY[key] ?? CATEGORY.system!;
            const n = key === "all" ? Object.values(page?.counts ?? {}).reduce((a, b) => a + b, 0) : (page?.counts?.[key] ?? 0);
            const active = category === key;
            if (key !== "all" && n === 0 && !active) return null;
            return (
              <button
                key={key}
                onClick={() => setCategory(key)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${
                  active ? "border-indigo-500 bg-indigo-500/15 text-white" : "border-[#2a3247] text-slate-400 hover:border-indigo-500/40 hover:text-slate-200"
                }`}
              >
                <Icon name={meta.icon} size={12} />
                {meta.label}
                <span className={`rounded-full px-1 text-[10px] ${active ? "bg-white/10 text-white" : "bg-white/5 text-slate-500"}`}>{n}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size={26} />
        </div>
      ) : entries.length === 0 ? (
        <Empty icon="history" title="Nothing logged yet" hint="Sign-ins, uploads, downloads, access changes and admin actions show up here." />
      ) : (
        <Card className="overflow-hidden">
          {groups.map((group) => (
            <section key={dayKey(group[0]!.ts)}>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-[#1c2334] bg-[#0d1119]/95 py-1.5 pl-[9rem] pr-4 backdrop-blur first:border-t-0 sm:pl-[10.25rem]">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{dayLabel(group[0]!.ts)}</span>
                <span className="text-[10px] text-slate-600">{group.length} event{group.length === 1 ? "" : "s"}</span>
              </div>
              <div className="divide-y divide-[#161c28]">
                {group.map((e) => (
                  <LogRow key={e.id} entry={e} />
                ))}
              </div>
            </section>
          ))}
          {page?.nextBefore && (
            <div className="flex justify-center border-t border-[#1c2334] p-3">
              <Btn size="sm" variant="soft" disabled={more} onClick={() => { setMore(true); void load(true); }}>
                {more ? <Spinner size={14} /> : <Icon name="chevronDown" size={14} />} Load older events
              </Btn>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
