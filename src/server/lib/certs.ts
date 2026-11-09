import forge from "node-forge";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { dirs } from "../db";
import { encryptString } from "./crypto";

export interface GeneratedCert {
  certPem: string;
  keyPem: string;
  serial: string;
  notBefore: Date;
  notAfter: Date;
}

type CertOpts = { commonName: string; organization?: string; days?: number; keyBits?: number; sans?: string[] };

function buildCert(opts: CertOpts, keyPem: string, pubPem: string): GeneratedCert {
  const days = Math.max(1, Math.min(opts.days ?? 825, 3650));
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(pubPem);
  // Positive serial (leading 0x01 avoids a negative ASN.1 integer).
  cert.serialNumber = "01" + crypto.randomBytes(15).toString("hex");
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + days);
  const attrs = [
    { name: "commonName", value: opts.commonName },
    { name: "organizationName", value: opts.organization || "FYRDrop" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  // Browsers ignore the CN: the hostname must be in subjectAltName. IPs and
  // DNS names need different SAN types.
  const names = [...new Set([opts.commonName, ...(opts.sans ?? [])].map((s) => s.trim()).filter(Boolean))].slice(0, 32);
  const altNames = names.map((n) => (net.isIP(n) ? { type: 7, ip: n } : { type: 2, value: n }));
  cert.setExtensions([
    { name: "basicConstraints", cA: false, critical: true },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true, clientAuth: true },
    { name: "subjectAltName", altNames },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(forge.pki.privateKeyFromPem(keyPem), forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem,
    serial: cert.serialNumber,
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
  };
}

/**
 * Generate a self-signed certificate. RSA key generation runs in OpenSSL's
 * thread pool (async) - forge's pure-JS keygen blocked the event loop for
 * seconds (minutes for 4096-bit on a Raspberry Pi).
 */
export async function generateSelfSignedAsync(opts: CertOpts): Promise<GeneratedCert> {
  const bits = opts.keyBits === 4096 ? 4096 : 2048;
  const { privateKey, publicKey } = await new Promise<{ privateKey: string; publicKey: string }>((resolve, reject) =>
    crypto.generateKeyPair(
      "rsa",
      { modulusLength: bits, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs1", format: "pem" } },
      (err, pub, priv) => (err ? reject(err) : resolve({ privateKey: priv, publicKey: pub })),
    ),
  );
  return buildCert(opts, privateKey, publicKey);
}

/** Synchronous variant for the boot path (TLS must exist before listening). */
export function generateSelfSigned(opts: CertOpts): GeneratedCert {
  const bits = opts.keyBits === 4096 ? 4096 : 2048;
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: bits,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  return buildCert(opts, privateKey, publicKey);
}

/** Parse an uploaded PEM certificate to extract metadata. */
export function parseCertPem(pem: string) {
  try {
    const x = new crypto.X509Certificate(pem);
    const field = (dn: string, key: string) => new RegExp(`(?:^|\\n)${key}=([^\\n]*)`).exec(dn)?.[1] ?? "";
    return {
      commonName: field(x.subject, "CN"),
      organization: field(x.subject, "O"),
      serial: x.serialNumber,
      notBefore: new Date(x.validFrom),
      notAfter: new Date(x.validTo),
      isSelfSigned: x.subject === x.issuer,
      keyBits: (x.publicKey.asymmetricKeyDetails?.modulusLength as number | undefined) ?? 0,
      publicKey: x.publicKey,
    };
  } catch {
    return null;
  }
}

/** Validate that a PEM private key parses and belongs to the certificate. */
export function keyMatchesCert(keyPem: string, certPem: string): boolean {
  try {
    const key = crypto.createPrivateKey(keyPem);
    return new crypto.X509Certificate(certPem).checkPrivateKey(key);
  } catch {
    return false;
  }
}

export function saveCertFiles(id: string, certPem: string, keyPem: string | null) {
  const certFile = `${id}.crt.pem`;
  fs.writeFileSync(path.join(dirs.certs, certFile), certPem, "utf8");
  let keyFile: string | null = null;
  if (keyPem) {
    // private keys are AES-256-GCM encrypted at rest
    keyFile = `${id}.key.pem`;
    fs.writeFileSync(path.join(dirs.certs, keyFile), encryptString(keyPem), { encoding: "utf8", mode: 0o600 });
  }
  return { certFile, keyFile };
}

export function deleteCertFiles(certFile: string, keyFile: string | null) {
  fs.rmSync(path.join(dirs.certs, path.basename(certFile)), { force: true });
  if (keyFile) fs.rmSync(path.join(dirs.certs, path.basename(keyFile)), { force: true });
}
