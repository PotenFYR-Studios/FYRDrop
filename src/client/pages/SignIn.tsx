import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { api } from "../api";
import { Icon } from "../icons";
import { Avatar, Btn, Input, Label, Spinner, useToast } from "../ui";
import { BlurFade, BorderBeam, DotPattern, MagicCard, ShimmerButton } from "../components/magic";

const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6"];

/** Resize a picked image to a small square-ish data URL (server caps avatars at ~200 KB). */
async function resizeAvatar(file: File, max = 200): Promise<string> {
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
  return canvas.toDataURL("image/jpeg", 0.82);
}

function passwordProblem(pw: string, username: string): string | null {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 128) return "That is too long (max 128 characters).";
  if (/^\d+$/.test(pw) && pw.length < 10) return "An all-digit password needs at least 10 digits.";
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return "Don't include your username in the password.";
  return null;
}

/**
 * Combined account screen: sign in, create an account, and the mandatory
 * password change after a temporary password (owner first boot / admin reset).
 * Pairing the device with the instance PIN happens before this step.
 */
export default function SignIn() {
  const { status, user, mustChangePassword, refresh, logout } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();

  const forced = !!user && (mustChangePassword || !user.hasPassword);
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [busy, setBusy] = useState(false);

  // sign-in
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // register
  const [regName, setRegName] = useState("");
  const [regAvatar, setRegAvatar] = useState<string | null>(null);
  const [regColor, setRegColor] = useState(COLORS[0]!);
  const [confirm, setConfirm] = useState("");

  // change password
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

  const appName = status?.appName ?? "FYRDrop";
  const registrationOpen = status?.registrationOpen !== false;

  useEffect(() => {
    document.title = forced ? `Set a password · ${appName}` : `Sign in · ${appName}`;
  }, [forced, appName]);

  const pwErr = useMemo(() => (newPw ? passwordProblem(newPw, username || user?.username || "") : null), [newPw, username, user?.username]);
  const canChange = newPw.length > 0 && !pwErr && newPw === newPw2 && (!!user?.hasPassword ? currentPw.length > 0 : true);

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.accountLogin(username.trim(), password);
      setPassword("");
      await refresh();
      push("ok", r.mustChangePassword ? "Signed in - set a new password to continue" : `Welcome back, ${r.user.name}`);
      if (!r.mustChangePassword) navigate("/", { replace: true });
    } catch (e: any) {
      push("err", e?.message ?? "Couldn't sign in");
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    if (busy) return;
    const problem = passwordProblem(password, username);
    if (problem) return push("err", problem);
    if (password !== confirm) return push("err", "The passwords don't match");
    setBusy(true);
    try {
      const r = await api.register({
        username: username.trim().toLowerCase(),
        name: regName.trim() || username.trim().toLowerCase(),
        password,
        avatar: regAvatar,
        color: regColor,
      });
      setPassword("");
      setConfirm("");
      await refresh();
      push("ok", `Welcome, ${r.user.name}!`);
      navigate("/", { replace: true });
    } catch (e: any) {
      push("err", e?.message ?? "Couldn't create the account");
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (busy || !canChange) return;
    setBusy(true);
    try {
      const r = await api.changePassword(user?.hasPassword ? currentPw : "", newPw);
      setCurrentPw("");
      setNewPw("");
      setNewPw2("");
      await refresh();
      push("ok", r.signedOut > 0 ? `Password changed - ${r.signedOut} other device(s) signed out` : "Password changed");
    } catch (e: any) {
      push("err", e?.message ?? "Couldn't change the password");
    } finally {
      setBusy(false);
    }
  };

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    try {
      setRegAvatar(await resizeAvatar(file));
    } catch {
      push("err", "Couldn't read that image");
    }
  };

  const heading = forced ? "Choose a new password" : mode === "signin" ? "Sign in" : "Create your account";
  const sub = forced
    ? "This account still uses a temporary password. Pick one only you know."
    : user
      ? `Signed in on this device as ${user.name}.`
      : mode === "signin"
        ? "Use your account - or the owner's admin account."
        : "Pick a username and password. No email needed.";

  return (
    <div className="anim-page relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <DotPattern className="opacity-60" />
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[110px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-cyan-500/10 blur-[90px]" />

      <div className="relative w-full max-w-md">
        <BlurFade>
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-indigo-500/40 bg-indigo-500/10 text-indigo-300">
              <Icon name={forced ? "lock" : "fingerprint"} size={30} />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">{heading}</h1>
            <p className="mt-1 text-sm text-slate-400">{sub}</p>
            {user && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#2a3247] bg-white/[0.03] py-1 pl-1 pr-3">
                <Avatar user={user} size={24} />
                <span className="text-xs text-slate-300">{user.name}</span>
                {user.role === "owner" && <span className="rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-200">owner</span>}
              </div>
            )}
          </div>
        </BlurFade>

        <BlurFade delay={80}>
          <MagicCard className="p-6 shadow-2xl backdrop-blur">
            <BorderBeam duration={10} />
            <div className="relative space-y-4">
              {forced ? (
                <>
                  <div>
                    <Label>{user?.hasPassword ? "Current password" : "Temporary password"}</Label>
                    <Input
                      autoFocus
                      type="password"
                      autoComplete="current-password"
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      placeholder={user?.hasPassword ? "From the startup banner" : ""}
                    />
                  </div>
                  <div>
                    <Label>New password</Label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      placeholder="At least 8 characters"
                    />
                    {pwErr && <p className="mt-1.5 text-xs text-amber-400/90">{pwErr}</p>}
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
                  <ShimmerButton onClick={() => void changePassword()} disabled={!canChange || busy}>
                    {busy ? <Spinner size={16} /> : <Icon name="check" size={16} />}
                    {busy ? "Saving…" : "Save password & continue"}
                  </ShimmerButton>
                  <p className="text-center text-[11px] text-slate-500">
                    Other devices signed into this account will be signed out.
                  </p>
                </>
              ) : mode === "signin" ? (
                <>
                  <div>
                    <Label>Username</Label>
                    <Input
                      autoFocus
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void signIn()}
                      placeholder="e.g. jon"
                    />
                  </div>
                  <div>
                    <Label>Password</Label>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void signIn()}
                      placeholder="••••••••"
                    />
                  </div>
                  <ShimmerButton onClick={() => void signIn()} disabled={busy || !username.trim() || !password}>
                    {busy ? <Spinner size={16} /> : <Icon name="logout" size={16} />}
                    {busy ? "Signing in…" : "Sign in"}
                  </ShimmerButton>
                  {registrationOpen ? (
                    <button
                      onClick={() => {
                        setMode("register");
                        setPassword("");
                      }}
                      className="w-full text-center text-xs text-slate-400 transition hover:text-slate-200"
                    >
                      First time here? <span className="text-indigo-300">Create an account</span>
                    </button>
                  ) : (
                    <p className="text-center text-[11px] text-slate-500">New accounts are disabled by the administrator.</p>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <Label>Username</Label>
                    <Input
                      autoFocus
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase().slice(0, 32))}
                      placeholder="lowercase letters, digits, . _ -"
                    />
                    <p className="mt-1.5 text-[11px] text-slate-500">3-32 characters. Used to sign in; not shown to others.</p>
                  </div>
                  <div>
                    <Label>Display name</Label>
                    <Input value={regName} onChange={(e) => setRegName(e.target.value)} maxLength={40} placeholder="Your name (optional)" />
                  </div>
                  <div>
                    <Label>Password</Label>
                    <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
                    {password && passwordProblem(password, username) && (
                      <p className="mt-1.5 text-xs text-amber-400/90">{passwordProblem(password, username)}</p>
                    )}
                  </div>
                  <div>
                    <Label>Repeat password</Label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void register()}
                      className={confirm && confirm !== password ? "border-red-500/60" : ""}
                    />
                  </div>

                  <div className="flex items-center gap-3 rounded-xl border border-[#232a3a] bg-[#12161f] p-3">
                    <Avatar user={{ name: regName || username || "?", avatar: regAvatar, color: regColor }} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-slate-300">Avatar &amp; accent</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <label className="cursor-pointer rounded-lg border border-[#2a3247] bg-white/5 px-2 py-1 text-[11px] text-slate-300 transition hover:bg-white/10">
                          <Icon name="camera" size={12} /> Photo
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => void pickAvatar(e.target.files?.[0])}
                          />
                        </label>
                        {COLORS.slice(0, 6).map((c) => (
                          <button
                            key={c}
                            onClick={() => setRegColor(c)}
                            aria-label={`Accent ${c}`}
                            className={`h-5 w-5 rounded-full transition ${regColor === c ? "ring-2 ring-white ring-offset-1 ring-offset-[#12161f]" : "opacity-75 hover:opacity-100"}`}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  <ShimmerButton onClick={() => void register()} disabled={busy || !username.trim() || !password || !confirm}>
                    {busy ? <Spinner size={16} /> : <Icon name="userPlus" size={16} />}
                    {busy ? "Creating…" : "Create account"}
                  </ShimmerButton>
                  <button
                    onClick={() => {
                      setMode("signin");
                      setPassword("");
                      setConfirm("");
                    }}
                    className="w-full text-center text-xs text-slate-400 transition hover:text-slate-200"
                  >
                    Already have an account? <span className="text-indigo-300">Sign in</span>
                  </button>
                </>
              )}

              <div className="flex items-center justify-between gap-2 border-t border-[#1c2334] pt-3">
                <span className="text-[11px] text-slate-500">Pairing: this device is unlocked with the instance PIN.</span>
                <button
                  onClick={() => void logout()}
                  className="shrink-0 text-[11px] text-slate-500 transition hover:text-red-300"
                  title="Forget this device - the PIN is needed again"
                >
                  Use another PIN
                </button>
              </div>
            </div>
          </MagicCard>
        </BlurFade>

        <div className="mt-6 text-center text-[11px] text-slate-600">
          {status?.version && <span>FYRDrop {status.version} · </span>}
          <span>self-hosted secure share hub</span>
        </div>
      </div>
    </div>
  );
}
