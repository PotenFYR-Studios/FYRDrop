import fs from "node:fs";
import path from "node:path";

/**
 * System configuration that is read at boot (restart required to apply).
 *
 * Stored in DATA_DIR/config.json so it survives container rebuilds. Every
 * environment variable the server understands has a field here and can be
 * set from Admin → Settings; an environment variable that is set always wins
 * over the file (the UI shows which one and locks the field).
 *
 * The values the process started with are kept as a frozen snapshot
 * (`bootConfig`). Everything that is read at boot reads the snapshot, so a
 * saved change never half-applies, and the UI can tell exactly which saved
 * values are still waiting for a restart.
 */

export interface SystemConfig {
  port: number;
  /** Bind address: 0.0.0.0 for every interface, or one specific address. */
  host: string;
  networkMode: "auto" | "off" | "custom";
  tlsCommonName: string;
  /** Custom certificate paths, used when networkMode is "custom". */
  tlsCertPath: string;
  tlsKeyPath: string;
  /** Send HSTS when serving HTTPS. */
  hsts: boolean;
  /** Plain-HTTP port that only redirects to HTTPS (0 = off). Used when HTTPS is on. */
  httpRedirectPort: number;
  sessionTtlDays: number;
  trustProxy: boolean;
  showPinInLogs: boolean;
  /** Address other cluster nodes use to reach this one (beacons, pairing). Empty = detected LAN address. */
  clusterUrl: string;
  /** Tailscale name in front of this instance (machine.tailnet.ts.net); implies a trusted proxy. */
  tailscaleHostname: string;
  /** Cloudflare Tunnel token; when set, TLS terminates at Cloudflare and proxy headers are trusted. */
  cloudflareTunnelToken: string;
  /** Public hostname of the Cloudflare tunnel, shown at boot. */
  cloudflareHostname: string;
  /** Threads used for image thumbnails (1-4). */
  thumbThreads: number;
  /** GitHub owner/repo the updater checks for releases. */
  updateRepo: string;
  /** A process manager (systemd, Docker restart policy, pm2...) restarts the server; the restart helper then does not start one itself. */
  managedByProcessManager: boolean;
  /** Development: write outgoing email as JSON files into this directory instead of sending it. */
  mailOutboxDir: string;
  /** Upload limit given to a brand-new instance (later edited under Instance → Upload limit). */
  defaultMaxUploadMb: number;
}

export const DEFAULTS: SystemConfig = {
  port: 3000,
  host: "0.0.0.0",
  networkMode: "off",
  tlsCommonName: "fyrdrop.local",
  tlsCertPath: "",
  tlsKeyPath: "",
  hsts: true,
  httpRedirectPort: 0,
  sessionTtlDays: 30,
  trustProxy: false,
  showPinInLogs: true,
  clusterUrl: "",
  tailscaleHostname: "",
  cloudflareTunnelToken: "",
  cloudflareHostname: "",
  thumbThreads: 1,
  updateRepo: "PotenFYR-Studios/FYRDrop",
  managedByProcessManager: false,
  mailOutboxDir: "",
  defaultMaxUploadMb: 512,
};

type Key = keyof SystemConfig;

export interface FieldInfo {
  key: Key;
  /** Environment variables that override this field, first match wins. */
  env: string[];
  label: string;
  group: "Network & TLS" | "Sessions & security" | "Public address & tunnels" | "Performance & updates" | "Developer";
  /** Needs a restart to take effect (everything here does, except showPinInLogs). */
  restart: boolean;
  /** Never sent back to the browser. */
  secret?: boolean;
  help: string;
}

