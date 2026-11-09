import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, timeAgo, type AppNotification } from "../api";
import { Icon, type IconName } from "../icons";
import { Spinner, useSync } from "../ui";

const KIND_ICON: Record<string, IconName> = {
  "share.downloaded": "download",
  "item.shared": "share",
  "group.added": "users",
  "security.login": "shield",
  "security.account": "lock",
  "storage.quota": "drive",
  "system.alert": "alert",
};

/** Bell with unread count and a dropdown inbox. Updates live through the shared event stream. */
export default function NotificationBell({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.notifications();
      setItems(r.items);
      setUnread(r.unread);
    } catch {
      /* signed out or offline - the bell just stays quiet */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useSync(() => void load(), { scopes: ["notifications"] });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openItem = async (n: AppNotification) => {
    setOpen(false);
    if (!n.readAt) {
      setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, readAt: Date.now() } : x)) ?? list);
      setUnread((u) => Math.max(0, u - 1));
      void api.markNotificationsRead([n.id]).catch(() => {});
    }
    if (n.link) navigate(n.link);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`relative flex items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-white ${compact ? "p-2" : "h-[34px] w-[38px] border border-[#2a3247] bg-white/[0.02]"}`}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Icon name="bell" size={compact ? 19 : 15} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[17px] rounded-full bg-indigo-500 px-1 text-center text-[10px] font-semibold leading-[17px] text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="anim-pop fixed left-3 right-3 top-14 z-[60] max-h-[70vh] overflow-hidden rounded-2xl border border-[#2a3247] bg-[#0f131c] shadow-2xl sm:left-auto sm:w-96 lg:left-64 lg:right-auto lg:top-4"
        >
          <div className="flex items-center gap-2 border-b border-[#1c2334] px-4 py-3">
            <span className="flex-1 text-sm font-semibold text-white">Notifications</span>
            {unread > 0 && (
              <button onClick={() => void api.markNotificationsRead("all").then(load)} className="text-[11px] text-indigo-300 hover:text-indigo-200">
                Mark all read
              </button>
            )}
            {items?.some((n) => n.readAt) && (
              <button onClick={() => void api.clearReadNotifications().then(load)} className="text-[11px] text-slate-500 hover:text-slate-300">
                Clear read
              </button>
            )}
            <button onClick={() => { setOpen(false); navigate("/profile#notifications"); }} className="rounded p-1 text-slate-500 hover:text-slate-200" aria-label="Notification settings" title="Notification settings">
              <Icon name="settings" size={14} />
            </button>
          </div>
          <div className="max-h-[calc(70vh-48px)] overflow-y-auto">
            {items === null ? (
              <div className="flex justify-center p-6"><Spinner /></div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">Nothing new. Shares, sign-ins and alerts show up here.</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => void openItem(n)}
                  className={`flex w-full gap-3 border-b border-[#161c28] px-4 py-3 text-left transition hover:bg-white/[0.03] ${n.readAt ? "opacity-60" : ""}`}
                >
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${n.kind.startsWith("security") || n.kind === "system.alert" ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-[#2a3247] bg-white/[0.03] text-slate-300"}`}>
                    <Icon name={KIND_ICON[n.kind] ?? "bell"} size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className="flex-1 text-[13px] leading-snug text-slate-100">{n.title}</span>
                      {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-400" aria-label="unread" />}
                    </span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block whitespace-pre-line text-[11px] text-slate-500">{n.body}</span>}
                    <span className="mt-1 block text-[10px] text-slate-600">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
