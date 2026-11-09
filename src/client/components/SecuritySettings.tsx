import { useCallback, useEffect, useState } from "react";
import { api, timeAgo, type AccountSecurity } from "../api";
import { Icon } from "../icons";
import { Badge, Btn, Card, CopyBtn, Input, Label, Modal, Spinner, useToast } from "../ui";

type Ask = { title: string; action: (password: string) => Promise<void> } | null;

/** Profile section: email address, authenticator app, passkeys, recovery codes. */
export default function SecuritySettings() {
  const { push } = useToast();
  const [sec, setSec] = useState<AccountSecurity | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [askPw, setAskPw] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [keyName, setKeyName] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await api.accountSecurity();
      setSec(s);
      setEmail((e) => e || s.email || "");
    } catch (e: any) {
      push("err", e?.message ?? "Could not load security settings");
    }
  }, [push]);
  useEffect(() => {
    void load();
  }, [load]);

  const withPassword = (title: string, action: (pw: string) => Promise<void>) => {
    setAskPw("");
    setAsk({ title, action });
  };

  const runAsk = async () => {
    if (!ask || !askPw) return;
    setAskBusy(true);
    try {
      await ask.action(askPw);
      setAsk(null);
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "That did not work");
    } finally {
      setAskBusy(false);
    }
  };

  const enableTotp = async () => {
    try {
      const r = await api.totpEnable(setupCode);
      setSetup(null);
      setSetupCode("");
      setCodes(r.recoveryCodes);
      push("ok", "Authenticator app turned on");
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Wrong code");
    }
  };

  const addPasskey = (pw: string) =>
    (async () => {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const optionsJSON = await api.passkeyOptions(pw, keyName.trim() || guessKeyName());
      let response;
      try {
        response = await startRegistration({ optionsJSON });
      } catch (e: any) {
        if (e?.name === "NotAllowedError") throw new Error("Passkey creation was cancelled");
        if (e?.name === "InvalidStateError") throw new Error("This device already has a passkey for your account");
        throw e;
      }
      const r = await api.passkeyRegister(response);
      setKeyName("");
      if (r.recoveryCodes) setCodes(r.recoveryCodes);
      push("ok", "Passkey added");
    })();

  if (!sec) return <Card className="mt-5 flex justify-center p-6"><Spinner /></Card>;
  const any2fa = sec.totpEnabled || sec.passkeys.length > 0;

  return (
    <Card className="mt-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Two-step sign-in &amp; recovery</h2>
          <p className="mt-1 text-xs text-slate-500">After your password, ask for a code from your phone or a passkey. A confirmed email lets you reset a forgotten password.</p>
        </div>
        {any2fa ? <Badge tone="ok">2-step on</Badge> : <Badge tone="warn">2-step off</Badge>}
      </div>

      {/* Email */}
      <div className="mt-5 rounded-xl border border-[#232a3a] bg-[#12161f] p-4">
        <div className="mb-2 flex items-center gap-2 text-sm text-slate-200">
          <Icon name="mail" size={15} /> Email address
          {sec.email && sec.emailVerified && <Badge tone="ok">confirmed</Badge>}
        </div>
        {!sec.mailEnabled && !sec.email ? (
          <p className="text-xs text-slate-500">Email is not set up on this instance yet. The owner can add an SMTP server in Settings.</p>
        ) : sec.pendingEmail ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[10rem] flex-1">
              <Label>Code sent to {sec.pendingEmail}</Label>
              <Input inputMode="numeric" value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" />
            </div>
            <Btn
              size="sm"
              onClick={async () => {
                try {
                  await api.verifyEmail(emailCode);
                  setEmailCode("");
                  push("ok", "Email confirmed");
                  await load();
                } catch (e: any) {
                  push("err", e?.message ?? "Wrong code");
                }
              }}
              disabled={emailCode.length !== 6}
            >
              Confirm
            </Btn>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <Btn
              size="sm"
              variant="soft"
              disabled={!email.trim() || email.trim().toLowerCase() === sec.email}
              onClick={() =>
                withPassword("Confirm your password to change the email address", async (pw) => {
                  const r = await api.setEmail(email.trim(), pw);
                  push("ok", `Code sent to ${r.sentTo}`);
                })
              }
            >
              {sec.email ? "Change" : "Add"}
            </Btn>
            {sec.email && (
              <Btn size="sm" variant="ghost" onClick={() => withPassword("Confirm your password to remove the email address", async (pw) => { await api.removeEmail(pw); setEmail(""); })}>
                Remove
              </Btn>
            )}
          </div>
        )}
      </div>

      {/* Authenticator app */}
      <div className="mt-3 rounded-xl border border-[#232a3a] bg-[#12161f] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Icon name="smartphone" size={15} className="text-slate-300" />
          <span className="text-sm text-slate-200">Authenticator app</span>
          {sec.totpEnabled && <Badge tone="ok">on</Badge>}
          <span className="flex-1" />
          {sec.totpEnabled ? (
            <Btn size="sm" variant="ghost" onClick={() => withPassword("Confirm your password to turn off the authenticator app", (pw) => api.totpDisable(pw).then(() => push("ok", "Authenticator app turned off")))}>
              Turn off
            </Btn>
          ) : (
            <Btn size="sm" variant="soft" onClick={() => withPassword("Confirm your password to set up an authenticator app", async (pw) => setSetup(await api.totpSetup(pw)))}>
              Set up
            </Btn>
          )}
        </div>
        {setup && (
          <div className="mt-4 flex flex-wrap gap-4">
            <img src={setup.qr} alt="QR code for your authenticator app" className="h-40 w-40 rounded-lg bg-white p-1" />
            <div className="min-w-[12rem] flex-1 space-y-3 text-xs text-slate-400">
              <p>Scan the code with Google Authenticator, 1Password, Aegis or any TOTP app. Or type the key:</p>
              <div className="flex items-center gap-2">
                <code className="mono break-all rounded bg-white/5 px-2 py-1 text-slate-200">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                <CopyBtn text={setup.secret} />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label>Code shown in the app</Label>
                  <Input inputMode="numeric" value={setupCode} onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => e.key === "Enter" && setupCode.length === 6 && void enableTotp()} placeholder="123456" autoFocus />
                </div>
                <Btn size="sm" onClick={() => void enableTotp()} disabled={setupCode.length !== 6}>Turn on</Btn>
                <Btn size="sm" variant="ghost" onClick={() => setSetup(null)}>Cancel</Btn>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Passkeys */}
      <div className="mt-3 rounded-xl border border-[#232a3a] bg-[#12161f] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Icon name="fingerprint" size={15} className="text-slate-300" />
          <span className="text-sm text-slate-200">Passkeys &amp; security keys</span>
          <span className="flex-1" />
          {sec.passkeysAvailable && (
            <>
              <input className="h-8 w-40 rounded-lg border border-[#2a3247] bg-[#0e1219] px-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-500" placeholder="Name (optional)" value={keyName} maxLength={60} onChange={(e) => setKeyName(e.target.value)} aria-label="Passkey name" />
              <Btn size="sm" variant="soft" onClick={() => withPassword("Confirm your password to add a passkey", addPasskey)}>Add</Btn>
            </>
          )}
        </div>
        {!sec.passkeysAvailable && <p className="mt-2 text-xs text-amber-300/90">{sec.passkeysProblem}</p>}
        {sec.passkeys.length > 0 && (
          <div className="mt-3 divide-y divide-[#1c2334]">
            {sec.passkeys.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                <span className="text-slate-200">{k.name}</span>
                <span className="text-slate-500">
                  for {k.rpId} · added {timeAgo(k.createdAt)}{k.lastUsedAt ? ` · used ${timeAgo(k.lastUsedAt)}` : ""}
                </span>
                {sec.currentRpId && k.rpId !== sec.currentRpId && <Badge tone="warn">other address</Badge>}
                <span className="flex-1" />
                <Btn size="sm" variant="ghost" onClick={() => withPassword(`Confirm your password to remove "${k.name}"`, (pw) => api.passkeyDelete(k.id, pw).then(() => push("ok", "Passkey removed")))}>
                  <Icon name="trash" size={13} />
                </Btn>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recovery */}
      {any2fa && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#232a3a] bg-[#12161f] p-4 text-sm text-slate-200">
          <Icon name="key" size={15} className="text-slate-300" /> Recovery codes
          <span className="text-xs text-slate-500">{sec.recoveryCodesLeft} left - each works once if you lose your phone or key</span>
          <span className="flex-1" />
          <Btn size="sm" variant="ghost" onClick={() => withPassword("Confirm your password to replace your recovery codes", async (pw) => setCodes((await api.regenerateRecovery(pw)).recoveryCodes))}>
            New codes
          </Btn>
        </div>
      )}

      <Modal open={!!ask} onClose={() => setAsk(null)} title={ask?.title ?? ""}>
        <div className="space-y-3">
          <Input type="password" autoFocus autoComplete="current-password" value={askPw} onChange={(e) => setAskPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void runAsk()} placeholder="Your password" />
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setAsk(null)}>Cancel</Btn>
            <Btn onClick={() => void runAsk()} disabled={askBusy || !askPw}>{askBusy ? <Spinner size={14} /> : "Continue"}</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={!!codes} onClose={() => setCodes(null)} title="Save your recovery codes">
        <div className="space-y-3 text-sm">
          <p className="text-slate-300">Each code signs you in once if you lose your second factor. They are shown only now - store them somewhere safe.</p>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#2a3247] bg-white/[0.03] p-3">
            {codes?.map((c) => <code key={c} className="mono text-slate-100">{c}</code>)}
          </div>
          <div className="flex justify-end gap-2">
            <CopyBtn text={(codes ?? []).join("\n")} label="Copy all" />
            <Btn onClick={() => setCodes(null)}>I saved them</Btn>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function guessKeyName() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iPhone / iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows Hello";
  return "Passkey";
}
