import fs from "node:fs";
import path from "node:path";
import { dirs } from "../db";
import { inContainer } from "./device";

/**
 * In-app updates.
 *
 * The instance asks the public GitHub repository for the newest release tag,
 * stages it (git checkout for a git install, downloaded source tree for a
 * plain folder), builds it, then asks for a mandatory restart. A small detached
 * helper performs the swap after the old process exits, starts the new one and
 * deletes every temporary directory it created.
 *
 * Docker is intentionally read-only here: the right way to update a container
 * is to pull the new image, so the UI shows the version and the pull command
 * instead of rewriting the image from inside.
 */

export const REPO = process.env.UPDATE_REPO?.trim() || "PotenFYR-Studios/FYRDrop";
const UPDATE_DIR = () => path.join(dirs.data, "update");
const STAGING_DIR = () => path.join(UPDATE_DIR(), "staging");
const PENDING = () => path.join(UPDATE_DIR(), "pending.json");
const HISTORY = () => path.join(UPDATE_DIR(), "history.json");

export type UpdateMode = "docker" | "git" | "source";

export interface PendingUpdate {
  from: string;
  to: string;
  mode: Exclude<UpdateMode, "docker">;
  tag: string;
  staging?: string;
  fromCommit?: string;
  createdAt: number;
}

export interface ReleaseInfo {
  tag: string;
  version: string;
  notes: string;
  url: string;
  publishedAt: string;
}

let currentCache: string | null = null;
export function currentVersion(): string {
  if (currentCache) return currentCache;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    currentCache = String(pkg.version ?? "0.0.0");
  } catch {
    currentCache = "0.0.0";
  }
  return currentCache;
}

export function updateMode(): UpdateMode {
  if (inContainer()) return "docker";
  if (fs.existsSync(path.join(process.cwd(), ".git"))) return "git";
  return "source";
}

export function readPending(): PendingUpdate | null {
  try {
    return JSON.parse(fs.readFileSync(PENDING(), "utf8")) as PendingUpdate;
  } catch {
    return null;
  }
}

export function writePending(p: PendingUpdate) {
  fs.mkdirSync(UPDATE_DIR(), { recursive: true });
  fs.writeFileSync(PENDING(), JSON.stringify(p, null, 2));
}

export function clearPending() {
  fs.rmSync(PENDING(), { force: true });
}

export function history(): { from: string; to: string; at: number }[] {
  try {
    const rows = JSON.parse(fs.readFileSync(HISTORY(), "utf8"));
    return Array.isArray(rows) ? rows.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function pushHistory(from: string, to: string) {
  const rows = [{ from, to, at: Date.now() }, ...history()].slice(0, 20);
  fs.mkdirSync(UPDATE_DIR(), { recursive: true });
  fs.writeFileSync(HISTORY(), JSON.stringify(rows, null, 2));
}

export function markApplied(p: PendingUpdate) {
  pushHistory(p.from, p.to);
  clearPending();
  cleanup();
}

/* ------------------------------ GitHub lookup ----------------------------- */

let latestCache: { at: number; value: ReleaseInfo | null; error?: string } | null = null;

export function normalizeVersion(v: string) {
  return v.replace(/^v/i, "").trim();
}

export function isNewer(current: string, candidate: string): boolean {
  const a = normalizeVersion(current).split(".").map(Number);
  const b = normalizeVersion(candidate).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = Number.isFinite(a[i]) ? a[i]! : 0;
    const y = Number.isFinite(b[i]) ? b[i]! : 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}

export async function latestRelease(force = false): Promise<{ release: ReleaseInfo | null; error?: string }> {
  if (!force && latestCache && Date.now() - latestCache.at < 10 * 60_000) return { release: latestCache.value, error: latestCache.error };
  let release: ReleaseInfo | null = null;
  let error: string | undefined;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "FYRDrop-updater" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const list = (await res.json()) as any[];
      const pick = list.find((r) => r && !r.draft && !r.prerelease && typeof r.tag_name === "string");
      if (pick) {
        release = {
          tag: pick.tag_name,
          version: normalizeVersion(pick.tag_name),
          notes: String(pick.body ?? "").slice(0, 5000),
          url: String(pick.html_url ?? `https://github.com/${REPO}/releases`),
          publishedAt: String(pick.published_at ?? ""),
        };
      }
    } else if (res.status !== 404) {
      error = `GitHub returned ${res.status}`;
    }
    if (!release) {
      // No releases yet: fall back to the newest tag.
      const tagsRes = await fetch(`https://api.github.com/repos/${REPO}/tags?per_page=20`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "FYRDrop-updater" },
        signal: AbortSignal.timeout(10_000),
      });
      if (tagsRes.ok) {
        const tags = (await tagsRes.json()) as any[];
        const tag = tags.find((t) => typeof t?.name === "string" && /^v?\d+\.\d+\.\d+/.test(t.name));
        if (tag) {
          release = {
            tag: tag.name,
            version: normalizeVersion(tag.name),
            notes: "Tag " + tag.name,
            url: `https://github.com/${REPO}/releases/tag/${tag.name}`,
            publishedAt: "",
          };
        }
      }
    }
  } catch (err) {
    error = String(err).slice(0, 200);
  }
  latestCache = { at: Date.now(), value: release, error };
  return { release, error };
}

