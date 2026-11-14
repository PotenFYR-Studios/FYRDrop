import dgram from "node:dgram";
import os from "node:os";
import { getIdentity, announcement, type Announcement } from "./cluster";
import { getSettings } from "./settings";
import { effectiveClusterUrl, effectivePort } from "./config";
import { tlsState } from "./tls";

/**
 * Local network discovery. Instances announce themselves on a multicast group
 * and on the broadcast address; nothing secret is in the packet (node id, name,
 * url, public key). Pairing still needs both admins to approve.
 *
 * Docker note: multicast stays inside the bridge network. Containers on the
 * same user-defined network find each other; reaching instances on the LAN from
 * a bridge container needs host networking or a macvlan network.
 */

const GROUP = "239.255.42.99";
const PORT = 41234;
const TTL_MS = 2 * 60_000;

export interface DiscoveredNode extends Announcement {
  ip: string;
  seenAt: number;
  source: "beacon" | "scan";
}

const seen = new Map<string, DiscoveredNode>();
let socket: dgram.Socket | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let selfPort = effectivePort();

function primaryIpv4(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === "IPv4" && !iface.internal && !iface.address.startsWith("127.")) return iface.address;
    }
  }
  return "127.0.0.1";
}

export function advertisedUrl(): string {
  const explicit = effectiveClusterUrl();
  if (explicit) return explicit;
  const scheme = tlsState().active ? "https" : "http";
  return `${scheme}://${primaryIpv4()}:${selfPort}`;
}

function remember(a: Announcement, ip: string, source: "beacon" | "scan") {
  if (!a || a.v !== 2 || typeof a.nodeId !== "string" || a.nodeId === getIdentity().id) return;
  if (typeof a.url !== "string" || !/^https?:\/\//i.test(a.url)) return;
  seen.set(a.nodeId, { ...a, ip, seenAt: Date.now(), source });
}

export function startDiscovery(port: number) {
  selfPort = port;
  if (socket) return;
  try {
    socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    socket.on("message", (msg, rinfo) => {
      try {
        remember(JSON.parse(msg.toString("utf8")) as Announcement, rinfo.address, "beacon");
      } catch {
        /* ignore malformed beacons */
      }
    });
    socket.on("error", () => {
      try {
        socket?.close();
      } catch {
        /* already closed */
      }
      socket = null;
    });
    socket.bind(PORT, () => {
      try {
        socket?.addMembership(GROUP);
        socket?.setMulticastTTL(1);
      } catch {
        /* multicast may be unavailable; broadcast still works */
      }
    });
  } catch {
    socket = null;
  }

  const beat = () => {
    if (!socket) return;
    const packet = Buffer.from(
      JSON.stringify(announcement(advertisedUrl(), getSettings()?.appName ?? "FYRDrop", selfPort)),
      "utf8",
    );
    try {
      socket.send(packet, PORT, GROUP);
      socket.send(packet, PORT, "255.255.255.255");
    } catch {
      /* interface went away */
    }
  };
  beat();
  timer = setInterval(beat, 20_000);
  timer.unref?.();
}

export function stopDiscovery() {
  if (timer) clearInterval(timer);
  timer = null;
  try {
    socket?.close();
  } catch {
    /* already closed */
  }
  socket = null;
}

export function discovered(): DiscoveredNode[] {
  const now = Date.now();
  for (const [id, d] of seen) if (now - d.seenAt > TTL_MS) seen.delete(id);
  return [...seen.values()].sort((a, b) => b.seenAt - a.seenAt);
}

/** Probe likely addresses on the local /24s for the announce endpoint. */
export async function scanNetwork(port = selfPort, timeoutMs = 700): Promise<DiscoveredNode[]> {
  const targets = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      if (/^172\.(1[7-9]|2\d|3[01])\./.test(iface.address)) continue; // docker bridges
      const base = iface.address.split(".").slice(0, 3).join(".");
      for (let host = 1; host <= 254; host++) targets.add(`${base}.${host}`);
    }
  }
  const list = [...targets];
  const found: DiscoveredNode[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const ip = list[cursor++];
      if (!ip || ip === primaryIpv4()) continue;
      try {
        const res = await fetch(`http://${ip}:${port}/api/cluster-node/announce`, {
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: "application/json" },
        });
        if (!res.ok) continue;
        const data = (await res.json()) as Announcement;
        if (data?.v === 2 && data.nodeId !== getIdentity().id) {
          const entry: DiscoveredNode = { ...data, ip, seenAt: Date.now(), source: "scan" };
          seen.set(data.nodeId, entry);
          found.push(entry);
        }
      } catch {
        /* host has nothing on this port */
      }
    }
  };
  await Promise.all(Array.from({ length: 24 }, worker));
  return found;
}
