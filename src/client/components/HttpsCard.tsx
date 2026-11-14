import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type TlsCert, type TlsView } from "../api";
import { Icon } from "../icons";
import { Badge, Btn, Card, Input, Label, Spinner, Textarea, useToast } from "../ui";

type Mode = "off" | "auto" | "custom";

const OPTIONS: { mode: Mode; title: string; blurb: string; when: string }[] = [
  {
    mode: "off",
    title: "HTTP",
    blurb: "No certificate, no browser warning. The default.",
    when: "Home or office network you trust, or when a reverse proxy, Tailscale or a Cloudflare Tunnel in front already provides HTTPS.",
  },
  {
    mode: "auto",
    title: "HTTPS, self-signed",
    blurb: "FYRDrop makes its own certificate. Encrypted, but each browser warns once until you trust it.",
    when: "You want encryption on the LAN and have no domain name.",
  },
  {
    mode: "custom",
    title: "HTTPS, your certificate",
    blurb: "Use a certificate from Let's Encrypt, your company CA or mkcert. No warning.",
    when: "You have a domain name (or your own CA) for this machine.",
  },
];

function CertBox({ cert, title }: { cert: TlsCert; title: string }) {
  return (
    <div className="rounded-xl border border-[#232a3a] bg-[#0d1017] p-3 text-[11px] leading-relaxed">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-200">
        {title}
        {cert.expired ? <Badge tone="bad">expired</Badge> : cert.daysLeft < 30 ? <Badge tone="warn">{cert.daysLeft} days left</Badge> : <Badge tone="ok">valid {cert.daysLeft} days</Badge>}
        {cert.selfSigned && <Badge>self-signed</Badge>}
      </div>
      <div className="text-slate-400">
        Issued to <span className="mono text-slate-200">{cert.subject}</span>
        {!cert.selfSigned && (
          <>
            {" "}
            by <span className="mono text-slate-200">{cert.issuer}</span>
          </>
        )}
      </div>
      <div className="text-slate-400">
        Valid for: <span className="mono break-all text-slate-300">{cert.names.join(", ") || cert.subject}</span>
      </div>
      <div className="text-slate-500">
        SHA-256 <span className="mono break-all">{cert.fingerprint}</span>
      </div>
    </div>
  );
}

/** Reads a picked .pem/.crt/.key file into a text field. */
function PemField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <button type="button" onClick={() => ref.current?.click()} className="mb-1.5 text-[11px] text-indigo-300 hover:text-indigo-200">
          Choose file…
        </button>
      </div>
      <input
        ref={ref}
        type="file"
        accept=".pem,.crt,.cer,.key,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void f.text().then(onChange);
          e.target.value = "";
        }}
      />
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} spellCheck={false} placeholder={placeholder} className="mono text-[11px]" />
    </div>
  );
}

/**
 * HTTP or HTTPS, in one place. Plain HTTP is the default; this card walks
 * through turning HTTPS on (self-signed or with your own certificate), shows
 * the certificate in use and says what address to open after the restart.
 */
