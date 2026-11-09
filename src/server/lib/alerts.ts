import { eq, gt } from "drizzle-orm";
import { db } from "../db";
import { kv, users } from "../db/schema";
import { availableBytes, userStorageBytes } from "./storage";
import { notify, notifyOwners } from "./notify";

/**
 * Periodic checks that turn into notifications: personal quota at 90 %,
 * and instance disk space under 5 % / 1 GB. Each alert repeats at most once
 * a day while the condition lasts.
 */

const DAY = 86_400_000;

function due(key: string) {
  const row = db.select().from(kv).where(eq(kv.key, key)).get();
  const last = Number(row?.value ?? 0);
  if (Date.now() - last < DAY) return false;
  const value = String(Date.now());
  db.insert(kv).values({ key, value }).onConflictDoUpdate({ target: kv.key, set: { value } }).run();
  return true;
}

function clear(key: string) {
  db.delete(kv).where(eq(kv.key, key)).run();
}

export function sweepQuotaAlerts() {
  for (const u of db.select({ id: users.id, quotaMb: users.quotaMb }).from(users).where(gt(users.quotaMb, 0)).all()) {
    const cap = u.quotaMb * 1024 * 1024;
    const used = userStorageBytes(u.id);
    const key = `alert:quota:${u.id}`;
    if (used >= cap * 0.9) {
      if (due(key)) {
        notify(u.id, "storage.quota", {
          title: used >= cap ? "Your storage is full" : "Your storage is almost full",
          body: `You use ${Math.round((used / cap) * 100)} % of your ${u.quotaMb} MB. Empty the trash or delete files you no longer need.`,
          link: "/files",
        });
      }
    } else clear(key);
  }
  const free = availableBytes();
  if (Number.isFinite(free) && free < 1024 ** 3) {
    if (due("alert:disk")) notifyOwners({ title: "This instance is running out of space", body: `Only ${(free / 1024 ** 2).toFixed(0)} MB are left for uploads.`, link: "/admin/storage" });
  } else clear("alert:disk");
}
