/**
 * Response headers for user-supplied content.
 *
 * Uploaded bytes are served from the app's own origin, so a file labelled
 * text/html, image/svg+xml or application/javascript would run script with the
 * victim's session (stored XSS). Only a short allow-list of passive media types
 * is ever rendered inline; everything else becomes an opaque download. Inline
 * responses also get their own locked-down CSP and `sandbox` where browsers
 * allow it.
 */

const INLINE_SAFE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|ogg|quicktime)|audio\/(mpeg|mp4|ogg|wav|webm|aac|flac|x-wav)|application\/pdf|text\/plain)$/;

export function isInlineSafe(mime: string) {
  return INLINE_SAFE.test(mime.toLowerCase().split(";")[0]!.trim());
}

function asciiFallback(name: string) {
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_").slice(0, 150) || "download";
}

export function contentDisposition(kind: "inline" | "attachment", name: string) {
  return `${kind}; filename="${asciiFallback(name)}"; filename*=UTF-8''${encodeURIComponent(name.slice(0, 200))}`;
}

/** Headers for serving stored bytes. `inline` is downgraded to attachment for unsafe types. */
export function userContentHeaders(opts: { mime: string; name: string; inline: boolean; size?: number }): Record<string, string> {
  const mime = (opts.mime || "application/octet-stream").toLowerCase().split(";")[0]!.trim();
  const safe = isInlineSafe(mime);
  const inline = opts.inline && safe;
  const h: Record<string, string> = {
    "content-type": safe ? (mime === "text/plain" ? "text/plain; charset=utf-8" : mime) : "application/octet-stream",
    "content-disposition": contentDisposition(inline ? "inline" : "attachment", opts.name),
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
    "cross-origin-resource-policy": "same-origin",
  };
  if (opts.size !== undefined) h["content-length"] = String(opts.size);
  if (inline) {
    // PDFs must be frameable by our own preview; Chrome's viewer refuses sandboxed frames.
    if (mime === "application/pdf") {
      h["content-security-policy"] = "default-src 'none'; frame-ancestors 'self'";
      h["x-frame-options"] = "SAMEORIGIN";
    } else {
      h["content-security-policy"] = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'self'";
      h["x-frame-options"] = "SAMEORIGIN";
    }
  } else {
    h["content-security-policy"] = "default-src 'none'; sandbox";
  }
  return h;
}

export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export const ITEM_TYPES = new Set(["file", "image", "text", "url"]);
