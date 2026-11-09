import { Hono } from "hono";
import { requireSession } from "../lib/auth";
import { KINDS, deleteNotification, getPrefs, listNotifications, markRead, setPrefs, type Prefs } from "../lib/notify";
import { mailEnabled } from "../lib/mail";
import type { AppEnv } from "../lib/net";

export const notificationRoutes = new Hono<AppEnv>();
notificationRoutes.use("*", requireSession);

notificationRoutes.get("/", (c) => {
  const limit = Number(c.req.query("limit") ?? 50) || 50;
  const before = Number(c.req.query("before") ?? 0) || undefined;
  return c.json(listNotifications(c.get("session").user!.id, limit, before));
});

notificationRoutes.post("/read", async (c) => {
  const b = (await c.req.json<{ ids?: number[]; all?: boolean }>().catch(() => null)) ?? {};
  const ids = b.all ? "all" : Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isSafeInteger) : [];
  markRead(c.get("session").user!.id, ids);
  return c.json({ ok: true });
});

notificationRoutes.delete("/read", (c) => {
  deleteNotification(c.get("session").user!.id, "read");
  return c.json({ ok: true });
});

notificationRoutes.delete("/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id)) return c.json({ error: "Invalid id." }, 400);
  deleteNotification(c.get("session").user!.id, id);
  return c.json({ ok: true });
});

notificationRoutes.get("/prefs", (c) => {
  const u = c.get("session").user!;
  const kinds = Object.entries(KINDS)
    .filter(([k]) => k !== "system.alert" || u.role === "owner")
    .map(([key, v]) => ({ key, label: v.label, group: v.group }));
  return c.json({ prefs: getPrefs(u.id), kinds, emailReady: mailEnabled() && !!u.email && u.emailVerified === 1 });
});

notificationRoutes.post("/prefs", async (c) => {
  const b = (await c.req.json<Prefs>().catch(() => null)) ?? { inapp: {}, email: {} };
  return c.json({ ok: true, prefs: setPrefs(c.get("session").user!.id, { inapp: b.inapp ?? {}, email: b.email ?? {} }) });
});
