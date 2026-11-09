/**
 * Detached update helper: runs after the old server exits, swaps the staged
 * release into place, starts the new server, then deletes every temporary
 * directory and archive it created.
 */
import fs from "node:fs";
import path from "node:path";

const app = process.argv[2] || process.env.FYRDROP_APP_DIR || process.cwd();
const data = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(app, "data");
const updateDir = path.join(data, "update");
const pendingPath = path.join(updateDir, "pending.json");
const logPath = path.join(updateDir, "apply.log");

const log = (msg: string) => {
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* nothing to log to */
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function writeHistory(from: string, to: string) {
  let rows: any[] = [];
  try {
    rows = JSON.parse(fs.readFileSync(path.join(updateDir, "history.json"), "utf8"));
  } catch {
    rows = [];
  }
  rows.unshift({ from, to, at: Date.now() });
  fs.writeFileSync(path.join(updateDir, "history.json"), JSON.stringify(rows.slice(0, 20), null, 2));
}

async function main() {
  await sleep(1500);
  let pending: any = null;
  try {
    pending = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
  } catch {
    log("no pending update - plain restart");
    pending = {};
  }

  if (pending.mode === "source" && pending.staging) {
    const old = `${app}.old-${Date.now()}`;
    try {
      process.chdir(data);
      fs.renameSync(app, old);
      fs.renameSync(pending.staging, app);
      log(`swapped ${pending.staging} -> ${app}; previous tree at ${old}`);
      pending.oldDir = old;
    } catch (err) {
      log(`swap failed: ${String(err)}`);
      try {
        if (!fs.existsSync(app)) fs.renameSync(old, app);
      } catch {
        /* best effort */
      }
      fs.writeFileSync(path.join(updateDir, "failed.json"), JSON.stringify({ at: Date.now(), error: String(err) }, null, 2));
      return;
    }
  }

  // Process managers restart the service themselves; only spawn when nothing
  // else will (plain terminal, nohup, bun run start).
  let savedManaged = false;
  try {
    savedManaged = JSON.parse(fs.readFileSync(path.join(data, "config.json"), "utf8"))?.managedByProcessManager === true;
  } catch {
    /* no config file */
  }
  const managed = !!process.env.INVOCATION_ID || !!process.env.FYRDROP_MANAGED || !!process.env.DYNO || savedManaged;
  if (!managed) {
    try {
      const out = fs.openSync(path.join(updateDir, "server.log"), "a");
      const child = Bun.spawn([process.execPath, "src/server/index.ts"], {
        cwd: app,
        detached: true,
        stdio: ["ignore", out, out],
        env: { ...process.env, FYRDROP_APP_DIR: app },
      });
      child.unref();
      log(`started new server pid ${child.pid}`);
    } catch (err) {
      log(`could not start the new server: ${String(err)}`);
      fs.writeFileSync(path.join(updateDir, "failed.json"), JSON.stringify({ at: Date.now(), error: String(err) }, null, 2));
      return;
    }
  } else {
    log("restart left to the process manager");
  }

  if (pending.to) {
    writeHistory(String(pending.from ?? ""), String(pending.to ?? ""));
    fs.rmSync(pendingPath, { force: true });
  }
  try {
    fs.rmSync(path.join(updateDir, "failed.json"), { force: true });
  } catch {
    /* none */
  }

  // Delete staged leftovers, archives and the previous tree. A locked file on
  // Windows is retried once after the new server has had time to start.
  await sleep(2500);
  const cleanup = () => {
    try {
      if (pending.oldDir) fs.rmSync(pending.oldDir, { recursive: true, force: true });
    } catch {
      /* retry below */
    }
    try {
      const stagingDir = path.join(updateDir, "staging");
      if (fs.existsSync(stagingDir)) for (const name of fs.readdirSync(stagingDir)) fs.rmSync(path.join(stagingDir, name), { recursive: true, force: true });
    } catch {
      /* retry below */
    }
    try {
      for (const f of fs.readdirSync(updateDir)) if (f.endsWith(".tar.gz") || f.endsWith(".zip")) fs.rmSync(path.join(updateDir, f), { force: true });
    } catch {
      /* nothing */
    }
  };
  cleanup();
  await sleep(3000);
  cleanup();
  log("cleanup finished");
}

void main();
