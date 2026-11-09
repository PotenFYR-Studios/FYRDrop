import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../App";
import { api, type CertInfo } from "../api";
import { Icon } from "../icons";
import { Badge, Btn, Card, Empty, Input, Label, PageHeader, useToast } from "../ui";

function daysLeftTone(d: number): "ok" | "warn" | "bad" {
  return d > 30 ? "ok" : d >= 8 ? "warn" : "bad";
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Certificate hosting: generate self-signed certs or upload PEM pairs, and download them for other devices. */
export default function Certs() {
  const { push } = useToast();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  // generate form
  const [name, setName] = useState("");
  const [cn, setCn] = useState("");
  const [org, setOrg] = useState("");
  const [days, setDays] = useState(825);
  const [keyBits, setKeyBits] = useState(2048);
  const [busy, setBusy] = useState(false);

  // upload form
  const [upName, setUpName] = useState("");
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [upBusy, setUpBusy] = useState(false);

  const reload = useCallback(() => {
    api
      .certs()
      .then((r) => setCerts(r.certs))
      .catch((e) => push("err", e.message ?? "Failed to load certificates"))
      .finally(() => setLoaded(true));
  }, [push]);

  useEffect(reload, [reload]);

  const generate = async () => {
    if (!name.trim() || !cn.trim()) {
      push("err", "Name and common name are required");
      return;
    }
    setBusy(true);
    try {
      await api.generateCert({ name: name.trim(), commonName: cn.trim(), organization: org.trim() || undefined, days, keyBits });
      push("ok", `Certificate "${name.trim()}" generated`);
      setName("");
      setCn("");
      setOrg("");
      reload();
    } catch (e: any) {
      push("err", e.message ?? "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (!certFile) {
      push("err", "Choose a PEM certificate file");
      return;
    }
    if (!upName.trim()) {
      push("err", "Give the certificate a name");
      return;
    }
    setUpBusy(true);
    try {
      await api.uploadCert(certFile, keyFile, upName.trim());
      push("ok", `Certificate "${upName.trim()}" uploaded`);
      setUpName("");
      setCertFile(null);
      setKeyFile(null);
      reload();
    } catch (e: any) {
      push("err", e.message ?? "Upload failed");
    } finally {
      setUpBusy(false);
    }
  };

  const remove = async (c: CertInfo) => {
    if (!window.confirm(`Delete certificate "${c.name}"? Devices trusting it will stop trusting this hub.`)) return;
    try {
      await api.deleteCert(c.id);
      push("ok", "Certificate deleted");
      reload();
    } catch (e: any) {
      push("err", e.message ?? "Delete failed");
    }
  };

  return (
    <div>
      <PageHeader title="Certificates" subtitle="Manage the TLS certificate this instance uses for HTTPS." />

      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4">
        <span className="mt-0.5 shrink-0 text-indigo-300">
          <Icon name="shieldCheck" size={18} />
        </span>
        <p className="text-sm text-indigo-100">
          To avoid browser warnings on other devices, <span className="font-semibold">install the certificate into their trust store</span>:
          download the <span className="font-mono text-xs">.pem</span> below and add it as a trusted root (iOS/Android profile, Windows certmgr, or
          Linux <span className="font-mono text-xs">update-ca-certificates</span>).
        </p>
      </div>

      {isOwner && (
      <div className="mb-8 grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">Generate a certificate</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="home-hub" />
            </div>
            <div>
              <Label>Common name (CN)</Label>
              <Input value={cn} onChange={(e) => setCn(e.target.value)} placeholder="fyrdrop.lan" />
            </div>
            <div>
              <Label>Organization (optional)</Label>
              <Input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Home Lab" />
            </div>
            <div>
              <Label>Valid for (days)</Label>
              <Input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} />
            </div>
            <div>
              <Label>Key size</Label>
              <select
                value={keyBits}
                onChange={(e) => setKeyBits(Number(e.target.value))}
                className="w-full rounded-xl border border-[#2a3247] bg-[#12161f] px-3.5 py-2.5 text-sm text-slate-100 outline-none focus:border-indigo-500"
              >
                <option value={2048}>2048 bits (fast)</option>
                <option value={4096}>4096 bits (strong)</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <Btn onClick={() => void generate()} disabled={busy}>
              {busy ? (
                "Generating…"
              ) : (
                <>
                  <Icon name="bolt" size={15} /> Generate
                </>
              )}
            </Btn>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">Upload a PEM certificate</h2>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={upName} onChange={(e) => setUpName(e.target.value)} placeholder="existing-cert" />
            </div>
            <div>
              <Label>Certificate (.pem / .crt)</Label>
              <input
                type="file"
                accept=".pem,.crt,.cer,.text/plain"
                onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-xl border border-[#2a3247] bg-[#12161f] px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:text-white"
              />
            </div>
            <div>
              <Label>Private key (.pem, optional)</Label>
              <input
                type="file"
                accept=".pem,.key"
                onChange={(e) => setKeyFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-xl border border-[#2a3247] bg-[#12161f] px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-slate-200"
              />
            </div>
          </div>
          <div className="mt-4">
            <Btn variant="soft" onClick={() => void upload()} disabled={upBusy}>
              {upBusy ? (
                "Uploading…"
              ) : (
                <>
                  <Icon name="upload" size={15} /> Upload
                </>
              )}
            </Btn>
          </div>
        </Card>
      </div>
      )}

      {certs.length === 0 ? (
        loaded && <Empty icon="key" title="No certificates yet" hint="Generate one above to serve HTTPS, or upload an existing PEM pair." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {certs.map((c) => (
            <Card key={c.id} className="hover-lift p-5">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#2a3247] bg-white/[0.03] text-indigo-300">
                    <Icon name="key" size={15} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-white">{c.name}</div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">{c.kind}</div>
                  </div>
                </div>
                <Badge tone={daysLeftTone(c.daysLeft)}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {c.daysLeft < 0 ? "expired" : `${c.daysLeft}d left`}
                </Badge>
              </div>
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Common name</dt>
                  <dd className="truncate font-mono text-slate-300">{c.commonName}</dd>
                </div>
                {c.organization && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Organization</dt>
                    <dd className="truncate text-slate-300">{c.organization}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Serial</dt>
                  <dd className="truncate font-mono text-slate-400" title={c.serial}>
                    {c.serial.slice(0, 16)}
                    {c.serial.length > 16 ? "…" : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Key</dt>
                  <dd className="text-slate-400">{c.keyBits} bits</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Valid</dt>
                  <dd className="text-slate-400">
                    {fmtDate(c.notBefore)} → {fmtDate(c.notAfter)}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Btn size="sm" variant="soft" href={`/api/certs/${c.id}/cert`} download={`${c.name}.crt.pem`}>
                  <Icon name="download" size={14} /> Cert
                </Btn>
                {isOwner && c.hasKey && (
                  <Btn size="sm" variant="soft" href={`/api/certs/${c.id}/key`} download={`${c.name}.key.pem`}>
                    <Icon name="key" size={14} /> Key
                  </Btn>
                )}
                {isOwner && (
                  <Btn size="sm" variant="danger" onClick={() => void remove(c)}>
                    <Icon name="trash" size={14} /> Delete
                  </Btn>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
