import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";

/**
 * Applies a staged restore at boot, BEFORE the database is opened.
 * Imported by db/index.ts, so it must not import anything that touches the DB.
 *
 * Current data is moved to DATA_DIR/restore_previous/<timestamp>/ (rollback copy),
 * then the staged backup is moved into place. Any failure rolls the moves back
 * and leaves the instance exactly as it was.
 */

export const STAGING_DIR = (data: string) => path.join(data, "restore_staging");
export const STAGING_MARKER = "READY.json";
const PRIMARY = "primary";
const KEEP_PREVIOUS = 2;

/** Top-level entries a restore replaces (relative to DATA_DIR). */
const REPLACED = ["fyrdrop.db", "fyrdrop.db-wal", "fyrdrop.db-shm", "keys", "config.json", "tls", "certs", "thumbs", "files"];

function moveInto(src: string, dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (err: any) {
    if (err?.code !== "EXDEV") throw err;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

export function applyStagedRestore(dataDir: string): void {
  const data = path.resolve(dataDir);
  const staging = STAGING_DIR(data);
  const markerPath = path.join(staging, STAGING_MARKER);
  if (!fs.existsSync(markerPath)) return;
  let marker: any = {};
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    /* proceed with defaults */
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const previous = path.join(data, "restore_previous", ts);
  const moved: { from: string; to: string }[] = [];
  const result = (ok: boolean, extra: Record<string, unknown>) =>
    fs.writeFileSync(path.join(data, "restore_result.json"), JSON.stringify({ at: Date.now(), ok, from: marker.from, by: marker.by, ...extra }, null, 2));

  try {
    const stagedDb = path.join(staging, "db", "fyrdrop.db");
    if (!fs.existsSync(stagedDb)) throw new Error("staged backup has no database");

    // Point the primary unit at this machine's files dir and map other units.
    const unitDirs = new Map<string, string>();
    const sdb = new Database(stagedDb);
    try {
      sdb.query("UPDATE storage_units SET path = ? WHERE id = ?").run(path.join(data, "files"), PRIMARY);
      const units = sdb.query("SELECT id, path FROM storage_units").all() as { id: string; path: string }[];
      for (const u of units) {
        if (u.id === PRIMARY) continue;
        let dir = path.isAbsolute(u.path) ? u.path : path.resolve(u.path);
        try {
          fs.mkdirSync(dir, { recursive: true });
          fs.accessSync(dir, fs.constants.W_OK);
        } catch {
          // The unit's mount does not exist here: keep its files under DATA_DIR instead.
          dir = path.join(data, `files-${u.id}`);
          fs.mkdirSync(dir, { recursive: true });
          sdb.query("UPDATE storage_units SET path = ? WHERE id = ?").run(dir, u.id);
        }
        unitDirs.set(u.id, dir);
      }
      // In-flight uploads in the backup have no parts here.
      try {
        sdb.exec("DELETE FROM uploads");
      } catch {
        /* older backup without the table */
      }
    } finally {
      sdb.close();
    }

    // 1. Move the current data aside.
    fs.mkdirSync(previous, { recursive: true });
    for (const name of REPLACED) {
      const p = path.join(data, name);
      if (!fs.existsSync(p)) continue;
      const to = path.join(previous, name);
      moveInto(p, to);
      moved.push({ from: p, to });
    }

    // 2. Move the staged backup in.
    moveInto(stagedDb, path.join(data, "fyrdrop.db"));
    for (const dir of ["keys", "tls", "certs", "thumbs"]) {
      const s = path.join(staging, dir);
      if (fs.existsSync(s)) moveInto(s, path.join(data, dir));
    }
    const cfg = path.join(staging, "config.json");
    if (fs.existsSync(cfg)) moveInto(cfg, path.join(data, "config.json"));
    fs.mkdirSync(path.join(data, "files"), { recursive: true });
    const filesRoot = path.join(staging, "files");
    if (fs.existsSync(filesRoot)) {
      for (const unitId of fs.readdirSync(filesRoot)) {
        const target = unitId === PRIMARY ? path.join(data, "files") : unitDirs.get(unitId) ?? path.join(data, `files-${unitId}`);
        fs.mkdirSync(target, { recursive: true });
        for (const f of fs.readdirSync(path.join(filesRoot, unitId))) {
          const dest = path.join(target, f);
          fs.rmSync(dest, { force: true });
          moveInto(path.join(filesRoot, unitId, f), dest);
        }
      }
    }
    // A metadata-only backup restores items whose bytes must still be on disk.
    // Keep the previous primary files next to the restored ones (by name) so
    // nothing is lost; the admin's "orphans" tool can clean up later.
    const prevFiles = path.join(previous, "files");
    if (marker.manifest?.includesFiles !== true && fs.existsSync(prevFiles)) {
      for (const f of fs.readdirSync(prevFiles)) {
        const dest = path.join(data, "files", f);
        if (!fs.existsSync(dest)) fs.copyFileSync(path.join(prevFiles, f), dest);
      }
    }
    fs.rmSync(path.join(data, "uploads_tmp"), { recursive: true, force: true });
    fs.rmSync(staging, { recursive: true, force: true });

    // Keep only the most recent rollback copies.
    const prevRoot = path.join(data, "restore_previous");
    const all = fs.readdirSync(prevRoot).sort().reverse();
    for (const old of all.slice(KEEP_PREVIOUS)) fs.rmSync(path.join(prevRoot, old), { recursive: true, force: true });

    result(true, { previous });
    console.log(`  restore: applied backup ${marker.from ?? ""}; previous data kept in ${previous}`);
  } catch (err) {
    // Roll back whatever was moved, newest first.
    for (const m of moved.reverse()) {
      try {
        fs.rmSync(m.from, { recursive: true, force: true });
        moveInto(m.to, m.from);
      } catch {
        /* best effort - the copy stays in restore_previous */
      }
    }
    fs.rmSync(staging, { recursive: true, force: true });
    result(false, { error: String((err as Error)?.message ?? err) });
    console.error(`  restore: FAILED (${String(err)}); the previous data was put back`);
  }
}
