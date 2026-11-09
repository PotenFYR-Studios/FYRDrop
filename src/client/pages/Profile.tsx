import { useEffect, useRef, useState } from "react";
import { useAuth } from "../App";
import { api, timeAgo, type DeviceSession } from "../api";
import { Icon } from "../icons";
import { Avatar, Badge, Btn, Card, Input, Label, Modal, PageHeader, Spinner, StatCard, useSync, useToast } from "../ui";
import SecuritySettings from "../components/SecuritySettings";
import NotificationPrefs from "../components/NotificationPrefs";
import DeveloperSettings from "../components/DeveloperSettings";

const PRESET_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
];

/** Resize an image file to fit within `max` px and return a data URL. */
async function resizeToDataUrl(file: File, max = 200): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Unsupported image");
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function Profile() {
  const { user, refresh, switchAccount, logout } = useAuth();
  const { push } = useToast();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [color, setColor] = useState("#6366f1");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // security
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const pwProblem =
    newPw && newPw.length < 8
      ? "Use at least 8 characters."
      : newPw && /^\d+$/.test(newPw) && newPw.length < 10
        ? "An all-digit password needs at least 10 digits."
        : newPw && user?.username && newPw.toLowerCase().includes(user.username)
          ? "Don't include your username in the password."
          : null;
  const canChangePw = !!newPw && !pwProblem && newPw === newPw2 && (!user?.hasPassword || currentPw.length > 0);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setAvatar(user.avatar);
      setColor(user.color);
      setDirty(false);
    }
  }, [user]);

  const loadDevices = () => {
    api
      .sessions()
      .then((r) => {
        const mine = r.sessions.filter((s) => s.user?.id === user?.id);
        setDevices(mine);
        setSessionCount(mine.length);
      })
      .catch(() => setSessionCount(null));
  };

  useEffect(() => {
    loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useSync(loadDevices, { scopes: ["sessions"] });

  const [renameDevice, setRenameDevice] = useState<DeviceSession | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  const saveDeviceName = async () => {
    if (!renameDevice) return;
    const name = renameValue.trim();
    if (!name) return;
    setRenaming(true);
    try {
      await api.editDevice(renameDevice.token, { deviceName: name });
      push("ok", "Device renamed");
      setRenameDevice(null);
      loadDevices();
    } catch (e: any) {
      push("err", e?.message ?? "Could not rename this device");
    } finally {
      setRenaming(false);
    }
  };

  const revokeDevice = async (token: string, name: string) => {
    if (!window.confirm(`Revoke "${name}"? It will need the instance PIN again.`)) return;
    try {
      await api.revokeSession(token);
      push("ok", `Revoked ${name}`);
      loadDevices();
    } catch (e: any) {
      push("err", e?.message ?? "Could not revoke the device");
    }
  };

  if (!user) {
    return (
      <div className="anim-page flex justify-center py-16">
        <Spinner size={26} />
      </div>
    );
  }

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    try {
      setAvatar(await resizeToDataUrl(file, 200));
      setDirty(true);
      push("ok", "Avatar ready - save to apply");
    } catch {
      push("err", "Couldn't read that image");
    }
  };

  const save = async () => {
    if (!name.trim()) {
      push("err", "Name can't be empty");
      return;
    }
    setBusy(true);
    try {
      await api.updateProfile({ name: name.trim(), avatar, color });
      await refresh();
      setDirty(false);
      push("ok", "Profile saved");
    } catch (e: any) {
      push("err", e?.message ?? "Couldn't save profile");
    } finally {
      setBusy(false);
    }
  };

  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  const changePassword = async () => {
    if (!canChangePw || pwBusy) return;
    setPwBusy(true);
    try {
      const r = await api.changePassword(user.hasPassword ? currentPw : "", newPw);
      setCurrentPw("");
      setNewPw("");
      setNewPw2("");
      push("ok", r.signedOut > 0 ? `Password changed - ${r.signedOut} other device(s) signed out` : "Password changed");
      await refresh();
    } catch (e: any) {
      push("err", e?.message ?? "Couldn't change the password");
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="anim-page">
      <PageHeader title="Your profile" subtitle="Your display name, avatar and password." />

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        {/* editor */}
        <Card className="p-6">
          <div className="mb-6 flex items-center gap-5">
            <div className="relative">
              <Avatar user={{ name: name.trim() || user.name, avatar, color }} size={88} />
              {avatar && (
                <button
                  onClick={() => {
                    setAvatar(null);
                    setDirty(true);
                  }}
                  title="Remove avatar"
                  className="absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-[#2a3247] bg-[#12161f] text-slate-400 transition hover:text-red-300"
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
            <div className="space-y-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pickAvatar(e.target.files?.[0])} />
              <div className="flex gap-2">
                <Btn variant="soft" size="sm" onClick={() => fileRef.current?.click()}><Icon name="camera" size={15} /> {avatar ? "Replace" : "Upload"} photo</Btn>
                {avatar && (
                  <Btn variant="ghost" size="sm" onClick={() => { setAvatar(null); setDirty(true); }}>Remove</Btn>
                )}
              </div>
              <p className="text-xs text-slate-500">Images are resized to ≤200px before upload.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Label>
                Display name <span className="text-red-400">*</span>
              </Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
                maxLength={60}
                placeholder="Your name"
              />
            </div>

            <div>
              <Label>
                <span className="inline-flex items-center gap-1.5"><Icon name="palette" size={13} /> Accent color</span>
              </Label>
              <div className="flex flex-wrap gap-2.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setColor(c);
                      setDirty(true);
                    }}
                    aria-label={`Color ${c}`}
                    className={`h-9 w-9 rounded-full transition-all duration-150 ${
                      color === c ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#12161f]" : "opacity-80 hover:scale-105 hover:opacity-100"
                    }`}
                    style={{ background: `linear-gradient(135deg, ${c}, ${c}88)` }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Btn disabled={busy || !dirty || !name.trim()} onClick={() => void save()}>
                {busy ? <Spinner size={16} /> : "Save changes"}
              </Btn>
              {dirty && <span className="text-xs text-amber-400/90">Unsaved changes</span>}
              {user.isBlocked ? <Badge tone="bad">blocked</Badge> : <Badge tone="ok">active</Badge>}
            </div>
          </div>
        </Card>

        {/* stats */}
        <div className="space-y-4">
          <StatCard label="Member since" value={memberSince} icon="clock" />
          <StatCard label="Device sessions" value={sessionCount ?? "-"} sub="Devices signed in to this account" icon="smartphone" />
          <Card className="p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Account details</div>
            <dl className="mt-3 space-y-3 text-xs">
              <div>
                <dt className="text-slate-500">Username</dt>
                <dd className="mt-0.5 truncate text-slate-300">{user.username ? `@${user.username}` : "not set"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">User ID</dt>
                <dd className="mono mt-0.5 break-all text-[11px] leading-relaxed text-slate-400">{user.id}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Last seen</dt>
                <dd className="mt-0.5 text-slate-300">{timeAgo(user.lastSeenAt)}</dd>
                <dd className="text-[11px] text-slate-500">{new Date(user.lastSeenAt).toLocaleString()}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      <Card className="mt-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Account &amp; security</h2>
            <p className="mt-1 text-xs text-slate-500">
              Signed in as <span className="text-slate-300">{user.username ? `@${user.username}` : user.name}</span> ·{" "}
              {user.role === "owner" ? "instance owner" : "user"} · this device stays paired when you switch accounts.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn variant="soft" size="sm" onClick={() => void switchAccount()}>
              <Icon name="switchUser" size={14} /> Switch account
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => void logout()}>
              <Icon name="logout" size={14} /> Sign out of this device
            </Btn>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div>
            <Label>{user.hasPassword ? "Current password" : "Temporary password"}</Label>
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="••••••••"
              disabled={!user.hasPassword}
            />
          </div>
          <div>
            <Label>New password</Label>
            <Input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="At least 8 characters" />
          </div>
          <div>
            <Label>Repeat new password</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void changePassword()}
              className={newPw2 && newPw2 !== newPw ? "border-red-500/60" : ""}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Btn size="sm" onClick={() => void changePassword()} disabled={!canChangePw || pwBusy}>
            {pwBusy ? <Spinner size={14} /> : <Icon name="lock" size={14} />} {pwBusy ? "Saving…" : "Change password"}
          </Btn>
          {pwProblem && <span className="text-xs text-amber-400/90">{pwProblem}</span>}
          {!pwProblem && newPw2 && newPw2 !== newPw && <span className="text-xs text-red-400">Passwords don't match</span>}
          <span className="text-[11px] text-slate-500">Changing it signs other devices out of this account.</span>
        </div>
      </Card>

      <SecuritySettings />
      <NotificationPrefs />
      <DeveloperSettings />

      <Card className="mt-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">Your devices</h2>
            <p className="mt-1 text-xs text-slate-500">
              Every device signed in to this account. Revoking one asks for the instance PIN next time.
            </p>
          </div>
          {user.role === "owner" && (
            <Btn size="sm" variant="soft" href="/admin/devices">
              <Icon name="smartphone" size={13} /> All devices
            </Btn>
          )}
        </div>
        {devices.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">No devices are signed in right now.</p>
        ) : (
          <div className="mt-4 divide-y divide-[#161c28] rounded-xl border border-[#232a3a] bg-[#12161f]">
            {devices.map((d) => {
              const ua = /Android|iPhone|iPad|Mobile/i.test(d.userAgent);
              return (
                <div key={d.token} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#2a3247] bg-white/[0.03] text-slate-300">
                    <Icon name={ua ? "smartphone" : "monitor"} size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm text-slate-100">{d.deviceName}</span>
                      {d.isCurrent && <Badge tone="info">this device</Badge>}
                      {!d.active && <Badge tone="warn">expired</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                      <span className="mono">{d.ip || "no IP"}</span>
                      {d.reportedIp && d.reportedIp !== d.ip && <span className="mono">device says {d.reportedIp}</span>}
                      <span>last seen {timeAgo(d.lastSeenAt)}</span>
                      {(d.mac || d.macNote) && <span className="mono">MAC {d.mac || d.macNote}</span>}
                      {d.hostName && d.hostName !== d.deviceName && <span className="mono">host {d.hostName}</span>}
                    </div>
                  </div>
                  {d.isCurrent && (
                    <button
                      onClick={() => {
                        setRenameDevice(d);
                        setRenameValue(d.deviceName);
                      }}
                      className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-200"
                      title="Rename this device"
                      aria-label={`Rename ${d.deviceName}`}
                    >
                      <Icon name="pencil" size={14} />
                    </button>
                  )}
                  {!d.isCurrent && (
                    <button
                      onClick={() => void revokeDevice(d.token, d.deviceName)}
                      className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
                      title="Revoke device"
                      aria-label={`Revoke ${d.deviceName}`}
                    >
                      <Icon name="power" size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal open={renameDevice !== null} onClose={() => setRenameDevice(null)} title="Rename this device">
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            The name was taken from this machine's host name. Changing it only affects the device you are using now.
          </p>
          <div>
            <Label>Device name</Label>
            <Input
              value={renameValue}
              maxLength={60}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void saveDeviceName()}
              placeholder="Living room laptop"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setRenameDevice(null)}>
              Cancel
            </Btn>
            <Btn onClick={() => void saveDeviceName()} disabled={renaming || !renameValue.trim()}>
              {renaming ? <Spinner size={14} /> : <Icon name="check" size={14} />} Save name
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
