import { eq } from "drizzle-orm";
import { db } from "../db";
import { settings } from "../db/schema";

/**
 * In-memory cache of the single settings row. It is read on nearly every
 * request (whitelist, limits, registration gate), so caching it removes a
 * SQLite round-trip from the hot path. Every write goes through updateSettings
 * which keeps the cache coherent.
 */

export type SettingsRow = typeof settings.$inferSelect;

let cached: SettingsRow | null | undefined;

export function getSettings(): SettingsRow | undefined {
  if (cached === undefined) cached = db.select().from(settings).limit(1).get() ?? null;
  return cached ?? undefined;
}

export function updateSettings(patch: Partial<typeof settings.$inferInsert>) {
  const s = getSettings();
  if (!s) return;
  db.update(settings).set({ ...patch, updatedAt: Date.now() }).where(eq(settings.id, s.id)).run();
  cached = undefined;
}

export function invalidateSettings() {
  cached = undefined;
}

export function maxUploadBytes() {
  const envMb = Number(process.env.MAX_UPLOAD_MB ?? 512);
  return (getSettings()?.maxUploadMb ?? envMb) * 1024 * 1024;
}
