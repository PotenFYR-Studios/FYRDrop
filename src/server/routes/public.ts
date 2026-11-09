import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { bodyLimit } from "hono/body-limit";
import { eq, and, isNull, or, gt, lt, sql } from "drizzle-orm";
import fs from "node:fs";
import { db } from "../db";
import { items, shareLinks } from "../db/schema";
import { sessionFromContext, signValue, verifySignedValue, verifyToken } from "../lib/auth";
import { onSync, onSignal, type SyncEvent } from "../lib/events";
import { decryptedWebStream, decryptString } from "../lib/crypto";
import { pathForRef } from "../lib/storage";
import { userContentHeaders, isHttpUrl } from "../lib/content";
import { verifySecret } from "../lib/secrets";
import { rateLimit, recordFailure, clearFailures, lockoutRemaining } from "../lib/security";
import { clientIp, type AppEnv } from "../lib/net";
import { auditRequest } from "../lib/audit";

/** Public, token-gated share endpoints - mounted at /api/share. No PIN session required. */
export const shareRoutes = new Hono<AppEnv>();

shareRoutes.use("*", bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: "Payload too large." }, 413) }));
// Token guessing / PIN brute force protection for the anonymous surface.
shareRoutes.use("*", rateLimit({ name: "share", windowMs: 60_000, max: 120 }));

const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;
const GRANT_TTL = 15 * 60_000;

function liveLink(token: string) {
  if (!TOKEN_RE.test(token)) return undefined;
  const now = Date.now();
  return db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.token, token), or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, now))))
    .limit(1)
    .get();
}

function liveItem(itemId: string) {
  const row = db.select().from(items).where(eq(items.id, itemId)).limit(1).get();
  if (!row || (row.expiresAt && row.expiresAt <= Date.now())) return null;
  return row;
}

/** Links shared with selected users require a matching signed-in account. */
function audienceGate(link: typeof shareLinks.$inferSelect, c: Context): { blocked: boolean; needsAuth: boolean } {
  if (!link.allowedUsers) return { blocked: false, needsAuth: false };
  const session = sessionFromContext(c);
  if (!session?.user) return { blocked: true, needsAuth: true };
  if (session.user.role === "owner") return { blocked: false, needsAuth: false };
  return { blocked: !link.allowedUsers.split(",").includes(session.user.id), needsAuth: false };
}

const exhausted = (l: typeof shareLinks.$inferSelect) => l.maxDownloads !== null && l.downloads >= l.maxDownloads;

/** Metadata for the public download page. */
shareRoutes.get("/:token", (c) => {
  const link = liveLink(c.req.param("token"));
  if (!link) return c.json({ error: "This share link is invalid or expired." }, 404);
  if (exhausted(link)) return c.json({ error: "This share link has reached its download limit." }, 410);
  const gate = audienceGate(link, c);
  if (gate.blocked) {
    return c.json(
      gate.needsAuth
        ? { error: "This link is restricted. Sign in with your FYRDrop account to open it.", needsAuth: true }
        : { error: "Your account is not on this link's access list." },
      gate.needsAuth ? 401 : 403,
    );
  }
  const item = liveItem(link.itemId);
  if (!item) return c.json({ error: "The shared item is no longer available." }, 404);
  // The text preview is only revealed after the PIN (if any) is verified.
  const plain = !link.pinHash && item.content ? decryptString(item.content) : null;
  const preview = item.type === "text" ? plain?.slice(0, 4000) : item.type === "url" && plain && isHttpUrl(plain) ? plain : undefined;
  return c.json({
    item: { name: item.name, type: item.type, mime: item.mime, size: item.size, createdAt: item.createdAt, uploadedBy: item.uploadedBy, preview },
    expiresAt: link.expiresAt,
    downloadsLeft: link.maxDownloads !== null ? link.maxDownloads - link.downloads : null,
    needsPin: !!link.pinHash,
    note: link.note,
    from: link.createdBy,
    grant: link.pinHash ? undefined : signValue("share", link.token, GRANT_TTL),
  });
});

/** Verify a link PIN; returns a short-lived signed grant (keeps the PIN out of URLs and logs). */
shareRoutes.post("/:token/unlock", async (c) => {
  const link = liveLink(c.req.param("token"));
  if (!link) return c.json({ error: "This share link is invalid or expired." }, 404);
  const lockKey = `share:${link.token}`;
  const wait = lockoutRemaining(lockKey) || lockoutRemaining(`share-ip:${clientIp(c)}`);
  if (wait > 0) return c.json({ error: `Too many wrong PINs. Try again in ${Math.ceil(wait / 1000)}s.` }, 429);
  const body = await c.req.json<{ pin?: string }>().catch(() => null);
  if (link.pinHash) {
    const ok = typeof body?.pin === "string" && (await verifySecret(body.pin.trim(), link.pinHash));
    if (!ok) {
      recordFailure(lockKey);
      recordFailure(`share-ip:${clientIp(c)}`);
      const shared = liveItem(link.itemId);
      auditRequest(c, "share.pin-failed", false, `Wrong PIN on a share link${shared ? ` for "${shared.name}"` : ""}`, {
        actor: { name: "share link" },
        target: shared?.name ?? "share link",
        meta: { linkCreatedBy: link.createdBy },
      });
      return c.json({ error: "Wrong PIN for this link." }, 401);
    }
    clearFailures(lockKey);
  }
  const item = liveItem(link.itemId);
  const plain = item?.content ? decryptString(item.content) : null;
  return c.json({
    ok: true,
    grant: signValue("share", link.token, GRANT_TTL),
    preview: item?.type === "text" ? plain?.slice(0, 4000) : item?.type === "url" && plain && isHttpUrl(plain) ? plain : undefined,
  });
});

