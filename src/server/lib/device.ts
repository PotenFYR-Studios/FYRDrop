import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import { execFile } from "node:child_process";

/**
 * Device identification.
 *
 * Browsers deliberately expose very little about the machine. What we can do:
 *  - a friendly name from the user agent (always works),
 *  - a real host name by asking DNS for the PTR record of the client IP
 *    (works on networks whose router publishes DHCP names),
 *  - the MAC from the server's own neighbour table (bare metal, same L2 only),
 *  - whatever the page reports about itself (platform, screen, timezone, and a
 *    local IPv4 gathered from WebRTC ICE candidates).
 *
 * A browser can never read the MAC address itself. Inside Docker the server
 * only sees the bridge gateway, so neighbour lookups there would describe the
 * host's virtual adapter, not the client. We skip them and say why.
 */

export interface DeviceHints {
  name?: string;
  platform?: string;
  language?: string;
  timezone?: string;
  screen?: string;
  dpr?: number;
  cores?: number;
  memoryGb?: number;
  touch?: boolean;
  localIp?: string;
}

export interface DeviceIdentity {
  name: string;
  hostName: string;
  mac: string;
  meta: Record<string, unknown>;
}

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function isIpv4(ip: string): boolean {
  return IPV4.test(ip) && ip.split(".").every((o) => Number(o) <= 255);
}

export function isPrivateIpv4(ip: string): boolean {
  if (!isIpv4(ip)) return false;
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "local" || ip === "";
}

let containerCache: boolean | null = null;
/** True when we are running inside a container, where client L2 details are hidden. */
export function inContainer(): boolean {
  if (containerCache !== null) return containerCache;
  try {
    if (fs.existsSync("/.dockerenv")) containerCache = true;
    else {
      const cgroup = fs.existsSync("/proc/1/cgroup") ? fs.readFileSync("/proc/1/cgroup", "utf8") : "";
      containerCache = /docker|kubepods|containerd|podman/i.test(cgroup);
    }
  } catch {
    containerCache = false;
  }
  return containerCache;
}

/* ------------------------------- User agent ------------------------------- */

export function parseUserAgent(ua: string) {
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Windows/i.test(ua)
    ? "Windows"
    : /Android/i.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/i.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Unknown OS";
  const type = /iPad|Tablet/i.test(ua) ? "tablet" : /Android|iPhone|iPod|Mobile/i.test(ua) ? "phone" : "desktop";
  return { browser, os, type, label: `${browser} on ${os}` };
}

function friendlyName(ua: string, hints: DeviceHints) {
  if (hints.name && String(hints.name).trim()) return String(hints.name).trim().slice(0, 60);
  const p = parseUserAgent(ua);
  return p.os === "Unknown OS" ? `${p.browser} device` : `${p.browser} on ${p.os}`;
}

/* ------------------------------- Host name -------------------------------- */

const hostCache = new Map<string, { name: string; until: number }>();

/**
 * c-ares (used by node:dns) does not consult the OS resolver, so on Windows and
 * on Linux with nss-mdns a LAN host name that the system itself can resolve can
 * still come back empty. Ask the OS as a second opinion.
 */
