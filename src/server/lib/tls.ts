import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirs } from "../db";
import { customTlsPaths, effectiveNetworkMode, effectiveTlsCommonName } from "./config";
import { generateSelfSigned, generateSelfSignedAsync, keyMatchesCert } from "./certs";

/**
 * How this instance is served.
 *
 *   off     plain HTTP (the default). Right for a trusted LAN, and for any
 *           setup where something in front terminates TLS (reverse proxy,
 *           Tailscale Serve, Cloudflare Tunnel).
 *   auto    HTTPS with a self-signed certificate kept in DATA_DIR/tls.
 *   custom  HTTPS with the owner's certificate: uploaded under Admin ->
 *           Settings (DATA_DIR/tls/custom-*.pem) or read from the paths in
 *           TLS_CERT_PATH / TLS_KEY_PATH.
 *
 * A certificate that is missing or broken never stops the server: it falls
 * back to HTTP and reports the problem, so the owner can still sign in and
 * fix it.
 */

export type TlsSource = "off" | "self-signed" | "custom";

export interface TlsState {
  active: boolean;
  source: TlsSource;
  cert?: string;
  key?: string;
  /** Why HTTPS was asked for but is not running. */
  problem?: string;
}

export interface CertSummary {
  subject: string;
  issuer: string;
  selfSigned: boolean;
  names: string[];
  notBefore: number;
  notAfter: number;
  daysLeft: number;
  expired: boolean;
  /** SHA-256 fingerprint, to compare against what the browser shows. */
  fingerprint: string;
}

const tlsDir = () => path.join(dirs.data, "tls");
export const tlsFiles = () => ({
  selfCert: path.join(tlsDir(), "cert.pem"),
  selfKey: path.join(tlsDir(), "key.pem"),
  customCert: path.join(tlsDir(), "custom-cert.pem"),
  customKey: path.join(tlsDir(), "custom-key.pem"),
});

function readPair(certFile: string | undefined, keyFile: string | undefined): { cert: string; key: string } | null {
  if (!certFile || !keyFile) return null;
  try {
    if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) return null;
    return { cert: fs.readFileSync(certFile, "utf8"), key: fs.readFileSync(keyFile, "utf8") };
  } catch {
    return null;
  }
}

/** Host names and addresses people can type to reach this machine. */
export function localNames(): string[] {
  const names = new Set<string>(["localhost", "127.0.0.1", "::1"]);
  const host = os.hostname().trim().toLowerCase();
  if (host && /^[a-z0-9.-]+$/.test(host)) {
    names.add(host);
    if (!host.includes(".")) names.add(`${host}.local`);
  }
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|veth|br-|vmnet|vEthernet)/i.test(name)) continue;
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) names.add(a.address);
  }
  return [...names];
}

export function describeCert(pem: string): CertSummary | null {
  try {
    const x = new crypto.X509Certificate(pem);
    const cn = (dn: string) => /(?:^|\n)CN=([^\n]*)/.exec(dn)?.[1] ?? dn.replace(/\n/g, ", ");
    const notAfter = new Date(x.validTo).getTime();
    const names = (x.subjectAltName ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^(DNS|IP Address):/i, ""))
      .filter(Boolean);
    return {
      subject: cn(x.subject),
      issuer: cn(x.issuer),
      selfSigned: x.subject === x.issuer,
      names,
      notBefore: new Date(x.validFrom).getTime(),
      notAfter,
      daysLeft: Math.floor((notAfter - Date.now()) / 86_400_000),
      expired: notAfter <= Date.now(),
      fingerprint: x.fingerprint256,
    };
  } catch {
    return null;
  }
}

