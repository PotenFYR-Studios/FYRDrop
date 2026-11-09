import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";
import { dirs } from "../db";
import { pathForRef } from "./storage";

/**
 * Thumbnails are generated one at a time through a tiny queue: libvips is
 * memory hungry, and a burst of 20 phone photos must not OOM a Raspberry Pi.
 * The libvips operation cache is disabled for the same reason.
 */

sharp.cache(false);
sharp.concurrency(Math.max(1, Math.min(2, Number(process.env.THUMB_THREADS ?? 1))));

const THUMB_SIZE = 480;
const MAX_PIXELS = 64_000_000; // ~8000×8000; rejects decompression bombs
const MAX_THUMB_SOURCE = 64 * 1024 * 1024;

let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  chain = run.catch(() => undefined);
  return run;
}

function thumbNameFor(base: string) {
  return `${path.basename(base).replace(/\.[^.]+$/, "")}.thumb.webp`;
}

/** Generate a square-cropped webp thumbnail from a plaintext buffer. */
export function makeThumbnailFromBuffer(buf: Buffer, baseName: string): Promise<string | null> {
  if (buf.byteLength > MAX_THUMB_SOURCE) return Promise.resolve(null);
  return enqueue(async () => {
    try {
      const thumbName = thumbNameFor(baseName);
      await sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: "error" })
        .rotate()
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover", withoutEnlargement: true })
        .webp({ quality: 76, effort: 2 })
        .toFile(path.join(dirs.thumbs, thumbName));
      return thumbName;
    } catch (err) {
      console.error("[thumb] failed for", path.basename(baseName), String(err));
      return null;
    }
  });
}

/** Generate a thumbnail from a stored (possibly unit-scoped) reference. */
export async function makeThumbnail(ref: string, mime: string, size?: number): Promise<string | null> {
  if (!mime.startsWith("image/") || mime === "image/svg+xml") return null;
  if (size !== undefined && size > MAX_THUMB_SOURCE) return null;
  try {
    const { decryptBuffer } = await import("./crypto");
    const buf = decryptBuffer(fs.readFileSync(pathForRef(ref)));
    const idx = ref.indexOf(":");
    return await makeThumbnailFromBuffer(buf, idx === -1 ? ref : ref.slice(idx + 1));
  } catch (err) {
    console.error("[thumb] failed for", path.basename(ref), String(err));
    return null;
  }
}

export function deleteThumb(thumbName: string | null | undefined) {
  if (!thumbName) return;
  fs.rmSync(path.join(dirs.thumbs, path.basename(thumbName)), { force: true });
}

export function thumbPath(thumbName: string) {
  return path.join(dirs.thumbs, path.basename(thumbName));
}
