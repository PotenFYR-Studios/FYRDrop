import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, timeAgo } from "../../api";
import { Icon } from "../../icons";
import { Badge, Btn, Card, Empty, Label, PageHeader, Textarea, useToast, useSync } from "../../ui";

type AuditEntry = { id: number; ts: number; ip: string; event: string; ok: number; detail: string };
type SecurityInfo = {
  audit: AuditEntry[];
  whitelist: { enabled: boolean; entries: string[] };
  registrationOpen: boolean;
};

const ENTRY_RE = /^(\d{1,3}\.){3}\d{1,3}(\/([0-9]|[12]\d|3[0-2]))?$/;
const validEntry = (s: string) => {
  if (!ENTRY_RE.test(s)) return false;
  return s.split("/")[0]!.split(".").every((o) => Number(o) <= 255);
};

/** Security center: IP whitelist, registration gate and the audit trail. */
export default function Security() {
  const { push } = useToast();
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [whitelistText, setWhitelistText] = useState("");
  const [whitelistEnabled, setWhitelistEnabled] = useState(false);
  const [regOpen, setRegOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingReg, setSavingReg] = useState(false);

  const reload = useCallback(() => {
    api
      .security()
      .then((r: SecurityInfo) => {
        setInfo(r);
        setWhitelistText(r.whitelist.entries.join(", "));
        setWhitelistEnabled(r.whitelist.enabled);
        setRegOpen(r.registrationOpen);
      })
      .catch((e) => push("err", e.message ?? "Failed to load security info"));
  }, [push]);

  useEffect(reload, [reload]);
  useSync(reload);

  const saveWhitelist = async () => {
    const entries = whitelistText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const bad = entries.find((e) => !validEntry(e));
    if (bad) {
      push("err", `"${bad}" is not a valid IPv4 or CIDR entry`);
      return;
    }
    setSaving(true);
    try {
      await api.saveSettings({ ipWhitelist: entries.join(","), ipWhitelistEnabled: whitelistEnabled });
      push("ok", `Whitelist saved (${entries.length} entr${entries.length === 1 ? "y" : "ies"}, ${whitelistEnabled ? "on" : "off"})`);
      reload();
    } catch (e: any) {
      push("err", e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveRegistration = async (open: boolean) => {
    setSavingReg(true);
    try {
      await api.saveSettings({ registrationOpen: open });
      setRegOpen(open);
      push("ok", open ? "New device registration opened" : "New device registration locked");
    } catch (e: any) {
      push("err", e.message ?? "Save failed");
    } finally {
      setSavingReg(false);
    }
  };

  if (!info) return <div className="py-16 text-center text-sm text-slate-500">Loading security center…</div>;

  return (
    <div>
      <PageHeader title="Security" subtitle="Access rules and the audit log." />

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Icon name="globe" size={15} className="text-indigo-300" />
              IP whitelist
            </h2>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={whitelistEnabled}
                onChange={(e) => setWhitelistEnabled(e.target.checked)}
                className="h-4 w-4 accent-indigo-500"
              />
              {whitelistEnabled ? "Enforcing" : "Disabled"}
            </label>
          </div>
          <Label>Allowed IPs / CIDR ranges (comma-separated)</Label>
          <Textarea
            rows={4}
            value={whitelistText}
            onChange={(e) => setWhitelistText(e.target.value)}
            placeholder="192.168.1.0/24, 10.0.0.5, 203.0.113.7"
            className="mono text-[12px]"
          />
          <p className="mt-2 text-xs text-slate-500">
            Only matching IPv4 addresses may log in while enforcing. <span className="text-slate-300">Paired devices with a valid session bypass the
            whitelist</span> - revoking their connection re-exposes them to the filter.
          </p>
          <div className="mt-3">
            <Btn onClick={() => void saveWhitelist()} disabled={saving}>
              {saving ? (
                "Saving…"
              ) : (
                <>
                  <Icon name="check" size={15} /> Save whitelist
                </>
              )}
            </Btn>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Icon name="shieldCheck" size={15} className="text-indigo-300" />
            Registration
          </h2>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#2a3247] bg-[#12161f] p-3.5">
            <input
              type="checkbox"
              checked={regOpen}
              disabled={savingReg}
              onChange={(e) => void saveRegistration(e.target.checked)}
              className="h-4 w-4 accent-indigo-500"
            />
            <div>
              <div className="text-sm text-white">Allow new device registration</div>
              <div className="text-xs text-slate-500">When off, the PIN only works for devices that already have a profile.</div>
            </div>
          </label>
          <div className="mt-3">
            <Badge tone={regOpen ? "warn" : "ok"}>
              <Icon name={regOpen ? "alert" : "lock"} size={11} />
              {regOpen ? "open to new devices" : "locked"}
            </Badge>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">Recent activity</h2>
            <span className="text-xs text-slate-500">{info.audit.length} latest entries, newest first</span>
          </div>
          <Link to="/admin/logs" className="inline-flex items-center gap-1 text-xs text-indigo-400 transition hover:text-indigo-300">
            <Icon name="history" size={12} /> Open the full activity log
          </Link>
        </div>
        {info.audit.length === 0 ? (
          <Empty icon="history" title="Nothing logged yet" hint="Sign-ins, uploads, downloads and admin actions are recorded here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#1c2334] text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">IP</th>
                  <th className="py-2 pr-4 font-medium">Event</th>
                  <th className="py-2 pr-4 font-medium">Result</th>
                  <th className="py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {info.audit.map((a) => {
                  const failed = !a.ok;
                  return (
                    <tr
                      key={a.id}
                      className={`border-b border-[#141a28] last:border-0 ${failed ? "bg-red-500/10 text-red-200" : "text-slate-300"}`}
                    >
                      <td className="whitespace-nowrap py-2 pr-4 text-slate-400">{timeAgo(a.ts)}</td>
                      <td className="whitespace-nowrap py-2 pr-4 font-mono">{a.ip || "-"}</td>
                      <td className="py-2 pr-4 font-medium">{a.event}</td>
                      <td className="py-2 pr-4">
                        <Badge tone={failed ? "bad" : "ok"}>
                          <Icon name={failed ? "alert" : "check"} size={11} className={failed ? "text-red-300" : "text-emerald-300"} />
                          {failed ? "failed" : "ok"}
                        </Badge>
                      </td>
                      <td className="max-w-[280px] truncate py-2 text-slate-400" title={a.detail}>
                        {a.detail || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
