import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { db, dirs } from "../db";
import { certs } from "../db/schema";
import { requireSession, requireOwner } from "../lib/auth";
import { generateSelfSignedAsync, parseCertPem, saveCertFiles, deleteCertFiles, keyMatchesCert } from "../lib/certs";
import { decryptString } from "../lib/crypto";
import { contentDisposition } from "../lib/content";
import { hit } from "../lib/security";
import { publish } from "../lib/events";
import { auditRequest } from "../lib/audit";
import type { AppEnv } from "../lib/net";

/**
 * Certificates. Every signed-in user can list them and download the public
 * certificate (to trust this hub). Generating, uploading, deleting and -
 * above all - downloading private keys is owner-only.
 */
export const certRoutes = new Hono<AppEnv>();

type Cert = typeof certs.$inferSelect;

certRoutes.use("*", requireSession);

const HOST_RE = /^(?=.{1,253}$)(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const validName = (s: string) => net.isIP(s) !== 0 || HOST_RE.test(s);

function serialize(row: Cert) {
  const { certFile, keyFile, ...rest } = row;
  return { ...rest, hasKey: !!keyFile, daysLeft: Math.ceil((row.notAfter - Date.now()) / 86_400_000) };
}

const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "certificate";

certRoutes.get("/", (c) => {
  const rows = db.select().from(certs).all().sort((a, b) => b.createdAt - a.createdAt);
  return c.json({ certs: rows.map(serialize) });
});

certRoutes.post("/generate", requireOwner, async (c) => {
  if (!hit(`certgen:${c.get("session").token}`, 60_000, 6)) return c.json({ error: "Slow down - key generation is expensive." }, 429);
  const body = await c.req.json<any>().catch(() => null);
  const commonName = typeof body?.commonName === "string" ? body.commonName.trim().toLowerCase() : "";
  if (!commonName || !validName(commonName)) return c.json({ error: "Common name must be a hostname or IP address." }, 400);
  const keyBits = Number(body?.keyBits ?? 2048);
  if (keyBits !== 2048 && keyBits !== 4096) return c.json({ error: "keyBits must be 2048 or 4096." }, 400);
  const sans: string[] = Array.isArray(body?.sans) ? body.sans.filter((s: unknown) => typeof s === "string").map((s: string) => s.trim()).filter(Boolean).slice(0, 16) : [];
  const bad = sans.find((s) => !validName(s));
  if (bad) return c.json({ error: `"${bad}" is not a valid hostname or IP.` }, 400);
  const organization = typeof body?.organization === "string" ? body.organization.trim().slice(0, 64) : "";

  const id = crypto.randomUUID();
  const gen = await generateSelfSignedAsync({ commonName, organization, days: Number(body?.days) || 825, keyBits, sans });
  const { certFile, keyFile } = saveCertFiles(id, gen.certPem, gen.keyPem);
  const row: Cert = {
    id,
    name: (typeof body?.name === "string" && body.name.trim() ? body.name.trim() : commonName).slice(0, 100),
    kind: "generated",
    commonName,
    organization,
    serial: gen.serial,
    keyBits,
    notBefore: gen.notBefore.getTime(),
    notAfter: gen.notAfter.getTime(),
    certFile,
    keyFile,
    createdAt: Date.now(),
  };
  db.insert(certs).values(row).run();
  publish({ scope: "certs", action: "created", id });
  auditRequest(c, "cert.generated", true, `Generated certificate "${row.name}" for ${row.commonName}`, {
    target: row.name,
    meta: { commonName: row.commonName, keyBits: row.keyBits, days: Math.round((row.notAfter - row.notBefore) / 86_400_000) },
  });
  return c.json({ cert: serialize(row) }, 201);
});

certRoutes.post(
  "/upload",
  requireOwner,
  bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: "Certificate files are limited to 256 KB." }, 413) }),
  async (c) => {
    const form = await c.req.formData().catch(() => null);
    const crt = form?.get("cert");
    if (!(crt instanceof File)) return c.json({ error: "A PEM certificate file is required." }, 400);
    const certPem = await crt.text();
    const parsed = parseCertPem(certPem);
    if (!parsed) return c.json({ error: "File is not a valid PEM certificate." }, 400);
    const key = form!.get("key");
    const keyPem = key instanceof File && key.size > 0 ? await key.text() : null;
    if (keyPem && !keyMatchesCert(keyPem, certPem)) return c.json({ error: "The private key is invalid or does not match the certificate." }, 400);

    const id = crypto.randomUUID();
    const { certFile, keyFile } = saveCertFiles(id, certPem, keyPem);
    const rawName = form!.get("name");
    const row: Cert = {
      id,
      name: ((typeof rawName === "string" && rawName.trim()) || parsed.commonName || "uploaded-cert").slice(0, 100),
      kind: "uploaded",
      commonName: parsed.commonName,
      organization: parsed.organization,
      serial: parsed.serial,
      keyBits: parsed.keyBits,
      notBefore: parsed.notBefore.getTime(),
      notAfter: parsed.notAfter.getTime(),
      certFile,
      keyFile,
      createdAt: Date.now(),
    };
    db.insert(certs).values(row).run();
    publish({ scope: "certs", action: "created", id });
    auditRequest(c, "cert.uploaded", true, `Uploaded certificate "${row.name}"`, {
      target: row.name,
      meta: { commonName: row.commonName, withKey: !!keyPem },
    });
    return c.json({ cert: serialize(row) }, 201);
  },
);

/** Public certificate (any signed-in device may fetch it to trust this hub). */
certRoutes.get("/:id/cert", (c) => {
  const row = db.select().from(certs).where(eq(certs.id, c.req.param("id"))).limit(1).get();
  if (!row) return c.json({ error: "Not found." }, 404);
  const fp = path.join(dirs.certs, path.basename(row.certFile));
  if (!fs.existsSync(fp)) return c.json({ error: "Certificate file missing." }, 410);
  return c.body(fs.readFileSync(fp), 200, {
    "content-type": "application/x-pem-file",
    "content-disposition": contentDisposition("attachment", `${safeName(row.name)}.crt.pem`),
  });
});

/** Private key download - owner only, decrypted on the fly. */
certRoutes.get("/:id/key", requireOwner, (c) => {
  const row = db.select().from(certs).where(eq(certs.id, c.req.param("id"))).limit(1).get();
  if (!row || !row.keyFile) return c.json({ error: "Not found." }, 404);
  const fp = path.join(dirs.certs, path.basename(row.keyFile));
  if (!fs.existsSync(fp)) return c.json({ error: "Key file missing." }, 410);
  auditRequest(c, "cert.key-downloaded", true, `Downloaded the private key for "${row.name}"`, {
    target: row.name,
    severity: "warn",
  });
  return c.body(decryptString(fs.readFileSync(fp, "utf8")), 200, {
    "content-type": "application/x-pem-file",
    "content-disposition": contentDisposition("attachment", `${safeName(row.name)}.key.pem`),
    "cache-control": "no-store",
  });
});

certRoutes.delete("/:id", requireOwner, (c) => {
  const row = db.select().from(certs).where(eq(certs.id, c.req.param("id"))).limit(1).get();
  if (!row) return c.json({ error: "Not found." }, 404);
  deleteCertFiles(row.certFile, row.keyFile);
  db.delete(certs).where(eq(certs.id, row.id)).run();
  publish({ scope: "certs", action: "deleted", id: row.id });
  auditRequest(c, "cert.deleted", true, `Deleted certificate "${row.name}"`, { target: row.name, severity: "warn" });
  return c.json({ ok: true });
});