export default function HttpsCard() {
  const { push } = useToast();
  const [st, setSt] = useState<TlsView | null>(null);
  const [mode, setMode] = useState<Mode>("off");
  const [names, setNames] = useState("");
  const [regenerate, setRegenerate] = useState(false);
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const [redirectPort, setRedirectPort] = useState(0);
  const [hsts, setHsts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState<{ url: string; sameOrigin: boolean; ready: boolean } | null>(null);

  const adopt = useCallback((r: TlsView) => {
    setSt(r);
    setMode(r.mode);
    setRedirectPort(r.httpRedirectPort);
    setHsts(r.hsts);
    setRegenerate(false);
    setCertPem("");
    setKeyPem("");
    setNames((cur) => cur || [...new Set([r.host, ...r.suggestedNames])].filter((n) => n && n !== "127.0.0.1" && n !== "::1").join(", "));
  }, []);

  useEffect(() => {
    api
      .tls()
      .then(adopt)
      .catch((e) => push("err", e?.message ?? "Could not read the HTTPS settings"));
  }, [adopt, push]);

  if (!st) {
    return (
      <Card className="mt-4 flex justify-center p-5">
        <Spinner />
      </Card>
    );
  }

  const locked = !!st.lockedBy;
  const runningMode: Mode = st.running.source === "self-signed" ? "auto" : st.running.source === "custom" ? "custom" : "off";
  const nameList = names.split(/[\s,]+/).map((n) => n.trim()).filter(Boolean);
  const newScheme = mode === "off" ? "http" : "https";
  const newUrl = `${newScheme}://${st.host}${(newScheme === "https" && st.port === 443) || (newScheme === "http" && st.port === 80) ? "" : `:${st.port}`}`;
  const behindProxy = st.requestScheme === "https" && st.running.scheme === "http";
  const dirty =
    mode !== st.mode ||
    redirectPort !== st.httpRedirectPort ||
    hsts !== st.hsts ||
    (mode === "auto" && (regenerate || !st.selfSigned)) ||
    (mode === "custom" && (certPem.trim() !== "" || keyPem.trim() !== ""));

  const save = async () => {
    if (mode === "custom" && !st.custom && (!certPem.trim() || !keyPem.trim())) {
      push("err", "Add the certificate and its private key first");
      return;
    }
    setBusy(true);
    try {
      const r = await api.saveTls({
        mode,
        names: mode === "auto" && (regenerate || !st.selfSigned) ? nameList : undefined,
        regenerate: mode === "auto" ? regenerate : undefined,
        certPem: mode === "custom" && certPem.trim() ? certPem : undefined,
        keyPem: mode === "custom" && keyPem.trim() ? keyPem : undefined,
        httpRedirectPort: redirectPort,
        hsts,
      });
      adopt(r);
      push("ok", "Saved. Restart the server to apply it.");
    } catch (e: any) {
      push("err", e?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    const target = { url: newUrl, sameOrigin: newScheme === st.requestScheme || behindProxy, ready: false };
    setRestarting(target);
    try {
      await api.restartServer();
    } catch {
      /* expected while the process exits */
    }
    if (!target.sameOrigin) {
      // The scheme changes, so this page cannot follow by itself: offer the new address.
      setTimeout(() => setRestarting({ ...target, ready: true }), 5000);
      return;
    }
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        if (Date.now() - started > 2500 && (await fetch("/health", { cache: "no-store" })).ok) {
          clearInterval(timer);
          window.location.reload();
        }
      } catch {
        /* still down */
      }
      if (Date.now() - started > 60_000) {
        clearInterval(timer);
        setRestarting({ ...target, ready: true });
      }
    }, 1200);
  };

  const pending = st.pendingRestart;

  return (
    <Card className="mt-4 p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Icon name={st.running.scheme === "https" ? "lock" : "unlock"} size={15} className="text-indigo-300" />
        <h2 className="text-sm font-semibold text-white">HTTP &amp; HTTPS</h2>
        <Badge tone={st.running.scheme === "https" ? "ok" : "default"}>
          running: {st.running.scheme === "https" ? (st.running.source === "custom" ? "HTTPS (your certificate)" : "HTTPS (self-signed)") : "HTTP"}
        </Badge>
        <Link to="/help#http-and-https" className="ml-auto inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200">
          <Icon name="help" size={13} /> Which one should I use?
        </Link>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        FYRDrop starts on plain HTTP so it works right away. Pick how it should be served, save, then restart. Nothing changes until the restart.
      </p>

      {behindProxy && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2 text-xs text-emerald-100">
          You reached this page over HTTPS through a proxy or tunnel that sits in front. Keep FYRDrop itself on HTTP; the proxy already encrypts the connection.
        </div>
      )}
      {st.running.problem && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-xs text-red-200">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" /> {st.running.problem}
        </div>
      )}
      {locked && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-200">
          Set by the environment variable <span className="mono">{st.lockedBy}</span>. Remove it to choose here.
        </div>
      )}

      <div className="mt-4 grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="How FYRDrop is served">
        {OPTIONS.map((o) => {
          const active = mode === o.mode;
          return (
            <button
              key={o.mode}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={locked}
              onClick={() => setMode(o.mode)}
              className={`rounded-xl border p-3 text-left transition disabled:opacity-60 ${active ? "border-indigo-500 bg-indigo-500/10" : "border-[#2a3247] hover:border-indigo-500/40"}`}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-white">
                <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${active ? "border-indigo-400" : "border-slate-600"}`}>
                  {active && <span className="h-2 w-2 rounded-full bg-indigo-400" />}
                </span>
                {o.title}
                {runningMode === o.mode && <Badge tone="info">running</Badge>}
              </span>
              <span className="mt-1.5 block text-[11px] leading-snug text-slate-400">{o.blurb}</span>
              <span className="mt-1 block text-[11px] leading-snug text-slate-500">Use when: {o.when}</span>
            </button>
          );
        })}
      </div>

      {mode === "off" && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Over HTTP on a LAN address browsers switch off passkeys; everything else works, including uploads, sharing, device transfer and copy buttons. Sign-in passwords travel unencrypted, so use HTTP only on a network you trust.
        </p>
      )}

      {mode === "auto" && (
        <div className="mt-3 space-y-3">
          {st.selfSigned && <CertBox cert={st.selfSigned} title="Certificate on this server" />}
          {(!st.selfSigned || regenerate) && (
            <div>
              <Label>Names and addresses people type to open FYRDrop</Label>
              <Input value={names} onChange={(e) => setNames(e.target.value)} placeholder="drop.lan, 192.168.1.20" />
              <p className="mt-1 text-[11px] text-slate-500">Comma separated. A browser only accepts the certificate for names listed here; this machine's own names and addresses are always included.</p>
            </div>
          )}
          {st.selfSigned && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" className="accent-indigo-500" checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} />
              Make a new certificate (after the address or name changed, or before it expires)
            </label>
          )}
          <div className="rounded-xl border border-[#232a3a] bg-[#12161f] p-3 text-[11px] leading-relaxed text-slate-400">
            <div className="mb-1 text-xs font-medium text-slate-200">After the restart</div>
            <ol className="list-decimal space-y-0.5 pl-4">
              <li>Open <span className="mono text-slate-200">{newUrl}</span>.</li>
              <li>The browser warns that it does not know the certificate. Choose Advanced, then continue. Compare the SHA-256 above if you want to be sure.</li>
              <li>
                To remove the warning for good, install the certificate on each device:{" "}
                <a href="/api/admin/tls/certificate" className="text-indigo-300 hover:text-indigo-200">download certificate</a>.
              </li>
            </ol>
          </div>
        </div>
      )}

      {mode === "custom" && (
        <div className="mt-3 space-y-3">
          {st.custom && (
            <>
              <CertBox cert={st.custom} title={st.custom.from === "paths" ? "Certificate from the configured paths" : "Uploaded certificate"} />
              {st.custom.problem && <div className="text-xs text-red-300">{st.custom.problem}</div>}
            </>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <PemField label={st.custom ? "Replace certificate (PEM)" : "Certificate (PEM)"} value={certPem} onChange={setCertPem} placeholder={"-----BEGIN CERTIFICATE-----\nfullchain.pem: your certificate first, then the chain"} />
            <PemField label={st.custom ? "Replace private key (PEM)" : "Private key (PEM)"} value={keyPem} onChange={setKeyPem} placeholder={"-----BEGIN PRIVATE KEY-----\nprivkey.pem, without a passphrase"} />
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            The pair is checked before it is saved (readable, not expired, key matches) and stored in the data folder with owner-only permissions. Renewing later is the same step. Prefer files on disk that a tool like certbot renews? Set{" "}
            <span className="mono">TLS_CERT_PATH</span> and <span className="mono">TLS_KEY_PATH</span> instead.
          </p>
        </div>
      )}

      {mode !== "off" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Also redirect plain HTTP from port</Label>
            <Input type="number" min={0} max={65535} value={String(redirectPort)} onChange={(e) => setRedirectPort(Math.max(0, Math.min(65535, Math.round(Number(e.target.value) || 0))))} />
            <p className="mt-1 text-[11px] text-slate-500">0 = off. For example 80, so http://{st.host} lands on the HTTPS address. Must differ from port {st.port}.</p>
          </div>
          <label className="flex items-start gap-2 pt-6 text-xs text-slate-300">
            <input type="checkbox" className="mt-0.5 accent-indigo-500" checked={hsts} onChange={(e) => setHsts(e.target.checked)} />
            <span>
              Tell browsers to always use HTTPS for this address (HSTS)
              <span className="block text-[11px] text-slate-500">Turn off if you may go back to HTTP: browsers remember this for two years.</span>
            </span>
          </label>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {pending && !restarting && (
          <span className="flex items-center gap-1.5 text-xs text-amber-200">
            <Icon name="alert" size={13} /> Saved as {st.mode === "off" ? "HTTP" : "HTTPS"}, still running {st.running.scheme.toUpperCase()}.
          </span>
        )}
        <span className="flex-1" />
        {dirty && !locked && (
          <Btn size="sm" onClick={() => void save()} disabled={busy}>
            {busy ? <Spinner size={13} /> : <Icon name="check" size={13} />} Save
          </Btn>
        )}
        {pending && !dirty && !restarting && (
          <Btn size="sm" onClick={() => void restart()}>
            <Icon name="power" size={13} /> Restart to apply
          </Btn>
        )}
      </div>

      {restarting && (
        <div className="mt-3 rounded-xl border border-indigo-500/40 bg-indigo-500/[0.08] p-3 text-xs text-indigo-100">
          {restarting.sameOrigin && !restarting.ready ? (
            <span className="flex items-center gap-2">
              <Spinner size={13} /> Restarting. This page reloads by itself.
            </span>
          ) : (
            <>
              <div className="flex items-center gap-2">
                {!restarting.ready && <Spinner size={13} />}
                The server is restarting on {restarting.url.startsWith("https") ? "HTTPS" : "HTTP"}, so this page cannot follow by itself. Open the new address:
              </div>
              <a href={restarting.url} className={`mono mt-1.5 inline-block text-sm ${restarting.ready ? "text-white underline" : "pointer-events-none text-slate-400"}`}>
                {restarting.url}
              </a>
              <div className="mt-1 text-[11px] text-indigo-200/70">
                You may be asked to sign in again there. If it does not answer after a minute, the server did not come back by itself: start it again, and it prints its address.
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