/* --------------------------------- Staging -------------------------------- */

function exec(cmd: string[], cwd: string, timeout = 300_000): { ok: boolean; out: string } {
  try {
    const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", timeout });
    const out = `${r.stdout?.toString?.() ?? ""}${r.stderr?.toString?.() ?? ""}`;
    return { ok: r.exitCode === 0, out: out.slice(-4000) };
  } catch (err) {
    return { ok: false, out: String(err) };
  }
}

export function cleanup() {
  try {
    const dir = STAGING_DIR();
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir)) {
        const p = path.join(dir, entry);
        // Anything older than an hour is abandoned staging work.
        try {
          if (Date.now() - fs.statSync(p).mtimeMs > 60 * 60_000) fs.rmSync(p, { recursive: true, force: true });
        } catch {
          /* gone */
        }
      }
    }
  } catch {
    /* update dir missing */
  }
}

/** Download and build a release into DATA_DIR/update/staging/<tag>. */
export async function stageRelease(tag: string): Promise<{ ok: boolean; error?: string; staging?: string }> {
  const mode = updateMode();
  if (mode === "docker") return { ok: false, error: "Docker installs update by pulling a new image." };
  const version = normalizeVersion(tag);
  if (!/^\d+\.\d+\.\d+/.test(version)) return { ok: false, error: "Invalid release tag." };
  fs.mkdirSync(STAGING_DIR(), { recursive: true });
  const fromVersion = currentVersion();
  const staging = path.join(STAGING_DIR(), version);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const app = process.cwd();

  if (mode === "git") {
    const commit = exec(["git", "rev-parse", "HEAD"], app);
    writePending({ from: currentVersion(), to: version, mode: "git", tag, fromCommit: commit.ok ? commit.out.trim() : undefined, createdAt: Date.now() });
    fs.rmSync(staging, { recursive: true, force: true });
    return { ok: true };
  }

  const tar = path.join(UPDATE_DIR(), `${version}.tar.gz`);
  try {
    const res = await fetch(`https://codeload.github.com/${REPO}/tar.gz/refs/tags/${encodeURIComponent(tag)}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
      headers: { "user-agent": "FYRDrop-updater" },
    });
    if (!res.ok) return { ok: false, error: `Download failed (HTTP ${res.status}).` };
    fs.writeFileSync(tar, Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    return { ok: false, error: `Download failed: ${String(err).slice(0, 160)}` };
  }

  const extract = exec(["tar", "-xzf", tar, "-C", staging, "--strip-components=1"], UPDATE_DIR());
  if (!extract.ok) {
    fs.rmSync(tar, { force: true });
    return { ok: false, error: `Could not unpack the release: ${extract.out.slice(0, 200)}` };
  }
  fs.rmSync(tar, { force: true });

  if (!fs.existsSync(path.join(staging, "src", "server", "index.ts"))) {
    fs.rmSync(staging, { recursive: true, force: true });
    return { ok: false, error: "The release does not look like FYRDrop." };
  }

  const install = exec(["bun", "install", "--frozen-lockfile"], staging);
  if (!install.ok) return { ok: false, error: `Dependency install failed: ${install.out.slice(0, 200)}` };
  const build = exec(["bun", "run", "build"], staging);
  if (!build.ok) return { ok: false, error: `Build failed: ${build.out.slice(0, 200)}` };
  if (!fs.existsSync(path.join(staging, "dist", "public", "index.html"))) return { ok: false, error: "The build produced no frontend." };

  writePending({ from: fromVersion, to: version, mode: "source", tag, staging, createdAt: Date.now() });
  return { ok: true, staging };
}

export function cancelStaging() {
  const p = readPending();
  if (p?.staging) fs.rmSync(p.staging, { recursive: true, force: true });
  try {
    for (const f of fs.readdirSync(UPDATE_DIR())) if (f.endsWith(".tar.gz")) fs.rmSync(path.join(UPDATE_DIR(), f), { force: true });
  } catch {
    /* no update dir */
  }
  clearPending();
  cleanup();
}

/** Start the detached helper that swaps files, starts the new server and cleans up. */
export function scheduleRestart() {
  const app = process.cwd();
  fs.mkdirSync(UPDATE_DIR(), { recursive: true });
  const log = fs.openSync(path.join(UPDATE_DIR(), "apply.log"), "a");
  const child = Bun.spawn([process.execPath, path.join(app, "src", "server", "lib", "update-apply.ts"), app], {
    cwd: UPDATE_DIR(),
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, FYRDROP_APP_DIR: app },
  });
  child.unref();
}

/** Called at boot: if the running version is the staged target, the update landed. */
export function finalizeOnBoot() {
  const pending = readPending();
  if (pending && normalizeVersion(currentVersion()) === normalizeVersion(pending.to)) {
    markApplied(pending);
    return true;
  }
  // A failed helper leaves its reason behind for the UI to show once.
  try {
    const failed = JSON.parse(fs.readFileSync(path.join(UPDATE_DIR(), "failed.json"), "utf8"));
    if (failed?.at && Date.now() - Number(failed.at) < 24 * 3600_000) return false;
  } catch {
    /* no failure marker */
  }
  cleanup();
  return false;
}

export function lastFailure(): { at: number; error: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(UPDATE_DIR(), "failed.json"), "utf8"));
  } catch {
    return null;
  }
}
