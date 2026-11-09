import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, timeAgo, type AdminDevice, type DeviceCounts } from "../../api";
import { Icon } from "../../icons";
import { Avatar, Badge, Btn, Card, Empty, Input, Label, Modal, PageHeader, Spinner, StatCard, useSync, useToast } from "../../ui";

function describeUa(ua: string) {
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Windows/i.test(ua)
    ? "Windows"
    : /Android/i.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/i.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Unknown OS";
  const mobile = /Android|iPhone|iPod|Mobile/i.test(ua);
  return { browser, os, mobile, label: `${browser} on ${os}` };
}

const IP_SOURCE: Record<string, { label: string; tone: "ok" | "warn" | "info" | "bad" }> = {
  socket: { label: "from connection", tone: "info" },
  proxy: { label: "from proxy header", tone: "info" },
  loopback: { label: "loopback", tone: "warn" },
  docker: { label: "docker bridge", tone: "warn" },
};

function metaString(device: AdminDevice, key: string): string {
  const v = device.meta?.[key];
  return typeof v === "string" ? v : "";
}

function DeviceRow({ device, onOpen, onRevoke, showAccount = true }: { device: AdminDevice; onOpen: () => void; onRevoke: () => void; showAccount?: boolean }) {
  const ua = describeUa(device.userAgent);
  const a = device.account;
  return (
    <div className="group flex flex-wrap items-start gap-3 border-t border-[#161c28] px-4 py-3 transition hover:bg-white/[0.03] first:border-t-0">
      <div className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#2a3247] bg-white/[0.03] text-slate-300">
        <Icon name={ua.mobile ? "smartphone" : "monitor"} size={17} />
        <span
          className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#0d1119] ${device.active ? "bg-emerald-400" : "bg-slate-600"}`}
          title={device.active ? "Active" : "Expired"}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={onOpen} className="truncate text-sm font-medium text-white transition hover:text-indigo-200" title="Open device details">
            {device.deviceName}
          </button>
          {device.hostName && device.hostName !== device.deviceName && (
            <span className="mono truncate text-[10px] text-slate-500" title="Host name from reverse DNS">
              {device.hostName}
            </span>
          )}
          {device.isCurrent && <Badge tone="info">this device</Badge>}
          {!device.active && <Badge tone="warn">expired</Badge>}
          {a?.isBlocked ? <Badge tone="bad">blocked account</Badge> : null}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1" title={`Server-seen address (${IP_SOURCE[device.ipSource]?.label ?? device.ipSource})`}>
            <Icon name="wifi" size={11} /> {device.ip || "no IP"}
            {device.ipSource && device.ipSource !== "socket" && device.ipSource !== "proxy" && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 text-[9px] text-amber-300">
                {IP_SOURCE[device.ipSource]?.label ?? device.ipSource}
              </span>
            )}
          </span>
          {device.reportedIp && device.reportedIp !== device.ip && (
            <>
              <span className="text-slate-600">·</span>
              <span className="mono" title="IPv4 this device reported over WebRTC">
                device says {device.reportedIp}
              </span>
            </>
          )}
          <span className="text-slate-600">·</span>
          <span>{ua.label}</span>
          <span className="text-slate-600">·</span>
          <span>last seen {timeAgo(device.lastSeenAt)}</span>
          <span className="hidden text-slate-600 sm:inline">·</span>
          <span className="hidden sm:inline">first seen {new Date(device.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
          {(device.mac || device.macNote) && (
            <>
              <span className="hidden text-slate-600 sm:inline">·</span>
              <span className="mono" title={device.mac ? "MAC detected by the server" : "MAC note entered by an admin"}>
                MAC {device.mac || device.macNote}
              </span>
            </>
          )}
        </div>

        {showAccount && (
        <div className="mt-1.5">
          {a ? (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#2a323f] bg-white/[0.03] py-0.5 pl-0.5 pr-2">
              <Avatar user={a} size={18} />
              <Link to={`/admin/users?q=${encodeURIComponent(a.name)}`} className="text-[11px] text-slate-300 transition hover:text-white" title="Open this account">
                {a.name}
              </Link>
              <span className="text-[10px] text-slate-500">{a.username ? `@${a.username}` : a.role}</span>
              {a.role === "owner" && <span className="rounded-full bg-indigo-500/20 px-1.5 text-[9px] text-indigo-200">owner</span>}
            </div>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
              <Icon name="alert" size={10} /> paired, no account signed in
            </span>
          )}
        </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Btn size="sm" variant="soft" onClick={onOpen} ariaLabel={`Details for ${device.deviceName}`}>
          <Icon name="eye" size={13} /> Details
        </Btn>
        <Btn size="sm" variant="ghost" onClick={onRevoke} className="text-slate-400 hover:bg-red-500/10 hover:text-red-300" title="Revoke device (it will need the PIN again)">
          <Icon name="power" size={13} /> Revoke
        </Btn>
      </div>
    </div>
  );
}

export default function Devices() {
  const { push } = useToast();
  const [params, setParams] = useSearchParams();
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [counts, setCounts] = useState<DeviceCounts>({ total: 0, active: 0, unassigned: 0, accounts: 0 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "idle" | "unassigned">("all");
  const [grouped, setGrouped] = useState(true);
  const [selected, setSelected] = useState<AdminDevice | null>(null);
  const [editName, setEditName] = useState("");
  const [editMac, setEditMac] = useState("");
  const [saving, setSaving] = useState(false);

  const userFilter = params.get("user") ?? "";

  const load = useCallback(async () => {
    try {
      const r = await api.devices();
      setDevices(r.devices);
      setCounts(r.counts);
    } catch (e: any) {
      push("err", e?.message ?? "Could not load devices");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);
  useSync(() => void load(), { scopes: ["sessions"] });

  const accounts = useMemo(() => {
    const map = new Map<string, { id: string; name: string; username: string | null; avatar: string | null; color: string }>();
    for (const d of devices) if (d.account) map.set(d.account.id, d.account);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [devices]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return devices.filter((d) => {
      if (userFilter && d.account?.id !== userFilter) return false;
      if (filter === "active" && !d.active) return false;
      if (filter === "idle" && d.active) return false;
      if (filter === "unassigned" && d.account) return false;
      if (!term) return true;
      return [d.deviceName, d.hostName, d.ip, d.reportedIp, d.mac, d.macNote, d.userAgent, metaString(d, "platform"), d.account?.name, d.account?.username]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [devices, q, filter, userFilter]);

  const groups = useMemo(() => {
    const buckets = new Map<string, { account: AdminDevice["account"]; devices: AdminDevice[] }>();
    for (const d of visible) {
      const key = d.account?.id ?? "__none";
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { account: d.account, devices: [] }));
      b.devices.push(d);
    }
    return [...buckets.values()].sort((x, y) => {
      if (!x.account) return 1;
      if (!y.account) return -1;
      return x.account.name.localeCompare(y.account.name);
    });
  }, [visible]);

  const open = (d: AdminDevice) => {
    setSelected(d);
    setEditName(d.deviceName);
    setEditMac(d.macNote);
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const r = await api.editDevice(selected.token, { deviceName: editName.trim(), macNote: editMac.trim() });
      setDevices((list) => list.map((d) => (d.token === selected.token ? { ...d, deviceName: r.deviceName, macNote: r.macNote } : d)));
      setSelected(null);
      push("ok", "Device updated");
    } catch (e: any) {
      push("err", e?.message ?? "Could not update the device");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (d: AdminDevice) => {
    if (!window.confirm(`Revoke "${d.deviceName}"? It will need the instance PIN again.`)) return;
    try {
      await api.revokeSession(d.token);
      setDevices((list) => list.filter((x) => x.token !== d.token));
      setCounts((c) => ({ ...c, total: Math.max(0, c.total - 1), active: d.active ? Math.max(0, c.active - 1) : c.active, unassigned: d.account ? c.unassigned : Math.max(0, c.unassigned - 1) }));
      push("ok", `Revoked ${d.deviceName}`);
      setSelected(null);
    } catch (e: any) {
      push("err", e?.message ?? "Could not revoke the device");
    }
  };

  const filteredAccount = userFilter ? accounts.find((a) => a.id === userFilter) : null;

  return (
    <div className="anim-page">
      <PageHeader
        title="Devices"
        subtitle="Every browser and phone paired with this instance, and the account signed in on it."
        actions={
          <Btn size="sm" variant="soft" onClick={() => void load()}>
            <Icon name="refresh" size={14} /> Refresh
          </Btn>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Paired devices" value={counts.total} icon="smartphone" />
        <StatCard label="Active sessions" value={counts.active} sub="not expired yet" icon="wifi" />
        <StatCard label="Accounts with devices" value={counts.accounts} icon="users" />
        <StatCard label="No account yet" value={counts.unassigned} sub="paired, nobody signed in" icon="userPlus" />
      </div>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[12rem] flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              <Icon name="search" size={14} />
            </span>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search device, account, IP or browser" className="pl-9 py-2" />
          </div>
          <select
            value={userFilter}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set("user", e.target.value);
              else next.delete("user");
              setParams(next, { replace: true });
            }}
            className="rounded-xl border border-[#2a3247] bg-[#12161f] px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
            aria-label="Filter by account"
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.username ? ` (@${a.username})` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setGrouped((v) => !v)}
            aria-pressed={grouped}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${
              grouped ? "border-indigo-500/50 bg-indigo-500/10 text-slate-100" : "border-[#2a3247] text-slate-400 hover:text-slate-200"
            }`}
          >
            <span className={`relative h-3.5 w-6 rounded-full transition ${grouped ? "bg-indigo-500" : "bg-slate-600"}`}>
              <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${grouped ? "left-3" : "left-0.5"}`} />
            </span>
            Group by account
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(
            [
              ["all", "All", counts.total],
              ["active", "Active", counts.active],
              ["idle", "Expired", counts.total - counts.active],
              ["unassigned", "No account", counts.unassigned],
            ] as const
          ).map(([key, label, n]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                filter === key ? "border-indigo-500 bg-indigo-500/15 text-white" : "border-[#2a3247] text-slate-400 hover:border-indigo-500/40 hover:text-slate-200"
              }`}
            >
              {label} <span className="text-slate-500">{n}</span>
            </button>
          ))}
          {filteredAccount && (
            <button onClick={() => setParams({}, { replace: true })} className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-[11px] text-indigo-200">
              Account: {filteredAccount.name} (clear)
            </button>
          )}
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size={26} />
        </div>
      ) : visible.length === 0 ? (
        <Empty icon="smartphone" title="No devices match" hint="Pair a device with the instance PIN and it will appear here." />
      ) : grouped ? (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.account?.id ?? "none"} className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-[#1c2334] bg-white/[0.02] px-4 py-2.5">
                {g.account ? (
                  <>
                    <Avatar user={g.account} size={26} />
                    <Link to={`/admin/users?q=${encodeURIComponent(g.account.name)}`} className="text-sm font-medium text-white transition hover:text-indigo-200">
                      {g.account.name}
                    </Link>
                    {g.account.username && <span className="text-[11px] text-slate-500">@{g.account.username}</span>}
                    {g.account.role === "owner" && <Badge tone="info">owner</Badge>}
                  </>
                ) : (
                  <>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
                      <Icon name="alert" size={12} />
                    </span>
                    <span className="text-sm font-medium text-amber-200">Paired, no account</span>
                    <span className="text-[11px] text-slate-500">someone entered the PIN but did not sign in</span>
                  </>
                )}
                <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
                  {g.account && (
                    <Link to={`/admin/logs?actor=${g.account.id}`} className="inline-flex items-center gap-1 transition hover:text-slate-300">
                      <Icon name="history" size={11} /> Account activity
                    </Link>
                  )}
                  <span>{g.devices.length} device{g.devices.length === 1 ? "" : "s"}</span>
                </div>
              </div>
              <div>
                {g.devices.map((d) => (
                  <DeviceRow key={d.token} device={d} onOpen={() => open(d)} onRevoke={() => void revoke(d)} showAccount={false} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          {visible.map((d) => (
            <DeviceRow key={d.token} device={d} onOpen={() => open(d)} onRevoke={() => void revoke(d)} />
          ))}
        </Card>
      )}

      <Modal open={selected !== null} onClose={() => setSelected(null)} title={selected ? `Device: ${selected.deviceName}` : "Device"} wide>
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {selected.account ? (
                <div className="inline-flex items-center gap-2 rounded-full border border-[#2a3247] bg-white/[0.03] py-1 pl-1 pr-3">
                  <Avatar user={selected.account} size={22} />
                  <span className="text-xs text-slate-200">{selected.account.name}</span>
                  <span className="text-[11px] text-slate-500">{selected.account.username ? `@${selected.account.username}` : ""}</span>
                </div>
              ) : (
                <Badge tone="warn">no account signed in</Badge>
              )}
              {selected.isCurrent && <Badge tone="info">this device</Badge>}
              <Badge tone={selected.active ? "ok" : "warn"}>{selected.active ? "active" : "expired"}</Badge>
            </div>

            {selected.ipSource === "docker" && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3 text-[11px] leading-relaxed text-amber-200/90">
                This server runs in a container, so it sees the Docker bridge address instead of the device's LAN IP. The
                device-reported address below is what the browser was willing to reveal. For real LAN addresses run the
                container with host networking, or put a proxy in front and set TRUST_PROXY=1.
              </div>
            )}
            {selected.ipSource === "loopback" && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3 text-[11px] leading-relaxed text-amber-200/90">
                This device reached the server over loopback, so 127.0.0.1 is accurate for it. Devices on the LAN show
                their own address when they open the instance by IP or host name.
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Display name</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={60} />
                <p className="mt-1 text-[11px] text-slate-500">
                  Taken from the device automatically. Rename only if you want a clearer label.
                </p>
              </div>
              <div>
                <Label>MAC note (manual)</Label>
                <Input value={editMac} onChange={(e) => setEditMac(e.target.value)} placeholder="aa:bb:cc:dd:ee:ff" />
                <p className="mt-1 text-[11px] text-slate-500">
                  {selected.mac
                    ? "A MAC was read from the server's neighbour table; the note is only for when it is wrong or missing."
                    : "Browsers cannot read the MAC address. Add it here if you need it for inventory."}
                </p>
              </div>
            </div>

            <dl className="grid gap-x-4 gap-y-3 rounded-xl border border-[#232a3a] bg-[#12161f] p-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Host name</dt>
                <dd className="mono mt-0.5 break-all text-slate-300">
                  {selected.hostName || <span className="text-slate-500">not published by DNS</span>}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Name source</dt>
                <dd className="mt-0.5 text-slate-300">
                  {selected.hostName ? "reverse DNS of the client IP" : "browser and operating system"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Address seen by the server</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="mono text-slate-300">{selected.ip || "unknown"}</span>
                  <Badge tone={IP_SOURCE[selected.ipSource]?.tone ?? "info"}>{IP_SOURCE[selected.ipSource]?.label ?? selected.ipSource}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Address the device reports</dt>
                <dd className="mono mt-0.5 text-slate-300">
                  {selected.reportedIp || <span className="text-slate-500">hidden by this browser</span>}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">MAC address</dt>
                <dd className="mono mt-0.5 text-slate-300">
                  {selected.mac || <span className="text-slate-500">{macReason(selected)}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">MAC note</dt>
                <dd className="mono mt-0.5 text-slate-300">{selected.macNote || <span className="text-slate-500">none</span>}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Platform</dt>
                <dd className="mt-0.5 text-slate-300">{metaString(selected, "platform") || describeUa(selected.userAgent).os}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Browser</dt>
                <dd className="mt-0.5 text-slate-300">
                  {describeUa(selected.userAgent).label} <span className="text-slate-500">({metaString(selected, "type") || "unknown"})</span>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Screen</dt>
                <dd className="mt-0.5 text-slate-300">
                  {metaString(selected, "screen") || <span className="text-slate-500">not reported</span>}
                  {typeof selected.meta?.dpr === "number" ? ` @ ${selected.meta.dpr}x` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Language and time zone</dt>
                <dd className="mt-0.5 text-slate-300">
                  {[metaString(selected, "language"), metaString(selected, "timezone")].filter(Boolean).join(" · ") || <span className="text-slate-500">not reported</span>}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">CPU and memory</dt>
                <dd className="mt-0.5 text-slate-300">
                  {selected.meta?.cores ? `${selected.meta.cores} threads` : "not reported"}
                  {selected.meta?.memoryGb ? ` · ${selected.meta.memoryGb} GB` : ""}
                  {selected.meta?.touch === true ? " · touch" : ""}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">First paired</dt>
                <dd className="mt-0.5 text-slate-300">{new Date(selected.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Last seen</dt>
                <dd className="mt-0.5 text-slate-300">
                  {timeAgo(selected.lastSeenAt)} <span className="text-slate-500">({new Date(selected.lastSeenAt).toLocaleString()})</span>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Session ends</dt>
                <dd className="mt-0.5 text-slate-300">{new Date(selected.expiresAt).toLocaleString()}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">User agent</dt>
                <dd className="mono mt-0.5 break-all text-[11px] leading-relaxed text-slate-400">{selected.userAgent || "not recorded"}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                {selected.account && (
                  <>
                    <Btn size="sm" variant="soft" href={`/admin/logs?actor=${selected.account.id}`}>
                      <Icon name="history" size={13} /> Account activity
                    </Btn>
                    <Btn size="sm" variant="soft" href={`/admin/users?q=${encodeURIComponent(selected.account.name)}`}>
                      <Icon name="user" size={13} /> Open account
                    </Btn>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <Btn size="sm" variant="danger" onClick={() => void revoke(selected)}>
                  <Icon name="power" size={13} /> Revoke device
                </Btn>
                <Btn size="sm" onClick={() => void save()} disabled={saving || !editName.trim()}>
                  {saving ? <Spinner size={14} /> : <Icon name="check" size={13} />} Save
                </Btn>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function macReason(device: AdminDevice): string {
  const source = metaString(device, "macSource");
  if (source === "unavailable-in-container") return "not visible inside Docker";
  if (source === "not-in-table") return "not in the server's neighbour table";
  if (source === "public-ip") return "client is not on this network";
  if (source === "loopback") return "loopback has no MAC";
  return "not available";
}
