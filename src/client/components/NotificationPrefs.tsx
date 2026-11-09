import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, Spinner, useToast } from "../ui";

type PrefState = Awaited<ReturnType<typeof api.notificationPrefs>>;

/** Profile section: which events notify you in the app and by email. */
export default function NotificationPrefs() {
  const { push } = useToast();
  const [st, setSt] = useState<PrefState | null>(null);

  useEffect(() => {
    api.notificationPrefs().then(setSt, (e) => push("err", e?.message ?? "Could not load notification settings"));
  }, [push]);

  useEffect(() => {
    if (st && window.location.hash === "#notifications") document.getElementById("notifications")?.scrollIntoView({ behavior: "smooth" });
  }, [st]);

  if (!st) return <Card className="mt-5 flex justify-center p-6"><Spinner /></Card>;

  const toggle = async (channel: "inapp" | "email", key: string, value: boolean) => {
    const prev = st;
    setSt({ ...st, prefs: { ...st.prefs, [channel]: { ...st.prefs[channel], [key]: value } } });
    try {
      const r = await api.saveNotificationPrefs({ [channel]: { [key]: value } });
      setSt((s) => (s ? { ...s, prefs: r.prefs } : s));
    } catch (e: any) {
      setSt(prev);
      push("err", e?.message ?? "Could not save");
    }
  };

  return (
    <Card className="mt-5 p-6">
      <div id="notifications" className="scroll-mt-24">
        <h2 className="text-sm font-semibold text-white">Notifications</h2>
        <p className="mt-1 text-xs text-slate-500">
          {st.emailReady ? "Choose what shows up under the bell and what is also emailed to you." : "Email copies need a confirmed email address above and email set up by the owner."}
        </p>
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-[#232a3a]">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 bg-white/[0.02] px-4 py-2 text-[10px] uppercase tracking-wide text-slate-500">
          <span>Event</span>
          <span>In app</span>
          <span>Email</span>
        </div>
        {st.kinds.map((k) => (
          <div key={k.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-t border-[#1c2334] px-4 py-2.5 text-sm">
            <span className="min-w-0 text-slate-200">
              {k.label}
              <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-600">{k.group}</span>
            </span>
            <input type="checkbox" className="h-4 w-4 accent-indigo-500" aria-label={`${k.label} in app`} checked={!!st.prefs.inapp[k.key]} onChange={(e) => void toggle("inapp", k.key, e.target.checked)} />
            <input type="checkbox" className="h-4 w-4 accent-indigo-500" aria-label={`${k.label} by email`} checked={!!st.prefs.email[k.key]} disabled={!st.emailReady} onChange={(e) => void toggle("email", k.key, e.target.checked)} />
          </div>
        ))}
      </div>
    </Card>
  );
}
