import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import path from "node:path";
import fs from "node:fs";
import { migrate, ensureDirs, dirs } from "./db";
import { ensureBootstrap } from "./lib/bootstrap";
import { printBanner } from "./lib/banner";
import { effectivePort, effectiveNetworkMode, effectiveHost, customTlsPaths, readConfig } from "./lib/config";
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
import { startDiscovery, stopDiscovery } from "./lib/discovery";
import { securityHeaders, csrfOriginCheck, ipWhitelist } from "./lib/security";
import { generateSelfSigned } from "./lib/certs";
import { startMaintenance, registerSweep, repairLegacyChunkedFiles } from "./lib/maintenance";
import { backfillAuditV2 } from "./lib/audit";
import { finalizeOnBoot } from "./lib/update";
import type { AppEnv } from "./lib/net";

migrate();
ensureDirs();
backfillAuditV2();
finalizeOnBoot();
const boot = ensureBootstrap();

// --- TLS (MITM protection) -------------------------------------------------
// Priority: TLS_CERT_PATH/TLS_KEY_PATH env > config.json networkMode ("auto" |
// "off" | "custom") > DATA_DIR/tls/{cert,key}.pem (auto-generated on first boot).
function tlsOptions(): { cert?: string; key?: string; auto: boolean } {
  const envCert = process.env.TLS_CERT_PATH;
  const envKey = process.env.TLS_KEY_PATH;
  if (envCert && envKey && fs.existsSync(envCert) && fs.existsSync(envKey)) {
    return { cert: fs.readFileSync(envCert, "utf8"), key: fs.readFileSync(envKey, "utf8"), auto: false };
  }
  const custom = customTlsPaths();
  if (custom.cert && custom.key && fs.existsSync(custom.cert) && fs.existsSync(custom.key)) {
    return { cert: fs.readFileSync(custom.cert, "utf8"), key: fs.readFileSync(custom.key, "utf8"), auto: false };
  }
  const tlsDir = path.join(dirs.data, "tls");
  const certFile = path.join(tlsDir, "cert.pem");
  const keyFile = path.join(tlsDir, "key.pem");
  const mode = effectiveNetworkMode();
  if (mode === "off") return { auto: false };
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    return { cert: fs.readFileSync(certFile, "utf8"), key: fs.readFileSync(keyFile, "utf8"), auto: true };
  }
  if (mode === "auto") {
    fs.mkdirSync(tlsDir, { recursive: true });
    const cn = process.env.TLS_COMMON_NAME ?? readConfig().tlsCommonName ?? "fyrdrop.local";
    const gen = generateSelfSigned({ commonName: cn, organization: "FYRDrop", days: 825, keyBits: 2048, sans: ["localhost", "127.0.0.1", "::1"] });
    fs.writeFileSync(certFile, gen.certPem, "utf8");
    fs.writeFileSync(keyFile, gen.keyPem, { encoding: "utf8", mode: 0o600 });
    return { cert: gen.certPem, key: gen.keyPem, auto: true };
  }
  return { auto: false };
}

const tls = tlsOptions();
const tlsActive = !!(tls.cert && tls.key);

const app = new Hono<AppEnv>();

// --- OWASP hardening ---
app.use("*", securityHeaders({ hsts: tlsActive && readConfig().hsts }));
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
startMaintenance();
startDiscovery(port);
void repairLegacyChunkedFiles();

const scheme = tlsActive ? "https" : "http";
const { detectHosting } = await import("./lib/hosting");
const hosting = detectHosting(port, tlsActive);
printBanner({ port, scheme, urls: hosting.urls, tlsNote: tls.auto ? "self-signed TLS" : undefined });
if (boot.created) console.log(`  First boot: sign in with the PIN, then the admin account shown above.`);
for (const n of hosting.notes) console.log(`  note: ${n}`);

const shutdown = () => {
  stopDiscovery();
  server.stop();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
