import { useCallback, useEffect, useState } from "react";
import { api, timeAgo } from "../../api";
import { Icon } from "../../icons";
import { Badge, Btn, Card, Empty, Input, Label, PageHeader, useToast, useSync } from "../../ui";

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
  const [currentPin, setCurrentPin] = useState("");
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
      .status()
      .then((s) => {
        setAppName(s.appName);
        setOwnerName(s.ownerName);
        setMaxUploadMb(s.maxUploadMb);
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
    if (!/^\d{4,10}$/.test(currentPin) || !/^\d{4,10}$/.test(newPin)) {
      push("err", "PINs must be 4-10 digits");
      return;
    }
    if (currentPin === newPin) {
      push("err", "The new PIN must differ from the current one");
      return;
    }
    setPinBusy(true);
    try {
      await api.saveSettings({ currentPin, newPin });
      push("ok", "PIN changed. Paired devices keep access; new devices need the new PIN.");
      setCurrentPin("");
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
              <Input
                type="password"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="••••"
                inputMode="numeric"
                autoComplete="current-password"
              />
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
    </div>
  );
}
