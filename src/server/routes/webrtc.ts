import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireSession } from "../lib/auth";
import { sendSignal } from "../lib/events";
import { hit } from "../lib/security";
import type { AppEnv } from "../lib/net";

/**
 * WebRTC signaling + presence for true peer-to-peer device-to-device
 * transfers. The server never sees file bytes - it only relays SDP/ICE
 * between two signed-in devices. Files travel over the encrypted data
 * channel directly between browsers.
 */

export const webrtcRoutes = new Hono<AppEnv>();

webrtcRoutes.use("*", requireSession);
webrtcRoutes.use("*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "Signal too large." }, 413) }));

/** sessionId -> presence entry (bounded by the number of signed-in devices). */
const presence = new Map<string, { deviceName: string; userName: string; userId: string; color: string; lastSeen: number }>();
const ONLINE_MS = 45_000;

export function sweepPresence() {
  const now = Date.now();
  for (const [k, v] of presence) if (now - v.lastSeen > ONLINE_MS) presence.delete(k);
}

webrtcRoutes.post("/presence", (c) => {
  const s = c.get("session");
  presence.set(s.token, { deviceName: s.deviceName, userName: s.user!.name, userId: s.user!.id, color: s.user!.color, lastSeen: Date.now() });
  return c.json({ ok: true });
});

webrtcRoutes.post("/presence/leave", (c) => {
  presence.delete(c.get("session").token);
  return c.json({ ok: true });
});

webrtcRoutes.get("/peers", (c) => {
  const s = c.get("session");
  const now = Date.now();
  return c.json({
    peers: [...presence.entries()]
      .filter(([token, v]) => token !== s.token && now - v.lastSeen <= ONLINE_MS)
      .map(([token, v]) => ({ token, deviceName: v.deviceName, userName: v.userName, color: v.color, mine: v.userId === s.user!.id, lastSeen: v.lastSeen })),
  });
});

const KINDS = new Set(["offer", "answer", "ice", "bye"]);

/** Relay a signaling message (SDP offer/answer, ICE candidate) to another device. */
webrtcRoutes.post("/signal", async (c) => {
  const s = c.get("session");
  if (!hit(`signal:${s.token}`, 10_000, 200)) return c.json({ error: "Signaling rate exceeded." }, 429);
  const body = await c.req.json<{ to?: string; kind?: string; payload?: unknown }>().catch(() => null);
  if (typeof body?.to !== "string" || !KINDS.has(body.kind ?? "")) return c.json({ error: "to and kind are required." }, 400);
  if (!presence.has(body.to) && body.kind !== "bye") return c.json({ error: "Target device is not online." }, 404);
  const delivered = sendSignal({
    from: s.token,
    fromName: `${s.user!.name} · ${s.deviceName}`,
    to: body.to,
    kind: body.kind as "offer",
    payload: body.payload,
  });
  if (!delivered && body.kind !== "bye") return c.json({ error: "Target device is not listening." }, 404);
  return c.json({ ok: true });
});