export const FIELDS: FieldInfo[] = [
  { key: "host", env: ["HOST"], label: "Interface", group: "Network & TLS", restart: true, help: "Bind address. 0.0.0.0 listens on every interface." },
  { key: "port", env: ["PORT", "SERVER_PORT"], label: "Port", group: "Network & TLS", restart: true, help: "TCP port the server listens on." },
  { key: "networkMode", env: ["TLS_ENABLED"], label: "HTTPS mode", group: "Network & TLS", restart: true, help: "off = plain HTTP (the default), auto = HTTPS with a self-signed certificate, custom = HTTPS with your certificate. The HTTPS card above sets this up step by step. TLS_ENABLED=0/auto/custom." },
  { key: "tlsCommonName", env: ["TLS_COMMON_NAME"], label: "TLS common name", group: "Network & TLS", restart: true, help: "Name in the generated self-signed certificate." },
  { key: "tlsCertPath", env: ["TLS_CERT_PATH"], label: "Certificate path", group: "Network & TLS", restart: true, help: "PEM certificate for custom TLS." },
  { key: "tlsKeyPath", env: ["TLS_KEY_PATH"], label: "Private key path", group: "Network & TLS", restart: true, help: "PEM private key for custom TLS." },
  { key: "hsts", env: [], label: "Send HSTS", group: "Network & TLS", restart: true, help: "Tell browsers to only use HTTPS for this host. Only sent while HTTPS is on." },
  { key: "httpRedirectPort", env: ["HTTP_REDIRECT_PORT"], label: "HTTP redirect port", group: "Network & TLS", restart: true, help: "While HTTPS is on, also listen on this plain-HTTP port and redirect to HTTPS. 0 = off." },
  { key: "sessionTtlDays", env: ["SESSION_TTL_DAYS"], label: "Session length (days)", group: "Sessions & security", restart: true, help: "How long a signed-in device stays signed in." },
  { key: "trustProxy", env: ["TRUST_PROXY"], label: "Trust reverse proxy headers", group: "Sessions & security", restart: true, help: "Read the client IP from X-Forwarded-For. Only enable when a proxy sits in front." },
  { key: "showPinInLogs", env: [], label: "Show sign-in secrets in the startup banner", group: "Sessions & security", restart: false, help: "Print the one-time admin password (and the instance PIN, when one is set) at boot." },
  { key: "clusterUrl", env: ["CLUSTER_URL"], label: "Cluster address", group: "Public address & tunnels", restart: true, help: "How other nodes reach this one, e.g. https://drop.lan:3000. Needed in Docker with a published port." },
  { key: "tailscaleHostname", env: ["TAILSCALE_HOSTNAME"], label: "Tailscale host name", group: "Public address & tunnels", restart: true, help: "machine.tailnet.ts.net when served through tailscale serve. Proxy headers are then trusted." },
  { key: "cloudflareHostname", env: ["CLOUDFLARE_HOSTNAME"], label: "Cloudflare tunnel host name", group: "Public address & tunnels", restart: true, help: "Public host name of your Cloudflare tunnel." },
  { key: "cloudflareTunnelToken", env: ["CLOUDFLARE_TUNNEL_TOKEN"], label: "Cloudflare tunnel token", group: "Public address & tunnels", restart: true, secret: true, help: "Marks the instance as behind Cloudflare: TLS ends at the edge and proxy headers are trusted. Write-only." },
  { key: "thumbThreads", env: ["THUMB_THREADS"], label: "Thumbnail threads", group: "Performance & updates", restart: true, help: "1 is gentle on a Raspberry Pi; up to 4 on bigger machines." },
  { key: "updateRepo", env: ["UPDATE_REPO"], label: "Update source (owner/repo)", group: "Performance & updates", restart: true, help: "GitHub repository checked for new releases." },
  { key: "managedByProcessManager", env: ["FYRDROP_MANAGED"], label: "Restarted by a process manager", group: "Performance & updates", restart: true, help: "systemd, a Docker restart policy or pm2 brings the server back; the restart helper then does not start a second copy." },
  { key: "defaultMaxUploadMb", env: ["MAX_UPLOAD_MB"], label: "Upload limit for a new instance (MB)", group: "Performance & updates", restart: true, help: "Only seeds the first boot. Change the live limit under Instance above." },
  { key: "mailOutboxDir", env: ["FYRDROP_MAIL_OUTBOX"], label: "Mail outbox directory", group: "Developer", restart: true, help: "Write outgoing email as JSON files here instead of sending it. Leave empty in production." },
];

/** Environment-only settings that cannot live in config.json. */
export const ENV_ONLY = [
  { env: "DATA_DIR", label: "Data directory", help: "Where the database, keys, files and config.json live. Set it before start; config.json itself is inside it." },
  { env: "NODE_ENV", label: "Node environment", help: "production caches the app shell in memory." },
];

let cached: SystemConfig | null = null;
let boot: SystemConfig | null = null;

function configPath() {
  return path.resolve(process.env.DATA_DIR ?? "./data", "config.json");
}

/** What is saved in config.json now (may differ from what is running). */
export function readConfig(): SystemConfig {
  if (cached) return cached;
  let loaded: SystemConfig = { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    loaded = { ...DEFAULTS, ...raw };
  } catch {
    /* defaults */
  }
  cached = loaded;
  return loaded;
}

/** The file as it was when this process started. Boot-time settings read this. */
export function bootConfig(): SystemConfig {
  if (!boot) boot = Object.freeze({ ...readConfig() }) as SystemConfig;
  return boot;
}

export function writeConfig(patch: Partial<SystemConfig>): SystemConfig {
  bootConfig(); // freeze the running values before the file changes
  const next = { ...readConfig(), ...patch };
  const f = configPath();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(next, null, 2), { mode: 0o600 });
  cached = next;
  return next;
}

