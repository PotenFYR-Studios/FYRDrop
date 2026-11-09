import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { Card, PageHeader } from "../ui";

function Section({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <Card className="scroll-mt-20 p-6" >
      <h2 id={title.toLowerCase().replace(/[^a-z0-9]+/g, "-")} className="mb-3 flex items-center gap-2.5 text-lg font-semibold text-white">
        <span className="shrink-0 text-indigo-300"><Icon name={icon} size={20} /></span> {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-300">{children}</div>
    </Card>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-[#2a3247] bg-[#12161f]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-slate-200 transition hover:bg-white/5"
      >
        {q}
        <span className={`shrink-0 text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          <Icon name="chevronDown" size={16} />
        </span>
      </button>
      {open && <div className="anim-pop border-t border-[#2a3247] px-4 py-3 text-sm leading-relaxed text-slate-400">{children}</div>}
    </div>
  );
}

const TOC: [string, IconName][] = [
  ["Getting started", "bolt"],
  ["PIN & devices", "key"],
  ["Sharing links & PIN protection", "link"],
  ["Device-to-device transfer (WebRTC)", "transfer"],
  ["Covert tools for DLP-restricted networks", "shield"],
  ["Certificates", "lock"],
  ["Admin & security", "shieldCheck"],
  ["FAQ", "help"],
];

export default function Help() {
  return (
    <div className="anim-page">
      <PageHeader
        title="Help & documentation"
        subtitle="Setup, sharing and admin basics."
      />

      <Card className="mb-6 p-5">
        <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">On this page</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {TOC.map(([t, icon]) => (
            <a
              key={t}
              href={`#${t.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#2a3247] bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-500/50 hover:text-white"
            >
              <Icon name={icon} size={13} /> {t}
            </a>
          ))}
        </div>
      </Card>

      <div className="space-y-5">
        <Section icon="bolt" title="Getting started">
          <p>
            FYRDrop is a self-hosted hub for sharing files, text snippets and links between your own devices - and with
            people you choose. After first startup you sign in with the instance PIN, create a profile, and everything
            you add syncs live to every signed-in device.
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-400">
            <li><span className="text-slate-200">Dashboard</span> - overview of recent items and activity.</li>
            <li><span className="text-slate-200">Files / Notepad / Links / Gallery</span> - the four item types, each with its own view.</li>
            <li><span className="text-slate-200">Share wizard</span> - turn any item into a public link with optional PIN, expiry and download limits.</li>
          </ul>
        </Section>

        <Section icon="key" title="PIN & devices">
          <p>
            The instance creates one PIN (4-10 digits) on first boot and prints it in the startup banner. Entering that
            PIN pairs the device: it becomes a named <span className="text-slate-200">device session</span> and stays
            paired until it expires or is revoked. Signing in to an account comes after pairing.
          </p>
          <p className="text-slate-400">
            The device is named automatically when the page opens: the server asks your network for the host name of this
            address, and falls back to the browser and system name when the network has no record. Admins review every session
            under <span className="text-slate-200">Devices</span> - name, host name, address, browser, last seen - and can
            revoke any of them with one click. A device holds one account at a time; use Switch account to change who is signed in.
          </p>
        </Section>

        <Section icon="link" title="Sharing links & PIN protection">
          <p>
            Any item can be published via the share wizard. Options:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-400">
            <li><span className="text-slate-200">Note</span> - a short message shown on the public page.</li>
            <li><span className="text-slate-200">PIN protection</span> - the recipient must enter a 4-10 digit PIN before the download link works. The PIN is verified server-side on every download.</li>
            <li><span className="text-slate-200">Expiry</span> - the link dies automatically after N days.</li>
            <li><span className="text-slate-200">Max downloads</span> - after N downloads the link returns "limit reached".</li>
          </ul>
          <p className="text-slate-400">
            Recipients don't need an account - public links work in any browser, and a QR code is generated for easy
            phone transfer.
          </p>
        </Section>

        <Section icon="transfer" title="Device-to-device transfer (WebRTC)">
          <p>
            The <span className="text-slate-200">Device Transfer</span> page connects two of your signed-in devices
            directly over WebRTC. Signalling (offer/answer/ICE exchange) goes through this server, but the file data
            itself flows peer-to-peer - it never touches the hub's disk.
          </p>
          <p className="text-slate-400">
            Both devices must be online and signed in at the same time. Perfect for quick AirDrop-style handoffs on
            networks where cloud transfers are blocked.
          </p>
        </Section>

        <Section icon="shield" title="Covert tools for DLP-restricted networks">
          <p>
            Corporate DLP (data-loss-prevention) proxies often block file uploads and common transfer services. The
            <span className="text-slate-200"> Covert Tools</span> page offers low-profile ways to move data through
            channels those proxies usually allow:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-400">
            <li><span className="text-slate-200">Text/URL items</span> - small payloads ride as ordinary JSON API calls.</li>
            <li><span className="text-slate-200">Encoded text</span> - base64/deflate packing keeps content inspectable-but-plain.</li>
            <li><span className="text-slate-200">WebRTC transfer</span> - direct browser-to-browser, no upload request at all.</li>
          </ul>
          <p className="text-slate-400">
            Use responsibly and only within the policies of your organisation - these tools bypass bottlenecks, not
            authorisation.
          </p>
        </Section>

        <Section icon="lock" title="Certificates">
          <p>
            FYRDrop can generate self-signed TLS certificates (choose common name, organisation, validity and key
            size) or accept uploaded certs/keys. Generated and uploaded certificates are listed with serial, expiry
            countdown and whether the private key is held.
          </p>
          <p className="text-slate-400">
            Self-signed certs will show a browser warning on first visit - trust them per-device, or use a real CA
            certificate uploaded here if you have one. Certificates never leave the server.
          </p>
        </Section>

        <Section icon="shieldCheck" title="Admin & security">
          <p>
            Admin pages cover analytics, storage cleanup, user management and security settings:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-400">
            <li><span className="text-slate-200">IP whitelist</span> - restrict access to trusted addresses; everyone else is refused at the edge.</li>
            <li><span className="text-slate-200">User blocks</span> - instantly disable an account without deleting its items.</li>
            <li><span className="text-slate-200">Activity log</span> - filter every sign-in, upload, download, share link and admin action by category, status or account, and expand a row for the raw details.</li>
            <li><span className="text-slate-200">Devices</span> - group sessions by account, see the host name, the address the server saw and the address the device reported, the browser and OS, screen and CPU, then rename, add a MAC note or revoke. Revoking asks for the PIN again.</li>
            <li>
              <span className="text-slate-200">Addresses</span> - the server records the address it actually sees on the socket. Behind a reverse proxy or Docker bridge that is not the device's LAN address, so the row is marked (proxy, docker bridge, loopback) and the address the browser reports over WebRTC is shown beside it when the browser allows it.
            </li>
            <li>
              <span className="text-slate-200">MAC annotations</span> - HTTP requests cannot see a device's MAC address
              (it is not transmitted past the local network segment), so admins manually annotate sessions with MAC
              notes where the local network makes that useful - e.g. matching DHCP leases.
            </li>
          </ul>
        </Section>

        

        <Section icon="help" title="FAQ">
          <div className="space-y-2">
            <Faq q="I forgot the admin PIN. Can I recover it?">
              No - the PIN is stored hashed and cannot be recovered. Reset the instance (delete its data directory) and
              run setup again, then re-add your items.
            </Faq>
            <Faq q="Why do I need a new profile on every device?">
              Accounts are per-device by design: a phone and a laptop can have distinct identities, so admin block and
              session lists stay meaningful. Name them the same if you prefer.
            </Faq>
            <Faq q="Do share links keep working after the item expires?">
              No. When the underlying item expires or is deleted, its public links return "not found" immediately.
            </Faq>
            <Faq q="Can the recipient see my PIN when I share a protected link?">
              Only if you tell them. The PIN is never embedded in the share URL - send it over a different channel
              (call, SMS, in person).
            </Faq>
            <Faq q="Does device transfer work across the internet?">
              WebRTC will traverse NATs via the signalling server where possible, but strict symmetric NATs or
              firewalls may block the direct path. On the same LAN it always works.
            </Faq>
            <Faq q="How large can uploads be?">
              Up to the per-file limit the admin set at startup (default 512 MB). Larger files are uploaded in chunks,
              so even big files work on flaky connections.
            </Faq>
          </div>
        </Section>
      </div>
    </div>
  );
}
