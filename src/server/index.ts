import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import path from "node:path";
import fs from "node:fs";
import { migrate, ensureDirs, dirs } from "./db";
import { ensureBootstrap } from "./lib/bootstrap";
import { printBanner } from "./lib/banner";
import { effectivePort, effectiveHost, bootConfig, effectiveHsts, effectiveHttpRedirectPort } from "./lib/config";
import { tlsState } from "./lib/tls";
import { authRoutes } from "./routes/auth";
import { itemRoutes, sweepUploads } from "./routes/items";
import { certRoutes } from "./routes/certs";
import { sessionRoutes } from "./routes/sessions";
import { adminRoutes } from "./routes/admin";
import { shareRoutes, eventRoutes } from "./routes/public";
import { webrtcRoutes, sweepPresence } from "./routes/webrtc";
import { userRoutes } from "./routes/users";
import { groupRoutes } from "./routes/groups";
import { remoteRoutes } from "./routes/remote";
import { clusterRoutes, clusterNodeRoutes } from "./routes/cluster";
import { publicClusterRoutes } from "./routes/overview";
import { backupRoutes } from "./routes/backup";
import { accountRoutes, sweepAccount } from "./routes/account";
import { mailRoutes } from "./routes/mail";
import { notificationRoutes } from "./routes/notifications";
import { keyRoutes, webhookRoutes } from "./routes/developer";
import { sweepNotifications } from "./lib/notify";
import { sweepQuotaAlerts } from "./lib/alerts";
import { sweepShareEvents } from "./lib/share-stats";
import { sweepReplication } from "./lib/replication";
import { sweepBackups } from "./lib/backup";
import { startDiscovery, stopDiscovery } from "./lib/discovery";
import { securityHeaders, csrfOriginCheck, ipWhitelist } from "./lib/security";
import { startMaintenance, registerSweep, repairLegacyChunkedFiles } from "./lib/maintenance";
import { backfillAuditV2 } from "./lib/audit";
import { finalizeOnBoot, currentVersion } from "./lib/update";
import type { AppEnv } from "./lib/net";

// Freeze the configuration this process runs with before anything can change the file.
bootConfig();
migrate();
ensureDirs();
backfillAuditV2();
finalizeOnBoot();
const boot = ensureBootstrap();

// --- HTTP / HTTPS ----------------------------------------------------------
// Plain HTTP is the default. HTTPS (self-signed or your own certificate) is set
// up under Admin -> Settings -> HTTPS, or with TLS_ENABLED / TLS_CERT_PATH /
// TLS_KEY_PATH. See lib/tls.ts for the order of precedence.
const tls = tlsState();
const tlsActive = tls.active;

const app = new Hono<AppEnv>();

// --- OWASP hardening ---
app.use("*", securityHeaders({ hsts: tlsActive && effectiveHsts() }));
app.use("/api/*", csrfOriginCheck());
app.use("/api/*", ipWhitelist());

app.get("/health", (c) => c.json({ ok: true }));

app.route("/api/auth", authRoutes);
app.route("/api/items", itemRoutes);
app.route("/api/certs", certRoutes);
app.route("/api/sessions", sessionRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/share", shareRoutes);
app.route("/api/events", eventRoutes);
app.route("/api/users", userRoutes);
app.route("/api/groups", groupRoutes);
app.route("/api/remote", remoteRoutes);
app.route("/api/webrtc", webrtcRoutes);
app.route("/api/cluster-node", clusterNodeRoutes);
app.route("/api/overview", publicClusterRoutes);
app.route("/api/cluster", clusterRoutes);
app.route("/api/backups", backupRoutes);
app.route("/api/account", accountRoutes);
app.route("/api/mail", mailRoutes);
app.route("/api/notifications", notificationRoutes);
app.route("/api/keys", keyRoutes);
app.route("/api/webhooks", webhookRoutes);

app.onError((err, c) => {
  // Never leak stack traces / internals to clients (OWASP A05).
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: "Internal server error." }, 500);
});

// --- Static SPA (built by vite into dist/public) ---
const candidates = [
  path.resolve(import.meta.dir, "../../dist/public"),
  path.resolve(process.cwd(), "dist/public"),
  path.resolve(process.cwd(), "public"),
];
const staticRoot = candidates.find((p) => fs.existsSync(path.join(p, "index.html"))) ?? candidates[0]!;
const relRoot = path.relative(process.cwd(), staticRoot) || ".";

