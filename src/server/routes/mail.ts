import { Hono } from "hono";
import { requireOwner } from "../lib/auth";
import { auditRequest } from "../lib/audit";
import { getSettings } from "../lib/settings";
import { EMAIL_RE, getMailConfig, normalizeEmail, publicMailConfig, renderMail, sendMail, setMailConfig, validateMailConfig } from "../lib/mail";
import { rateLimit } from "../lib/security";
import type { AppEnv } from "../lib/net";

/** Owner-only SMTP settings. */
export const mailRoutes = new Hono<AppEnv>();
mailRoutes.use("*", requireOwner);

mailRoutes.get("/", (c) => c.json({ config: publicMailConfig() }));

mailRoutes.post("/", async (c) => {
  const b = (await c.req.json<any>().catch(() => null)) ?? {};
  const before = getMailConfig();
  const candidate = { ...before, ...b, passEnc: before.passEnc };
  const problem = validateMailConfig({
    ...candidate,
    enabled: typeof b.enabled === "boolean" ? b.enabled : before.enabled,
    publicUrl: typeof b.publicUrl === "string" ? b.publicUrl.trim().replace(/\/+$/, "") : before.publicUrl,
  });
  if (problem) return c.json({ error: problem }, 400);
  setMailConfig(b);
  auditRequest(c, "settings.mail", true, "Email (SMTP) settings updated", { target: "mail", meta: { host: candidate.host, enabled: candidate.enabled } });
  return c.json({ ok: true, config: publicMailConfig() });
});

mailRoutes.post("/test", rateLimit({ name: "mail-test", windowMs: 60_000, max: 5 }), async (c) => {
  const b = (await c.req.json<{ to?: string }>().catch(() => null)) ?? {};
  const to = normalizeEmail(b.to) || c.get("session").user?.email || "";
  if (!EMAIL_RE.test(to)) return c.json({ error: "Enter an address to send the test to." }, 400);
  const problem = validateMailConfig({ ...getMailConfig(), enabled: true });
  if (problem) return c.json({ error: problem }, 400);
  const appName = getSettings()?.appName ?? "FYRDrop";
  const m = renderMail({ appName, heading: "Test email", paragraphs: [`Email from ${appName} works.`] });
  try {
    await sendMail({ to, subject: `${appName}: test email`, ...m }, { force: true });
  } catch (err: any) {
    return c.json({ error: `Sending failed: ${String(err?.message ?? err).slice(0, 300)}` }, 502);
  }
  return c.json({ ok: true, sentTo: to });
});
