import os from "node:os";

/**
 * Hosting-environment detection: prints the right access URLs at boot and
 * adjusts security defaults for reverse proxies (Tailscale Serve/Funnel,
 * Cloudflare Tunnel).
 *
 * - Tailscale: set TAILSCALE_HOSTNAME=machine.tailnet-name.ts.net (or run
 *   `tailscale serve` against the app). Requests arrive with the tailscale
 *   host header - CSRF origin check passes automatically.
 * - Cloudflare Tunnel: run cloudflared with CLOUDFLARE_TUNNEL_TOKEN; requests
 *   carry cf-ray + x-forwarded-proto=https. We never serve our own TLS when a
 *   tunnel token is present (TLS terminates at Cloudflare's edge).
 */

export interface HostingInfo {
  scheme: "http" | "https";
  ports: { local: number };
  urls: string[];
  behindProxy: boolean;
  notes: string[];
}

export function detectHosting(port: number, tlsActive: boolean): HostingInfo {
  const urls: string[] = [];
  const notes: string[] = [];
  let scheme: "http" | "https" = tlsActive ? "https" : "http";

  urls.push(`local:     ${scheme}://localhost:${port}`);

  // LAN addresses (skip docker/VM virtual NICs heuristically)
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (/^(docker|veth|br-|vmnet|vEthernet)/i.test(name)) continue;
      urls.push(`network:   ${scheme}://${addr.address}:${port}  (${name})`);
    }
  }

  const tsHost = process.env.TAILSCALE_HOSTNAME?.trim();
  if (tsHost) {
    urls.push(`tailscale: https://${tsHost}`);
    notes.push(
      "TAILSCALE_HOSTNAME set - make sure `tailscale serve " +
        `https / http://localhost:${port}` + "` (or the compose sidecar) forwards to this port.",
    );
  }

  const cfToken = process.env.CLOUDFLARE_TUNNEL_TOKEN?.trim();
  const cfName = process.env.CLOUDFLARE_HOSTNAME?.trim();
  if (cfToken) {
    if (tlsActive) {
      notes.push("CLOUDFLARE_TUNNEL_TOKEN is set but TLS is active - set TLS_ENABLED=0; the tunnel terminates TLS at Cloudflare's edge.");
    }
    scheme = "https";
    if (cfName) urls.push(`cloudflare: https://${cfName}`);
    else urls.push("cloudflare: via your configured tunnel (hostname from the Zero Trust dashboard)");
    notes.push("Cloudflare Tunnel detected - set a Cloudflare Access policy in front of it for zero-trust auth, and add your tunnel hostname to CORS-free same-origin (it is, by Host header).");
  }

  const behindProxy = !!tsHost || !!cfToken || process.env.TRUST_PROXY === "1";
  if (behindProxy) {
    notes.push("Proxy detected - client IPs are read from x-forwarded-for; x-forwarded-host is trusted for CSRF checks.");
  }

  return { scheme, ports: { local: port }, urls, behindProxy, notes };
}

/** True when the current request came through a Cloudflare edge. */
export function isCloudflareRequest(headers: Headers) {
  return headers.has("cf-ray");
}

/** Best-effort client IP honoring proxy headers (Tailscale/cloudflared/nginx). */
export function clientIpFrom(headers: Headers) {
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  return headers.get("x-real-ip") ?? headers.get("cf-connecting-ip") ?? "";
}