// The shell is read once (it only changes on redeploy) instead of on every navigation.
let shell: string | null = null;
function spaShell() {
  if (shell === null || process.env.NODE_ENV !== "production") shell = fs.readFileSync(path.join(staticRoot, "index.html"), "utf8");
  return shell;
}

// Hashed assets are immutable → cache aggressively (saves bandwidth on slow Pi uplinks).
app.use("/assets/*", async (c, next) => {
  await next();
  if (c.res.status === 200) c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
});
app.use("/assets/*", serveStatic({ root: relRoot }));
app.get("/favicon.svg", serveStatic({ root: relRoot }));
app.get("/recover.js", serveStatic({ root: relRoot }));
app.get("/manifest.webmanifest", serveStatic({ root: relRoot, mimes: { webmanifest: "application/manifest+json" } }));
app.get("/favicon.ico", serveStatic({ root: relRoot, rewriteRequestPath: () => "/favicon.svg" }));
app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));
app.get("*", (c) => {
  try {
    c.header("Cache-Control", "no-cache");
    return c.html(spaShell());
  } catch {
    return c.text("FYRDrop: frontend not built yet. Run `bun run build`.", 503);
  }
});

const port = effectivePort();

const server = Bun.serve({
  port,
  hostname: effectiveHost(),
  // Pass the real socket address to Hono as env (no per-request Request clone).
  fetch(req, srv) {
    return app.fetch(req, { ip: srv.requestIP(req)?.address ?? "" });
  },
  ...(tlsActive ? { tls: { cert: tls.cert!, key: tls.key! } } : {}),
  // Chunks are ≤32 MB, multipart ≤48 MB, cluster JSON ≤~90 MB.
  maxRequestBodySize: 96 * 1024 * 1024,
  idleTimeout: 120,
  development: false,
});

registerSweep(sweepUploads);
registerSweep(sweepPresence);
registerSweep(() => sweepBackups(currentVersion()));
registerSweep(sweepAccount);
registerSweep(sweepNotifications);
registerSweep(sweepQuotaAlerts);
registerSweep(sweepShareEvents);
registerSweep(sweepReplication);
startMaintenance();
startDiscovery(port);
void repairLegacyChunkedFiles();

const scheme = tlsActive ? "https" : "http";
const { detectHosting } = await import("./lib/hosting");
const hosting = detectHosting(port, tlsActive);
printBanner({ port, scheme, urls: hosting.urls, tlsNote: tls.source === "self-signed" ? "self-signed certificate" : tls.source === "custom" ? "your certificate" : undefined });
if (boot.created) console.log(`  First boot: open the address above and sign in with the admin account shown in the box.`);
if (tls.problem) console.log(`  warning: ${tls.problem}`);
if (!tlsActive && !hosting.behindProxy) console.log(`  note: serving plain HTTP. Fine on a trusted network; for HTTPS open Admin > Settings > HTTPS (or Help > HTTP and HTTPS).`);
for (const n of hosting.notes) console.log(`  note: ${n}`);

// Optional plain-HTTP listener that only sends browsers to the HTTPS address.
const redirectPort = effectiveHttpRedirectPort();
let redirectServer: ReturnType<typeof Bun.serve> | null = null;
if (tlsActive && redirectPort && redirectPort !== port) {
  try {
    redirectServer = Bun.serve({
      port: redirectPort,
      hostname: effectiveHost(),
      fetch(req) {
        const u = new URL(req.url);
        // Only the host name is taken from the request; scheme and port are ours.
        const host = /^[a-z0-9.-]+$/i.test(u.hostname) || /^\[[0-9a-f:]+\]$/i.test(u.hostname) ? u.hostname : "localhost";
        return new Response(null, { status: 308, headers: { location: `https://${host}${port === 443 ? "" : `:${port}`}${u.pathname}${u.search}` } });
      },
    });
    console.log(`  note: http://<host>:${redirectPort} redirects to HTTPS on port ${port}.`);
  } catch (err) {
    console.log(`  warning: could not open the HTTP redirect port ${redirectPort}: ${String(err).slice(0, 120)}`);
  }
}

const shutdown = () => {
  stopDiscovery();
  redirectServer?.stop();
  server.stop();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
