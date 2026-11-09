import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ConfigField, type ConfigState } from "../api";
import { Icon } from "../icons";
import { Badge, Btn, Card, Input, Label, Modal, Spinner, useToast } from "../ui";

const GROUP_ORDER = ["Network & TLS", "Sessions & security", "Public address & tunnels", "Performance & updates", "Developer"];
const SELECT = "w-full rounded-xl border border-[#2a3247] bg-[#12161f] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500 disabled:opacity-50";

/**
 * Every setting the server reads at start, each also settable by an
 * environment variable. Fields set by an environment variable are locked and
 * show the variable; saved values that are not running yet stay flagged until
 * the server restarts.
 */
export default function SystemConfigCard() {
  const { push } = useToast();
  const [st, setSt] = useState<ConfigState | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [ask, setAsk] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [showEnv, setShowEnv] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.config();
      setSt(r);
      setDraft(Object.fromEntries(r.fields.map((f) => [f.key, f.value])));
    } catch (e: any) {
      push("err", e?.message ?? "Could not load the configuration");
    }
  }, [push]);
  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const m = new Map<string, ConfigField[]>();
    for (const f of st?.fields ?? []) (m.get(f.group) ?? m.set(f.group, []).get(f.group)!).push(f);
    return GROUP_ORDER.filter((g) => m.has(g)).map((g) => [g, m.get(g)!] as const);
  }, [st]);

  if (!st) return <Card className="mt-4 flex justify-center p-5"><Spinner /></Card>;

  const dirty = st.fields.filter((f) => !f.envOverride && !f.secret && JSON.stringify(draft[f.key]) !== JSON.stringify(f.value)).map((f) => f.key);
  const hasChanges = dirty.length > 0 || token.length > 0;

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = Object.fromEntries(dirty.map((k) => [k, draft[k]]));
      if (token) patch.cloudflareTunnelToken = token;
      const r = await api.saveConfig({ ...patch, ...extra });
      setSt(r);
      setDraft(Object.fromEntries(r.fields.map((f) => [f.key, f.value])));
      setToken("");
      if (r.overriddenByEnv?.length) push("info", `Saved, but ${r.overriddenByEnv.join(", ")} stay(s) as set by environment variables`);
      if (r.restartRequired?.length) setAsk(true);
      else push("ok", "Saved");
    } catch (e: any) {
      push("err", e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const restart = async () => {
    setRestarting(true);
    setAsk(false);
    try {
      await api.restartServer();
    } catch {
      /* expected while the process exits */
    }
    const started = Date.now();
    // Port, interface or TLS may change; the page can only follow if the address stays the same.
    const timer = setInterval(async () => {
      try {
        if ((await fetch("/health", { cache: "no-store" })).ok && Date.now() - started > 2500) {
          clearInterval(timer);
          window.location.reload();
        }
      } catch {
        /* still down */
      }
      if (Date.now() - started > 60_000) {
        clearInterval(timer);
        setRestarting(false);
        push("info", "The server is not answering here. If you changed the port, interface or TLS mode, open the new address.");
      }
    }, 1200);
  };

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  const control = (f: ConfigField) => {
    const locked = !!f.envOverride;
    const v = locked ? f.envOverride!.value : draft[f.key];
    if (f.key === "host") {
      return (
        <select className={SELECT} value={String(v ?? "0.0.0.0")} disabled={locked} onChange={(e) => set(f.key, e.target.value)}>
          {!st.interfaces.some((i) => i.address === v) && <option value={String(v)}>{String(v)}</option>}
          {st.interfaces.map((i) => (
            <option key={i.address} value={i.address}>{i.address} ({i.name})</option>
          ))}
        </select>
      );
    }
    if (f.key === "networkMode") {
      const val = locked ? ({ "0": "off", false: "off", off: "off", "1": "auto", true: "auto" } as Record<string, string>)[String(v).toLowerCase()] ?? String(v) : String(v);
      return (
        <select className={SELECT} value={val} disabled={locked} onChange={(e) => set(f.key, e.target.value)}>
          <option value="auto">Auto (self-signed)</option>
          <option value="off">Off (HTTP)</option>
          <option value="custom">Custom certificate</option>
        </select>
      );
    }
    if (typeof f.value === "boolean") {
      const on = locked ? ["1", "true", "yes", "on"].includes(String(v).toLowerCase()) : !!v;
      return (
        <label className="flex h-10 items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" className="accent-indigo-500" checked={on} disabled={locked} onChange={(e) => set(f.key, e.target.checked)} />
          {on ? "On" : "Off"}
        </label>
      );
    }
    if (f.secret) {
      return (
        <div className="flex gap-2">
          <Input type="password" autoComplete="off" disabled={locked} value={locked ? "••••••••" : token} onChange={(e) => setToken(e.target.value)} placeholder={f.isSet ? "set - type to replace" : "not set"} />
          {f.isSet && !locked && (
            <Btn size="sm" variant="ghost" onClick={() => window.confirm("Remove the saved tunnel token? Takes effect after a restart.") && void save({ [f.key]: null })}>
              Clear
            </Btn>
          )}
        </div>
      );
    }
    if (typeof f.value === "number") {
      return <Input type="number" disabled={locked} value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value === "" ? "" : Number(e.target.value))} />;
    }
    return <Input disabled={locked} value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} />;
  };

  const customTls = (locked: ConfigField | undefined) => (locked?.envOverride ? locked.envOverride.value : draft.networkMode) === "custom";

  return (
    <>
      <Card className="mt-4 p-5">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Icon name="sliders" size={15} className="text-indigo-300" />
          <h2 className="text-sm font-semibold text-white">System configuration</h2>
          <span className="text-xs text-slate-500">Read when the server starts. Every field can also come from an environment variable, which then wins and locks the field.</span>
        </div>

        {st.pendingRestart.length > 0 && (
          <div className="my-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-100">
            <Icon name="alert" size={14} />
            Saved but not running yet: <span className="mono">{st.pendingRestart.map((k) => st.fields.find((f) => f.key === k)?.label ?? k).join(", ")}</span>
            <Btn size="sm" className="ml-auto" onClick={() => setAsk(true)} disabled={restarting}>
              {restarting ? <Spinner size={13} /> : <Icon name="power" size={13} />} Restart now
            </Btn>
          </div>
        )}

        <div className="mt-3 space-y-5">
          {groups.map(([group, fields]) => (
            <div key={group}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">{group}</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {fields
                  .filter((f) => !((f.key === "tlsCertPath" || f.key === "tlsKeyPath") && !customTls(st.fields.find((x) => x.key === "networkMode")) && !f.envOverride))
                  .map((f) => (
                    <div key={f.key} className={f.key === "cloudflareTunnelToken" || f.key === "clusterUrl" ? "sm:col-span-2" : ""}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Label>{f.label}</Label>
                        {f.pending && <Badge tone="warn">restart</Badge>}
                        {!f.restart && <Badge>live</Badge>}
                      </div>
                      {control(f)}
                      <p className="mt-1 text-[11px] leading-snug text-slate-500">
                        {f.envOverride ? (
                          <span className="text-amber-300/90">Set by <span className="mono">{f.envOverride.name}</span>; remove the variable to use this field.</span>
                        ) : (
                          <>
                            {f.help}
                            {f.env.length > 0 && <span className="mono text-slate-600"> {f.env.join(" / ")}</span>}
                          </>
                        )}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={() => setShowEnv((s) => !s)} className="text-xs text-slate-400 hover:text-slate-200">
            {showEnv ? "Hide" : "Show"} environment-only settings
          </button>
          <span className="flex-1" />
          {hasChanges && (
            <Btn size="sm" variant="ghost" onClick={() => { setDraft(Object.fromEntries(st.fields.map((f) => [f.key, f.value]))); setToken(""); }}>
              Discard
            </Btn>
          )}
          <Btn size="sm" onClick={() => void save()} disabled={saving || !hasChanges}>
            {saving ? <Spinner size={13} /> : <Icon name="check" size={13} />} Save configuration
          </Btn>
        </div>
        {showEnv && (
          <div className="mt-3 divide-y divide-[#1c2334] rounded-xl border border-[#232a3a] text-xs">
            {st.envOnly.map((e) => (
              <div key={e.env} className="flex flex-wrap gap-2 px-3 py-2">
                <span className="mono w-28 shrink-0 text-slate-200">{e.env}</span>
                <span className="mono min-w-0 flex-1 break-all text-slate-400">{e.value || "not set"}</span>
                <span className="w-full text-slate-500">{e.help}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={ask && !restarting} onClose={() => setAsk(false)} title="Restart required">
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            These settings are saved and apply after a restart:{" "}
            <span className="mono text-white">{st.pendingRestart.map((k) => st.fields.find((f) => f.key === k)?.label ?? k).join(", ") || "-"}</span>.
          </p>
          <p className="text-xs text-slate-500">
            The server closes and the restart helper (or your process manager) starts it again. If the port, interface or TLS mode changes, open the new address afterwards.
          </p>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setAsk(false)}>Later</Btn>
            <Btn onClick={() => void restart()}>
              <Icon name="power" size={14} /> Restart now
            </Btn>
          </div>
        </div>
      </Modal>
    </>
  );
}