/** The environment variable that overrides `key`, if one is set. */
export function envOverride(key: Key): { name: string; value: string } | null {
  const f = FIELDS.find((x) => x.key === key);
  for (const name of f?.env ?? []) {
    const v = process.env[name];
    if (v !== undefined && v.trim() !== "") return { name, value: v.trim() };
  }
  return null;
}

const truthy = (v: string) => ["1", "true", "yes", "on"].includes(v.toLowerCase());

/** Effective value (env > running file > default) of a boot-time setting. */
function eff<K extends Key>(key: K): SystemConfig[K] {
  const o = envOverride(key);
  const fileVal = bootConfig()[key];
  if (!o) return fileVal;
  const d = DEFAULTS[key];
  if (typeof d === "number") {
    const n = Number(o.value);
    return (Number.isFinite(n) && n > 0 ? n : fileVal) as SystemConfig[K];
  }
  if (typeof d === "boolean") return truthy(o.value) as SystemConfig[K];
  return o.value as SystemConfig[K];
}

export function effectivePort(): number {
  return eff("port") || 3000;
}

export function effectiveTtlDays(): number {
  return eff("sessionTtlDays") || 30;
}

export function effectiveNetworkMode(): "auto" | "off" | "custom" {
  const env = process.env.TLS_ENABLED?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "off" || env === "http") return "off";
  if (env === "custom") return "custom";
  // A certificate handed over by environment variables means "use it".
  if (process.env.TLS_CERT_PATH && process.env.TLS_KEY_PATH) return "custom";
  if (env === "1" || env === "true" || env === "auto" || env === "on" || env === "https") return "auto";
  const saved = bootConfig().networkMode;
  return saved === "auto" || saved === "custom" ? saved : "off";
}

/** Bind address, with HOST env winning over the saved config. */
export function effectiveHost(): string {
  return eff("host") || "0.0.0.0";
}

/** Custom certificate paths (env TLS_CERT_PATH/TLS_KEY_PATH win). */
export function customTlsPaths(): { cert?: string; key?: string } {
  return { cert: eff("tlsCertPath") || undefined, key: eff("tlsKeyPath") || undefined };
}

export const effectiveTlsCommonName = () => eff("tlsCommonName") || "fyrdrop.local";
export const effectiveHsts = () => bootConfig().hsts;
/** Plain-HTTP redirect port (0 = off). */
export function effectiveHttpRedirectPort(): number {
  const o = envOverride("httpRedirectPort");
  const n = Math.round(Number(o ? o.value : bootConfig().httpRedirectPort));
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : 0;
}
export const effectiveClusterUrl = () => eff("clusterUrl").replace(/\/+$/, "");
export const effectiveTailscaleHostname = () => eff("tailscaleHostname");
export const effectiveCloudflareToken = () => eff("cloudflareTunnelToken");
export const effectiveCloudflareHostname = () => eff("cloudflareHostname");
export const effectiveThumbThreads = () => Math.max(1, Math.min(4, Math.round(eff("thumbThreads") || 1)));
export const effectiveUpdateRepo = () => eff("updateRepo") || DEFAULTS.updateRepo;
export const effectiveManaged = () => eff("managedByProcessManager");
export const effectiveMailOutbox = () => eff("mailOutboxDir");
export const effectiveDefaultMaxUploadMb = () => eff("defaultMaxUploadMb") || 512;
/** TRUST_PROXY, the saved flag, or a tunnel in front. */
export const effectiveTrustProxy = () => eff("trustProxy") || !!effectiveTailscaleHostname() || !!effectiveCloudflareToken();

/** Per-field view for the admin UI: saved value, running value, env override, pending restart. */
export function describeConfig() {
  const saved = readConfig();
  const running = bootConfig();
  const fields = FIELDS.map((f) => {
    const o = envOverride(f.key);
    const mask = (v: unknown) => (f.secret ? (v ? "••••••••" : "") : v);
    return {
      key: f.key,
      label: f.label,
      group: f.group,
      help: f.help,
      env: f.env,
      restart: f.restart,
      secret: !!f.secret,
      value: mask(saved[f.key]),
      isSet: f.secret ? !!saved[f.key] : undefined,
      envOverride: o ? { name: o.name, value: f.secret ? "••••••••" : o.value } : null,
      pending: f.restart && !o && JSON.stringify(saved[f.key]) !== JSON.stringify(running[f.key]),
    };
  });
  return {
    fields,
    envOnly: ENV_ONLY.map((e) => ({ ...e, value: e.env === "DATA_DIR" ? path.resolve(process.env.DATA_DIR ?? "./data") : process.env[e.env] ?? "" })),
    pendingRestart: fields.filter((f) => f.pending).map((f) => f.key),
  };
}
