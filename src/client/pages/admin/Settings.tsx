import { useCallback, useEffect, useState } from "react";
import { api, timeAgo } from "../../api";
import { Icon } from "../../icons";
import { Badge, Btn, Card, Empty, Input, Label, Modal, PageHeader, Spinner, useToast, useSync } from "../../ui";
import type { UpdateCheck, UpdateStatus } from "../../api";

type Peer = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: number;
  lastSyncAt: number | null;
  lastStatus: string;
  createdAt: number;
};

function statusTone(status: string): "ok" | "bad" | "default" {
  if (status === "ok") return "ok";
  if (status === "never") return "default";
  return "bad";
}

/** Instance settings: identity, upload limits, PIN rotation and federation peers. */
export default function AdminSettings() {
  const { push } = useToast();

  // instance
  const [appName, setAppName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [maxUploadMb, setMaxUploadMb] = useState(0);
  const [saveBusy, setSaveBusy] = useState(false);

  // pin
  const [oldPin, setOldPin] = useState("");
  const [showOldPin, setShowOldPin] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);

  // federation
  const [peers, setPeers] = useState<Peer[]>([]);
  const [peerName, setPeerName] = useState("");
  const [peerUrl, setPeerUrl] = useState("");
  const [peerToken, setPeerToken] = useState("");
  const [peerBusy, setPeerBusy] = useState(false);

  const reload = useCallback(() => {
    api
      .ownerSettings()
      .then((s) => {
        setAppName(s.appName);
        setOwnerName(s.ownerName);
        setMaxUploadMb(s.maxUploadMb);
        setOldPin(s.pin || "");
      })
      .catch((e) => push("err", e.message ?? "Failed to load settings"));
    api
      .peers()
      .then((r) => setPeers(r.peers))
      .catch(() => {});
  }, [push]);

  useEffect(reload, [reload]);
  useSync(reload);

  const saveInstance = async () => {
    if (!appName.trim() || !ownerName.trim()) {
      push("err", "App name and owner name are required");
      return;
    }
    if (!Number.isFinite(maxUploadMb) || maxUploadMb < 1 || maxUploadMb > 64 * 1024) {
      push("err", "Max upload must be between 1 and 65536 MB");
      return;
    }
    setSaveBusy(true);
    try {
      await api.saveSettings({ appName: appName.trim(), ownerName: ownerName.trim(), maxUploadMb });
      push("ok", "Settings saved");
      reload();
    } catch (e: any) {
      push("err", e.message ?? "Save failed");
    } finally {
      setSaveBusy(false);
    }
  };

  const changePin = async () => {
    if (!/^\d{4,10}$/.test(newPin)) {
      push("err", "PINs must be 4-10 digits");
      return;
    }
    if (oldPin && oldPin === newPin) {
      push("err", "The new PIN must differ from the current one");
      return;
    }
    setPinBusy(true);
    try {
      await api.saveSettings({ newPin });
      setOldPin(newPin);
      push("ok", "PIN changed. Paired devices keep access; new devices need the new PIN.");
      setNewPin("");
    } catch (e: any) {
      push("err", e.message ?? "PIN change failed");
    } finally {
      setPinBusy(false);
    }
  };

  const addPeer = async () => {
    if (!peerName.trim() || !peerUrl.trim() || !peerToken.trim()) {
      push("err", "Name, base URL and token are all required");
      return;
    }
    if (!/^https?:\/\//i.test(peerUrl.trim())) {
      push("err", "Base URL must start with http:// or https://");
      return;
    }
    setPeerBusy(true);
    try {
      await api.addPeer(peerName.trim(), peerUrl.trim().replace(/\/+$/, ""), peerToken.trim());
      push("ok", `Peer "${peerName.trim()}" added`);
      setPeerName("");
      setPeerUrl("");
      setPeerToken("");
      reload();
    } catch (e: any) {
      push("err", e.message ?? "Could not add peer");
    } finally {
      setPeerBusy(false);
    }
  };

  const removePeer = async (p: Peer) => {
    if (!window.confirm(`Remove federation peer "${p.name}"?`)) return;
    try {
      await api.deletePeer(p.id);
      push("ok", `Peer "${p.name}" removed`);
      reload();
    } catch (e: any) {
      push("err", e.message ?? "Could not remove peer");
    }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Instance name, limits and federation." />

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Icon name="settings" size={15} className="text-indigo-300" />
            Instance
          </h2>
          <div className="space-y-3">
            <div>
              <Label>App name</Label>
              <Input value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="FYRDrop" />
            </div>
            <div>
              <Label>Owner name</Label>
              <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Jon" />
            </div>
            <div>
              <Label>Max upload size (MB)</Label>
              <Input type="number" min={1} max={65536} value={maxUploadMb} onChange={(e) => setMaxUploadMb(Number(e.target.value))} />
            </div>
          </div>
          <div className="mt-4">
            <Btn onClick={() => void saveInstance()} disabled={saveBusy}>
              {saveBusy ? (
                "Saving…"
              ) : (
                <>
                  <Icon name="check" size={15} /> Save settings
                </>
              )}
            </Btn>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Icon name="key" size={15} className="text-indigo-300" />
            Change PIN
          </h2>
          <div className="space-y-3">
            <div>
              <Label>Current PIN</Label>
              <div className="flex items-center gap-2 rounded-xl border border-[#2a3247] bg-[#12161f] px-3 py-2">
                <span className="mono flex-1 text-sm tracking-[0.3em] text-slate-200">{showOldPin ? oldPin : "•".repeat(Math.max(4, oldPin.length))}</span>
                <button type="button" onClick={() => setShowOldPin((v) => !v)} className="rounded-lg p-1 text-slate-500 hover:text-slate-200" title={showOldPin ? "Hide PIN" : "Show PIN"}>
                  <Icon name={showOldPin ? "eyeOff" : "eye"} size={14} />
                </button>
                <button type="button" onClick={() => void navigator.clipboard.writeText(oldPin).then(() => push("ok", "PIN copied"))} className="rounded-lg p-1 text-slate-500 hover:text-slate-200" title="Copy PIN">
                  <Icon name="copy" size={14} />
                </button>
              </div>
            </div>
            <div>
              <Label>New PIN</Label>
              <Input
                type="password"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="••••"
                inputMode="numeric"
                autoComplete="new-password"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">4-10 digits. Existing sessions stay signed in; new sign-ins use the new PIN.</p>
          <div className="mt-4">
            <Btn variant="soft" onClick={() => void changePin()} disabled={pinBusy}>
              {pinBusy ? (
                "Changing…"
              ) : (
                <>
                  <Icon name="key" size={15} /> Change PIN
                </>
              )}
            </Btn>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
          <Icon name="globe" size={15} className="text-indigo-300" />
          Federation
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          Peers are other FYRDrop instances. Share any item with <span className="text-slate-300">Broadcast</span> in its share menu to push a copy to
          every peer.
        </p>

        <div className="mb-5 grid gap-3 md:grid-cols-[1fr_1.4fr_1fr_auto]">
          <div>
            <Label>Name</Label>
            <Input value={peerName} onChange={(e) => setPeerName(e.target.value)} placeholder="cabin-hub" />
          </div>
          <div>
            <Label>Base URL</Label>
            <Input value={peerUrl} onChange={(e) => setPeerUrl(e.target.value)} placeholder="https://cabin.example.com" />
          </div>
          <div>
            <Label>Token</Label>
            <Input value={peerToken} onChange={(e) => setPeerToken(e.target.value)} placeholder="shared secret" autoComplete="off" />
          </div>
          <div className="flex items-end">
            <Btn onClick={() => void addPeer()} disabled={peerBusy}>
              {peerBusy ? (
                "Adding…"
              ) : (
                <>
                  <Icon name="plus" size={15} /> Add peer
                </>
              )}
            </Btn>
          </div>
        </div>

        {peers.length === 0 ? (
          <Empty icon="globe" title="No federation peers" hint="Add another FYRDrop instance to sync items between hubs." />
        ) : (
          <ul className="space-y-2">
            {peers.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2a3247] bg-[#12161f] px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-white">{p.name}</span>
                    <Badge tone={statusTone(p.lastStatus)}>{p.lastStatus}</Badge>
                    {!p.enabled && <Badge tone="default">disabled</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    <span className="font-mono">{p.baseUrl}</span>
                    {p.lastSyncAt ? <span className="ml-2">· synced {timeAgo(p.lastSyncAt)}</span> : <span className="ml-2">· never synced</span>}
                  </div>
                </div>
                <Btn size="sm" variant="danger" onClick={() => void removePeer(p)}>
                  <Icon name="trash" size={14} /> Remove
                </Btn>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <RestartCard />
      <UpdateCard />
    </div>
  );
}

/* -------------------------------- Updates --------------------------------- */

function UpdateCard() {
  const { push } = useToast();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState<"check" | "stage" | "restart" | "cancel" | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.updateStatus());
    } catch (e: any) {
      push("err", e?.message ?? "Could not read the update state");
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  const runCheck = async () => {
    setBusy("check");
    try {
      const res = await api.updateCheck();
      setCheck(res);
      if (res.error) push("err", res.error);
      else if (res.latest) push(res.updateAvailable ? "ok" : "info", res.updateAvailable ? `Version ${res.latest.version} is available` : "You are on the newest release");
      else push("info", `${res.current} is the latest published version`);
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Update check failed");
    } finally {
      setBusy(null);
    }
  };

  const stage = async (tag: string) => {
    setBusy("stage");
    try {
      await api.updateStage(tag);
      push("ok", "Release staged. A restart is required.");
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Could not stage the update");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy("cancel");
    try {
      await api.updateCancel();
      push("ok", "Staged update discarded");
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Could not cancel");
    } finally {
      setBusy(null);
    }
  };

  const restart = async () => {
    setBusy("restart");
    setRestarting(true);
    try {
      await api.updateRestart();
    } catch {
      /* the server is going down; expected */
    }
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/health", { cache: "no-store" });
        if (res.ok) {
          clearInterval(timer);
          window.location.reload();
        }
      } catch {
        /* still restarting */
      }
      if (Date.now() - started > 90_000) {
        clearInterval(timer);
        setRestarting(false);
        setBusy(null);
      }
    }, 1500);
  };

  const pending = status?.pending ?? null;

  return (
    <>
      <Card className="mt-4 p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
          <Icon name="download" size={15} className="text-indigo-300" /> Software update
          {status && <Badge tone="info">v{status.current}</Badge>}
          {status?.mode === "docker" && <Badge tone="default">docker</Badge>}
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Checks the public GitHub repository, stages the release, then asks for a restart. Nothing changes until you restart.
        </p>

        {status?.mode === "docker" && (
          <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3 text-[11px] leading-relaxed text-amber-200/90">
            This instance runs in Docker. Update by pulling the new image and recreating the container:
            <pre className="mono mt-1.5 whitespace-pre-wrap break-all text-[11px] text-amber-100">{status.dockerHint}</pre>
          </div>
        )}

        {status?.lastFailure && (
          <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/[0.07] p-3 text-[11px] text-red-200/90">
            Last update failed: {status.lastFailure.error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Btn size="sm" variant="soft" onClick={() => void runCheck()} disabled={busy !== null}>
            {busy === "check" ? <Spinner size={13} /> : <Icon name="refresh" size={13} />} Check for updates
          </Btn>
          {status && status.mode !== "docker" && (
            <span className="text-[11px] text-slate-500">
              {status.mode === "git" ? "Git checkout: updates fetch the tag and rebuild in place." : "Folder install: the release is built in a staging folder and swapped on restart."}
            </span>
          )}
        </div>

        {check && (
          <div className="mt-3 rounded-xl border border-[#232a3a] bg-[#12161f] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-300">
                Current {check.current}
                {check.latest ? ` · latest ${check.latest.version}` : " · no release published yet"}
              </span>
              {check.latest && check.updateAvailable && status?.mode !== "docker" && !pending && (
                <Btn size="sm" className="ml-auto" onClick={() => void stage(check.latest!.tag)} disabled={busy !== null}>
                  {busy === "stage" ? <Spinner size={13} /> : <Icon name="download" size={13} />} Update to {check.latest.version}
                </Btn>
              )}
              {check.latest && !check.updateAvailable && <Badge tone="ok">up to date</Badge>}
            </div>
            {check.latest?.notes && (
              <>
                <button onClick={() => setShowNotes((v) => !v)} className="mt-2 text-[11px] text-indigo-300 hover:text-indigo-200">
                  {showNotes ? "Hide release notes" : "Release notes"}
                </button>
                {showNotes && (
                  <pre className="mono mt-1.5 max-h-44 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-400">{check.latest.notes}</pre>
                )}
              </>
            )}
            {check.latest?.url && (
              <a href={check.latest.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] text-slate-500 hover:text-slate-300">
                Open on GitHub
              </a>
            )}
          </div>
        )}

        {pending && (
          <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-amber-100">
              <Icon name="alert" size={14} />
              <span>
                Version {pending.to} is staged. Restart is mandatory to finish the update.
              </span>
              <div className="ml-auto flex gap-2">
                <Btn size="sm" variant="ghost" onClick={() => void cancel()} disabled={busy !== null}>
                  Discard
                </Btn>
                <Btn size="sm" onClick={() => void restart()} disabled={busy !== null}>
                  {busy === "restart" || restarting ? <Spinner size={13} /> : <Icon name="power" size={13} />} Restart now
                </Btn>
              </div>
            </div>
          </div>
        )}

        {status && status.history.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Update history</div>
            <ul className="space-y-1 text-[11px] text-slate-400">
              {status.history.slice(0, 5).map((h, i) => (
                <li key={i} className="mono">
                  {h.from} → {h.to} <span className="text-slate-600">· {timeAgo(h.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Modal
        open={!!pending && !restarting && busy !== "restart"}
        onClose={() => {}}
        title={pending ? `Restart required for ${pending.to}` : "Restart required"}
      >
        {pending && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              The new version is staged. FYRDrop has to restart before it runs. Until then this instance keeps serving{" "}
              {pending.from}.
            </p>
            <p className="text-xs text-slate-500">
              The restart helper starts the new process, deletes the previous tree, staging folders and downloaded archives, then
              the page reconnects on its own.
            </p>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => void cancel()} disabled={busy !== null}>
                Discard update
              </Btn>
              <Btn onClick={() => void restart()} disabled={busy !== null}>
                {busy === "restart" ? <Spinner size={14} /> : <Icon name="power" size={14} />} Restart and finish
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/* ------------------------ Network / restart settings ----------------------- */

function RestartCard() {
  const { push } = useToast();
  const [cfg, setCfg] = useState<any>(null);
  const [interfaces, setInterfaces] = useState<{ name: string; address: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<string[] | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    api
      .config()
      .then((r: any) => {
        setCfg(r.config);
        setInterfaces(r.interfaces ?? []);
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const r = await api.saveConfig({
        port: Number(cfg.port),
        host: cfg.host,
        networkMode: cfg.networkMode,
        tlsCertPath: cfg.tlsCertPath,
        tlsKeyPath: cfg.tlsKeyPath,
        hsts: !!cfg.hsts,
        tlsCommonName: cfg.tlsCommonName,
        sessionTtlDays: Number(cfg.sessionTtlDays),
        trustProxy: !!cfg.trustProxy,
      });
      setCfg(r.config);
      if (r.restartRequired?.length) setPending(r.restartRequired);
      else push("ok", "Saved");
    } catch (e: any) {
      push("err", e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const restart = async () => {
    setRestarting(true);
    try {
      await api.restartServer();
    } catch {
      /* expected while the process exits */
    }
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        if ((await fetch("/health", { cache: "no-store" })).ok) {
          clearInterval(timer);
          window.location.reload();
        }
      } catch {
        /* still down */
      }
      if (Date.now() - started > 60_000) {
        clearInterval(timer);
        setRestarting(false);
      }
    }, 1200);
  };

  if (!cfg) return null;

  return (
    <>
      <Card className="mt-4 p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
          <Icon name="network" size={15} className="text-indigo-300" /> Network and restart
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Port, TLS mode and proxy trust are read at boot. Saving them asks for a restart; nothing changes until then.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>Interface</Label>
            <select
              value={cfg.host ?? "0.0.0.0"}
              onChange={(e) => setCfg({ ...cfg, host: e.target.value })}
              className="w-full rounded-xl border border-[#2a3247] bg-[#12161f] px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
            >
              {interfaces.length === 0 && <option value="0.0.0.0">all interfaces</option>}
              {interfaces.map((i) => (
                <option key={i.address} value={i.address}>
                  {i.address} ({i.name})
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Port</Label>
            <Input type="number" min={1} max={65535} value={cfg.port} onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) })} />
          </div>
          <div>
            <Label>TLS mode</Label>
            <select
              value={cfg.networkMode}
              onChange={(e) => setCfg({ ...cfg, networkMode: e.target.value })}
              className="w-full rounded-xl border border-[#2a3247] bg-[#12161f] px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
            >
              <option value="auto">Auto (self-signed)</option>
              <option value="off">Off (HTTP)</option>
              <option value="custom">Custom certificate</option>
            </select>
          </div>
          <div>
            <Label>TLS common name</Label>
            <Input value={cfg.tlsCommonName ?? ""} onChange={(e) => setCfg({ ...cfg, tlsCommonName: e.target.value })} />
          </div>
          <div>
            <Label>Session length (days)</Label>
            <Input type="number" min={1} max={365} value={cfg.sessionTtlDays} onChange={(e) => setCfg({ ...cfg, sessionTtlDays: Number(e.target.value) })} />
          </div>
        </div>
        {cfg.networkMode === "custom" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Certificate path</Label>
              <Input value={cfg.tlsCertPath ?? ""} onChange={(e) => setCfg({ ...cfg, tlsCertPath: e.target.value })} placeholder="/app/data/tls/cert.pem" />
            </div>
            <div>
              <Label>Private key path</Label>
              <Input value={cfg.tlsKeyPath ?? ""} onChange={(e) => setCfg({ ...cfg, tlsKeyPath: e.target.value })} placeholder="/app/data/tls/key.pem" />
            </div>
            <p className="text-[11px] text-slate-500 sm:col-span-2">Files must exist on the server and be readable by the FYRDrop user. Relative paths are resolved from the working directory.</p>
          </div>
        )}
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={!!cfg.hsts} onChange={(e) => setCfg({ ...cfg, hsts: e.target.checked })} className="accent-indigo-500" />
          Send HSTS when serving HTTPS
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={!!cfg.trustProxy} onChange={(e) => setCfg({ ...cfg, trustProxy: e.target.checked })} className="accent-indigo-500" />
          Trust X-Forwarded-For from a reverse proxy (only enable when one sits in front)
        </label>
        {pending && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-100">
            <Icon name="alert" size={14} />
            Restart required to apply: <span className="mono">{pending.join(", ")}</span>
            <Btn size="sm" className="ml-auto" onClick={() => void restart()} disabled={restarting}>
              {restarting ? <Spinner size={13} /> : <Icon name="power" size={13} />} Restart now
            </Btn>
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <Btn size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner size={13} /> : <Icon name="check" size={13} />} Save network settings
          </Btn>
        </div>
      </Card>

      <Modal open={pending !== null && !restarting} onClose={() => setPending(null)} title="Restart required">
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            These settings only apply after a restart: <span className="mono text-white">{pending?.join(", ")}</span>.
          </p>
          <p className="text-xs text-slate-500">The server closes and the restart helper starts it again. This page reconnects on its own.</p>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setPending(null)}>Later</Btn>
            <Btn onClick={() => void restart()} disabled={restarting}>
              {restarting ? <Spinner size={14} /> : <Icon name="power" size={14} />} Restart now
            </Btn>
          </div>
        </div>
      </Modal>
    </>
  );
}