async function systemReverse(ip: string): Promise<string> {
  let out = "";
  if (process.platform === "win32") {
    out = await exec("ping", ["-a", "-n", "1", "-w", "800", ip], 1400);
    const m = /Pinging\s+([^\s\[]+)\s+\[/i.exec(out);
    return m ? m[1]!.replace(/\.$/, "").slice(0, 80) : "";
  }
  if (process.platform === "linux") {
    out = await exec("getent", ["hosts", ip], 1200);
    const first = out.trim().split(/\s+/)[0] ?? "";
    return first && first !== ip ? first.replace(/\.$/, "").slice(0, 80) : "";
  }
  out = await exec("dscacheutil", ["-q", "host", "-a", `ip_address=${ip}`], 1200);
  const m = /name:\s*([^\s]+)/i.exec(out);
  return m ? m[1]!.replace(/\.$/, "").slice(0, 80) : "";
}

/** Reverse DNS for the client IP, with a short timeout and a 10 minute cache. */
export async function hostNameFor(ip: string): Promise<string> {
  if (!isIpv4(ip) || isLoopback(ip)) return "";
  const hit = hostCache.get(ip);
  if (hit && hit.until > Date.now()) return hit.name;
  const ptr = dns
    .reverse(ip)
    .then((names) => {
      const clean = (names[0] ?? "").replace(/\.$/, "");
      // Ignore generic PTR names that are just the IP again.
      return clean && clean !== ip && !clean.replace(/[-.]/g, "").includes(ip.replace(/\./g, "")) ? clean.slice(0, 80) : "";
    })
    .catch(() => "");
  const timeout = new Promise<string>((r) => setTimeout(() => r(""), 900));
  const [fromDns, fromOs] = await Promise.all([Promise.race([ptr, timeout]), systemReverse(ip)]);
  const name = fromDns || fromOs;
  hostCache.set(ip, { name, until: Date.now() + 10 * 60_000 });
  if (hostCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of hostCache) if (v.until < now) hostCache.delete(k);
  }
  return name;
}

/* --------------------------------- MAC ------------------------------------ */

const MAC_RE = /([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i;
const macCache = new Map<string, { mac: string; until: number }>();

function exec(cmd: string, args: string[], timeoutMs = 900): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => resolve(err ? "" : String(stdout)));
    } catch {
      resolve("");
    }
  });
}

/**
 * Best-effort MAC from the local neighbour table. Only meaningful when the
 * server shares the client's L2 segment, which is why containers and loopback
 * are excluded.
 */
export async function macFor(ip: string): Promise<string> {
  if (!isIpv4(ip) || isLoopback(ip) || !isPrivateIpv4(ip) || inContainer()) return "";
  const hit = macCache.get(ip);
  if (hit && hit.until > Date.now()) return hit.mac;
  // The client may be this machine (LAN address of the server): read the MAC
  // straight from the local interfaces instead of the neighbour table.
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === "IPv4" && iface.address === ip && iface.mac && iface.mac !== "00:00:00:00:00:00") {
        macCache.set(ip, { mac: iface.mac.toLowerCase(), until: Date.now() + 5 * 60_000 });
        return iface.mac.toLowerCase();
      }
    }
  }
  let out = "";
  if (process.platform === "linux") out = await exec("ip", ["neigh", "show", ip]);
  else if (process.platform === "darwin") out = await exec("arp", ["-n", ip]);
  else if (process.platform === "win32") out = await exec("arp", ["-a", ip]);
  const m = MAC_RE.exec(out);
  const mac = m ? m[0].replace(/-/g, ":").toLowerCase() : "";
  macCache.set(ip, { mac, until: Date.now() + 5 * 60_000 });
  return mac;
}

/* ------------------------------- Identity --------------------------------- */

function cleanHints(raw: unknown): DeviceHints {
  const h = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    name: str(h.name, 60),
    platform: str(h.platform, 80),
    language: str(h.language, 20),
    timezone: str(h.timezone, 60),
    screen: str(h.screen, 20),
    dpr: num(h.dpr),
    cores: num(h.cores),
    memoryGb: num(h.memoryGb),
    touch: typeof h.touch === "boolean" ? h.touch : undefined,
    localIp: isIpv4(str(h.localIp, 40)) ? str(h.localIp, 40) : "",
  };
}

export async function identifyDevice(opts: { ua: string; ip: string; hints?: unknown }): Promise<DeviceIdentity> {
  const hints = cleanHints(opts.hints);
  const uaInfo = parseUserAgent(opts.ua);
  const hostName = await hostNameFor(opts.ip);
  const mac = await macFor(opts.ip);
  const name = (hostName || friendlyName(opts.ua, hints)).slice(0, 60);
  const meta: Record<string, unknown> = {
    ...uaInfo,
    platform: hints.platform || "",
    language: hints.language || "",
    timezone: hints.timezone || "",
    screen: hints.screen || "",
    dpr: hints.dpr ?? null,
    cores: hints.cores ?? null,
    memoryGb: hints.memoryGb ?? null,
    touch: hints.touch ?? null,
    reportedIp: hints.localIp || "",
    reverseDns: hostName,
    macSource: mac
      ? "detected"
      : inContainer()
        ? "unavailable-in-container"
        : isLoopback(opts.ip)
          ? "loopback"
          : isPrivateIpv4(opts.ip)
            ? "not-in-table"
            : "public-ip",
  };
  return { name, hostName, mac, meta };
}
