import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { humanSize, timeAgo } from "./api";
import { Icon, type IconName } from "./icons";
import { NumberTicker } from "./components/magic";

/* ---------- Toasts ---------- */
type Toast = { id: number; kind: "ok" | "err" | "info"; msg: string };
const ToastCtx = createContext<{ push: (kind: Toast["kind"], msg: string) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`anim-pop flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm shadow-2xl backdrop-blur ${
              t.kind === "ok"
                ? "border-emerald-500/40 bg-emerald-950/80 text-emerald-200"
                : t.kind === "err"
                  ? "border-red-500/40 bg-red-950/80 text-red-200"
                  : "border-indigo-500/40 bg-indigo-950/80 text-indigo-100"
            }`}
          >
            <Icon name={t.kind === "ok" ? "check" : t.kind === "err" ? "alert" : "info"} size={16} />
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Primitives ---------- */
export function Btn({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  type,
  href,
  download,
  target = "_self",
  title,
  ariaLabel,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "soft";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  type?: "button" | "submit";
  /** Render a real link styled as a button (valid HTML - never nest <button> in <a>). */
  href?: string;
  download?: string;
  target?: "_self" | "_blank";
  title?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const base = "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none";
  const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-5 py-2.5 text-base" };
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-950/50",
    ghost: "text-slate-300 hover:text-white hover:bg-white/5 border border-transparent",
    danger: "bg-red-600/90 text-white hover:bg-red-500",
    soft: "bg-white/5 text-slate-200 hover:bg-white/10 border border-[#2a3247]",
  };
  const cls = `${base} ${sizes[size]} ${variants[variant]} ${disabled && href ? "pointer-events-none opacity-40" : ""} ${className}`;
  if (href) {
    return (
      <a
        href={href}
        download={download}
        target={target}
        rel={target === "_blank" ? "noopener noreferrer" : undefined}
        title={title}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        className={cls}
      >
        {children}
      </a>
    );
  }
  return (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel} className={cls}>
      {children}
    </button>
  );
}

