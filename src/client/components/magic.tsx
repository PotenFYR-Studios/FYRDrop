import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Small, dependency-free "Magic UI" style primitives.
 *
 * Everything here is plain CSS/DOM - no animation libraries, no extra bundle
 * weight - and every effect respects prefers-reduced-motion.
 */

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/* ------------------------------- DotPattern ------------------------------- */

/** Faint dot grid used behind hero sections and empty states. */
export function DotPattern({
  className = "",
  width = 18,
  height = 18,
  cx = 1,
  cy = 1,
  cr = 1,
}: {
  className?: string;
  width?: number;
  height?: number;
  cx?: number;
  cy?: number;
  cr?: number;
}) {
  const id = `dot-${width}-${height}-${cx}-${cy}-${cr}`.replace(/\./g, "_");
  return (
    <svg
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full text-slate-400/20 ${className}`}
    >
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse">
          <circle cx={cx} cy={cy} r={cr} fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/* ------------------------------- BorderBeam ------------------------------- */

/** A light beam that travels around a rounded container's border. */
export function BorderBeam({
  className = "",
  duration = 9,
  delay = 0,
  size = 140,
  colorFrom = "#6366f1",
  colorTo = "#22d3ee",
}: {
  className?: string;
  duration?: number;
  delay?: number;
  size?: number;
  colorFrom?: string;
  colorTo?: string;
}) {
  if (reducedMotion()) return null;
  const style = {
    "--beam-from": colorFrom,
    "--beam-to": colorTo,
    animationDuration: `${duration}s`,
    animationDelay: `${delay}s`,
    boxShadow: `0 0 ${Math.max(12, Math.round(size / 8))}px ${colorFrom}44`,
  } as CSSProperties;
  return (
    <span aria-hidden="true" className={`pointer-events-none absolute inset-0 rounded-[inherit] ${className}`}>
      <span className="beam-ring" style={style} />
    </span>
  );
}

/* -------------------------------- MagicCard ------------------------------- */

/** Card whose border and surface light up under the pointer. */
export function MagicCard({
  children,
  className = "",
  gradientSize = 260,
  glow = "rgba(99,102,241,0.55)",
}: {
  children: ReactNode;
  className?: string;
  gradientSize?: number;
  glow?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onPointerLeave={() => setPos(null)}
      className={`group relative overflow-hidden rounded-2xl border border-[#232a3a] bg-[#0f131b]/85 ${className}`}
      style={
        pos
          ? ({
              backgroundImage: `radial-gradient(${gradientSize}px circle at ${pos.x}px ${pos.y}px, ${glow}, transparent 45%)`,
            } as CSSProperties)
          : undefined
      }
    >
      {children}
    </div>
  );
}

/* ------------------------------- NumberTicker ------------------------------ */

/** Counts up to `value` once, on mount. */
export function NumberTicker({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 900,
  className = "",
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const from = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    const delta = value - begin;
    if (reducedMotion() || !Number.isFinite(delta) || delta === 0) {
      setShown(value);
      from.current = value;
      return;
    }
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(begin + delta * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);

  return (
    <span className={`tabular-nums ${className}`}>
      {prefix}
      {shown.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/* -------------------------------- BlurFade -------------------------------- */

/** Fades/slides children in on mount; `delay` staggers lists. */
export function BlurFade({
  children,
  delay = 0,
  className = "",
  y = 10,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  const [in_, setIn] = useState(() => reducedMotion());
  useEffect(() => {
    if (reducedMotion()) return;
    const t = setTimeout(() => setIn(true), Math.max(0, delay));
    return () => clearTimeout(t);
  }, [delay]);
  return (
    <div
      className={className}
      style={{
        opacity: in_ ? 1 : 0,
        transform: in_ ? "none" : `translateY(${y}px)`,
        filter: in_ ? "none" : "blur(6px)",
        transition: "opacity .5s cubic-bezier(.22,1,.36,1), transform .5s cubic-bezier(.22,1,.36,1), filter .5s",
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------ ShimmerButton ----------------------------- */

/** Primary button with a slow light sweep; used for the main auth actions. */
export function ShimmerButton({
  children,
  onClick,
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`shimmer-btn relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-5 py-2.5 text-sm font-medium text-white transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 ${className}`}
    >
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </button>
  );
}
