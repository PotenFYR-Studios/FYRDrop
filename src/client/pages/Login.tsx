import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../App";
import { api } from "../api";
import { Icon } from "../icons";
import { Btn, Input, Label, Spinner, useToast } from "../ui";
import { BorderBeam, DotPattern } from "../components/magic";
import { collectHints, quickHints, type DeviceHints } from "../device";

export default function Login() {
  const { status, refresh } = useAuth();
  const { push } = useToast();
  const [pin, setPin] = useState("");
  const [hints, setHints] = useState<DeviceHints>(() => quickHints());
  const [detected, setDetected] = useState<{ deviceName: string; hostName: string } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const appName = status?.appName ?? "FYRDrop";
  const version = status?.version ?? "";
  const valid = useMemo(() => /^\d{4,10}$/.test(pin), [pin]);

  // Runs when the page opens: describe this device and probe its local IPv4
  // before the person touches the PIN field. Nothing is read from disk.
  useEffect(() => {
    let alive = true;
    void collectHints().then((h) => {
      if (alive) setHints(h);
    });
    // Ask the server what name it would store: reverse DNS of this address.
    void api
      .detectDevice()
      .then((d) => {
        if (alive && d.deviceName) setDetected({ deviceName: d.deviceName, hostName: d.hostName });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // No instance PIN (the default): register this device by itself and go on to
  // the account sign-in. The PIN form below only shows when the owner turned it on.
  const pinRequired = status?.pinRequired === true;
  const [autoError, setAutoError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (pinRequired) return;
    let alive = true;
    setAutoError("");
    (async () => {
      try {
        const h = await Promise.race([collectHints(), new Promise<DeviceHints>((r) => setTimeout(() => r(quickHints()), 1500))]);
        await api.login("", { ...h });
        await refresh();
        // Still here after a successful registration: the browser dropped the cookie.
        if (alive) setAutoError("The browser did not keep the session cookie. Allow cookies for this site, then try again.");
      } catch (e: any) {
        if (alive) setAutoError(e?.message ?? "Could not reach the server.");
      }
    })();
    return () => {
      alive = false;
    };
    // refresh is a stable callback; rerun only for a retry or a PIN mode change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinRequired, attempt]);

  if (!pinRequired) {
    return (
      <div className="anim-page relative flex min-h-screen items-center justify-center overflow-hidden px-4">
        <DotPattern className="opacity-60" />
        <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[110px]" />
        <div className="relative w-full max-w-sm text-center">
          <div className="anim-glow mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-indigo-500/40 bg-indigo-500/10 text-indigo-300">
            <Icon name="logo" size={30} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{appName}</h1>
          {autoError ? (
            <div className="glass mt-6 rounded-2xl p-5 text-left">
              <div className="flex items-start gap-2 text-sm text-amber-200">
                <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                <span>{autoError}</span>
              </div>
              <Btn className="mt-4 w-full" onClick={() => setAttempt((n) => n + 1)}>
                <Icon name="refresh" size={15} /> Try again
              </Btn>
            </div>
          ) : (
            <p className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-400">
              <Spinner size={16} /> Opening the sign-in page…
            </p>
          )}
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const res = await api.login(pin, { ...hints });
      await refresh();
      push("ok", res.deviceName ? `Paired as ${res.deviceName}` : "Device paired");
    } catch (e: any) {
      setPin("");
      setShake(true);
      setTimeout(() => setShake(false), 500);
      push("err", e?.message ?? "Wrong PIN - try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="anim-page relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <DotPattern className="opacity-60" />
      {/* injected keyframe: error shake */}
      <style>{`@keyframes shakeX{0%,100%{transform:translateX(0)}15%{transform:translateX(-9px)}30%{transform:translateX(8px)}45%{transform:translateX(-6px)}60%{transform:translateX(5px)}75%{transform:translateX(-3px)}}`}</style>

      {/* background glow */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[110px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-cyan-500/10 blur-[90px]" />

      <div className="relative w-full max-w-sm">
        <div className="mb-7 text-center">
          <div
            className="anim-glow mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-indigo-500/40 bg-indigo-500/10 text-indigo-300"
            title="Pair this device with your instance"
          >
            <Icon name="logo" size={30} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{appName}</h1>
          <p className="mt-1 text-sm text-slate-400">Enter your PIN to pair this device</p>
        </div>

        <div
          className="glass relative rounded-2xl p-6 shadow-2xl"
          style={shake ? { animation: "shakeX 0.45s ease-in-out", borderColor: "#ef4444aa" } : undefined}
        >
          <BorderBeam duration={12} />
          <div className="relative space-y-4">
            <div>
              <Label>Access PIN</Label>
              <Input
                autoFocus
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
                placeholder="••••••"
                aria-label="Access PIN"
                className="text-center text-2xl tracking-[0.5em]"
              />
              {pin.length > 0 && !valid && (
                <p className="mt-1.5 text-xs text-amber-400/90">{10 - pin.length > 0 ? `At least 4 digits (${pin.length}/10 max)` : ""}</p>
              )}
            </div>

            <Btn size="lg" className="w-full" disabled={!valid || busy} onClick={() => void submit()}>
              {busy ? "Pairing…" : (
                <>
                  <Icon name="lock" size={16} /> Unlock
                </>
              )}
            </Btn>

            <div className="rounded-xl border border-[#232a3a] bg-[#12161f] p-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-slate-300">
                  <Icon name={hints.type === "desktop" ? "monitor" : "smartphone"} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-slate-200">{detected?.deviceName ?? hints.name}</div>
                  <div className="truncate text-[11px] text-slate-500">
                    {detected?.hostName
                      ? "host name from your network"
                      : hints.localIp
                        ? `this device reports ${hints.localIp}`
                        : "browser and system name"}
                  </div>
                </div>
                <span className="rounded-full border border-[#2a3247] px-2 py-0.5 text-[10px] text-slate-400">detected</span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {detected?.hostName
                  ? "This is the host name your network returns for this device. It is stored with the device when you pair."
                  : "Your network did not return a host name, so the browser and system name is used. You can rename it later on the Devices page."}
              </p>
            </div>

            <button
              onClick={() => setShowDetails((s) => !s)}
              className="w-full text-center text-xs text-slate-500 transition hover:text-slate-300"
            >
              {showDetails ? "Hide device details" : "What this device shares"}
            </button>
            {showDetails && (
              <div className="anim-pop space-y-2 rounded-xl border border-[#232a3a] bg-[#0d1017] p-3 text-[11px]">
                <Row label="Platform" value={hints.platform || hints.os} />
                <Row label="Browser" value={hints.browser} />
                <Row label="Screen" value={hints.screen ? `${hints.screen} @ ${hints.dpr}x` : "-"} />
                <Row label="Language" value={hints.language || "-"} />
                <Row label="Time zone" value={hints.timezone || "-"} />
                <Row label="CPU threads" value={hints.cores ? String(hints.cores) : "-"} />
                <Row label="Memory" value={hints.memoryGb ? `${hints.memoryGb} GB` : "-"} />
                <Row label="Local IPv4" value={hints.localIp || "hidden by this browser"} />
                <p className="border-t border-[#232a3a] pt-2 text-slate-500">
                  No cookies, passwords or files are read. Browsers cannot share the MAC address; an admin can note it on
                  the Devices page.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 text-center text-[11px] text-slate-600">
          {version && <span>FYRDrop {version} · </span>}
          <span>self-hosted secure share hub</span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="mono truncate text-right text-slate-300">{value}</span>
    </div>
  );
}
