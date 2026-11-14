import { useCallback, useEffect, useRef, useState } from "react";
import { api, humanSize, timeAgo, uploadBackupFile, type BackupInfo, type BackupManifest, type BackupState } from "../../api";
import { Icon } from "../../icons";
import { Badge, Btn, Card, Empty, Input, Label, Modal, PageHeader, Progress, Spinner, useSync, useToast } from "../../ui";

const fmt = (ts: number) => new Date(ts).toLocaleString();

export default function Backups() {
  const { push } = useToast();
  const [state, setState] = useState<BackupState | null>(null);
  const [includeFiles, setIncludeFiles] = useState(false);
  const [encrypt, setEncrypt] = useState(true);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [restoreOf, setRestoreOf] = useState<BackupInfo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setState(await api.backups());
    } catch (e: any) {
      push("err", e?.message ?? "Could not load backups");
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);
  useSync(() => void load());

  // A big backup keeps running after the request returns; poll until it is done.
  useEffect(() => {
    if (!state?.running) return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [state?.running, load]);

  const create = async () => {
    if (encrypt) {
      if (pass.length < 10) return push("err", "Use a passphrase of at least 10 characters.");
      if (pass !== pass2) return push("err", "The passphrases do not match.");
    }
    setBusy(true);
    try {
      const r = await api.createBackup({ includeFiles, passphrase: encrypt ? pass : undefined, note: note.trim() || undefined });
      push("ok", r.running ? "Backup started - it keeps running in the background" : `Backup ${r.backup?.name} created`);
      setPass("");
      setPass2("");
      setNote("");
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Backup failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b: BackupInfo) => {
    if (!window.confirm(`Delete ${b.name}? This cannot be undone.`)) return;
    try {
      await api.deleteBackup(b.name);
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Could not delete");
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploadPct(0);
    try {
      const r = await uploadBackupFile(file, setUploadPct);
      push("ok", `Uploaded as ${r.name}`);
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Upload failed");
    } finally {
      setUploadPct(null);
    }
  };

  const saveSchedule = async (patch: Parameters<typeof api.backupSchedule>[0]) => {
    try {
      const r = await api.backupSchedule(patch);
      setState((s) => (s ? { ...s, schedule: r.schedule } : s));
    } catch (e: any) {
      push("err", e?.message ?? "Could not save the schedule");
    }
  };

  const cancelRestore = async () => {
    try {
      await api.cancelRestore();
      push("ok", "Restore cancelled");
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Could not cancel");
    }
  };

  if (!state) return <div className="flex justify-center py-16"><Spinner size={26} /></div>;
  const sch = state.schedule;

  return (
    <div className="anim-page">
      <PageHeader title="Backups" subtitle="Snapshot the database, keys and settings (and optionally every stored file), download it, or restore from it." />

      {state.staged && (
        <Card className="mb-5 border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Icon name="alert" size={18} className="text-amber-300" />
            <div className="min-w-0 flex-1 text-sm text-amber-100">
              Restore from <b>{state.staged.from}</b> (made {fmt(state.staged.manifest.createdAt)}) is ready and is applied the next time the server starts.
            </div>
            <Btn size="sm" variant="ghost" onClick={() => void cancelRestore()}>Cancel restore</Btn>
            <Btn
              size="sm"
              variant="danger"
              onClick={async () => {
                await api.restartServer().catch(() => {});
                push("info", "Restarting - sign in again in a few seconds");
              }}
            >
              Restart now
            </Btn>
          </div>
        </Card>
      )}
      {state.lastRestore && Date.now() - state.lastRestore.at < 7 * 86_400_000 && (
        <Card className={`mb-5 p-4 text-sm ${state.lastRestore.ok ? "border-emerald-500/30 text-emerald-200" : "border-red-500/40 text-red-200"}`}>
          {state.lastRestore.ok
            ? `Restored from ${state.lastRestore.from ?? "a backup"} ${timeAgo(state.lastRestore.at)}. The data it replaced is kept in ${state.lastRestore.previous}.`
            : `The restore ${timeAgo(state.lastRestore.at)} failed and nothing was changed: ${state.lastRestore.error}`}
        </Card>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <div className="flex items-center gap-2 font-medium text-white"><Icon name="database" size={16} /> New backup</div>
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input type="checkbox" className="mt-0.5 accent-indigo-500" checked={includeFiles} onChange={(e) => setIncludeFiles(e.target.checked)} />
            <span>
              Include stored files
              <span className="block text-xs text-slate-500">Without it the backup holds accounts, items, shares, settings and keys, but item bytes stay on this disk.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input type="checkbox" className="mt-0.5 accent-indigo-500" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
            <span>
              Encrypt with a passphrase
              <span className="block text-xs text-slate-500">Strongly recommended: a backup contains the instance's master key. Without the passphrase it cannot be restored.</span>
            </span>
          </label>
          {encrypt && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input type="password" placeholder="Passphrase (10+ characters)" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
              <Input type="password" placeholder="Repeat passphrase" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
            </div>
          )}
          <Input placeholder="Note (optional)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          <div className="flex items-center gap-3">
            <Btn onClick={() => void create()} disabled={busy || state.running}>
              {busy || state.running ? <Spinner size={14} /> : <Icon name="download" size={14} />} {state.running ? "Backup running..." : "Create backup"}
            </Btn>
            {state.lastError && <span className="text-xs text-red-300">Last backup failed: {state.lastError}</span>}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div className="flex items-center gap-2 font-medium text-white"><Icon name="clock" size={16} /> Automatic backups</div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" className="accent-indigo-500" checked={sch.enabled} onChange={(e) => void saveSchedule({ enabled: e.target.checked })} />
            Run automatically
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Every (hours)</Label>
              <Input type="number" min={1} max={720} value={sch.everyHours} onChange={(e) => setState({ ...state, schedule: { ...sch, everyHours: Number(e.target.value) } })} onBlur={() => void saveSchedule({ everyHours: sch.everyHours })} />
            </div>
            <div>
              <Label>Keep the last</Label>
              <Input type="number" min={1} max={100} value={sch.keep} onChange={(e) => setState({ ...state, schedule: { ...sch, keep: Number(e.target.value) } })} onBlur={() => void saveSchedule({ keep: sch.keep })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" className="accent-indigo-500" checked={sch.includeFiles} onChange={(e) => void saveSchedule({ includeFiles: e.target.checked })} />
            Include stored files
          </label>
          <p className="text-xs text-slate-500">
            Automatic backups are not passphrase protected and stay in the backups folder on this server; download and encrypt one before moving it elsewhere.
            {sch.lastRunAt ? ` Last run ${timeAgo(sch.lastRunAt)}.` : ""}
            {sch.lastError ? ` Last error: ${sch.lastError}` : ""}
          </p>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-white">Backups on this server</div>
        <div className="flex items-center gap-2">
          {uploadPct !== null && <div className="w-40"><Progress pct={uploadPct} /></div>}
          <input ref={fileRef} type="file" accept=".tar,.fyb" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          <Btn size="sm" variant="soft" onClick={() => fileRef.current?.click()} disabled={uploadPct !== null}>
            <Icon name="upload" size={13} /> Upload a backup
          </Btn>
        </div>
      </div>
      {state.backups.length === 0 ? (
        <Empty icon="database" title="No backups yet" hint="Create one above or upload a backup from another FYRDrop." />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-[#161c28]">
            {state.backups.map((b) => (
              <div key={b.name} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Icon name={b.encrypted ? "lock" : "archive"} size={16} className={b.encrypted ? "text-emerald-300" : "text-slate-500"} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-mono text-xs text-white">{b.name}</span>
                    {b.encrypted && <Badge tone="ok">encrypted</Badge>}
                    {b.includesFiles && <Badge tone="info">with files</Badge>}
                    {b.auto && <Badge>auto</Badge>}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">
                    {fmt(b.createdAt)} · {humanSize(b.size)}{b.note ? ` · ${b.note}` : ""}
                  </div>
                </div>
                <Btn size="sm" variant="soft" href={`/api/backups/file/${encodeURIComponent(b.name)}`} download={b.name}>
                  <Icon name="download" size={13} /> Download
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => setRestoreOf(b)}>
                  <Icon name="refresh" size={13} /> Restore
                </Btn>
                <Btn size="sm" variant="danger" onClick={() => void remove(b)} ariaLabel={`Delete ${b.name}`}>
                  <Icon name="trash" size={13} />
                </Btn>
              </div>
            ))}
          </div>
        </Card>
      )}

      <RestoreDialog backup={restoreOf} onClose={() => setRestoreOf(null)} onDone={() => void load()} />
    </div>
  );
}

function RestoreDialog({ backup, onClose, onDone }: { backup: BackupInfo | null; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [pass, setPass] = useState("");
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPass("");
    setManifest(null);
    setErr("");
    setConfirm("");
    if (backup && !backup.encrypted) {
      api.inspectBackup(backup.name).then((r) => setManifest(r.manifest), (e) => setErr(e?.message ?? "Could not read the backup"));
    }
  }, [backup]);

  if (!backup) return null;

  const inspect = async () => {
    setBusy(true);
    setErr("");
    try {
      setManifest((await api.inspectBackup(backup.name, pass)).manifest);
    } catch (e: any) {
      setErr(e?.message ?? "Could not read the backup");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (restart: boolean) => {
    setBusy(true);
    try {
      await api.restoreBackup(backup.name, backup.encrypted ? pass : undefined, restart);
      push(restart ? "info" : "ok", restart ? "Restoring - the server restarts, then sign in with the backup's accounts (and PIN, if it had one)" : "Restore staged - it is applied on the next restart");
      onDone();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Restore ${backup.name}`}>
      <div className="space-y-4 text-sm">
        <p className="text-slate-300">
          Restoring replaces <b>everything</b> on this instance: accounts, items, shares, settings, the PIN and the keys. The current data is kept in
          <code className="mx-1 text-xs">restore_previous</code>on the server so it can be recovered by hand.
        </p>
        {backup.encrypted && !manifest && (
          <div className="flex gap-2">
            <Input type="password" placeholder="Backup passphrase" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" />
            <Btn onClick={() => void inspect()} disabled={busy || !pass}>{busy ? <Spinner size={14} /> : "Unlock"}</Btn>
          </div>
        )}
        {manifest && (
          <div className="rounded-xl border border-[#2a3247] bg-white/[0.02] p-3 text-xs text-slate-300">
            <div>Made {fmt(manifest.createdAt)} by FYRDrop {manifest.version} ({manifest.appName})</div>
            <div>{manifest.counts.users} accounts · {manifest.counts.items} items{manifest.includesFiles ? ` · ${manifest.counts.files} files (${humanSize(manifest.counts.bytes)})` : " · no file contents"}</div>
            {!manifest.includesFiles && <div className="mt-1 text-amber-300">This backup has no file contents. Items only open if their files are still on this server.</div>}
            {manifest.note && <div className="mt-1 text-slate-500">{manifest.note}</div>}
          </div>
        )}
        {err && <div className="text-red-300">{err}</div>}
        {manifest && (
          <>
            <div>
              <Label>Type RESTORE to confirm</Label>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESTORE" />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Btn variant="ghost" onClick={() => void restore(false)} disabled={busy || confirm !== "RESTORE"}>Stage for next restart</Btn>
              <Btn variant="danger" onClick={() => void restore(true)} disabled={busy || confirm !== "RESTORE"}>
                {busy ? <Spinner size={14} /> : <Icon name="refresh" size={14} />} Restore and restart
              </Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
