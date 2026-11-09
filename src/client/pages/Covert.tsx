import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Icon, type IconName } from "../icons";
import { Badge, Btn, Card, CopyBtn, Input, Label, PageHeader, Spinner, Textarea, useToast } from "../ui";
import { api, humanSize } from "../api";

type Tab = "qr" | "encode" | "decode" | "b64";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "qr", label: "QR Code", icon: "qr" },
  { id: "encode", label: "Text → Image", icon: "image" },
  { id: "decode", label: "Image → Text", icon: "code" },
  { id: "b64", label: "Base64 File", icon: "file" },
];

function Segmented({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <div className="mb-6 inline-flex rounded-xl border border-[#2a3247] bg-[#12161f] p-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm transition-all ${
            tab === t.id ? "bg-indigo-600 text-white shadow-lg shadow-indigo-950/50" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Icon name={t.icon} size={14} />
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** DLP-safe transfer tools: payloads dressed up as images/QR codes/base64 so exfil filters see "an image". */
export default function Covert() {
  const { push } = useToast();
  const [tab, setTab] = useState<Tab>("qr");
  return (
    <div>
      <PageHeader title="Covert Tools" subtitle="Move text through channels that only allow images." />
      <Segmented tab={tab} setTab={setTab} />
      {tab === "qr" && <QrTab />}
      {tab === "encode" && <EncodeTab />}
      {tab === "decode" && <DecodeTab />}
      {tab === "b64" && <B64Tab />}
    </div>
  );
}

/* ---------- QR Share ---------- */

function QrTab() {
  const [text, setText] = useState("");
  const [qr, setQr] = useState("");

  useEffect(() => {
    if (!text.trim()) {
      setQr("");
      return;
    }
    const to = setTimeout(() => {
      QRCode.toDataURL(text, { width: 260, margin: 2, errorCorrectionLevel: "M", color: { dark: "#0b0e14", light: "#e5e9f2" } })
        .then(setQr)
        .catch(() => setQr(""));
    }, 250);
    return () => clearTimeout(to);
  }, [text]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <Label>Payload to encode</Label>
        <Textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a URL, note, token…" />
        <p className="mt-2 text-xs text-slate-500">The QR regenerates live as you type. Keep payloads short - dense codes scan poorly.</p>
      </Card>
      <Card className="flex flex-col items-center justify-center gap-4 p-5">
        {qr ? (
          <>
            <img src={qr} alt="QR code" className="rounded-xl border border-[#2a3247]" />
            <div className="flex gap-2">
              <Btn variant="soft" size="sm" href={qr} download="payload-qr.png">
                <Icon name="download" size={14} /> Download PNG
              </Btn>
              <CopyBtn text={text} label="Copy payload" />
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">{text.trim() ? "Encoding…" : "Type a payload to see its QR code."}</p>
        )}
      </Card>
    </div>
  );
}

/* ---------- Text → Image ---------- */

/** Byte layout: RGB channels only (3 bytes/pixel), first 3 bytes = payload length. Alpha stays 255. */
function encodeToImage(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 0xffffff) throw new Error("Payload is too large for an image (max 16 MB)");
  const total = 3 + bytes.length;
  const pixels = Math.ceil(total / 3);
  const width = Math.ceil(Math.sqrt(pixels));
  const height = Math.ceil(pixels / width);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const img = ctx.createImageData(width, height);
  const data = img.data;
  // Opaque everywhere: canvas premultiplies alpha, so a transparent pixel would
  // silently zero the colour bytes and corrupt the payload.
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const len = bytes.length;
  const write = (i: number, v: number) => {
    const pixel = Math.floor(i / 3);
    const ch = i % 3;
    data[pixel * 4 + ch] = v;
  };
  write(0, (len >>> 16) & 0xff);
  write(1, (len >>> 8) & 0xff);
  write(2, len & 0xff);
  for (let i = 0; i < len; i++) write(3 + i, bytes[i]!);
  // Padding is mid-grey so the image looks like noise instead of a black block.
  for (let i = total; i < pixels * 3; i += 3) {
    const pixel = Math.floor(i / 3) * 4;
    data[pixel] = 128;
    data[pixel + 1] = 128;
    data[pixel + 2] = 128;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

function EncodeTab() {
  const { push } = useToast();
  const [text, setText] = useState("");
  const [img, setImg] = useState("");
  const [info, setInfo] = useState("");

  const encode = () => {
    if (!text) {
      push("err", "Enter some text first");
      return;
    }
    try {
      const url = encodeToImage(text);
      setImg(url);
      const bytes = new TextEncoder().encode(text).length;
      setInfo(`${bytes} bytes hidden in a PNG`);
    } catch (e) {
      push("err", `Encoding failed: ${String(e)}`);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <Label>Secret text</Label>
        <Textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="The message travels as raw pixel bytes…" />
        <div className="mt-3">
          <Btn onClick={encode}>Encode into PNG</Btn>
        </div>
      </Card>
      <Card className="flex flex-col items-center justify-center gap-3 p-5">
        {img ? (
          <>
            <img src={img} alt="Encoded payload" className="max-h-64 rounded-xl border border-[#2a3247]" />
            <Badge tone="info">{info}</Badge>
            <div className="flex gap-2">
              <Btn variant="soft" size="sm" href={img} download="payload.png">
                <Icon name="download" size={14} /> Download PNG
              </Btn>
            </div>
            <p className="max-w-xs text-center text-xs text-slate-500">
              Looks like noise. Decode it on any FYRDrop device via the <span className="text-slate-300">Image → Text</span> tab.
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-500">Encoded image appears here.</p>
        )}
      </Card>
    </div>
  );
}

/* ---------- Image → Text ---------- */

function DecodeTab() {
  const { push } = useToast();
  const [dataUrl, setDataUrl] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  const decode = () => {
    if (!dataUrl.trim()) {
      push("err", "Paste an image data URL first");
      return;
    }
    setBusy(true);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const read = (i: number) => data[Math.floor(i / 3) * 4 + (i % 3)]!;
        if (data.length < 12) throw new Error("Image too small to hold a payload");
        const len = (read(0) << 16) | (read(1) << 8) | read(2);
        if (len === 0 || len > (data.length / 4) * 3 - 3) throw new Error("No valid payload found in this image");
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = read(3 + i);
        setResult(new TextDecoder().decode(bytes));
        push("ok", "Payload decoded");
      } catch (e) {
        push("err", e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    };
    image.onerror = () => {
      setBusy(false);
      push("err", "Could not load that data URL as an image");
    };
    image.src = dataUrl.trim();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <Label>Image data URL</Label>
        <Textarea
          rows={6}
          value={dataUrl}
          onChange={(e) => setDataUrl(e.target.value)}
          placeholder="data:image/png;base64,…"
          className="mono text-[11px]"
        />
        <div className="mt-3 flex gap-2">
          <Btn onClick={decode} disabled={busy}>
            <Icon name="code" size={14} />
            {busy ? "Decoding…" : "Decode payload"}
          </Btn>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#2a3247] bg-white/5 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10">
            <Icon name="upload" size={14} />
            Upload image
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => setDataUrl(String(reader.result ?? ""));
                reader.readAsDataURL(f);
              }}
            />
          </label>
        </div>
      </Card>
      <Card className="p-5">
        <Label>Decoded text</Label>
        <Textarea rows={9} readOnly value={result} placeholder="The hidden message appears here." />
        {result && (
          <div className="mt-3">
            <CopyBtn text={result} label="Copy text" />
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- Base64 file tool ---------- */

type B64Mode = "file-encode" | "file-decode" | "cli";

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

function base64ToBytes(text: string): Uint8Array {
  const clean = text
    .replace(/^data:[^;]+;base64,/i, "")
    .replace(/-----BEGIN [^-]+-----/gi, "")
    .replace(/-----END [^-]+-----/gi, "")
    .replace(/\s+/g, "");
  if (!clean) throw new Error("empty");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(clean)) throw new Error("invalid");
  const normalized = clean.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function downloadBytes(bytes: Uint8Array, name: string, mime = "application/octet-stream") {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function B64Tab() {
  const { push } = useToast();
  const [mode, setMode] = useState<B64Mode>("file-encode");
  const [file, setFile] = useState<File | null>(null);
  const [encoded, setEncoded] = useState("");
  const [wrap, setWrap] = useState<"76" | "64" | "0">("76");
  const [b64, setB64] = useState("");
  const [fileName, setFileName] = useState("decoded.bin");
  const [decoded, setDecoded] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const encodeFile = async (f: File) => {
    setBusy(true);
    setEncoded("");
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const raw = bytesToBase64(bytes);
      const wrapped = wrap === "0" ? raw : raw.replace(new RegExp(`(.{${wrap}})`, "g"), "$1\n");
      setEncoded(wrapped);
      setFile(f);
      setFileName(`${f.name}.b64`);
      push("ok", `${f.name} encoded`);
    } catch {
      push("err", "Could not read that file");
    } finally {
      setBusy(false);
    }
  };

  const decode = () => {
    try {
      const bytes = base64ToBytes(b64);
      setDecoded(bytes);
      push("ok", `Decoded ${bytes.length} bytes`);
    } catch {
      push("err", "That is not valid Base64");
    }
  };

  const saveToFiles = async () => {
    if (!decoded) return;
    try {
      const f = new File([decoded as unknown as BlobPart], fileName || "decoded.bin");
      await api.upload([f], 0, {
        read: { scope: "everyone", userIds: [] },
        write: { scope: "private", userIds: [] },
        delete: { scope: "private", userIds: [] },
      });
      push("ok", "Saved to Files");
    } catch (e: any) {
      push("err", e?.message ?? "Upload failed");
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {(
            [
              ["file-encode", "File → Base64", "upload"],
              ["file-decode", "Base64 → File", "download"],
              ["cli", "Make Base64 with built-in tools", "code"],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition ${
                mode === id ? "border-indigo-500 bg-indigo-500/15 text-white" : "border-[#2a3247] text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon name={icon} size={12} /> {label}
            </button>
          ))}
        </div>

        {mode === "file-encode" && (
          <div>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void encodeFile(f);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center transition ${
                dragging ? "border-indigo-500 bg-indigo-500/10" : "border-[#2a3247] hover:border-indigo-500/50"
              }`}
            >
              <Icon name="upload" size={22} className="text-slate-400" />
              <span className="mt-2 text-sm text-slate-200">Drop a file here or click to choose</span>
              <span className="mt-1 text-[11px] text-slate-500">Any type. Files over ~20 MB can be slow in the browser; the commands below handle bigger ones.</span>
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void encodeFile(f);
                }}
              />
            </label>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-slate-300">Line wrap</span>
              {(
                [
                  ["76", "76 chars (classic)"],
                  ["64", "64 chars (certutil)"],
                  ["0", "Single line"],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                  <input type="radio" checked={wrap === v} onChange={() => setWrap(v)} className="accent-indigo-500" /> {label}
                </label>
              ))}
              {file && <span className="ml-auto text-[11px] text-slate-500">{file.name} · {humanSize(file.size)}</span>}
            </div>

            {file && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Btn size="sm" onClick={() => void encodeFile(file)} disabled={busy}>
                  {busy ? <Spinner size={13} /> : <Icon name="refresh" size={13} />} Encode again with this wrap
                </Btn>
                {encoded && (
                  <>
                    <CopyBtn text={encoded} label="Copy base64" />
                    <Btn
                      size="sm"
                      variant="soft"
                      onClick={() => downloadBytes(new TextEncoder().encode(encoded), `${file.name}.b64`, "text/plain")}
                    >
                      <Icon name="download" size={13} /> Download .b64
                    </Btn>
                  </>
                )}
              </div>
            )}

            {encoded && (
              <div className="mt-4">
                <Label>Base64 output</Label>
                <Textarea rows={8} readOnly value={encoded} className="mono text-[11px] break-all" />
                <p className="mt-2 text-[11px] text-slate-500">
                  {encoded.replace(/\s/g, "").length.toLocaleString()} base64 characters · about 33% larger than the file. Base64 is
                  encoding, not encryption; FYRDrop encrypts the file itself when it is stored.
                </p>
              </div>
            )}
          </div>
        )}

        {mode === "file-decode" && (
          <div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[12rem] flex-1">
                <Label>File name for the decoded bytes</Label>
                <Input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="photo.jpg" />
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#2a3247] px-3 py-2 text-xs text-slate-300 hover:text-white">
                <Icon name="upload" size={13} /> Load a .b64 file
                <input
                  type="file"
                  accept=".b64,.txt,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void f.text().then((t) => {
                      setB64(t);
                      setDecoded(null);
                    });
                  }}
                />
              </label>
            </div>
            <div className="mt-3">
              <Label>Base64 text</Label>
              <Textarea
                rows={8}
                value={b64}
                onChange={(e) => {
                  setB64(e.target.value);
                  setDecoded(null);
                }}
                placeholder="Paste base64, a data: URL, or the contents of a .b64 file"
                className="mono text-[11px] break-all"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn onClick={decode} disabled={!b64.trim()}>
                <Icon name="download" size={14} /> Decode
              </Btn>
              {decoded && (
                <>
                  <Btn variant="soft" onClick={() => downloadBytes(decoded, fileName || "decoded.bin")}>
                    <Icon name="download" size={14} /> Save {fileName || "file"}
                  </Btn>
                  <Btn variant="ghost" onClick={() => void saveToFiles()}>
                    <Icon name="folder" size={14} /> Save to Files
                  </Btn>
                </>
              )}
            </div>
            {decoded && (
              <p className="mt-3 text-[11px] text-slate-500">
                {decoded.length.toLocaleString()} bytes ready. The file is rebuilt exactly; base64 does not carry the original name,
                so set one above.
              </p>
            )}
          </div>
        )}

        {mode === "cli" && <B64Cli />}
      </Card>
    </div>
  );
}

function Cmd({ label, cmd, note, danger }: { label: string; cmd: string; note?: string; danger?: string }) {
  return (
    <div className="rounded-xl border border-[#232a3a] bg-[#0d1017] p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <CopyBtn text={cmd} label="Copy" />
      </div>
      <pre className="mono mt-1.5 overflow-x-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-slate-300">{cmd}</pre>
      {note && <p className="mt-1.5 text-[11px] text-slate-500">{note}</p>}
      {danger && <p className="mt-1 text-[11px] text-amber-400/80">{danger}</p>}
    </div>
  );
}

function B64Cli() {
  const [os, setOs] = useState<"windows" | "linux">("windows");
  return (
    <div>
      <div className="mb-3 inline-flex rounded-xl border border-[#2a3247] bg-[#0d1119] p-1">
        {(
          [
            ["windows", "Windows"],
            ["linux", "Linux"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setOs(id)}
            className={`rounded-lg px-4 py-1 text-xs transition ${os === id ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="mb-3 text-xs leading-relaxed text-slate-400">
        Every command below uses tools that ship with the operating system. Replace <span className="mono text-slate-300">file.bin</span>{" "}
        with your file. The output opens in the <span className="text-slate-200">Base64 → File</span> tab, or pipe it back with the
        decode command.
      </p>

      {os === "windows" ? (
        <div className="space-y-3">
          <Cmd
            label="PowerShell 5.1 and 7 (cleanest, no headers)"
            cmd={`[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\\path\\file.bin")) | Set-Content -NoNewline "file.b64"`}
            note="Reads the whole file into memory. Decode with the next command."
          />
          <Cmd
            label="PowerShell decode"
            cmd={`[IO.File]::WriteAllBytes("C:\\path\\file.bin", [Convert]::FromBase64String((Get-Content -Raw "file.b64")))`}
            note="Writes the exact bytes back. Works with or without line breaks in the input."
          />
          <Cmd
            label="PowerShell, single line, no BOM"
            cmd={`$b = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\\path\\file.bin")); [IO.File]::WriteAllText("file.b64", $b)`}
            note="Use this when a tool rejects the file because of a UTF-8 BOM added by Set-Content."
          />
          <Cmd
            label="certutil (present on every Windows)"
            cmd={`certutil -encode "C:\\path\\file.bin" "file.b64"`}
            note="Adds -----BEGIN CERTIFICATE----- headers and wraps at 64 characters."
          />
          <Cmd
            label="certutil decode"
            cmd={`certutil -decode "file.b64" "file.bin"`}
            note="certutil accepts its own headers. Most other decoders need them removed first."
          />
          <Cmd
            label="Strip certutil headers with PowerShell"
            cmd={`(Get-Content "file.b64" | Where-Object { $_ -notmatch '^-----' }) -join '' | Set-Content -NoNewline "clean.b64"`}
            note="Produces plain base64 that base64 -d, Node, Python or this page can read."
          />
          <Cmd
            label="cmd.exe copy of the PowerShell method"
            cmd={`powershell -NoProfile -Command "[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\\path\\file.bin')) | Set-Content -NoNewline 'file.b64'"`}
            note="Useful inside .bat files where you do not want to open a PowerShell window."
          />
          <p className="text-[11px] text-slate-500">
            Not built in on Windows but common: OpenSSL (<span className="mono">openssl base64 -in file.bin -out file.b64</span>) if
            Git for Windows or a similar toolset is installed.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <Cmd
            label="GNU coreutils base64 (almost every distribution)"
            cmd={`base64 file.bin > file.b64`}
            note="Wraps at 76 characters. Decode with: base64 -d file.b64 > file.bin"
          />
          <Cmd
            label="Single line, no wrapping"
            cmd={`base64 -w 0 file.bin > file.b64`}
            note="Better for copy-paste and JSON. BusyBox uses -w 0 as well on recent versions."
          />
          <Cmd
            label="Decode"
            cmd={`base64 -d file.b64 > file.bin`}
            note="Also accepts --decode. GNU base64 ignores line breaks but not PEM headers."
          />
          <Cmd
            label="OpenSSL (installed nearly everywhere)"
            cmd={`openssl base64 -in file.bin -out file.b64`}
            note="Add -A for a single line. Decode: openssl base64 -d -in file.b64 -out file.bin"
          />
          <Cmd
            label="BusyBox (routers, Alpine, minimal images)"
            cmd={`busybox base64 file.bin > file.b64`}
            note="Decode: busybox base64 -d file.b64 > file.bin"
          />
          <Cmd
            label="uuencode in base64 mode (sharutils)"
            cmd={`uuencode -m file.bin file.bin > file.b64`}
            note="Decode: uudecode -o file.bin file.b64. Adds a begin/end wrapper like certutil."
          />
          <Cmd
            label="Strip PEM or uuencode headers"
            cmd={`sed '/^-----/d' file.b64 | base64 -d > file.bin`}
            note="For files produced by certutil or uuencode."
          />
          <Cmd
            label="Python 3 fallback"
            cmd={`python3 -c "import base64,sys;sys.stdout.write(base64.b64encode(open(sys.argv[1],'rb').read()).decode())" file.bin > file.b64`}
            note="Not part of a minimal install, but present on most desktops. Decode with base64.b64decode."
          />
          <Cmd
            label="Perl fallback"
            cmd={`perl -MMIME::Base64 -0777 -ne 'print encode_base64($_)' file.bin > file.b64`}
            note="Decode: perl -MMIME::Base64 -0777 -ne 'print decode_base64($_)' file.b64 > file.bin"
          />
          <Cmd
            label="Check the round trip"
            cmd={`base64 -w 0 file.bin | base64 -d | cmp - file.bin && echo "identical"`}
            note="Prints identical when the encode/decode pair preserved every byte."
          />
        </div>
      )}

      <div className="mt-4 rounded-xl border border-[#232a3a] bg-[#12161f] p-3 text-[11px] leading-relaxed text-slate-500">
        Base64 turns 3 bytes into 4 characters, so the text is about a third larger than the file. It hides nothing: anyone can
        decode it. It is useful for channels that only accept text (chat, JSON, logs, e-mail). FYRDrop itself encrypts files at
        rest, so base64 is only a transport wrapper here.
      </div>
    </div>
  );
}
