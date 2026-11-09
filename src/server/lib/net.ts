import type { Context } from "hono";
import { readConfig } from "./config";
import { inContainer, isLoopback, isPrivateIpv4 } from "./device";

/**
 * Client-IP resolution.
 *
 * Proxy headers (x-forwarded-for, x-real-ip, cf-connecting-ip) are attacker
 * controlled unless a trusted reverse proxy sits in front of us. They are only
 * honoured when the operator opted in (config.trustProxy / TRUST_PROXY=1, or a
 * tunnel env var is present). Otherwise the real socket address handed to us
 * by Bun.serve (c.env.ip) is authoritative - this is what keeps rate limits and
 * the IP whitelist from being bypassed with a forged header.
 */

export type AppEnv = { Bindings: { ip?: string } };

let trustCache: boolean | null = null;

export function trustProxy(): boolean {
  if (trustCache !== null) return trustCache;
  trustCache =
    process.env.TRUST_PROXY === "1" ||
    process.env.TRUST_PROXY === "true" ||
    !!process.env.TAILSCALE_HOSTNAME?.trim() ||
    !!process.env.CLOUDFLARE_TUNNEL_TOKEN?.trim() ||
    readConfig().trustProxy === true;
  return trustCache;
}

function normalize(ip: string) {
  // IPv4-mapped IPv6 (::ffff:192.168.1.5) -> 192.168.1.5
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return (m ? m[1]! : ip).slice(0, 64);
}

export type IpSource = "socket" | "proxy" | "loopback" | "docker";

export interface ClientIpInfo {
  ip: string;
  source: IpSource;
}

/**
 * The client IP plus where it came from, so the UI can explain why a proxy or
 * container setup might show an address that is not the person's LAN IP.
 */
export function clientIpInfo(c: Context): ClientIpInfo {
  const socket = (c.env as { ip?: string } | undefined)?.ip ?? "";
  if (trustProxy()) {
    const fwd =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip");
    if (fwd) return { ip: normalize(fwd), source: "proxy" };
  }
  const ip = normalize(socket || "local");
  if (isLoopback(ip)) return { ip, source: "loopback" };
  if (inContainer() && isPrivateIpv4(ip)) return { ip, source: "docker" };
  return { ip, source: "socket" };
}

export function clientIp(c: Context): string {
  return clientIpInfo(c).ip;
}

/** Host used for same-origin checks; x-forwarded-host only behind a trusted proxy. */
export function requestHost(c: Context): string {
  if (trustProxy()) {
    const fh = c.req.header("x-forwarded-host");
    if (fh) return fh.split(",")[0]!.trim();
  }
  return c.req.header("host") ?? "";
}

export function requestProto(c: Context): "http" | "https" {
  if (trustProxy()) {
    const fp = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
    if (fp === "https" || fp === "http") return fp;
  }
  return new URL(c.req.url).protocol === "https:" ? "https" : "http";
}
