import { useCallback, useEffect, useState } from "react";
import { api, humanSize, timeAgo, type ReplicaPolicy, type ReplicationState } from "../api";
import { Icon } from "../icons";
import { Badge, Btn, Card, Input, Label, Progress, Spinner, useSync, useToast } from "../ui";

/** Cluster page: replica policy, protection status and the last rebalancing pass. */
export default function ReplicationCard({ nodeCount }: { nodeCount: number }) {
  const { push } = useToast();
  const [st, setSt] = useState<ReplicationState | null>(null);
  const [draft, setDraft] = useState<ReplicaPolicy | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.replication();
      setSt(r);
      setDraft((d) => d ?? r.policy);
    } catch (e: any) {
      push("err", e?.message ?? "Could not load replication status");
    }
  }, [push]);
  useEffect(() => {
    void load();
  }, [load]);
  useSync(() => void load(), { scopes: ["settings"] });

  if (!st || !draft) return <Card className="mt-6 flex justify-center p-6"><Spinner /></Card>;

  const save = async (patch: Partial<ReplicaPolicy>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    try {
      const r = await api.saveReplicaPolicy(patch);
      setDraft(r.policy);
      await load();
    } catch (e: any) {
      push("err", e?.message ?? "Could not save the policy");
    }
  };

  const runNow = async () => {
    setBusy(true);
    try {
      const r = await api.runReplication();
      setSt(r);
      const x = r.report;
      push(x.failed ? "info" : "ok", `Pass done: ${x.placed} placed, ${x.moved} moved, ${x.removed} removed${x.repaired ? `, ${x.repaired} repaired` : ""}${x.failed ? `, ${x.failed} problem(s)` : ""}`);
    } catch (e: any) {
      push("err", e?.message ?? "Pass failed");
    } finally {
      setBusy(false);
    }
  };

  const s = st.summary;
  const rep = st.report;
  const pct = s.eligible ? Math.round((s.protected / s.eligible) * 100) : 100;

  return (
    <Card className="mt-6 p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Icon name="database" size={16} className="text-slate-300" />
        <h2 className="text-sm font-semibold text-white">Replicas &amp; rebalancing</h2>
        {draft.enabled ? <Badge tone="ok">on</Badge> : <Badge>off</Badge>}
        <span className="text-xs text-slate-500">Keep copies of your items on linked nodes. The cluster checks them, repairs losses and moves copies off full nodes every few minutes.</span>
      </div>

      {nodeCount === 0 ? (
        <p className="text-sm text-slate-500">Link at least one other instance to keep copies there.</p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" className="accent-indigo-500" checked={draft.enabled} onChange={(e) => void save({ enabled: e.target.checked })} />
                Keep copies automatically
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Copies on other nodes</Label>
                  <select
                    value={draft.copies}
                    onChange={(e) => void save({ copies: Number(e.target.value) })}
                    className="w-full rounded-xl border border-[#2a3247] bg-[#12161f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-indigo-500"
                  >
                    {Array.from({ length: Math.min(nodeCount, 5) + 1 }, (_, n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Which items</Label>
                  <select
                    value={draft.include}
                    onChange={(e) => void save({ include: e.target.value as ReplicaPolicy["include"] })}
                    className="w-full rounded-xl border border-[#2a3247] bg-[#12161f] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-indigo-500"
                  >
                    <option value="all">Everything</option>
                    <option value="label">Only with a label</option>
                  </select>
                </div>
                {draft.include === "label" && (
                  <div className="col-span-2">
                    <Label>Label</Label>
                    <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} onBlur={() => void save({ label: draft.label })} />
                  </div>
                )}
                <div>
                  <Label>Keep free on each node (%)</Label>
                  <Input type="number" min={0} max={50} value={draft.headroomPct} onChange={(e) => setDraft({ ...draft, headroomPct: Number(e.target.value) })} onBlur={() => void save({ headroomPct: draft.headroomPct })} />
                </div>
                <div>
                  <Label>Max per pass (MB)</Label>
                  <Input type="number" min={16} value={draft.maxMbPerRun} onChange={(e) => setDraft({ ...draft, maxMbPerRun: Number(e.target.value) })} onBlur={() => void save({ maxMbPerRun: draft.maxMbPerRun })} />
                </div>
                <div>
                  <Label>Largest item (MB, max 64)</Label>
                  <Input type="number" min={1} max={64} value={draft.maxItemMb} onChange={(e) => setDraft({ ...draft, maxItemMb: Number(e.target.value) })} onBlur={() => void save({ maxItemMb: draft.maxItemMb })} />
                </div>
                <div>
                  <Label>Verify copies every (hours)</Label>
                  <Input type="number" min={1} value={draft.verifyEveryHours} onChange={(e) => setDraft({ ...draft, verifyEveryHours: Number(e.target.value) })} onBlur={() => void save({ verifyEveryHours: draft.verifyEveryHours })} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-300">{s.protected} of {s.eligible} items have {draft.copies} cop{draft.copies === 1 ? "y" : "ies"}</span>
                  <span className="text-slate-500">{pct}%</span>
                </div>
                <Progress pct={pct} />
                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                  {s.under > 0 && <span className="text-amber-300">{s.under} waiting for a copy</span>}
                  {s.over > 0 && <span>{s.over} with extra copies</span>}
                  {s.tooLarge > 0 && <span>{s.tooLarge} too large to copy (over {Math.min(draft.maxItemMb, 64)} MB)</span>}
                </div>
              </div>
              <div className="divide-y divide-[#1c2334] rounded-xl border border-[#232a3a] text-xs">
                {st.nodes.map((n) => {
                  const live = rep?.nodes.find((x) => x.id === n.id);
                  return (
                    <div key={n.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="text-slate-200">{n.name}</span>
                      {live && !live.reachable && <Badge tone="bad">unreachable</Badge>}
                      <span className="text-slate-500">{n.replicas} copies · {humanSize(n.bytes)}</span>
                      <span className="flex-1" />
                      {live?.reachable && <span className="text-slate-500">{humanSize(live.freeBytes)} free</span>}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Btn size="sm" onClick={() => void runNow()} disabled={busy || st.running}>
                  {busy || st.running ? <Spinner size={13} /> : <Icon name="refresh" size={13} />} Run a pass now
                </Btn>
                {rep && (
                  <span className="text-[11px] text-slate-500">
                    Last pass {timeAgo(rep.at)} ({rep.reason}): {rep.placed} placed, {rep.moved} moved, {rep.removed} removed, {rep.verified} verified
                    {rep.repaired ? `, ${rep.repaired} repaired` : ""}
                    {rep.replacedBad ? `, ${rep.replacedBad} bad copies replaced` : ""}
                    {rep.budgetHit ? " · stopped at the per-pass limit" : ""}
                  </span>
                )}
              </div>
              {rep && rep.errors.length > 0 && (
                <details className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-200">
                  <summary className="cursor-pointer">{rep.errors.length} problem(s) in the last pass</summary>
                  <ul className="mt-1 list-disc pl-4">
                    {rep.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
