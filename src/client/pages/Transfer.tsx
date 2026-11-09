import { useCallback, useEffect, useRef, useState } from "react";
import { api, humanSize } from "../api";
import { useSignal } from "../sync";
import { Icon } from "../icons";
import { Badge, Btn, Card, Empty, PageHeader, Progress, useToast } from "../ui";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const CHUNK_SIZE = 64 * 1024;
const BACKPRESSURE = 4 * 1024 * 1024;

type RtcPeer = { token: string; deviceName: string; lastSeen: number };
type SignalMsg = { from: string; fromName: string; to: string; kind: "offer" | "answer" | "ice" | "bye"; payload: any };
type Transfer = {
  id: string;
  name: string;
  size: number;
  mime: string;
  pct: number;
  direction: "send" | "recv";
  done: boolean;
  failed?: boolean;
  url?: string;
};

/** P2P device transfer: files go browser-to-browser over WebRTC data channels; the server only relays signaling. */
export default function Transfer() {
  const { push } = useToast();
  const [peers, setPeers] = useState<RtcPeer[]>([]);
  const [selected, setSelected] = useState<RtcPeer | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [online, setOnline] = useState(false);

  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const fileInput = useRef<HTMLInputElement | null>(null);
  const selectedRef = useRef<RtcPeer | null>(null);
  selectedRef.current = selected;

  // Received files live as blob: URLs - revoke them when they leave the list or
  // the page unmounts, otherwise the whole file stays in memory.
  const transfersRef = useRef<Transfer[]>([]);
  transfersRef.current = transfers;
  useEffect(
    () => () => {
      for (const t of transfersRef.current) if (t.url) URL.revokeObjectURL(t.url);
    },
    [],
  );

  const upsert = useCallback((id: string, patch: Partial<Transfer>) => {
    setTransfers((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const addTransfer = useCallback((t: Transfer) => {
    setTransfers((ts) => {
      const next = [t, ...ts];
      for (const dropped of next.slice(20)) if (dropped.url) URL.revokeObjectURL(dropped.url);
      return next.slice(0, 20);
    });
  }, []);

  const clearFinished = () => {
    setTransfers((ts) => {
      const finished = ts.filter((t) => t.done || t.failed);
      for (const t of finished) if (t.url) URL.revokeObjectURL(t.url);
      return ts.filter((t) => !t.done && !t.failed);
    });
  };

  /* ---------- WebRTC plumbing ---------- */

  const key = (remote: string, connId: string) => `${remote}:${connId}`;

  const openChannel = useCallback(
    (dc: RTCDataChannel, t: Transfer) => {
      let header: { name: string; size: number; mime: string } | null = null;
      const chunks: ArrayBuffer[] = [];
      let received = 0;
      dc.binaryType = "arraybuffer";
      dc.onmessage = (ev) => {
        try {
          if (typeof ev.data === "string") {
            header = JSON.parse(ev.data);
            received = 0;
            upsert(t.id, { name: header!.name, size: header!.size, mime: header!.mime });
            return;
          }
          if (!header) return;
          chunks.push(ev.data);
          received += ev.data.byteLength;
          upsert(t.id, { pct: Math.min(99, Math.round((received / header.size) * 100)) });
          if (received >= header.size) {
            const blob = new Blob(chunks, { type: header.mime || "application/octet-stream" });
            const url = URL.createObjectURL(blob);
            upsert(t.id, { pct: 100, done: true, url });
            try {
              dc.send("ack");
            } catch {
              /* channel already closing */
            }
            push("ok", `Received "${header.name}" (${humanSize(header.size)})`);
            setTimeout(() => {
              try {
                dc.close();
              } catch {
                /* noop */
              }
            }, 500);
          }
        } catch (err) {
          upsert(t.id, { failed: true });
          push("err", `Reception failed: ${String(err)}`);
        }
      };
      dc.onerror = () => upsert(t.id, { failed: true });
    },
    [push, upsert],
  );

  /* Receiver: answer offers automatically. */
  const handleOffer = useCallback(
    async (msg: SignalMsg) => {
      const { connId, sdp } = msg.payload ?? {};
      if (!connId || !sdp) return;
      try {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcs.current.set(key(msg.from, connId), pc);
        const t: Transfer = { id: `${msg.from}:${connId}`, name: "incoming file", size: 0, mime: "", pct: 0, direction: "recv", done: false };
        addTransfer(t);
        pc.ondatachannel = (ev) => openChannel(ev.channel, t);
        pc.onicecandidate = (ev) => {
          if (ev.candidate) void api.signal(msg.from, "ice", { connId, candidate: ev.candidate.toJSON() }).catch(() => {});
        };
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await api.signal(msg.from, "answer", { connId, sdp: pc.localDescription });
        push("info", `${msg.fromName} wants to send a file`);
      } catch (err) {
        push("err", `Failed to accept transfer: ${String(err)}`);
      }
    },
    [addTransfer, openChannel, push],
  );

  /* Sender: finish the handshake started in sendFiles. */
  const handleAnswer = useCallback(async (msg: SignalMsg) => {
    const { connId, sdp } = msg.payload ?? {};
    const pc = pcs.current.get(key(msg.from, connId));
    if (!pc || !sdp) return;
    try {
      if (pc.signalingState !== "stable") await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch {
      /* stale answer */
    }
  }, []);

  const handleIce = useCallback(async (msg: SignalMsg) => {
    const { connId, candidate } = msg.payload ?? {};
    const pc = pcs.current.get(key(msg.from, connId));
    if (!pc || !candidate) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      /* candidate arrived out of order or after close */
    }
  }, []);

  const handleBye = useCallback(
    (msg: SignalMsg) => {
      const prefix = `${msg.from}:`;
      for (const [k, pc] of pcs.current) {
        if (k.startsWith(prefix)) {
          try {
            pc.close();
          } catch {
            /* noop */
          }
          pcs.current.delete(k);
        }
      }
      push("info", `${msg.fromName || "Peer"} disconnected`);
    },
    [push],
  );

  /* ---------- Presence + signaling loop ---------- */

  useEffect(() => {
    let alive = true;
    const beat = () =>
      api
        .presence()
        .then(() => alive && setOnline(true))
        .catch(() => alive && setOnline(false));
    void beat();
    const presenceTimer = setInterval(beat, 15_000);
    const peerTimer = setInterval(() => {
      api
        .rtcPeers()
        .then((r) => alive && setPeers(r.peers))
        .catch(() => {});
    }, 5_000);
    void api
      .rtcPeers()
      .then((r) => alive && setPeers(r.peers))
      .catch(() => {});

    return () => {
      alive = false;
      clearInterval(presenceTimer);
      clearInterval(peerTimer);
      for (const pc of pcs.current.values()) {
        try {
          pc.close();
        } catch {
          /* noop */
        }
      }
      pcs.current.clear();
    };
  }, []);

  // One shared SSE stream for the whole tab (sync.ts) - no extra connection per page.
  useSignal((msg: SignalMsg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.kind === "offer") void handleOffer(msg);
    else if (msg.kind === "answer") void handleAnswer(msg);
    else if (msg.kind === "ice") void handleIce(msg);
    else if (msg.kind === "bye") handleBye(msg);
  });

  /* ---------- Sender ---------- */

  const sendFiles = useCallback(
    async (files: FileList | null) => {
      const peer = selectedRef.current;
      if (!peer || !files?.length) return;
      for (const file of Array.from(files)) {
        const connId = Math.random().toString(36).slice(2, 10);
        const t: Transfer = { id: `out:${connId}`, name: file.name, size: file.size, mime: file.type || "application/octet-stream", pct: 0, direction: "send", done: false };
        addTransfer(t);
        try {
          const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
          pcs.current.set(key(peer.token, connId), pc);
          const dc = pc.createDataChannel("file", { ordered: true });
          dc.binaryType = "arraybuffer";
          dc.bufferedAmountLowThreshold = 256 * 1024;
          dc.onerror = () => upsert(t.id, { failed: true });
          pc.onicecandidate = (ev) => {
            if (ev.candidate) void api.signal(peer.token, "ice", { connId, candidate: ev.candidate.toJSON() }).catch(() => {});
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await api.signal(peer.token, "offer", { connId, sdp: pc.localDescription });

          await new Promise<void>((resolve, reject) => {
            const to = setTimeout(() => reject(new Error("Peer did not answer")), 20_000);
            dc.onopen = () => {
              clearTimeout(to);
              resolve();
            };
            dc.onerror = () => {
              clearTimeout(to);
              reject(new Error("Data channel failed"));
            };
          });

          dc.send(JSON.stringify({ name: file.name, size: file.size, mime: file.type || "application/octet-stream" }));

          let offset = 0;
          while (offset < file.size) {
            const slice = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
            const buf = await slice.arrayBuffer();
            if (dc.bufferedAmount > BACKPRESSURE) {
              await new Promise<void>((r) => dc.addEventListener("bufferedamountlow", () => r(), { once: true }));
            }
            dc.send(buf);
            offset += buf.byteLength;
            upsert(t.id, { pct: Math.min(99, Math.round((offset / file.size) * 100)) });
          }

          // Wait until the receiver has acked (or a grace period after the buffer drains).
          await new Promise<void>((resolve) => {
            const to = setTimeout(() => resolve(), 30_000);
            dc.onmessage = (ev) => {
              if (ev.data === "ack") {
                clearTimeout(to);
                resolve();
              }
            };
          });
          dc.close();
          upsert(t.id, { pct: 100, done: true });
          push("ok", `Sent "${file.name}" to ${peer.deviceName}`);
        } catch (err) {
          upsert(t.id, { failed: true });
          push("err", `Sending "${file.name}" failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          const pc = pcs.current.get(key(peer.token, connId));
          if (pc && pc.connectionState !== "closed") {
            setTimeout(() => {
              try {
                pc.close();
              } catch {
                /* noop */
              }
              pcs.current.delete(key(peer.token, connId));
            }, 1_000);
          }
        }
      }
      if (fileInput.current) fileInput.current.value = "";
    },
    [addTransfer, push, upsert],
  );

  const disconnect = async () => {
    const peer = selectedRef.current;
    if (peer) await api.signal(peer.token, "bye", {}).catch(() => {});
    setSelected(null);
  };

  const activeCount = transfers.filter((t) => !t.done && !t.failed).length;

  return (
    <div>
      <PageHeader
        title="Device Transfer"
        subtitle="Send files straight between browsers. The server only helps them connect, never sees the files."
        actions={
          <Badge tone={online ? "ok" : "bad"}>
            <Icon name="wifi" size={11} />
            {online ? "online" : "offline"}
          </Badge>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        {/* Peer list */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Online devices</h2>
            <Badge tone="info">{peers.length}</Badge>
          </div>
          <div className="space-y-2">
            {peers.map((p) => (
              <button
                key={p.token}
                onClick={() => setSelected(p)}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border p-3 text-left transition ${
                  selected?.token === p.token ? "border-indigo-500/60 bg-indigo-500/10" : "border-[#2a3247] bg-[#12161f] hover:border-[#3a4460]"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-white">{p.deviceName}</div>
                    <div className="text-[11px] text-slate-500">seen {Math.max(1, Math.round((Date.now() - p.lastSeen) / 1000))}s ago</div>
                  </div>
                </div>
                <span className="text-slate-500">
                  <Icon name="transfer" size={15} />
                </span>
              </button>
            ))}
            {peers.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-500">
                No other devices online. Open FYRDrop on another paired device to transfer files.
              </p>
            )}
          </div>
        </Card>

        {/* Transfer pane */}
        <div className="space-y-5">
          <Card className="p-5">
            {selected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-white">Sending to {selected.deviceName}</div>
                    <div className="text-xs text-slate-500">Files travel directly over an encrypted data channel.</div>
                  </div>
                  <Btn variant="ghost" size="sm" onClick={() => void disconnect()}>
                    Disconnect
                  </Btn>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => void sendFiles(e.target.files)}
                />
                <Btn onClick={() => fileInput.current?.click()} disabled={activeCount > 0}>
                  {activeCount > 0 ? (
                    `Transferring… (${activeCount})`
                  ) : (
                    <>
                      <Icon name="upload" size={15} /> Choose files to send
                    </>
                  )}
                </Btn>
              </div>
            ) : (
              <Empty icon="transfer" title="Select a device" hint="Pick an online device on the left to start a direct transfer." />
            )}
          </Card>

          {transfers.length > 0 && (
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-white">Transfers</h2>
                {transfers.some((t) => t.done || t.failed) && (
                  <Btn size="sm" variant="ghost" onClick={clearFinished}>
                    <Icon name="trash" size={13} /> Clear finished
                  </Btn>
                )}
              </div>
              <div className="space-y-3">
                {transfers.map((t) => (
                  <div key={t.id} className="rounded-xl border border-[#2a3247] bg-[#12161f] p-3.5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm text-slate-200">
                          <Icon
                            name={t.direction === "send" ? "upload" : "download"}
                            size={13}
                            className={t.direction === "send" ? "shrink-0 text-indigo-300" : "shrink-0 text-emerald-300"}
                          />
                          <span className="truncate">{t.name}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {humanSize(t.size)} · {t.direction === "send" ? "sending" : "receiving"}
                        </div>
                      </div>
                      {t.failed ? (
                        <Badge tone="bad">failed</Badge>
                      ) : t.done ? (
                        <Badge tone="ok">done</Badge>
                      ) : (
                        <span className="text-xs text-slate-400">{t.pct}%</span>
                      )}
                    </div>
                    {!t.done && !t.failed && <Progress pct={t.pct} />}
                    {t.done && t.url && (
                      <div className="flex gap-2">
                        <Btn size="sm" variant="soft" href={t.url} download={t.name}>
                          <Icon name="download" size={14} /> Save file
                        </Btn>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