/** Check a PEM pair before it is trusted with the listener. Returns an error message or null. */
export function validatePair(certPem: string, keyPem: string): string | null {
  if (!/-----BEGIN CERTIFICATE-----/.test(certPem)) return "The certificate is not PEM (it should start with -----BEGIN CERTIFICATE-----).";
  if (!/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(keyPem)) return "The private key is not PEM (it should start with -----BEGIN PRIVATE KEY-----).";
  if (/ENCRYPTED/.test(keyPem)) return "The private key is passphrase-protected. Remove the passphrase first (openssl pkey -in key.pem -out plain-key.pem).";
  const info = describeCert(certPem);
  if (!info) return "The certificate could not be read.";
  if (info.expired) return "The certificate has expired.";
  if (!keyMatchesCert(keyPem, certPem)) return "The private key does not belong to this certificate. For a chain, put your own certificate first.";
  return null;
}

/** The pair a custom setup would use: explicit paths first, then the uploaded pair. */
export function customPair(): { cert: string; key: string; from: "paths" | "upload" } | null {
  const p = customTlsPaths();
  const byPath = readPair(p.cert, p.key);
  if (byPath) return { ...byPath, from: "paths" };
  const f = tlsFiles();
  const uploaded = readPair(f.customCert, f.customKey);
  return uploaded ? { ...uploaded, from: "upload" } : null;
}

export function selfSignedPair() {
  const f = tlsFiles();
  return readPair(f.selfCert, f.selfKey);
}

function writePair(certFile: string, keyFile: string, cert: string, key: string) {
  fs.mkdirSync(tlsDir(), { recursive: true });
  fs.writeFileSync(certFile, cert, "utf8");
  fs.writeFileSync(keyFile, key, { encoding: "utf8", mode: 0o600 });
}

export function saveCustomPair(cert: string, key: string) {
  const f = tlsFiles();
  writePair(f.customCert, f.customKey, cert.trim() + "\n", key.trim() + "\n");
}

/** Make (or replace) the self-signed certificate. Used from the admin page; boot uses the sync path below. */
export async function regenerateSelfSigned(names: string[], days = 825) {
  const all = [...new Set([...names.map((n) => n.trim()).filter(Boolean), ...localNames()])];
  const gen = await generateSelfSignedAsync({ commonName: all[0] ?? effectiveTlsCommonName(), organization: "FYRDrop", days, keyBits: 2048, sans: all });
  const f = tlsFiles();
  writePair(f.selfCert, f.selfKey, gen.certPem, gen.keyPem);
  return describeCert(gen.certPem)!;
}

let state: TlsState | null = null;

/** Resolved once per process: TLS cannot change while the listener is up. */
export function tlsState(): TlsState {
  if (state) return state;
  state = resolve();
  return state;
}

function resolve(): TlsState {
  const mode = effectiveNetworkMode();
  if (mode === "off") return { active: false, source: "off" };

  if (mode === "custom") {
    const pair = customPair();
    if (!pair) return { active: false, source: "off", problem: "HTTPS is set to use your own certificate, but no certificate and key were found. Serving plain HTTP until one is added." };
    const bad = validatePair(pair.cert, pair.key);
    if (bad) return { active: false, source: "off", problem: `HTTPS is set to use your own certificate, but it cannot be used: ${bad} Serving plain HTTP until it is replaced.` };
    return { active: true, source: "custom", cert: pair.cert, key: pair.key };
  }

  // auto: reuse the stored self-signed certificate, or make one for this machine's names.
  let pair = selfSignedPair();
  if (pair && validatePair(pair.cert, pair.key)) pair = null; // expired or damaged -> replace
  if (!pair) {
    try {
      const cn = effectiveTlsCommonName();
      const gen = generateSelfSigned({ commonName: cn, organization: "FYRDrop", days: 825, keyBits: 2048, sans: localNames() });
      const f = tlsFiles();
      writePair(f.selfCert, f.selfKey, gen.certPem, gen.keyPem);
      pair = { cert: gen.certPem, key: gen.keyPem };
    } catch (err) {
      return { active: false, source: "off", problem: `Could not create the self-signed certificate (${String(err).slice(0, 160)}). Serving plain HTTP.` };
    }
  }
  return { active: true, source: "self-signed", cert: pair.cert, key: pair.key };
}
