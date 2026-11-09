import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, humanSize, ApiError } from "../api";
import { Icon, mimeIcon } from "../icons";
import { Badge, Btn, Card, Input, Label, Spinner, useToast } from "../ui";

interface ShareMeta {
  item: { name: string; type: string; size: number; uploadedBy: string; createdAt: number; preview?: string; mime?: string };
  needsPin: boolean;
  note?: string | null;
  from?: string | null;
  downloadsLeft?: number | null;
  expiresAt?: number | null;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="anim-page relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[110px]" />
      <div className="relative w-full max-w-lg">{children}</div>
    </div>
  );
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const { push } = useToast();
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound" | "limit" | "error" | "restricted">("loading");
  const [pin, setPin] = useState("");
  const [pinOk, setPinOk] = useState(false);
  const [grant, setGrant] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setState("loading");
    try {
      const m = await api.shareMeta(token);
      setMeta(m);
      setGrant(typeof m.grant === "string" ? m.grant : null);
      setPinOk(false);
      setState("ready");
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 410) setState("limit");
      else if (e instanceof ApiError && e.status === 404) setState("notfound");
      else if (e instanceof ApiError && e.status === 401 && e.data?.needsAuth) setState("restricted");
      else setState("error");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const verifyPin = async () => {
    if (!token || !/^\d{4,10}$/.test(pin) || checking) return;
    setChecking(true);
    try {
      const r = await api.unlockShare(token, pin);
      setGrant(r.grant);
      if (r.preview) setMeta((m) => (m ? { ...m, item: { ...m.item, preview: r.preview } } : m));
      setPinOk(true);
      push("ok", "PIN accepted");
    } catch (e: any) {
      setPin("");
      push("err", e?.message ?? "Wrong PIN");
    } finally {
      setChecking(false);
    }
  };

  if (state === "loading") {
    return (
      <Centered>
        <div className="flex justify-center py-16"><Spinner size={28} /></div>
      </Centered>
    );
  }

  if (state === "restricted") {
    return (
      <Centered>
        <Card className="p-8 text-center">
          <div className="mb-3 flex justify-center text-indigo-300">
            <Icon name="lock" size={34} />
          </div>
          <h1 className="text-xl font-semibold text-white">This link is restricted</h1>
          <p className="mt-2 text-sm text-slate-400">
            Only selected FYRDrop profiles can open it. Sign in with the account that shared it, then reopen this link.
          </p>
          <a href="/login" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500">
            <Icon name="logout" size={15} /> Sign in
          </a>
        </Card>
      </Centered>
    );
  }

  if (state === "notfound" || state === "error") {
    return (
      <Centered>
        <Card className="p-8 text-center">
          <div className="mb-3 flex justify-center text-slate-500">
            <Icon name={state === "error" ? "alert" : "link"} size={34} />
          </div>
          <h1 className="text-xl font-semibold text-white">{state === "error" ? "Something went wrong" : "Link not found"}</h1>
          <p className="mt-2 text-sm text-slate-400">
            {state === "error"
              ? "Couldn't reach the server. Check your connection and try again."
              : "This share link is invalid, or the item has expired or been deleted."}
          </p>
          <Btn variant="soft" className="mt-5" onClick={() => void load()}>Try again</Btn>
        </Card>
      </Centered>
    );
  }

  if (state === "limit") {
    return (
      <Centered>
        <Card className="p-8 text-center">
          <div className="mb-3 flex justify-center text-amber-400/80">
            <Icon name="alert" size={34} />
          </div>
          <h1 className="text-xl font-semibold text-white">Download limit reached</h1>
          <p className="mt-2 text-sm text-slate-400">This share link has hit its maximum number of downloads and is no longer active.</p>
          <p className="mt-4 text-xs text-slate-500">Ask the sender for a fresh link if you still need the file.</p>
        </Card>
      </Centered>
    );
  }

  if (!meta) return null;
  const { item } = meta;
  const downloadUrl = `/api/share/${token}/download${grant ? `?grant=${encodeURIComponent(grant)}` : ""}`;
  const typeIcon =
    item.type === "url" ? "link" : item.type === "text" ? "note" : item.type === "image" ? "image" : mimeIcon(item.mime ?? "", item.name);

  const gate = (
    <Card className="p-8">
      <div className="mb-5 text-center">
        <div className="mb-2 flex justify-center text-indigo-300">
          <Icon name="lock" size={30} />
        </div>
        <h1 className="text-xl font-semibold text-white">PIN required</h1>
        <p className="mt-1 text-sm text-slate-400">The sender protected this share. Enter the PIN to unlock.</p>
      </div>
      <Label>Share PIN</Label>
      <Input
        autoFocus
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))}
        onKeyDown={(e) => e.key === "Enter" && void verifyPin()}
        placeholder="••••"
        className="text-center text-xl tracking-[0.4em]"
      />
      <Btn size="lg" className="mt-4 w-full" disabled={!/^\d{4,10}$/.test(pin) || checking} onClick={() => void verifyPin()}>
        {checking ? "Checking…" : "Unlock"}
      </Btn>
    </Card>
  );

  const content = (
    <Card className="overflow-hidden">
      <div className="border-b border-[#1c2334] bg-white/[0.02] p-6 text-center">
        <div className="mb-3 flex justify-center text-indigo-300">
          <Icon name={typeIcon} size={34} />
        </div>
        <h1 className="break-words text-xl font-semibold text-white">{item.name}</h1>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
          {item.type && <Badge tone="info">{item.type}</Badge>}
          {typeof item.size === "number" && <span>{humanSize(item.size)}</span>}
          {item.uploadedBy && meta.from && <span>from {meta.from}</span>}
          {!meta.from && item.uploadedBy && <span>by {item.uploadedBy}</span>}
          {item.createdAt && <span>· {new Date(item.createdAt).toLocaleString()}</span>}
        </div>
        {meta.note && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#2a3247] bg-[#12161f] p-3 text-left text-sm text-slate-300">
            <span className="mt-0.5 shrink-0 text-slate-500"><Icon name="note" size={15} /></span>
            <span>{meta.note}</span>
          </div>
        )}
        {meta.expiresAt && (
          <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber-400/90">
            <Icon name="clock" size={13} /> Expires {new Date(meta.expiresAt).toLocaleString()}
          </div>
        )}
        {typeof meta.downloadsLeft === "number" && (
          <div className="mt-1 text-xs text-slate-500">{meta.downloadsLeft} download{meta.downloadsLeft === 1 ? "" : "s"} remaining</div>
        )}
      </div>

      {meta.needsPin && !pinOk ? (
        <div className="p-6">{gate}</div>
      ) : (
        <div className="p-6">
          {item.type === "url" && item.preview && (
            <div className="mb-5 rounded-xl border border-[#2a3247] bg-[#12161f] p-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Destination</div>
              <a href={item.preview} target="_blank" rel="noreferrer" className="mono break-all text-sm text-cyan-300 hover:underline">
                {item.preview}
              </a>
            </div>
          )}
          {item.type === "text" && item.preview && (
            <pre className="mono mb-5 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-[#2a3247] bg-[#12161f] p-4 text-sm text-slate-200">
              {item.preview}
            </pre>
          )}

          {item.type === "url" ? (
            <Btn size="lg" className="w-full" href={item.preview} target="_blank">
              <Icon name="external" size={16} /> Open link
            </Btn>
          ) : (
            <Btn size="lg" className="w-full" href={downloadUrl}>
              <Icon name="download" size={16} /> Download {typeof item.size === "number" ? `(${humanSize(item.size)})` : ""}
            </Btn>
          )}
          <p className="mt-3 text-center text-[11px] text-slate-600">
            {meta.needsPin ? "PIN verified - download unlocked." : "Direct download · no account needed."}
          </p>
        </div>
      )}
    </Card>
  );

  return (
    <Centered>
      <div className="mb-5 flex items-center justify-center gap-2 text-sm text-slate-500">
        <span className="text-indigo-300"><Icon name="logo" size={18} /></span>
        <span className="font-medium text-slate-300">FYRDrop</span>
        <span>secure share</span>
      </div>
      {content}
      {meta.needsPin && !pinOk ? null : (
        <p className="mt-4 text-center text-[11px] text-slate-600">Powered by FYRDrop - self-hosted secure share hub</p>
      )}
    </Centered>
  );
}
