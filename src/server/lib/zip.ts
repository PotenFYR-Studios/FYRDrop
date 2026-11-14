/**
 * Minimal streaming ZIP writer (store only, no compression).
 *
 * Bundles are downloaded as one archive. Files are already compressed formats
 * most of the time (images, video, archives), so storing them keeps the CPU
 * cost near zero and lets the bytes stream straight from the decryptor without
 * buffering. Sizes and CRCs are written after each file (data descriptor),
 * because they are only known once the stream ends.
 *
 * Classic ZIP (no ZIP64): each entry and the whole archive must stay under
 * 4 GiB. Callers check with `zipFits` first.
 */

export interface ZipEntry {
  name: string;
  /** Expected size, used only for the up-front limit check. */
  size: number;
  mtime: number;
  /** Opens the content when its turn comes, so only one file is read at a time. */
  open: () => ReadableStream<Uint8Array> | Uint8Array;
}

const MAX = 0xffffffff;
export const ZIP_MAX_ENTRIES = 2000;

/** Whether the entries fit a classic ZIP archive. */
export function zipFits(entries: { size: number }[]) {
  if (entries.length === 0 || entries.length > ZIP_MAX_ENTRIES) return false;
  let total = 0;
  for (const e of entries) {
    if (e.size >= MAX) return false;
    total += e.size + 200;
  }
  return total < MAX;
}

/** Entry names must be unique and must not escape the extraction folder. */
export function safeZipNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    let name =
      raw
        .replace(/[\\/]+/g, "_")
        .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
        .replace(/^\.+/, "_")
        .trim()
        .slice(0, 180) || "file";
    const key = name.toLowerCase();
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n > 0) {
      const dot = name.lastIndexOf(".");
      name = dot > 0 ? `${name.slice(0, dot)} (${n + 1})${name.slice(dot)}` : `${name} (${n + 1})`;
    }
    return name;
  });
}

function dosTime(ms: number) {
  const d = new Date(ms);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const FLAGS = 0x0808; // bit 3: sizes follow the data, bit 11: UTF-8 names

export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const central: Uint8Array[] = [];
  let offset = 0;
  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let crc = 0;
  let written = 0;
  let headerOffset = 0;
  let nameBytes = new Uint8Array(0);
  let stamp = { time: 0, date: 0 };

  const begin = (e: ZipEntry) => {
    nameBytes = enc.encode(e.name);
    stamp = dosTime(e.mtime);
    headerOffset = offset;
    crc = 0;
    written = 0;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, FLAGS, true);
    h.setUint16(8, 0, true);
    h.setUint16(10, stamp.time, true);
    h.setUint16(12, stamp.date, true);
    h.setUint16(26, nameBytes.length, true);
    const out = new Uint8Array(30 + nameBytes.length);
    out.set(new Uint8Array(h.buffer), 0);
    out.set(nameBytes, 30);
    offset += out.length;
    return out;
  };

  const end = () => {
    const d = new DataView(new ArrayBuffer(16));
    d.setUint32(0, 0x08074b50, true);
    d.setUint32(4, crc >>> 0, true);
    d.setUint32(8, written, true);
    d.setUint32(12, written, true);
    offset += 16;
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, FLAGS, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, stamp.time, true);
    c.setUint16(14, stamp.date, true);
    c.setUint32(16, crc >>> 0, true);
    c.setUint32(20, written, true);
    c.setUint32(24, written, true);
    c.setUint16(28, nameBytes.length, true);
    c.setUint32(42, headerOffset, true);
    const rec = new Uint8Array(46 + nameBytes.length);
    rec.set(new Uint8Array(c.buffer), 0);
    rec.set(nameBytes, 46);
    central.push(rec);
    return new Uint8Array(d.buffer);
  };

  const finish = () => {
    const size = central.reduce((n, r) => n + r.length, 0);
    const out = new Uint8Array(size + 22);
    let p = 0;
    for (const r of central) {
      out.set(r, p);
      p += r.length;
    }
    const e = new DataView(out.buffer, size, 22);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, central.length, true);
    e.setUint16(10, central.length, true);
    e.setUint32(12, size, true);
    e.setUint32(16, offset, true);
    return out;
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (reader) {
          const { done, value } = await reader.read();
          if (!done) {
            const chunk = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
            crc = Bun.hash.crc32(chunk, crc);
            written += chunk.length;
            offset += chunk.length;
            if (written >= MAX || offset >= MAX) throw new Error("Archive grew past the 4 GB ZIP limit.");
            controller.enqueue(chunk);
            return;
          }
          reader = null;
          controller.enqueue(end());
          return;
        }
        if (index >= entries.length) {
          controller.enqueue(finish());
          controller.close();
          return;
        }
        const entry = entries[index++]!;
        controller.enqueue(begin(entry));
        const body = entry.open();
        if (body instanceof Uint8Array) {
          crc = Bun.hash.crc32(body, 0);
          written = body.length;
          offset += body.length;
          if (body.length) controller.enqueue(body);
          controller.enqueue(end());
        } else {
          reader = body.getReader();
        }
      } catch (err) {
        await reader?.cancel().catch(() => {});
        reader = null;
        controller.error(err);
      }
    },
    async cancel() {
      // The client went away mid-download: release the file being read.
      await reader?.cancel().catch(() => {});
      reader = null;
    },
  });
}