/** The actual bytes. Counter increments are atomic so maxDownloads can't be overshot. */
shareRoutes.get("/:token/download", async (c) => {
  const link = liveLink(c.req.param("token"));
  if (!link) return c.json({ error: "This share link is invalid or expired." }, 404);
  const gate = audienceGate(link, c);
  if (gate.blocked) {
    const shared = liveItem(link.itemId);
    auditRequest(c, "share.blocked", false, `Blocked a download from a restricted share link${shared ? ` for "${shared.name}"` : ""}`, {
      target: shared?.name ?? "share link",
      severity: "warn",
      meta: { needsAuth: gate.needsAuth },
    });
    return c.json({ error: gate.needsAuth ? "Sign in with an allowed account." : "Not authorised for this link." }, gate.needsAuth ? 401 : 403);
  }
  if (link.pinHash && !verifySignedValue("share", link.token, c.req.query("grant"))) {
    return c.json({ error: "PIN required for this link.", needsPin: true }, 401);
  }
  const item = liveItem(link.itemId);
  if (!item) return c.json({ error: "The shared item is no longer available." }, 404);
  const fp = item.storedName ? pathForRef(item.storedName) : null;
  if (fp && !fs.existsSync(fp)) return c.json({ error: "Stored file is missing." }, 410);

  // Claim one download slot atomically (UPDATE … WHERE downloads < max).
  const claimed = db
    .update(shareLinks)
    .set({ downloads: sql`${shareLinks.downloads} + 1` })
    .where(and(eq(shareLinks.token, link.token), or(isNull(shareLinks.maxDownloads), lt(shareLinks.downloads, shareLinks.maxDownloads))))
    .returning({ token: shareLinks.token })
    .all();
  if (claimed.length === 0) return c.json({ error: "Download limit reached." }, 410);
  db.update(items).set({ downloads: sql`${items.downloads} + 1` }).where(eq(items.id, item.id)).run();
  auditRequest(c, "share.download", true, `Someone downloaded "${item.name}" from a share link`, {
    actor: { name: "public link" },
    target: item.name,
    meta: { linkCreatedBy: link.createdBy, pin: !!link.pinHash },
  });

  if (item.type === "text" || item.type === "url") {
    return c.body(decryptString(item.content ?? ""), 200, userContentHeaders({ mime: "text/plain", name: `${item.name}.txt`, inline: false }));
  }
  return c.body(decryptedWebStream(fp!), 200, userContentHeaders({ mime: item.mime, name: item.name, inline: false, size: item.size }));
});

/* ------------------------------ Server-sent events ------------------------------ */

export const eventRoutes = new Hono<AppEnv>();

const streamsPerSession = new Map<string, number>();
const MAX_STREAMS_PER_SESSION = 4;

eventRoutes.get("/", (c) => {
  const session = sessionFromContext(c);
  if (!session) return c.json({ error: "Unauthorized." }, 401);
  const open = streamsPerSession.get(session.token) ?? 0;
  if (open >= MAX_STREAMS_PER_SESSION) return c.json({ error: "Too many open event streams for this device." }, 429);
  streamsPerSession.set(session.token, open + 1);
  const cookie = c.req.header("cookie") ?? "";
  const rawToken = /(?:^|;\s*)fyrdrop_session=([^;]+)/.exec(cookie)?.[1] ?? "";

  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    let closed = false;
    let release: () => void = () => {};
    const done = new Promise<void>((r) => (release = r));
    const send = (event: string, data: string) => {
      if (closed) return;
      stream.writeSSE({ event, data }).catch(() => cleanup());
    };
    const offSync = onSync((evt: SyncEvent) => send("sync", JSON.stringify(evt)));
    const offSignal = onSignal(session.token, (msg) => send("signal", JSON.stringify(msg)));
    // Heartbeat keeps proxies from idling the stream out and lets us notice
    // revoked sessions (blocked user, signed out elsewhere) within ~25 s.
    const ping = setInterval(() => {
      if (!verifyToken(decodeURIComponent(rawToken))) return cleanup();
      send("ping", String(Date.now()));
    }, 25_000);
    function cleanup() {
      if (closed) return;
      closed = true;
      offSync();
      offSignal();
      clearInterval(ping);
      const n = (streamsPerSession.get(session!.token) ?? 1) - 1;
      if (n <= 0) streamsPerSession.delete(session!.token);
      else streamsPerSession.set(session!.token, n);
      release();
    }
    stream.onAbort(cleanup);
    send("hello", JSON.stringify({ device: session.deviceName, user: session.user?.id ?? null }));
    await done;
  });
});
