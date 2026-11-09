import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api, type Item, type UserProfile } from "../api";
import { Icon } from "../icons";
import { Btn, Input, Label, Modal, Steps, CopyBtn, Badge, useToast } from "../ui";

/** Share wizard: details → audience → protection → lifetime → done. */
export default function ShareWizard({ item, open, onClose }: { item: Item | null; open: boolean; onClose: () => void }) {
  const { push } = useToast();
  const [step, setStep] = useState(0);
  const [note, setNote] = useState("");
  const [audience, setAudience] = useState<"anyone" | "users">("anyone");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [usePin, setUsePin] = useState(false);
  const [pin, setPin] = useState("");
  const [expiresDays, setExpiresDays] = useState(0);
  const [maxDownloads, setMaxDownloads] = useState(0);
  const [link, setLink] = useState<{ url: string; qr: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api
      .allUsers()
      .then((r) => setUsers(r.users))
      .catch(() => setUsers([]));
  }, [open]);

  if (!item) return null;
  const reset = () => {
    setStep(0);
    setNote("");
    setAudience("anyone");
    setSelectedUsers([]);
    setUsePin(false);
    setPin("");
    setExpiresDays(0);
    setMaxDownloads(0);
    setLink(null);
    setBusy(false);
  };

  const toggleUser = (id: string) =>
    setSelectedUsers((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const create = async () => {
    if (usePin && !/^\d{4,10}$/.test(pin)) {
      push("err", "Link PIN must be 4-10 digits");
      return;
    }
    if (audience === "users" && selectedUsers.length === 0) {
      push("err", "Pick at least one user, or share with anyone");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createShare(item.id, {
        note: note || undefined,
        pin: usePin ? pin : undefined,
        expiresDays: expiresDays > 0 ? expiresDays : undefined,
        maxDownloads: maxDownloads > 0 ? maxDownloads : undefined,
        allowedUserIds: audience === "users" ? selectedUsers : undefined,
      });
      const full = `${location.origin}${res.url}`;
      const qr = await QRCode.toDataURL(full, { width: 220, margin: 1, color: { dark: "#0b0e14", light: "#e5e9f2" } });
      setLink({ url: full, qr });
      setStep(4);
      push("ok", "Share link created");
    } catch (e: any) {
      push("err", e.message ?? "Failed to create link");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={`Share "${item.name}"`} wide>
      <Steps steps={["Details", "Audience", "Protection", "Lifetime", "Done"]} current={step} />

      {step === 0 && (
        <div className="space-y-4">
          <div>
            <Label>Recipient / note (shown on the public page)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. For Alice - design review" maxLength={200} />
          </div>
          <div className="rounded-xl border border-[#2a3247] bg-[#12161f] p-3 text-xs text-slate-400">
            Sharing: <span className="text-slate-200">{item.name}</span> · type <Badge tone="info">{item.type}</Badge>
          </div>
          <div className="flex justify-end">
            <Btn onClick={() => setStep(1)}>
              Next <Icon name="arrowRight" size={16} />
            </Btn>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <button
            onClick={() => setAudience("anyone")}
            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${audience === "anyone" ? "border-indigo-500/60 bg-indigo-500/10" : "border-[#2a3247] hover:border-[#3a4460]"}`}
          >
            <Icon name="globe" size={18} className="mt-0.5 text-indigo-300" />
            <div>
              <div className="text-sm text-white">Anyone with the link</div>
              <div className="text-xs text-slate-500">The token URL is enough to open it (PIN / expiry still apply).</div>
            </div>
          </button>
          <button
            onClick={() => setAudience("users")}
            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${audience === "users" ? "border-indigo-500/60 bg-indigo-500/10" : "border-[#2a3247] hover:border-[#3a4460]"}`}
          >
            <Icon name="users" size={18} className="mt-0.5 text-indigo-300" />
            <div>
              <div className="text-sm text-white">Selected users only</div>
              <div className="text-xs text-slate-500">Only the chosen profiles can open it - they must be signed in.</div>
            </div>
          </button>

          {audience === "users" && (
            <div className="anim-pop max-h-52 space-y-1 overflow-y-auto rounded-xl border border-[#2a3247] bg-[#0f131b] p-2">
              {users.length === 0 && <div className="p-2 text-xs text-slate-500">No accounts found.</div>}
              {users.map((u) => {
                const checked = selectedUsers.includes(u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() => toggleUser(u.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition ${checked ? "bg-indigo-500/15 text-white" : "text-slate-300 hover:bg-white/5"}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: u.color }}>
                        {u.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span>{u.name}</span>
                      {u.role === "owner" && <Badge tone="info">owner</Badge>}
                    </span>
                    <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? "border-indigo-400 bg-indigo-500" : "border-slate-600"}`}>
                      {checked && <Icon name="check" size={11} className="text-white" />}
                    </span>
                  </button>
                );
              })}
              <div className="flex justify-between border-t border-[#232a3a] px-1 pt-2 text-[11px] text-slate-500">
                <span>{selectedUsers.length} selected</span>
                <button className="hover:text-slate-300" onClick={() => setSelectedUsers(users.map((u) => u.id))}>
                  Select all
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <Btn variant="ghost" onClick={() => setStep(0)}>
              <Icon name="arrowLeft" size={16} /> Back
            </Btn>
            <Btn onClick={() => setStep(2)}>
              Next <Icon name="arrowRight" size={16} />
            </Btn>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#2a3247] p-3">
            <input type="checkbox" checked={usePin} onChange={(e) => setUsePin(e.target.checked)} className="h-4 w-4 accent-indigo-500" />
            <div>
              <div className="text-sm text-white">Protect with a PIN</div>
              <div className="text-xs text-slate-500">The recipient must enter this PIN before downloading.</div>
            </div>
          </label>
          {usePin && (
            <div>
              <Label>Link PIN (4-10 digits)</Label>
              <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="••••" inputMode="numeric" />
            </div>
          )}
          <div className="flex justify-between">
            <Btn variant="ghost" onClick={() => setStep(1)}>
              <Icon name="arrowLeft" size={16} /> Back
            </Btn>
            <Btn onClick={() => setStep(3)}>
              Next <Icon name="arrowRight" size={16} />
            </Btn>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Expires in (days, 0 = never)</Label>
              <Input type="number" min={0} max={365} value={expiresDays} onChange={(e) => setExpiresDays(Number(e.target.value))} />
            </div>
            <div>
              <Label>Max downloads (0 = unlimited)</Label>
              <Input type="number" min={0} max={9999} value={maxDownloads} onChange={(e) => setMaxDownloads(Number(e.target.value))} />
            </div>
          </div>
          <div className="flex justify-between">
            <Btn variant="ghost" onClick={() => setStep(2)}>
              <Icon name="arrowLeft" size={16} /> Back
            </Btn>
            <Btn onClick={create} disabled={busy}>
              {busy ? (
                "Creating…"
              ) : (
                <>
                  <Icon name="link" size={16} /> Create link
                </>
              )}
            </Btn>
          </div>
        </div>
      )}

      {step === 4 && link && (
        <div className="space-y-4 text-center">
          <img src={link.qr} alt="QR code" className="mx-auto rounded-xl border border-[#2a3247]" />
          <div className="mono break-all rounded-xl border border-[#2a3247] bg-[#12161f] p-3 text-xs text-cyan-300">{link.url}</div>
          <div className="flex flex-wrap justify-center gap-2">
            <CopyBtn text={link.url} label="Copy link" />
            <Btn variant="soft" size="sm" onClick={() => window.open(link.url, "_blank")}>
              <Icon name="external" size={14} /> Open
            </Btn>
          </div>
          <Btn variant="ghost" onClick={() => { reset(); onClose(); }}>Close</Btn>
        </div>
      )}
    </Modal>
  );
}
