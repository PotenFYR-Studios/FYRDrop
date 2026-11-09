/**
 * Tiny in-process pub/sub used to notify SSE clients that data changed and to
 * relay WebRTC signaling. Subscribers live in Sets (O(1) add/remove, no
 * EventEmitter max-listener warnings) and a throwing subscriber can never
 * break delivery to the others.
 */

export type SyncEvent = { scope: "items" | "certs" | "sessions" | "settings" | "audit"; action: string; id?: string };
export type SignalEvent = { from: string; fromName: string; to: string; kind: "offer" | "answer" | "ice" | "bye"; payload: unknown };

const syncSubs = new Set<(e: SyncEvent) => void>();
const signalSubs = new Map<string, Set<(e: SignalEvent) => void>>();

export function publish(evt: SyncEvent) {
  for (const fn of syncSubs) {
    try {
      fn(evt);
    } catch {
      /* isolated */
    }
  }
}

export function onSync(fn: (e: SyncEvent) => void) {
  syncSubs.add(fn);
  return () => syncSubs.delete(fn);
}

/** Deliver a signaling message to every open stream of one device session. */
export function sendSignal(evt: SignalEvent): boolean {
  const subs = signalSubs.get(evt.to);
  if (!subs || subs.size === 0) return false;
  for (const fn of subs) {
    try {
      fn(evt);
    } catch {
      /* isolated */
    }
  }
  return true;
}

export function onSignal(sessionId: string, fn: (e: SignalEvent) => void) {
  let set = signalSubs.get(sessionId);
  if (!set) signalSubs.set(sessionId, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) signalSubs.delete(sessionId);
  };
}

export function streamCount() {
  return syncSubs.size;
}