export function Card({
  children,
  className = "",
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`glass rounded-2xl ${onClick ? "hover-lift cursor-pointer" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-[#2a3247] bg-[#12161f] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl border border-[#2a3247] bg-[#12161f] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 ${props.className ?? ""}`}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">{children}</label>;
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "ok" | "warn" | "bad" | "info" }) {
  const tones = {
    default: "bg-white/5 text-slate-300 border-white/10",
    ok: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    warn: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    bad: "bg-red-500/10 text-red-300 border-red-500/30",
    info: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon = "folder", title, hint }: { icon?: IconName; title: string; hint?: string }) {
  return (
    <div className="anim-pop flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#2a3247] py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#2a3247] bg-white/[0.03] text-slate-500">
        <Icon name={icon} size={26} />
      </div>
      <div className="font-medium text-slate-300">{title}</div>
      {hint && <div className="max-w-sm text-sm text-slate-500">{hint}</div>}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-indigo-400" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`anim-pop glass max-h-[90vh] w-full ${wide ? "max-w-2xl" : "max-w-md"} overflow-y-auto rounded-2xl p-6 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white" aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- Wizard steps ---------- */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="mb-6 flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s} className="flex flex-1 items-center gap-2">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-300 ${
              i < current
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                : i === current
                  ? "anim-glow border-indigo-500 bg-indigo-500/20 text-white"
                  : "border-[#2a3247] bg-transparent text-slate-500"
            }`}
          >
            {i < current ? <Icon name="check" size={14} /> : i + 1}
          </div>
          <span className={`hidden text-xs sm:block ${i === current ? "text-white" : "text-slate-500"}`}>{s}</span>
          {i < steps.length - 1 && <div className={`h-px flex-1 ${i < current ? "bg-emerald-500/40" : "bg-[#2a3247]"}`} />}
        </div>
      ))}
    </div>
  );
}

/* ---------- Charts (pure SVG) ---------- */
export function StatCard({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon?: IconName }) {
  return (
    <Card className="hover-lift p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-1.5 text-2xl font-semibold text-white">
            {typeof value === "number" ? <NumberTicker value={value} /> : value}
          </div>
          {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
        </div>
        {icon && (
          <div className="rounded-xl border border-[#2a3247] bg-white/[0.03] p-2.5 text-indigo-300">
            <Icon name={icon} size={20} />
          </div>
        )}
      </div>
    </Card>
  );
}

export function Bars({ data, height = 120 }: { data: { date: string; count: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((d) => (
        <div key={d.date} className="group relative flex-1">
          <div
            className="w-full rounded-t-md bg-gradient-to-t from-indigo-600/50 to-cyan-400/70 transition-all duration-300 group-hover:from-indigo-500 group-hover:to-cyan-300"
            style={{ height: `${Math.max(3, (d.count / max) * height)}px` }}
          />
          <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-md border border-[#2a3247] bg-[#12161f] px-2 py-1 text-[10px] text-slate-200 opacity-0 transition group-hover:opacity-100">
            {d.date.slice(5)} · {d.count}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Donut({ segments, size = 130 }: { segments: { label: string; value: number; color: string }[]; size?: number }) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a2030" strokeWidth="14" />
        {segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="14"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                className="transition-all duration-500"
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <div className="space-y-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            <span className="capitalize text-slate-300">{s.label}</span>
            <span className="text-slate-500">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Progress({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
      <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-200" style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

/* ---------- Item bits ---------- */
export function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const { push } = useToast();
  return (
    <Btn
      size="sm"
      variant="soft"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          push("ok", "Copied to clipboard");
          setTimeout(() => setDone(false), 1500);
        } catch {
          push("err", "Clipboard blocked by the browser");
        }
      }}
    >
      {done ? (
        <>
          <Icon name="check" size={14} />
          Copied
        </>
      ) : (
        <>
          <Icon name="copy" size={14} />
          {label}
        </>
      )}
    </Btn>
  );
}

export function ItemMeta({ item }: { item: { uploadedBy: string; createdAt: number; size: number; downloads: number; expiresAt?: number | null } }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
      <span className="inline-flex items-center gap-1" title="Uploaded by">
        <Icon name="users" size={11} />
        {item.uploadedBy}
      </span>
      <span title="Created">{timeAgo(item.createdAt)}</span>
      <span title="Size">{humanSize(item.size)}</span>
      <span className="inline-flex items-center gap-1" title="Downloads">
        <Icon name="download" size={11} />
        {item.downloads}
      </span>
      {item.expiresAt && <Badge tone="warn">expires {timeAgo(item.expiresAt).replace(" ago", "")}</Badge>}
    </div>
  );
}

export function Avatar({ user, size = 36 }: { user: { name: string; avatar: string | null; color: string } | null; size?: number }) {
  if (!user) return <div className="rounded-full bg-white/10" style={{ width: size, height: size }} />;
  return user.avatar ? (
    <img src={user.avatar} alt={user.name} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <div
      className="flex items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${user.color}, ${user.color}88)`, fontSize: size * 0.42 }}
    >
      {user.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

/* ---------- Realtime ---------- */
// One shared EventSource per tab (see sync.ts). Re-exported here so pages keep
// importing from "../ui".
import { useSync, useSyncStatus, type SyncStatus } from "./sync";
export { useSync, useSyncStatus };
export type { SyncStatus };

export function LiveIndicator({ status }: { status: SyncStatus }) {
  const map = {
    online: { color: "bg-emerald-400", ring: "bg-emerald-400", label: "Live - realtime sync connected" },
    connecting: { color: "bg-amber-400", ring: "bg-amber-400", label: "Connecting to realtime sync…" },
    offline: { color: "bg-red-400", ring: "bg-red-400", label: "Realtime sync offline - retrying" },
  }[status];
  return (
    <div
      title={map.label}
      className="flex items-center gap-2 rounded-lg border border-[#232a3a] bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-400"
    >
      <span className="relative flex h-2 w-2">
        {status === "online" && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${map.ring} opacity-50`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${map.color}`} />
      </span>
      <span>{status === "online" ? "Live" : status === "connecting" ? "Connecting" : "Offline"}</span>
    </div>
  );
}
