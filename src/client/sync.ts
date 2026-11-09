import { useEffect, useRef, useState } from "react";

/**
 * One EventSource per tab, shared by every component.
 *
 * Previously each page (plus the sidebar indicator and the transfer page)
 * opened its own stream; over HTTP/1.1 browsers cap a host at 6 connections,
 * so a few tabs were enough to stall every fetch. Listeners are refcounted:
 * the stream opens with the first subscriber, closes with the last, and
 * reconnects with backoff. It also pauses while the tab is hidden so idle
 * phones don't keep a socket (and the Pi) busy.
 */

export type SyncStatus = "connecting" | "online" | "offline";
export type SyncEvent = { scope: "items" | "certs" | "sessions" | "settings" | "audit"; action: string; id?: string };

type SyncFn = (e: SyncEvent) => void;
type SignalFn = (msg: any) => void;

const syncSubs = new Set<SyncFn>();
const signalSubs = new Set<SignalFn>();
const statusSubs = new Set<(s: SyncStatus) => void>();
let es: EventSource | null = null;
let status: SyncStatus = "connecting";
let retry: ReturnType<typeof setTimeout> | null = null;
let backoff = 2000;
let hiddenTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(s: SyncStatus) {
  if (s === status) return;
  status = s;
  for (const fn of statusSubs) fn(s);
}

function refs() {
  return syncSubs.size + signalSubs.size + statusSubs.size;
}

function open() {
  if (es || refs() === 0 || document.visibilityState === "hidden") return;
  setStatus("connecting");
  es = new EventSource("/api/events");
  es.addEventListener("hello", () => {
    backoff = 2000;
    setStatus("online");
  });
  es.addEventListener("sync", (ev) => {
    let data: SyncEvent;
    try {
      data = JSON.parse((ev as MessageEvent).data);
    } catch {
      return;
    }
    for (const fn of syncSubs) fn(data);
  });
  es.addEventListener("signal", (ev) => {
    let data: any;
    try {
      data = JSON.parse((ev as MessageEvent).data);
    } catch {
      return;
    }
    for (const fn of signalSubs) fn(data);
  });
  es.onerror = () => {
    close();
    setStatus("offline");
    if (refs() > 0) {
      retry = setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    }
  };
}

function close() {
  es?.close();
  es = null;
  if (retry) clearTimeout(retry);
  retry = null;
}

function release() {
  if (refs() === 0) close();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // Grace period so quick tab switches don't churn the connection.
      hiddenTimer = setTimeout(close, 60_000);
    } else {
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = null;
      if (!es) {
        open();
        // Something may have changed while we were away.
        for (const fn of syncSubs) fn({ scope: "items", action: "resync" });
      }
    }
  });
}

/** Force-close (used on sign-out so a revoked session doesn't keep retrying). */
export function resetSync() {
  close();
  setStatus("connecting");
}

/**
 * Subscribe to realtime changes. Bursts are coalesced (default 350 ms) so ten
 * uploads in a row cause one reload, not ten.
 */
export function useSync(onChange: () => void, opts: { scopes?: SyncEvent["scope"][]; debounceMs?: number } = {}) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const scopes = opts.scopes?.join(",") ?? "";
  const wait = opts.debounceMs ?? 350;
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const allowed = scopes ? new Set(scopes.split(",")) : null;
    const fn: SyncFn = (e) => {
      if (allowed && !allowed.has(e.scope) && e.action !== "resync") return;
      if (t) clearTimeout(t);
      t = setTimeout(() => cb.current(), wait);
    };
    syncSubs.add(fn);
    open();
    return () => {
      syncSubs.delete(fn);
      if (t) clearTimeout(t);
      release();
    };
  }, [scopes, wait]);
}

export function useSignal(onSignal: (msg: any) => void) {
  const cb = useRef(onSignal);
  cb.current = onSignal;
  useEffect(() => {
    const fn: SignalFn = (m) => cb.current(m);
    signalSubs.add(fn);
    open();
    return () => {
      signalSubs.delete(fn);
      release();
    };
  }, []);
}

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>(status);
  useEffect(() => {
    statusSubs.add(setS);
    open();
    setS(status);
    return () => {
      statusSubs.delete(setS);
      release();
    };
  }, []);
  return s;
}
