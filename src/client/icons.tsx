import { memo, useId, type SVGProps } from "react";

/**
 * FYRDrop custom icon set - 24×24, 1.75 stroke, currentColor.
 * Each glyph is [primary strokes, optional duotone accent]. The accent layer
 * renders as a soft filled shape at low opacity, giving the set its own look
 * without any icon dependency or Unicode emoji.
 */

type Glyph = { d: string; accent?: string };

const G: Record<string, Glyph> = {
  logo: { d: "M12 3.2c3.6 4.1 6.2 7.6 6.2 10.6a6.2 6.2 0 0 1-12.4 0c0-3 2.6-6.5 6.2-10.6Z M9.2 14.6a2.9 2.9 0 0 0 2.8 2.6", accent: "M12 3.2c3.6 4.1 6.2 7.6 6.2 10.6a6.2 6.2 0 0 1-12.4 0c0-3 2.6-6.5 6.2-10.6Z" },
  dashboard: { d: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z", accent: "M13 10h7v10h-7z" },
  folder: { d: "M3.5 7.5A2.5 2.5 0 0 1 6 5h3.2l2 2.2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19.2H6a2.5 2.5 0 0 1-2.5-2.5v-9.2Z M3.5 10h17", accent: "M3.5 10h17v6.7a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5Z" },
  note: { d: "M6 3.5h8.5L19 8v12.5H6zM14 3.5V8h4.5M9 12h6M9 15.5h4", accent: "M14 3.5V8h4.5Z" },
  link: { d: "M10 14a4.5 4.5 0 0 0 6.4.4l2-2a4.5 4.5 0 0 0-6.4-6.4l-1.1 1.1M14 10a4.5 4.5 0 0 0-6.4-.4l-2 2a4.5 4.5 0 0 0 6.4 6.4l1.1-1.1" },
  image: { d: "M4 5.5h16v13H4zM4 15l4.5-4.5L13 15l3-3 4 4M15.5 9.5h.01", accent: "M4 15l4.5-4.5L13 15l3-3 4 4v2.5H4Z" },
  transfer: { d: "M7 8h11l-3-3M17 16H6l3 3", accent: "M3 12a9 9 0 0 0 18 0 9 9 0 0 0-18 0Z" },
  shield: { d: "M12 3.5 19 6v5.5c0 4.3-2.8 7.4-7 9-4.2-1.6-7-4.7-7-9V6l7-2.5Z", accent: "M12 3.5 19 6v5.5c0 4.3-2.8 7.4-7 9Z" },
  shieldCheck: { d: "M12 3.5 19 6v5.5c0 4.3-2.8 7.4-7 9-4.2-1.6-7-4.7-7-9V6l7-2.5ZM9 12l2.2 2.2L15.5 10", accent: "M12 3.5 19 6v5.5c0 4.3-2.8 7.4-7 9-4.2-1.6-7-4.7-7-9V6Z" },
  key: { d: "M14.5 10.5a4 4 0 1 0-3.2 4.7L8 18.5H6v2H3.5v-3.2l6-6a4 4 0 0 1 5-4.8M15.5 8.5h.01", accent: "M10.5 9a4 4 0 1 0 8 0 4 4 0 0 0-8 0Z" },
  help: { d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.3a2.6 2.6 0 1 1 3.7 2.4c-.8.4-1.2 1-1.2 1.9M12 17h.01", accent: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" },
  chart: { d: "M4 20V4M4 20h16M8 16v-5M12.5 16V8M17 16v-3", accent: "M7 11h2v5H7zM11.5 8h2v8h-2zM16 13h2v3h-2z" },
  radio: { d: "M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M12 11v2M5.5 18.5a9.5 9.5 0 0 1 0-13M18.5 5.5a9.5 9.5 0 0 1 0 13" },
  drive: { d: "M4 6h16v5H4zM4 13h16v5H4zM7 8.5h.01M7 15.5h.01M11 8.5h6M11 15.5h6", accent: "M4 13h16v5H4z" },
  users: { d: "M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.7 2.8 2.4 3 5.2", accent: "M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" },
  user: { d: "M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5c.8-3.8 3.7-6 7.5-6s6.7 2.2 7.5 6", accent: "M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" },
  userPlus: { d: "M10 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3 20.5c.8-3.8 3.4-6 7-6 1.4 0 2.6.3 3.7.9M18 14v6M15 17h6", accent: "M10 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" },
  switchUser: { d: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c.7-3.4 3-5.5 6-5.5 1.2 0 2.3.3 3.2.9M15 14h6l-2-2M21 18h-6l2 2" },
  settings: { d: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19 12c0 .5 0 .9-.1 1.3l2 1.5-2 3.4-2.3-.9c-.7.6-1.5 1.1-2.4 1.4L13.8 21h-3.6l-.4-2.3c-.9-.3-1.7-.8-2.4-1.4l-2.3.9-2-3.4 2-1.5A7 7 0 0 1 5 12c0-.5 0-.9.1-1.3l-2-1.5 2-3.4 2.3.9c.7-.6 1.5-1.1 2.4-1.4L10.2 3h3.6l.4 2.3c.9.3 1.7.8 2.4 1.4l2.3-.9 2 3.4-2 1.5c.1.4.1.8.1 1.3Z", accent: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" },
  sliders: { d: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4" },
  star: { d: "m12 4 2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2l.9-5.5-4-3.9L9.5 9 12 4Z" },
  download: { d: "M12 4v11M7.5 11 12 15.5 16.5 11M5 20h14" },
  upload: { d: "M12 20V9M7.5 13 12 8.5l4.5 4.5M5 4h14" },
  cloudUp: { d: "M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.6 1.5 3.8 3.8 0 0 1-.5 7.5M12 20v-7M9 15.5l3-3 3 3", accent: "M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.6 1.5 3.8 3.8 0 0 1-.5 7.5Z" },
  share: { d: "M17.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6.5 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM17.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8.7 13.3l6.6 3.9M15.3 6.8 8.7 10.7" },
  trash: { d: "M5 7h14M9.5 7V5h5v2M7 7l1 13h8l1-13M10.5 11v5M13.5 11v5", accent: "M7 7l1 13h8l1-13Z" },
  copy: { d: "M8.5 8.5h10v12h-10zM15.5 8.5V3.5h-10v12h3", accent: "M8.5 8.5h10v12h-10z" },
  check: { d: "m5 12.5 4.5 4.5L19 7.5" },
  checkCircle: { d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 12.2l2.4 2.4 4.6-4.8", accent: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" },
  x: { d: "M6 6l12 12M18 6 6 18" },
  plus: { d: "M12 5v14M5 12h14" },
  minus: { d: "M5 12h14" },
  qr: { d: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM15 15h2v2h-2zM19 15h1M15 19h5M7 7h.01M17 7h.01M7 17h.01", accent: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" },
  clock: { d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2", accent: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" },
  alert: { d: "M12 4 21 20H3L12 4ZM12 10v4M12 17h.01", accent: "M12 4 21 20H3Z" },
  info: { d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01", accent: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" },
  arrowRight: { d: "M4 12h16M15 6l6 6-6 6" },
  arrowLeft: { d: "M20 12H4M9 6l-6 6 6 6" },
  chevronDown: { d: "m6 9 6 6 6-6" },
  chevronRight: { d: "m9 6 6 6-6 6" },
  external: { d: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" },
  logout: { d: "M9 4H4v16h5M15 8l4 4-4 4M8 12h11" },
  eye: { d: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", accent: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" },
  eyeOff: { d: "M4 4l16 16M10 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.8 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.2 3.3-.6" },
  camera: { d: "M4 7h4l1.5-2h5L16 7h4v13H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", accent: "M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" },
  palette: { d: "M12 21a9 9 0 1 1 9-9c0 2.5-2 3.5-4 3.5h-2a2 2 0 0 0-1.5 3.3c.7.9 0 2.2-1.5 2.2ZM7.5 10h.01M10 7h.01M14 7h.01M16.5 10h.01" },
  power: { d: "M12 4v7M7.5 6.5a7 7 0 1 0 9 0" },
  wifi: { d: "M4 9.5a12 12 0 0 1 16 0M7 13a7.5 7.5 0 0 1 10 0M10 16.5a3 3 0 0 1 4 0M12 20h.01" },
  file: { d: "M6.5 3.5h8L18.5 8v12.5h-12zM14 3.5V8h4.5", accent: "M14 3.5V8h4.5Z" },
  fileText: { d: "M6.5 3.5h8L18.5 8v12.5h-12zM14 3.5V8h4.5M9.5 12h6M9.5 15.5h6", accent: "M14 3.5V8h4.5Z" },
  film: { d: "M4 5h16v14H4zM8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4", accent: "M8 5h8v14H8z" },
  music: { d: "M9 18V6l11-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z" },
  archive: { d: "M3.5 5h17v4h-17zM5 9v10.5h14V9M10 13h4", accent: "M3.5 5h17v4h-17z" },
  code: { d: "m8 8-4.5 4L8 16M16 8l4.5 4L16 16M13.5 5l-3 14" },
  lock: { d: "M6 10.5h12V21H6zM8.5 10.5V7a3.5 3.5 0 1 1 7 0v3.5M12 14.5v2.5", accent: "M6 10.5h12V21H6z" },
  unlock: { d: "M6 10.5h12V21H6zM8.5 10.5V7a3.5 3.5 0 0 1 6.8-1.2M12 14.5v2.5", accent: "M6 10.5h12V21H6z" },
  database: { d: "M4 6.5c0-1.7 3.6-3 8-3s8 1.3 8 3v11c0 1.7-3.6 3-8 3s-8-1.3-8-3v-11ZM4 6.5c0 1.7 3.6 3 8 3s8-1.3 8-3M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" },
  refresh: { d: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" },
  bolt: { d: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z", accent: "M13 2 4 14h6l-1 8 9-12h-6Z" },
  bell: { d: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2ZM10 20a2 2 0 0 0 4 0" },
  monitor: { d: "M3.5 4.5h17v11h-17zM9 20h6M12 15.5V20", accent: "M3.5 4.5h17v11h-17z" },
  smartphone: { d: "M7 3h10v18H7zM10.5 18h3", accent: "M7 3h10v18H7z" },
  fingerprint: { d: "M12 11v4M8.5 20c.5-2 .5-4 .5-6a3 3 0 0 1 6 0c0 2 0 4 .5 6M5.5 20c.7-2.6 1-5.2 1-8a5.5 5.5 0 0 1 11 0c0 2.8.3 5.4 1 8M6 6.5A7.5 7.5 0 0 1 18 6.5" },
  globe: { d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.4 3.8 5.4 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3Z" },
  network: { d: "M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM19 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM12 8v4M12 12l-6 4.5M12 12l6 4.5", accent: "M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" },
  menu: { d: "M4 7h16M4 12h16M4 17h10" },
  search: { d: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM21 21l-5.2-5.2" },
  pencil: { d: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4" },
  sparkles: { d: "M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3ZM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2ZM5 15.5l.6 1.4 1.4.6-1.4.6L5 19.5l-.6-1.4-1.4-.6 1.4-.6.6-1.4Z", accent: "M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7Z" },
  inbox: { d: "M3.5 13.5 6 5h12l2.5 8.5v5h-17zM3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5", accent: "M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5v5h-17Z" },
  grid: { d: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z" },
  list: { d: "M8.5 6H20M8.5 12H20M8.5 18H20M4 6h.01M4 12h.01M4 18h.01" },
  pin: { d: "M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5ZM12 14v6", accent: "M7 12l3-3h4l3 3v2H7Z" },
  send: { d: "M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z", accent: "M21 3l-7 18-4-7-7-4Z" },
  mail: { d: "M3.5 5.5h17v13h-17zM3.5 6.5l8.5 6.5 8.5-6.5" },
  server: { d: "M4 4h16v6H4zM4 14h16v6H4zM7.5 7h.01M7.5 17h.01", accent: "M4 4h16v6H4z" },
  cpu: { d: "M7 7h10v10H7zM10 10h4v4h-4zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4", accent: "M10 10h4v4h-4z" },
  history: { d: "M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v4.5H8M12 7.5V12l3 2" },
  filter: { d: "M4 5h16l-6.2 7.5V19l-3.6-1.8v-4.7L4 5Z", accent: "M4 5h16l-6.2 7.5V19l-3.6-1.8v-4.7Z" },
  moreH: { d: "M5.5 12h.01M12 12h.01M18.5 12h.01" },
};

export type IconName = keyof typeof G;

export const Icon = memo(function Icon({
  name,
  size = 18,
  filled = false,
  duotone = true,
  strokeWidth = 1.75,
  className = "",
  ...rest
}: { name: IconName; size?: number; filled?: boolean; duotone?: boolean; strokeWidth?: number; className?: string } & Omit<SVGProps<SVGSVGElement>, "name">) {
  const g = G[name] ?? G.file!;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {(filled || (duotone && g.accent)) && <path d={filled ? g.d : g.accent!} fill="currentColor" stroke="none" opacity={filled ? 1 : 0.16} />}
      <path d={g.d} />
    </svg>
  );
});

/** The FYRDrop mark: a gradient drop with an orbit ring. */
export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="6" y1="3" x2="26" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#a5b4fc" />
          <stop offset=".55" stopColor="#6366f1" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path d="M16 3.5c5.2 5.8 8.8 10.6 8.8 14.9a8.8 8.8 0 1 1-17.6 0C7.2 14.1 10.8 9.3 16 3.5Z" fill={`url(#${id}g)`} />
      <path d="M11.8 19.6a4.3 4.3 0 0 0 4.1 3.9" stroke="#fff" strokeOpacity=".85" strokeWidth="2" strokeLinecap="round" fill="none" />
      <ellipse cx="16" cy="18.5" rx="13" ry="4.2" stroke={`url(#${id}g)`} strokeOpacity=".55" strokeWidth="1.2" fill="none" transform="rotate(-18 16 18.5)" />
    </svg>
  );
}

export const MIME_ICONS: { test: RegExp; icon: IconName }[] = [
  { test: /^image\//, icon: "image" },
  { test: /^video\//, icon: "film" },
  { test: /^audio\//, icon: "music" },
  { test: /pdf/, icon: "fileText" },
  { test: /zip|tar|gzip|7z|rar|compressed/, icon: "archive" },
  { test: /json|javascript|typescript|xml|html|css|x-sh|python/, icon: "code" },
  { test: /x509|pem|pkcs/, icon: "key" },
];

export function mimeIcon(mime: string, name = ""): IconName {
  for (const m of MIME_ICONS) if (m.test.test(mime)) return m.icon;
  if (/\.(md|txt|log|csv)$/i.test(name)) return "fileText";
  if (/\.(zip|7z|rar|tar|gz)$/i.test(name)) return "archive";
  if (/\.(js|ts|tsx|py|go|rs|sh|json|ya?ml)$/i.test(name)) return "code";
  return "file";
}

/** Tint per file family - used for icon tiles. */
export function mimeTone(icon: IconName): string {
  switch (icon) {
    case "image":
      return "text-cyan-300 bg-cyan-400/10 ring-cyan-400/20";
    case "film":
      return "text-fuchsia-300 bg-fuchsia-400/10 ring-fuchsia-400/20";
    case "music":
      return "text-pink-300 bg-pink-400/10 ring-pink-400/20";
    case "archive":
      return "text-amber-300 bg-amber-400/10 ring-amber-400/20";
    case "code":
      return "text-emerald-300 bg-emerald-400/10 ring-emerald-400/20";
    case "note":
    case "fileText":
      return "text-sky-300 bg-sky-400/10 ring-sky-400/20";
    case "link":
      return "text-violet-300 bg-violet-400/10 ring-violet-400/20";
    case "key":
      return "text-yellow-300 bg-yellow-400/10 ring-yellow-400/20";
    default:
      return "text-indigo-300 bg-indigo-400/10 ring-indigo-400/20";
  }
}
