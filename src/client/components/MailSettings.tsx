import { useEffect, useState } from "react";
import { api, type MailConfigView } from "../api";
import { Icon } from "../icons";
import { Badge, Btn, Card, Input, Label, Spinner, useToast } from "../ui";

/** Owner settings card: SMTP relay used for password resets and notifications. */
export default function MailSettings() {
  const { push } = useToast();
  const [cfg, setCfg] = useState<MailConfigView | null>(null);
  const [password, setPassword] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .mailConfig()
      .then((r) => setCfg({ ...r.config, publicUrl: r.config.publicUrl || window.location.origin }))
      .catch((e) => push("err", e?.message ?? "Could not load email settings"));
  }, [push]);

  if (!cfg) return <Card className="mt-4 flex justify-center p-5"><Spinner /></Card>;

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.saveMailConfig({ ...cfg, ...(password ? { password } : {}) });
      setCfg(r.config);
      setPassword("");
      push("ok", "Email settings saved");
    } catch (e: any) {
      push("err", e?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await api.testMail(testTo.trim());
      push("ok", `Test email sent to ${r.sentTo}`);
    } catch (e: any) {
      push("err", e?.message ?? "Sending failed");
    } finally {
      setBusy(false);
    }
  };

  const set = (p: Partial<MailConfigView>) => setCfg({ ...cfg, ...p });

  return (
    <Card className="mt-4 p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Icon name="mail" size={16} className="text-slate-300" />
        <h2 className="text-sm font-semibold text-white">Email (SMTP)</h2>
        {cfg.enabled ? <Badge tone="ok">on</Badge> : <Badge>off</Badge>}
        {cfg.outbox && <Badge tone="info">writing to FYRDROP_MAIL_OUTBOX</Badge>}
        <span className="text-xs text-slate-500">Used for password reset links, address confirmation and notification emails.</span>
      </div>
      <label className="mb-4 flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" className="accent-indigo-500" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Send email
      </label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Label>SMTP server</Label>
          <Input value={cfg.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.example.com" />
        </div>
        <div>
          <Label>Port</Label>
          <Input type="number" value={cfg.port} onChange={(e) => set({ port: Number(e.target.value) })} />
        </div>
        <div>
          <Label>Security</Label>
          <select
            value={cfg.security}
            onChange={(e) => {
              const security = e.target.value as MailConfigView["security"];
              set({ security, port: security === "tls" ? 465 : security === "starttls" ? 587 : cfg.port });
            }}
            className="w-full rounded-xl border border-[#2a3247] bg-[#12161f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-indigo-500"
          >
            <option value="starttls">STARTTLS (587)</option>
            <option value="tls">TLS (465)</option>
            <option value="none">None (LAN relay only)</option>
          </select>
        </div>
        <div>
          <Label>Username</Label>
          <Input value={cfg.user} onChange={(e) => set({ user: e.target.value })} autoComplete="off" />
        </div>
        <div>
          <Label>Password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={cfg.hasPassword ? "unchanged" : ""} autoComplete="new-password" />
        </div>
        <div className="lg:col-span-2">
          <Label>Sender</Label>
          <Input value={cfg.from} onChange={(e) => set({ from: e.target.value })} placeholder="FYRDrop <drop@example.com>" />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Label>Public address of this instance</Label>
          <Input value={cfg.publicUrl} onChange={(e) => set({ publicUrl: e.target.value })} placeholder="https://drop.example.com" />
          <p className="mt-1 text-[11px] text-slate-500">Links in emails point here. It is never taken from the request, so a forged Host header cannot redirect reset links.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Btn size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? <Spinner size={13} /> : <Icon name="check" size={13} />} Save email settings
        </Btn>
        <span className="flex-1" />
        <input
          className="h-8 w-52 rounded-lg border border-[#2a3247] bg-[#12161f] px-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-500"
          placeholder="send a test to..."
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          aria-label="Test recipient"
        />
        <Btn size="sm" variant="soft" onClick={() => void test()} disabled={busy || !testTo.trim()}>
          <Icon name="send" size={13} /> Send test
        </Btn>
      </div>
    </Card>
  );
}
