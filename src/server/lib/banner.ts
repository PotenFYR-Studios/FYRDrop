import { sql } from "drizzle-orm";
import { db, dirs } from "../db";
import { clusterNodes, items, sessions, users } from "../db/schema";
import { currentPin, initialAdminPassword } from "./bootstrap";
import { readConfig } from "./config";
import { listUnits } from "./storage";
import { getSettings } from "./settings";

const count = (t: typeof items | typeof users | typeof sessions | typeof clusterNodes) => db.select({ n: sql<number>`count(*)` }).from(t).get()?.n ?? 0;

/** Pretty CLI startup banner (box drawing) - printed on every boot. */
export function printBanner(opts: { port: number; scheme: "http" | "https"; urls: string[]; tlsNote?: string }) {
  const conf = readConfig();
  const pin = conf.showPinInLogs ? currentPin() : null;
  const admin = conf.showPinInLogs ? initialAdminPassword() : null;
  const appName = getSettings()?.appName ?? "FYRDrop";
  let units = 0;
  try {
    units = listUnits().length;
  } catch {
    /* storage not ready */
  }

  const W = 66;
  const pad = (s: string) => (s.length > W ? s.slice(0, W) : s + " ".repeat(W - s.length));
  const line = (s = "") => console.log(`│ ${pad(s)} │`);
  const sep = () => console.log(`├${"─".repeat(W + 2)}┤`);

  console.log(`╭${"─".repeat(W + 2)}╮`);
  line(`  FYRDrop · ${appName} · v1.0.0`);
  sep();
  line(`Instance PIN  ${pin ?? "(hidden - showPinInLogs is off)"}`);
  if (admin) {
    line(`Admin login   ${admin.username} / ${admin.password}`);
    line(`              one-time password - you must change it at first sign-in`);
  }
  line(`Network       ${opts.scheme.toUpperCase()} · port ${opts.port}${opts.tlsNote ? ` · ${opts.tlsNote}` : ""}`);
  for (const u of opts.urls.slice(0, 3)) line(`              ${u}`);
  sep();
  line(`Items ${count(items)} · Users ${count(users)} · Devices ${count(sessions)} · Cluster ${count(clusterNodes)} · Units ${units}`);
  line(`Data          ${dirs.data}`);
  sep();
  line(`Sign in at    ${opts.scheme}://localhost:${opts.port}`);
  console.log(`╰${"─".repeat(W + 2)}╯`);
}
