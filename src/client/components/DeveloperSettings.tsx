import { useCallback, useEffect, useState } from "react";
import { api, timeAgo, type ApiKeyView, type WebhookView } from "../api";
import { Icon } from "../icons";
import { Badge, Btn, Card, CopyBtn, Input, Label, Modal, Spinner, useToast } from "../ui";

/** Profile section: personal API keys and outgoing webhooks. */
export default function DeveloperSettings() {
  const { push } = useToast();
  const [keys, setKeys] = useState<ApiKeyView[] | null>(null);
  const [hooks, setHooks] = useState<{ webhooks: WebhookView[]; events: string[]; canTargetPrivate: boolean } | null>(null);
  const [keyName, setKeyName] = useState("");
  const [keyWrite, setKeyWrite] = useState(false);
  const [keyDays, setKeyDays] = useState(0);
  const [hookName, setHookName] = useState("");
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState<string[]>([]);
  const [secretShown, setSecretShown] = useState<{ title: string; value: string; hint: string } | null>(null);
  const [deliveries, setDeliveries] = useState<{ hook: WebhookView; rows: Awaited<ReturnType<typeof api.webhookDeliveries>>["deliveries"] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [k, h] = await Promise.all([api.apiKeys(), api.webhooks()]);
      setKeys(k.keys);
      setHooks(h);
    } catch (e: any) {
      push("err", e?.message ?? "Could not load developer settings");
    }
  }, [push]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (keys && window.location.hash === "#developer") document.getElementById("developer")?.scrollIntoView({ behavior: "smooth" });
  }, [keys]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "That did not work");
    } finally {
      setBusy(false);
    }
  };

  if (!keys || !hooks) return <Card className="mt-5 flex justify-center p-6"><Spinner /></Card>;
  const origin = window.location.origin;

  return (
    <Card className="mt-5 p-6">
      <div id="developer" className="scroll-mt-24">
        <h2 className="text-sm font-semibold text-white">API keys &amp; webhooks</h2>
        <p className="mt-1 text-xs text-slate-500">Script uploads and listings with a personal key, or have FYRDrop call your service when your items change.</p>
      </div>

      {/* keys */}
      <div className="mt-4 rounded-xl border border-[#232a3a] bg-[#12161f] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-slate-200"><Icon name="key" size={15} /> API keys</div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1">
            <Label>Name</Label>
            <Input value={keyName} maxLength={60} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. backup script" />
          </div>
          <label className="flex h-10 items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" className="accent-indigo-500" checked={keyWrite} onChange={(e) => setKeyWrite(e.target.checked)} /> can also write
          </label>
          <select value={keyDays} onChange={(e) => setKeyDays(Number(e.target.value))} className="h-10 rounded-xl border border-[#2a3247] bg-[#0e1219] px-2 text-xs text-slate-200" aria-label="Expires">
            <option value={0}>never expires</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
          <Btn
            size="sm"
            disabled={busy || !keyName.trim()}
            onClick={() =>
              void run(async () => {
                const r = await api.createApiKey(keyName.trim(), keyWrite ? ["read", "write"] : ["read"], keyDays);
                setKeyName("");
                setSecretShown({ title: "Your new API key", value: r.token, hint: `It is shown only now. Use it as: curl -H "Authorization: Bearer ${r.token.slice(0, 16)}…" ${origin}/api/items` });
              })
            }
          >
            Create key
          </Btn>
        </div>
        {keys.length > 0 && (
          <div className="mt-3 divide-y divide-[#1c2334]">
            {keys.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                <span className="text-slate-100">{k.name}</span>
                <code className="mono text-slate-500">{k.preview}</code>
                {k.scopes.includes("write") ? <Badge tone="warn">read + write</Badge> : <Badge>read</Badge>}
                <span className="text-slate-500">
                  {k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : "never used"}
                  {k.expiresAt ? ` · expires ${new Date(k.expiresAt).toLocaleDateString()}` : ""}
                </span>
                <span className="flex-1" />
                <Btn size="sm" variant="ghost" onClick={() => window.confirm(`Revoke "${k.name}"? Scripts using it stop working immediately.`) && void run(() => api.revokeApiKey(k.id).then(() => undefined))}>
                  Revoke
                </Btn>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-500">Keys act as you, but can never reach admin pages, backups, account security, or create other keys.</p>
      </div>

      {/* webhooks */}
      <div className="mt-3 rounded-xl border border-[#232a3a] bg-[#12161f] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-slate-200"><Icon name="send" size={15} /> Webhooks</div>
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
          <Input value={hookName} maxLength={60} onChange={(e) => setHookName(e.target.value)} placeholder="Name" />
          <Input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://example.com/fyrdrop-hook" />
          <Btn
            size="sm"
            disabled={busy || !hookUrl.trim()}
            onClick={() =>
              void run(async () => {
                const r = await api.createWebhook({ name: hookName.trim(), url: hookUrl.trim(), events: hookEvents });
                setHookName("");
                setHookUrl("");
                setHookEvents([]);
                setSecretShown({ title: "Signing secret", value: r.secret, hint: 'Verify X-FYRDrop-Signature = "sha256=" + HMAC-SHA256(secret, X-FYRDrop-Timestamp + "." + body). Shown only now.' });
              })
            }
          >
            Add webhook
          </Btn>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400">
          <span className="text-slate-500">Events (none ticked = all):</span>
          {hooks.events.map((ev) => (
            <label key={ev} className="flex items-center gap-1">
              <input type="checkbox" className="accent-indigo-500" checked={hookEvents.includes(ev)} onChange={(e) => setHookEvents((l) => (e.target.checked ? [...l, ev] : l.filter((x) => x !== ev)))} />
              <span className="mono">{ev}</span>
            </label>
          ))}
        </div>
        {!hooks.canTargetPrivate && <p className="mt-2 text-[11px] text-slate-500">Webhooks to local network addresses are reserved for the instance owner.</p>}
        {hooks.webhooks.length > 0 && (
          <div className="mt-3 divide-y divide-[#1c2334]">
            {hooks.webhooks.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                <span className="text-slate-100">{h.name}</span>
                <span className="mono max-w-[16rem] truncate text-slate-500" title={h.url}>{h.url}</span>
                {!h.enabled ? <Badge tone="bad">off</Badge> : h.lastStatus.startsWith("ok") ? <Badge tone="ok">{h.lastStatus}</Badge> : h.lastStatus === "never" ? <Badge>not used yet</Badge> : <Badge tone="warn">{h.lastStatus}</Badge>}
                <span className="text-slate-500">{h.events.length ? h.events.join(", ") : "all events"}</span>
                <span className="flex-1" />
                <Btn size="sm" variant="ghost" onClick={() => void run(async () => { const r = await api.testWebhook(h.id); push(r.ok ? "ok" : "err", r.ok ? `Ping delivered (HTTP ${r.statusCode})` : `Ping failed: ${r.error}`); })}>Test</Btn>
                <Btn size="sm" variant="ghost" onClick={() => void api.webhookDeliveries(h.id).then((r) => setDeliveries({ hook: h, rows: r.deliveries }), (e) => push("err", e?.message ?? "Could not load"))}>Log</Btn>
                <Btn size="sm" variant="ghost" onClick={() => void run(() => api.updateWebhook(h.id, { enabled: !h.enabled }).then(() => undefined))}>{h.enabled ? "Pause" : "Resume"}</Btn>
                <Btn size="sm" variant="ghost" onClick={() => window.confirm("Replace the signing secret? Your receiver must use the new one.") && void run(async () => { const r = await api.rotateWebhookSecret(h.id); setSecretShown({ title: "New signing secret", value: r.secret, hint: "The old secret stops working now." }); })}>New secret</Btn>
                <Btn size="sm" variant="ghost" onClick={() => window.confirm(`Delete the webhook "${h.name}"?`) && void run(() => api.deleteWebhook(h.id).then(() => undefined))}><Icon name="trash" size={13} /></Btn>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={!!secretShown} onClose={() => setSecretShown(null)} title={secretShown?.title ?? ""}>
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <code className="mono flex-1 break-all rounded-lg border border-[#2a3247] bg-white/[0.03] p-2 text-xs text-slate-100">{secretShown?.value}</code>
            <CopyBtn text={secretShown?.value ?? ""} />
          </div>
          <p className="text-xs text-slate-400">{secretShown?.hint}</p>
          <div className="flex justify-end"><Btn onClick={() => setSecretShown(null)}>Done</Btn></div>
        </div>
      </Modal>

      <Modal open={!!deliveries} onClose={() => setDeliveries(null)} title={`Deliveries · ${deliveries?.hook.name ?? ""}`} wide>
        {deliveries?.rows.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing sent yet.</p>
        ) : (
          <div className="max-h-[60vh] divide-y divide-[#1c2334] overflow-y-auto text-xs">
            {deliveries?.rows.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                {d.ok ? <Badge tone="ok">{d.statusCode}</Badge> : <Badge tone="bad">{d.statusCode ?? "error"}</Badge>}
                <span className="mono text-slate-200">{d.event}</span>
                <span className="text-slate-500">attempt {d.attempt} · {d.durationMs} ms · {timeAgo(d.createdAt)}</span>
                {d.error && <span className="text-red-300">{d.error}</span>}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </Card>
  );
}
