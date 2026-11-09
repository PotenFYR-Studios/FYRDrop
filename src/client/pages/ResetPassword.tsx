import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Icon } from "../icons";
import { Btn, Input, Label, Spinner } from "../ui";
import { DotPattern } from "../components/magic";

/**
 * Public page opened from a password reset email. The token is in the URL
 * fragment, so it never reaches a server log; it is read once and cleared
 * from the address bar.
 */
export default function ResetPassword() {
  const token = useMemo(() => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "", []);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Reset password";
    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
  }, []);

  const problem = pw && pw.length < 8 ? "Use at least 8 characters." : pw2 && pw !== pw2 ? "The passwords don't match." : "";

  const submit = async () => {
    if (busy || !pw || problem || pw !== pw2) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.resetPasswordWithToken(token, pw);
      setDone(r.username);
    } catch (e: any) {
      setErr(e?.message ?? "Could not reset the password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <DotPattern className="opacity-60" />
      <div className="glass relative w-full max-w-md rounded-2xl p-7">
        <div className="mb-4 flex items-center gap-2 text-white">
          <Icon name="key" size={20} className="text-indigo-300" />
          <h1 className="text-lg font-semibold">Choose a new password</h1>
        </div>
        {!token ? (
          <p className="text-sm text-slate-300">This link is incomplete. Open the link from the email again, or ask for a new one on the sign-in page.</p>
        ) : done ? (
          <div className="space-y-4 text-sm text-slate-300">
            <p>The password for <b>@{done}</b> was changed and every device signed in to it was signed out.</p>
            <Btn href="/">Go to sign in</Btn>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label>New password</Label>
              <Input type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
            <div>
              <Label>Repeat new password</Label>
              <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} />
            </div>
            {(problem || err) && <p className="text-xs text-red-300">{problem || err}</p>}
            <Btn className="w-full" onClick={() => void submit()} disabled={busy || !pw || !!problem || pw !== pw2}>
              {busy ? <Spinner size={14} /> : <Icon name="check" size={14} />} Save new password
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
