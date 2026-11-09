import fs from "node:fs";
import path from "node:path";

/**
 * System configuration that is read at boot (restart required to apply).
 * Stored in DATA_DIR/config.json so it survives container rebuilds; explicit
 * environment variables always win over the file.
 */

export interface SystemConfig {
  port: number;
  networkMode: "auto" | "off" | "custom";
  tlsCommonName: string;
  sessionTtlDays: number;
  trustProxy: boolean;
  showPinInLogs: boolean;
}

const DEFAULTS: SystemConfig = {
  port: 3000,
  networkMode: "auto",
  tlsCommonName: "fyrdrop.local",
  sessionTtlDays: 30,
  trustProxy: false,
  showPinInLogs: true,
};

let cached: SystemConfig | null = null;

function configPath() {
  return path.resolve(process.env.DATA_DIR ?? "./data", "config.json");
}

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

export function writeConfig(patch: Partial<SystemConfig>): SystemConfig {
  const next = { ...readConfig(), ...patch };
  const f = configPath();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(next, null, 2), { mode: 0o600 });
  cached = next;
  return next;
}

/** Env vars override the file; used by the boot path. */
export function effectivePort(): number {
  const env = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 0);
  return env || readConfig().port || 3000;
}

export function effectiveTtlDays(): number {
  return Number(process.env.SESSION_TTL_DAYS ?? readConfig().sessionTtlDays ?? 30);
}

export function effectiveNetworkMode(): "auto" | "off" | "custom" {
  const env = process.env.TLS_ENABLED;
  if (env === "0" || env === "false") return "off";
  if (env === "1" || env === "true" || env === "auto") return "auto";
  if (process.env.TLS_CERT_PATH && process.env.TLS_KEY_PATH) return "custom";
  return readConfig().networkMode;
}
