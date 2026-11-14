import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
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

function Code({ children }: { children: ReactNode }) {
  return <pre className="mono overflow-x-auto whitespace-pre rounded-xl border border-[#232a3a] bg-[#0d1017] p-3 text-[11px] leading-relaxed text-slate-300">{children}</pre>;
}

const TOC: [string, IconName][] = [
  ["Getting started", "bolt"],
  ["HTTP and HTTPS", "lock"],
  ["Bundles", "grid"],
  ["Sign-in, PIN & devices", "key"],
  ["Sharing links & PIN protection", "link"],
  ["Device-to-device transfer (WebRTC)", "transfer"],
  ["Covert tools for DLP-restricted networks", "shield"],
  ["Certificates", "key"],
  ["Admin & security", "shieldCheck"],
  ["FAQ", "help"],
];

export default function Help() {
  // Other pages link straight to a section (for example Settings -> "Which one should I use?").
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [hash]);

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
            people you choose. Open the address the server prints at start, sign in with the owner account from the
            startup banner (or create your own account), and everything you add syncs live to every signed-in device.
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-400">
            <li><span className="text-slate-200">Dashboard</span> - overview of recent items and activity.</li>
            <li><span className="text-slate-200">Files / Notepad / Links / Gallery</span> - the four item types, each with its own view.</li>
            <li><span className="text-slate-200">Share wizard</span> - turn any item into a public link with optional PIN, expiry and download limits.</li>
          </ul>
        </Section>

        <Section icon="lock" title="HTTP and HTTPS">
          <p>
            FYRDrop starts on <span className="text-slate-200">plain HTTP</span>, so it works the moment it is running: no certificate to
            create, no browser warning. That is the right choice on a home or office network you trust, and whenever something in front of
            FYRDrop already provides HTTPS. The owner changes it under{" "}
            <span className="text-slate-200">Admin → Settings → HTTP &amp; HTTPS</span>: pick an option, save, restart.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Option</th>
                  <th className="py-1.5 pr-3 font-medium">Use it when</th>
                  <th className="py-1.5 font-medium">What you do</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c2334] text-slate-400">
                <tr>
                  <td className="py-2 pr-3 align-top text-slate-200">HTTP (default)</td>
                  <td className="py-2 pr-3 align-top">Trusted LAN, or a proxy / Tailscale / Cloudflare Tunnel sits in front.</td>
                  <td className="py-2 align-top">Nothing.</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 align-top text-slate-200">HTTPS, self-signed</td>
                  <td className="py-2 pr-3 align-top">You want encryption on the LAN and have no domain name.</td>
                  <td className="py-2 align-top">Choose it in Settings, restart, open the https:// address and accept the one-time warning (or install the certificate on each device).</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 align-top text-slate-200">HTTPS, your certificate</td>
                  <td className="py-2 pr-3 align-top">You have a domain name or your own CA (Let's Encrypt, company CA, mkcert).</td>
                  <td className="py-2 align-top">Paste or pick the certificate and key in Settings, restart. No warning.</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 align-top text-slate-200">Reverse proxy or tunnel</td>
                  <td className="py-2 pr-3 align-top">Reachable from the internet, or you already run Caddy, nginx, Traefik, Tailscale or Cloudflare.</td>
                  <td className="py-2 align-top">Leave FYRDrop on HTTP and let the proxy do HTTPS. Turn on "Trust reverse proxy headers".</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-slate-400">
            <span className="text-slate-200">What is different on HTTP.</span> Everything works except passkeys, which browsers only allow on
            HTTPS or localhost. Passwords and files travel unencrypted, so anyone who can listen on the network could read them: fine at home,
            not across the internet.
          </p>
          <p className="text-slate-400">
            <span className="text-slate-200">Self-signed, step by step.</span> Settings lists the names and addresses the certificate will be
            valid for (add the name people type, for example <span className="mono">drop.lan</span>). After the restart open{" "}
            <span className="mono">https://your-address:port</span>. The browser says it does not know the certificate; choose Advanced, then
            continue. To remove the warning for good, download the certificate from the same Settings card and install it as trusted on each
            device. Make a new certificate there when the machine's address changes.
          </p>
          <p className="text-slate-400">
            <span className="text-slate-200">Your own certificate.</span> Use the full chain as the certificate (your certificate first) and
            the matching private key without a passphrase. FYRDrop checks the pair before saving it. Renewing is the same step again. If a
            tool such as certbot renews files on disk, point <span className="mono">TLS_CERT_PATH</span> and{" "}
            <span className="mono">TLS_KEY_PATH</span> at them instead and restart after a renewal.
          </p>
          <p className="text-slate-400">
            <span className="text-slate-200">Behind a reverse proxy.</span> Keep FYRDrop on HTTP and set{" "}
            <span className="mono">TRUST_PROXY=1</span> (Settings → System configuration → Trust reverse proxy headers) so it sees the real
            client address and knows the visitor used HTTPS. With Caddy the whole setup is two lines, and the certificate is issued and
            renewed for you:
          </p>
          <Code>{`drop.example.com {
    reverse_proxy 127.0.0.1:3000
}`}</Code>
          <p className="text-slate-400">nginx, inside your HTTPS <span className="mono">server</span> block:</p>
          <Code>{`location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_buffering off;            # live updates (server-sent events)
    proxy_request_buffering off;    # large uploads
    client_max_body_size 100m;      # uploads are sent in chunks of at most 32 MB
}`}</Code>
          <p className="text-slate-400">
            <span className="text-slate-200">Environment variables.</span> <span className="mono">TLS_ENABLED=0</span> HTTP (default),{" "}
            <span className="mono">TLS_ENABLED=auto</span> self-signed HTTPS, <span className="mono">TLS_CERT_PATH</span> +{" "}
            <span className="mono">TLS_KEY_PATH</span> your certificate, <span className="mono">HTTP_REDIRECT_PORT=80</span> to send plain HTTP
            visitors to HTTPS. A variable that is set wins over the Settings page and locks the choice there.
          </p>
          <div className="space-y-2">
            <Faq q="I switched back to HTTP and the browser still insists on https://">
              The browser remembered "always use HTTPS" (HSTS) from when the certificate was trusted. Clear it for this address: in Chrome
              and Edge open chrome://net-internals/#hsts and delete the domain; in Firefox forget the site from History. Turning HSTS off in
              the Settings card before leaving HTTPS avoids this.
            </Faq>
            <Faq q="HTTPS is selected but the server came up on HTTP">
              The certificate could not be used (missing file, expired, or the key does not match). FYRDrop falls back to HTTP instead of
              refusing to start, and the Settings card shows the reason in red.
            </Faq>
            <Faq q="The browser shows the certificate warning on every visit">
              The address you typed is not one of the names in the certificate. Make a new self-signed certificate in Settings and add that
              name or address, or install the certificate as trusted on the device.
            </Faq>
          </div>
        </Section>

        <Section icon="grid" title="Bundles">
          <p>
            Things you add <span className="text-slate-200">together</span> stay together. Drop five files, pick a folder, add several images
            to the gallery or paste a list of links, and they appear as one <span className="text-slate-200">bundle</span>: a single card
            with a name, the number of items and the total size. Anything you add on its own stays a normal single item.
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-400">
            <li>Click a bundle to open it and work with one item the usual way (preview, share, access, delete).</li>
            <li><span className="text-slate-200">Zip</span> downloads the whole bundle as one archive. On the Files page you can also tick any items and download just those as a zip.</li>
            <li><span className="text-slate-200">Rename</span> gives the bundle a name; <span className="text-slate-200">Ungroup</span> lists its items one by one again; the trash icon moves the whole bundle to trash.</li>
            <li>A bundle of links has <span className="text-slate-200">Open all</span> and <span className="text-slate-200">Copy all</span>.</li>
            <li>When uploading several files, untick "Keep these files together" in the upload dialog to list them separately.</li>
          </ul>
        </Section>

        <Section icon="key" title="Sign-in, PIN & devices">
          <p>
            Everyone signs in with their own account. The first one is the owner account <span className="mono">admin</span>, whose one-time
            password is printed in the startup banner and has to be replaced at the first sign-in. Other people create an account on the
            sign-in page (the owner can close registration under Security).
          </p>
          <p>
            The <span className="text-slate-200">instance PIN</span> is optional and <span className="text-slate-200">off by default</span>.
            Turned on under <span className="text-slate-200">Admin → Settings → Instance PIN</span>, it puts a shared 4-10 digit code in front
            of the sign-in page: a new device has to enter it once before it can sign in or register. That is worth having when the instance
            is reachable from the internet. Turning it on or off never signs out devices that are already in.
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
            phone transfer. The <span className="text-slate-200">Share links</span> page lists every link you made with
            how often it was opened and downloaded, from which kind of device and which site; no IP addresses are kept.
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

        <Section icon="key" title="Certificates">
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
            <li><span className="text-slate-200">Devices</span> - group sessions by account, see the host name, the address the server saw and the address the device reported, the browser and OS, screen and CPU, then rename, add a MAC note or revoke. A revoked device is signed out at once.</li>
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

        

        <Section icon="fingerprint" title="Two-step sign-in, email and API keys">
          <ul className="list-disc space-y-1.5 pl-5 text-slate-400">
            <li><span className="text-slate-200">Profile → Two-step sign-in</span>: add an authenticator app or a passkey. Save the recovery codes; each works once if you lose your phone or key. Passkeys need a host name (localhost, a .local name or a domain), not an IP address.</li>
            <li><span className="text-slate-200">Email</span>: confirm an address to reset a forgotten password with "Forgot your password?" on the sign-in screen and to get notification emails. The owner sets up SMTP under Settings.</li>
            <li><span className="text-slate-200">Notifications</span>: the bell shows shares, new sign-ins, security changes and storage alerts. Choose what is also emailed under Profile → Notifications.</li>
            <li><span className="text-slate-200">API keys &amp; webhooks</span>: script FYRDrop with a personal key, or get a signed POST when your items change.</li>
          </ul>
        </Section>

        <Section icon="help" title="FAQ">
          <div className="space-y-2">
            <Faq q="I forgot the instance PIN.">
              The owner can read and change it under Admin → Settings → Instance PIN on any device that is still signed in, or turn it off
              there. When "Show sign-in secrets in the startup banner" is on, the server also prints it at every start.
            </Faq>
            <Faq q="I lost my phone and cannot pass the second step.">
              Use one of your recovery codes. Without one, ask the owner to reset your two-step sign-in from Admin → Users.
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
              so even big files work on flaky connections. If the tab closes or the server restarts, the upload appears
              under Unfinished uploads on the Files page; pick the same file again to continue where it stopped.
            </Faq>
          </div>
        </Section>
      </div>
    </div>
  );
}
