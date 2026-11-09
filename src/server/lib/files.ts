const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".7z": "application/x-7z-compressed",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".crt": "application/x-x509-ca-cert",
  ".pem": "application/x-pem-file",
  ".key": "application/x-pem-file",
};

export function guessMime(name: string, fallback = "application/octet-stream") {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return fallback;
  return MIME_MAP[name.slice(dot).toLowerCase()] ?? fallback;
}

const SAFE = /^[A-Za-z0-9._-]+$/;

/** Random filesystem-safe stored filename keeping the original extension. */
export function storedFileName(originalName: string) {
  const dot = originalName.lastIndexOf(".");
  const ext = dot > 0 ? originalName.slice(dot).toLowerCase().slice(0, 12) : "";
  const base = originalName
    .slice(0, dot > 0 ? dot : undefined)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 48) || "file";
  const random = crypto.randomUUID().slice(0, 8);
  const name = `${base}-${random}${ext}`;
  return SAFE.test(name) ? name : `file-${random}`;
}

export function humanSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
