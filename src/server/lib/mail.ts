import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { kv } from "../db/schema";
import { encryptString, decryptString } from "./crypto";
import { logEvent } from "./audit";
import { effectiveMailOutbox } from "./config";

/**
 * Outgoing mail (password reset, verification codes, notifications).
 *
 * The owner configures an SMTP relay in Settings. The password is sealed with
 * the master key. `publicUrl` is the address people use to reach this
 * instance; links in emails are built from it and never from the request's
 * Host header (which a client controls).
 *
 * The mail outbox setting (FYRDROP_MAIL_OUTBOX) writes each message as JSON into that directory
 * instead of sending it - for development and automated tests.
 */

export interface MailConfig {
  enabled: boolean;
  host: string;
  port: number;
  /** tls = implicit TLS (465), starttls = upgrade (587), none = plain (LAN relays only). */
  security: "tls" | "starttls" | "none";
  user: string;
  passEnc: string;
  from: string;
  publicUrl: string;
}

const KEY = "mail:config";
const DEFAULTS: MailConfig = { enabled: false, host: "", port: 587, security: "starttls", user: "", passEnc: "", from: "", publicUrl: "" };
let transport: Transporter | null = null;

export function getMailConfig(): MailConfig {
  const row = db.select().from(kv).where(eq(kv.key, KEY)).get();
  try {
    return { ...DEFAULTS, ...(row ? JSON.parse(row.value) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Safe view for the admin UI (no password). */
export function publicMailConfig() {
  const { passEnc, ...rest } = getMailConfig();
  return { ...rest, hasPassword: !!passEnc, outbox: !!effectiveMailOutbox() };
}

export function setMailConfig(patch: Partial<Omit<MailConfig, "passEnc">> & { password?: string | null }): MailConfig {
  const cur = getMailConfig();
  const next: MailConfig = { ...cur };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (typeof patch.host === "string") next.host = patch.host.trim().slice(0, 200);
  if (patch.port !== undefined) next.port = Math.min(Math.max(Math.round(Number(patch.port)) || 587, 1), 65535);
  if (patch.security === "tls" || patch.security === "starttls" || patch.security === "none") next.security = patch.security;
  if (typeof patch.user === "string") next.user = patch.user.trim().slice(0, 200);
  if (typeof patch.from === "string") next.from = patch.from.trim().slice(0, 200);
  if (typeof patch.publicUrl === "string") next.publicUrl = patch.publicUrl.trim().replace(/\/+$/, "").slice(0, 300);
  if (patch.password === null) next.passEnc = "";
  else if (typeof patch.password === "string" && patch.password) next.passEnc = encryptString(patch.password.slice(0, 500));
  db.insert(kv).values({ key: KEY, value: JSON.stringify(next) }).onConflictDoUpdate({ target: kv.key, set: { value: JSON.stringify(next) } }).run();
  transport = null;
  return next;
}

export function validateMailConfig(cfg: MailConfig): string | null {
  if (!cfg.enabled) return null;
  if (!effectiveMailOutbox() && !cfg.host) return "SMTP host is required.";
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(cfg.from.replace(/^.*<([^>]+)>\s*$/, "$1"))) return "Sender address must be a valid email (e.g. FYRDrop <drop@example.com>).";
  try {
    const u = new URL(cfg.publicUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
  } catch {
    return "Public URL must be the full address of this instance, e.g. https://drop.example.com";
  }
  return null;
}

export function mailEnabled() {
  const cfg = getMailConfig();
  return cfg.enabled && !validateMailConfig(cfg);
}

/** Absolute link into this instance (path must start with "/"). */
export function publicLink(p: string) {
  return getMailConfig().publicUrl + p;
}

function getTransport(cfg: MailConfig): Transporter {
  if (transport) return transport;
  let pass = "";
  if (cfg.passEnc) {
    try {
      pass = decryptString(cfg.passEnc);
    } catch {
      pass = "";
    }
  }
  transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.security === "tls",
    requireTLS: cfg.security === "starttls",
    ignoreTLS: cfg.security === "none",
    auth: cfg.user ? { user: cfg.user, pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transport;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Minimal branded HTML around plain paragraphs; an optional button link. */
export function renderMail(opts: { appName: string; heading: string; paragraphs: string[]; button?: { label: string; href: string }; footer?: string }) {
  const p = opts.paragraphs.map((t) => `<p style="margin:0 0 14px;line-height:1.5">${esc(t)}</p>`).join("");
  const btn = opts.button
    ? `<p style="margin:22px 0"><a href="${esc(opts.button.href)}" style="background:#6366f1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${esc(opts.button.label)}</a></p><p style="margin:0 0 14px;font-size:12px;color:#64748b;word-break:break-all">${esc(opts.button.href)}</p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a"><div style="max-width:520px;margin:24px auto;background:#fff;border-radius:12px;padding:28px"><div style="font-size:13px;color:#6366f1;font-weight:600;margin-bottom:6px">${esc(opts.appName)}</div><h1 style="font-size:20px;margin:0 0 16px">${esc(opts.heading)}</h1>${p}${btn}<p style="margin:24px 0 0;font-size:12px;color:#94a3b8">${esc(opts.footer ?? "You get this email because of your account on this FYRDrop instance.")}</p></div></body></html>`;
  const text = [opts.heading, "", ...opts.paragraphs, ...(opts.button ? ["", `${opts.button.label}: ${opts.button.href}`] : []), "", opts.footer ?? ""].join("\n").trim();
  return { html, text };
}

export async function sendMail(mail: Mail, opts: { force?: boolean } = {}): Promise<void> {
  const cfg = getMailConfig();
  if (!opts.force && !mailEnabled()) throw new Error("Email is not configured on this instance.");
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(mail.to)) throw new Error("Invalid recipient address.");
  const outbox = effectiveMailOutbox();
  if (outbox) {
    fs.mkdirSync(outbox, { recursive: true });
    const file = path.join(outbox, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`);
    fs.writeFileSync(file, JSON.stringify({ from: cfg.from, ...mail }, null, 2));
    return;
  }
  await getTransport(cfg).sendMail({ from: cfg.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
}

/** Fire-and-forget send for notifications: failures land in the activity log, never in the request. */
export function sendMailInBackground(mail: Mail, label: string) {
  sendMail(mail).catch((err) => {
    logEvent({ event: "system.mail-failed", ok: false, detail: `${label}: ${String(err?.message ?? err).slice(0, 200)}`, actor: { name: "mailer" }, target: mail.to.replace(/^(.).*@/, "$1***@") });
  });
}

export const EMAIL_RE = /^[^\s@<>,;]{1,64}@[^\s@<>,;]{1,190}\.[^\s@<>,;]{2,}$/;
export function normalizeEmail(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase().slice(0, 254) : "";
}
