# 📡 FYRDrop

**Self-hosted sharing hub** - share files, notes, links and images between your own devices and people you trust. Real accounts with two-step sign-in, an optional instance PIN, AES-256-GCM encrypted at rest. Starts on plain HTTP and switches to HTTPS in two clicks. Runs anywhere: Docker, Bun, Node-compatible hosts, Pterodactyl / Pelican / FeatherPanel eggs.

```
Files · Notepad · Links · Gallery · Certificates · P2P Transfer · Covert Tools · Federation
```

---

## ✨ Features

| Area | What you get |
| --- | --- |
| **Files** | Drag & drop / paste multi-upload, auto thumbnails, expiry, download counters, chunked uploads for huge files (streamed straight to disk) that **resume after a reload, a closed tab or a server restart** |
| **Notepad** | Shared, editable notes with per-note read/write/delete access; import text, Markdown, HTML, RTF, Word and **PDF** (text layer, extracted in the browser) |
| **Links** | Saved URLs with local monogram tiles (no third-party favicon requests), one-click open/copy, pinnable to the dashboard |
| **Gallery** | Image grid with WebP thumbnails, lightbox, realtime updates |
| **Share links** | Token-gated public links (`/s/<token>`) with optional per-link PIN (signed, short-lived grant - never in the URL), recipient note, expiry and atomic download caps. A **Share links** page shows opens, downloads, unique visitors, devices and referring sites per link - without storing IP addresses |
| **Certificates** | Generate self-signed TLS certificates in-app or upload existing PEM pairs; every signed-in user can download the public cert, only the owner can download private keys |
| **Device transfer** | True peer-to-peer WebRTC file transfer between paired devices (server only does signaling - files never touch the server) |
| **Covert tools** | QR transfer, lossless text-to-image pixel encoding and base64 wrapping for networks where DLP software blocks normal file sharing |
| **Cluster** | Pair instances with mutual approval and X25519-derived keys, browse and push items, and keep **verified replicas** of your items on other nodes with automatic rebalancing and self-repair |
| **Backups** | Encrypted (passphrase) or plain tar backups of the database, keys and settings, optionally with every stored file; scheduled backups with retention; restore from a local or uploaded backup with rollback |
| **Notifications** | Bell inbox for shares, sign-ins, security changes, storage and instance alerts; optional email copies per event |
| **API & webhooks** | Personal API keys (read or read + write) and signed webhooks for item and share events |
| **Bundles** | Things added together stay together: several files, a folder, a set of images or a pasted list of links become one bundle card with a name, a count and a total size. Open it, download it as one `.zip`, rename it, ungroup it or trash it in one go. Anything added alone stays a single item; any selection on the Files page can also be downloaded as a zip |
| **Accounts** | Each person signs in to their own account (or registers one). An optional instance PIN can be put in front of the sign-in page. The owner account sees every account and device, and the profile page lists your own devices |
| **Admin** | Analytics, a **Devices** page that ties every session to its account (rename, MAC note, revoke), a filterable **Activity log** with actor/target/IP and expandable details, storage breakdown & safe orphan cleanup, security center, instance settings, account management |
| **Realtime** | A single shared SSE stream per browser tab keeps every page live |

### Security

- **Account sign-in, optional instance PIN.** Every person signs in to an account (argon2id passwords, optional TOTP or passkey). The owner can also turn on an **instance PIN** under Admin → Settings: a shared code a new device must enter before it even sees the sign-in page - useful when the instance is reachable from the internet. It is **off by default**. The session is **rotated** at account sign-in, so a pre-login token can't be reused (no session fixation), and a device that has not signed in yet only holds a 24-hour session.
- **Owner account with a one-time password.** First boot creates the `admin` account and prints its one-time password in the startup banner. It must be replaced at first sign-in; nothing else on the admin surface works until then.
- **Progressive lockout per username** after 5 wrong passwords, independent of IP, and login errors never reveal whether a username exists. Share-link PINs are locked out the same way.
- **AES-256-GCM at rest** - uploads, notes, links and certificate private keys are encrypted with a per-instance master key (`data/keys/master.key`). Nothing readable on disk without it.
- **HTTP by default, HTTPS when you want it** - a new instance serves plain HTTP so it works immediately on a trusted network or behind a proxy. **Admin → Settings → HTTP & HTTPS** turns on HTTPS with a self-signed certificate (valid for the machine's names and addresses) or with your own certificate, which is validated before it is saved. A broken certificate never locks you out: the server falls back to HTTP and says why. See [HTTP and HTTPS](#-http-and-https).
- **OWASP hardening** - strict CSP (`default-src 'self'`), `X-Frame-Options: DENY`, nosniff, referrer policy, CSRF origin checks on all mutating API calls, rate limits, body limits, no stack traces to clients, path-safe stored filenames.
- **Safe inline serving** - only images, audio, video, PDF and plain text render inline; HTML/SVG/JS uploads always download (`Content-Disposition: attachment`), so an uploaded file can't XSS the hub.
- **Per-item access model** - every item has read / write / delete scopes (`everyone`, `selected`, `private`). New items default to *everyone can read, only the uploader (and owner) can edit or delete*. Write/delete never exceed read.
- **Honest client IPs** - `X-Forwarded-For` is ignored unless `TRUST_PROXY=1`, so rate limits and the IP whitelist can't be spoofed.
- **Stateless signed sessions** - HMAC-SHA256 tokens (no DB write per request), instant device revocation, per-user blocking with audit trail.
- **Two-step sign-in** - optional authenticator-app codes (TOTP) and passkeys / security keys as a second factor, with one-time recovery codes. The second step is bound to the device that passed the password step; codes cannot be replayed. The owner can reset a person's second factor.
- **Password reset by email** - with SMTP configured, people confirm an address and can reset a forgotten password through a single-use link that expires after 30 minutes. Links are built from the configured public URL, never from the request's Host header, and the token travels in the URL fragment.
- **Bounded memory** - rate-limit maps, upload registries and the audit log are capped and swept; unfinished chunked uploads are kept for 7 days so they can be resumed, then removed.
- **Activity log** - every sign-in, upload, download, share link, access change, certificate action, storage cleanup, cluster join and account change is recorded with the account that did it, the target, the client IP and a machine-readable detail blob. Filter by category, status, time range or account; new events arrive live. Admin → Security keeps a short recent view with a link to the full log.
- **Device inventory** - Admin → Devices lists every session with its account chip, host name, address plus address source, browser/OS, screen, first and last seen dates and MAC. Rename a device, annotate it, or revoke it; a revoked device is signed out at once. Each person sees the same list for their own sessions under Profile.
- **Automatic device identity** - opening the app names the device before anyone signs in: the server resolves the host name of the client address through DNS and the OS resolver, and falls back to the browser and system name. The page also reports platform, screen, time zone, language, CPU threads, memory and, when the browser allows it, a local IPv4 gathered from WebRTC ICE candidates. Everything is stored with the session, not in a cookie.
- **Addresses and MAC** - the address column is always what the server saw on the socket, tagged `connection`, `proxy`, `docker bridge` or `loopback`, so a wrong-looking address is explained instead of silently trusted. Browsers cannot read the MAC address; on bare metal the app reads it from the server's neighbour table (ARP), and inside Docker it says so and relies on the manual MAC note. Run with host networking on Linux (see `docker-compose.yml`) for real LAN addresses and MACs.

> **About MAC addresses:** HTTP cannot see client MAC addresses (they die at the first hop). FYRDrop shows IP + user-agent per connection and lets admins **annotate devices with their MAC** in Admin → Connections for LAN inventory.

---

## 🚀 Quick start (Docker)

```bash
docker run -d \
  --name fyrdrop \
  -p 3000:3000 \
  -v fyrdrop-data:/app/data \
  ghcr.io/potenfyr-studios/fyrdrop:latest
```

Or with docker compose:

```bash
git clone https://github.com/PotenFYR-Studios/FYRDrop
cd FYRDrop && docker compose up -d
```

Open `http://localhost:3000`, then:

1. **Read the startup banner** (`docker logs fyrdrop`) - it prints the owner login (`admin` + one-time password).
2. Sign in as `admin` and set a real password.
3. Other people open the same address and **create their own account** - or sign in to an existing one.
4. Optional: turn on **HTTPS** and the **instance PIN** under Admin → Settings.

## 🔒 HTTP and HTTPS

FYRDrop starts on **plain HTTP**. That is the right setup on a network you trust and whenever something in front already provides HTTPS. Everything works over HTTP except passkeys, which browsers only allow on HTTPS or `localhost`.

| You want | Do this |
| --- | --- |
| **HTTP** (default) | Nothing. |
| **HTTPS, self-signed** - encryption on the LAN, no domain name | Admin → Settings → **HTTP & HTTPS** → *HTTPS, self-signed* → Save → Restart. Open `https://<address>:3000` and accept the one-time browser warning, or download the certificate from the same card and install it as trusted on each device. Env: `TLS_ENABLED=auto`. |
| **HTTPS, your certificate** - Let's Encrypt, company CA, mkcert | Same card → *HTTPS, your certificate* → paste or pick the full-chain certificate and the private key (no passphrase) → Save → Restart. The pair is checked first (readable, not expired, key matches). Env: `TLS_CERT_PATH` + `TLS_KEY_PATH` for files that a tool such as certbot renews. |
| **A reverse proxy or tunnel does HTTPS** - Caddy, nginx, Traefik, Tailscale, Cloudflare | Keep FYRDrop on HTTP and set `TRUST_PROXY=1` so it sees the real client address and scheme. |

Good to know:

- Changes apply after a restart; the Settings card shows what is saved versus what is running and offers the restart.
- `HTTP_REDIRECT_PORT=80` (or the field in the card) also listens on plain HTTP and redirects to the HTTPS address.
- If a certificate is missing, expired or does not match its key, the server starts on HTTP instead of refusing to start, and the card shows the reason.
- HSTS is only sent over HTTPS. Turn it off in the card before going back to HTTP, or clear it in the browser (`chrome://net-internals/#hsts`).
- An environment variable that is set wins over the Settings page and locks the choice there.

Caddy (certificate issued and renewed for you):

```
drop.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

nginx, inside your HTTPS `server` block:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_buffering off;            # live updates (server-sent events)
    proxy_request_buffering off;    # large uploads
    client_max_body_size 100m;      # uploads are sent in chunks of at most 32 MB
}
```

The same guide is in the app under **Help → HTTP and HTTPS**.

The container health check hits `/health` with `curl` (installed in the image), so `docker ps` shows a truthful `healthy` status.

## 🛠 Development

Requires [Bun](https://bun.sh) ≥ 1.1.

```bash
bun install
bun run dev          # API server on :3000 (watch mode)
bun run dev:client   # Vite dev server on :5173 (proxies /api)
bun run typecheck    # tsc --noEmit
bun run build        # production client bundle → dist/public
bun run start        # serve API + built client on :3000
```

## 🐳 Docker image

Multi-stage build on `oven/bun` (debian), multi-arch (`linux/amd64`, `linux/arm64`), published to GHCR on every push to `main` and every `v*` tag. The runtime stage installs **production dependencies only** (no Vite/TypeScript), plus `tini` and `curl` for the health check.

The **GHCR cleanup** workflow (`.github/workflows/ghcr-cleanup.yml`) removes the untagged images each push to `main` leaves behind - weekly and after every publish - while keeping the newest 3 and never touching a manifest that a tagged multi-arch image still uses. Run it by hand from the Actions tab; manual runs are a dry run unless you untick it.

Every variable below except `DATA_DIR` and `NODE_ENV` can also be set in **Admin → Settings → System configuration** (stored in `DATA_DIR/config.json`). A variable that is set wins over the saved value; the admin page shows which variable is in charge and locks that field. These settings are read when the server starts: saving one marks it **restart pending** until the next start, and the page offers **Restart now**.

| Env var | Admin field | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` / `SERVER_PORT` | Port | `3000` | Listen port (wings injects `SERVER_PORT`) |
| `HOST` | Interface | `0.0.0.0` | Bind address |
| `DATA_DIR` | - (shown read-only) | `./data` | SQLite DB, uploads, keys, certs, TLS, `config.json` |
| `TLS_ENABLED` | HTTPS mode | `0` | `0` = plain HTTP (default); `auto`/`1` = HTTPS with a self-signed certificate; `custom` = HTTPS with your certificate |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | Certificate / key path | - | Bring your own PEM cert/key (turns HTTPS on) |
| `TLS_COMMON_NAME` | TLS common name | `fyrdrop.local` | Extra name in the auto-generated cert |
| `HTTP_REDIRECT_PORT` | HTTP redirect port | `0` | With HTTPS on: also listen on this plain-HTTP port and redirect to HTTPS |
| `SESSION_TTL_DAYS` | Session length | `30` | Device session lifetime |
| `TRUST_PROXY` | Trust reverse proxy headers | `0` | Set to `1` only behind a trusted reverse proxy so `X-Forwarded-For` is used |
| `CLUSTER_URL` | Cluster address | detected LAN address | How other cluster nodes reach this one (set it in Docker with a published port) |
| `TAILSCALE_HOSTNAME` | Tailscale host name | - | `machine.tailnet.ts.net` behind `tailscale serve`; proxy headers are trusted |
| `CLOUDFLARE_TUNNEL_TOKEN` | Cloudflare tunnel token (write-only) | - | Behind a Cloudflare tunnel: TLS ends at the edge, proxy headers are trusted |
| `CLOUDFLARE_HOSTNAME` | Cloudflare tunnel host name | - | Public tunnel host name shown at boot |
| `THUMB_THREADS` | Thumbnail threads | `1` | Threads for thumbnail generation, 1-4 (keep 1 on a Pi) |
| `UPDATE_REPO` | Update source | `PotenFYR-Studios/FYRDrop` | GitHub `owner/repo` checked for releases |
| `FYRDROP_MANAGED` | Restarted by a process manager | off | systemd / Docker / pm2 restarts the server, so the restart helper does not start one |
| `MAX_UPLOAD_MB` | Upload limit for a new instance | `512` | Seeds the first boot; the live limit is under Instance → Upload limit |
| `FYRDROP_MAIL_OUTBOX` | Mail outbox directory | - | Development: write emails as JSON files instead of sending |
| `NODE_ENV` | - | - | `production` caches the app shell |

## 🧩 Panel eggs

| Panel | Egg | Import |
| --- | --- | --- |
| Pterodactyl 1.x | `eggs/pterodactyl/fyrdrop-egg.json` | Egg → Import |
| Pelican (Wings ≥1.11) | `eggs/pelican/fyrdrop-egg.json` | Import directly (or re-import the Pterodactyl egg) |
| FeatherPanel | `eggs/feather/fyrdrop-egg.json` | Import; if your version rejects it, import the Pterodactyl egg instead |

Eggs use the official `ghcr.io/potenfyr-studios/fyrdrop` image - no runtime install needed. Data persists under `/home/container/data`. Configurable variables: max upload size, HTTPS mode (plain HTTP by default), TLS CN, session TTL. Releases also attach ready-made `fyrdrop-*-egg.json` files.

## 📦 Standalone binaries

Every release ships standalone executables (Bun compile) for **linux x64/arm64, Windows x64, macOS x64/arm64**, plus a `fyrdrop-client-<tag>.tar.gz` bundle:

```bash
tar -xzf fyrdrop-v1.0.0-linux-x64.tar.gz
tar -xzf fyrdrop-client-v1.0.0.tar.gz -C dist/public   # client bundle → ./dist/public
PORT=3000 ./fyrdrop-linux-x64          # http://localhost:3000 (TLS_ENABLED=auto for HTTPS)
```

### Accounts: owner vs normal user

- The **owner account** is `admin`, created at first boot with a one-time password printed in the banner. It must be changed at first sign-in.
- Everyone else **registers an account** on a paired device (username + password). An owner can disable registration in Admin → Settings.
- Admin pages (analytics, connections, storage, users, security, cluster, settings) are hidden from normal users *and* enforced server-side (`requireOwner`).
- Admin → Users gives per-account **usage stats (items, bytes, downloads, devices, last IP)** plus edit, block/unblock, sign-out-everywhere, **reset password** (returns a one-time temporary password), and delete - optionally purging that account's items.

### Share audiences

The share wizard lets you pick **anyone with the link** or **selected accounts only**. Restricted links require a signed-in FYRDrop account on the access list; anonymous visitors see a "restricted" page with a sign-in shortcut. Combine with a link PIN for two-factor sharing - the PIN is verified once and exchanged for a 15-minute signed grant, so it never lands in URLs or access logs.

## 🗄 Storage units & quotas

Uploads land on the **storage unit with the most free space** - point a unit at any local path or mounted volume:

- Admin → Storage → **Add unit** opens a **host filesystem browser** (drives on Windows, `/` on POSIX, writable flags, free-space readout) so you can pick a directory; absolute paths can also be typed.
- Each unit shows used/free space; units can only be removed once empty.
- **Delete orphans** only removes files that no database row references *and* that are older than 10 minutes - an in-flight upload can never be swept.
- An **instance quota** (MB, 0 = unlimited) gates uploads and cluster pushes, and free space is advertised to cluster peers so they can refuse with a clear "add storage" message.

## 🧾 Activity log & devices

- **Activity** (`/admin/logs`) answers "who did what, and to what": actor account, target item/account/device, client IP, category, status and an expandable JSON detail block. Categories cover sign-in, accounts, devices, items, share links, certificates, storage, cluster, federation, security and system events.
- Entries stream in live over the existing SSE connection; pause the feed with the Live toggle. Filters: free-text search, category, status (failed / warnings / errors) and time range.
- **Devices** (`/admin/devices`) replaces the old plain connections table. It groups sessions by account, shows browser/OS parsed from the user agent, first/last seen, expiry, MAC note and a current-device badge. Details opens a panel to rename the device, add a MAC note, jump to the account or open that account's activity.
- The same device list is shown to each person under **Profile -> Your devices**, where they can revoke their own sessions. Account pages link back into Devices, and log rows link to both the account and its devices.

## 📦 Large files

Files over 32 MB must use the chunked path (`/api/items/upload/begin` → `PUT …/chunk/:id/:index` → `/finish`). Uploads in progress are stored in the database, so they survive a page reload and a server restart: the Files page lists **Unfinished uploads**, and picking the same file again (or pressing Resume) continues with the chunks the server does not have yet. `GET /api/items/upload/pending` lists them; `begin` with the same `fingerprint` (or a `resumeId`) returns the chunks already received. Chunks are streamed to disk, never held in memory, and assembled with a streamed AES-256-GCM container that declares its format in the header (`FDCHUNK1`). On boot the server **verifies and repairs** files written by older versions in the legacy raw-append layout, so existing large uploads keep working after an upgrade.

## 🔗 Clusters

Link multiple FYRDrop instances with strong keys so they can browse each other's content and pool storage - same LAN or across networks (use HTTPS/Tailscale/Cloudflare Tunnel between them):

1. Instances announce themselves on the local network (multicast and broadcast every 20 s) and can be probed with **Scan network**. The packet carries only the node id, name, URL and public key. Set `CLUSTER_URL` when running in Docker with a published port, otherwise the beacon advertises the container address.
2. **Connect** on the discovered instance (or paste its address) sends a link request. The other admin sees who asked, from which address, and picks **Approve** or **Reject**.
3. The requesting admin then approves too. **Both approvals are required before either side stores a link.** The two admins see the same pair fingerprint and can compare it out of band.
4. The link key is never sent over the wire: each side contributes an ephemeral X25519 key and both derive the same 32-byte key with three Diffie-Hellman results. Payloads are sealed with **AES-256-GCM** and signed with **HMAC-SHA256** using that key, so cross-node traffic stays private and tamper-evident even on plain HTTP. The key is encrypted at rest and destroyed on unlink.

Manual pairing still works by entering the other instance's address; there is no code to copy.

From Admin → Cluster you can **refresh** a node's manifest (items + storage), **push** local items into a peer's storage, and **unlink**. Only items readable by everyone are advertised and transferable; per-user cross-instance access is not part of this version. Unlinking asks the peer to hand back everything, deletes the copies, destroys the link key on both sides, and removes any pending requests. Unlinking triggers a **reclaim**: the peer hands back everything you pushed into its storage, deletes its copies, and both sides forget the link. If the peer can't be reached, force-unlink is offered with an explicit data-loss warning. Storage pressure (quota/full disk) is reported as a 507 with `needsSpace: true`, so the UI tells you exactly which node needs more space.

### Replicas & rebalancing

Admin → Cluster → **Replicas & rebalancing** keeps copies of local items on linked nodes. Choose how many copies (per item, on other nodes), whether every item or only items with a label are copied, how much free space each node must keep, and how much may be sent per pass. Every maintenance pass (or **Run a pass now**):

- places missing copies on the node with the most free space,
- verifies copies by SHA-256 on the peer and replaces missing or altered ones,
- restores a local item whose file went missing from a healthy copy,
- removes copies of deleted or expired items and trims extra copies,
- moves copies off a node that dropped below its free-space headroom.

Copies are private items on the peer, hidden from its lists and never copied again. They travel over the sealed cluster channel, so items over 64 MB are not copied. Unlinking a node hands its copies back like any other reclaim.

## 💾 Backups

Admin → **Backups** creates a snapshot of the database (`VACUUM INTO`, consistent while the server runs), the keys directory, `config.json`, TLS files, certificates, thumbnails and - optionally - every stored file. With a passphrase the archive is a `.fyb` container (scrypt + AES-256-GCM in authenticated 1 MB frames; truncation and tampering are detected). Without one it is a standard `.tar`. Backups contain the master key, so encrypt any backup that leaves the server.

Automatic backups run on a schedule (every N hours, keep the last N, metadata only or with files). **Restore** verifies the whole archive, unpacks it into `restore_staging`, and swaps it in at the next start before SQLite opens; the replaced data is kept in `restore_previous/<time>` (the two most recent are kept), and any failure during the swap puts the old data back. Backups from another machine can be uploaded from the same page.

## 🔑 API keys & webhooks

Profile → **API keys & webhooks**. A key is sent as `Authorization: Bearer fyd_…`; read keys can only `GET`, write keys can also create, change and delete. Keys never reach admin, backup, cluster or account-security endpoints and cannot create keys or webhooks. Only a SHA-256 of the key is stored.

Webhooks receive `POST` JSON `{"id","event","createdAt","data"}` for `item.created`, `item.updated`, `item.deleted`, `share.created` and `share.downloaded` on your own items. Verify `X-FYRDrop-Signature`:

```
sha256=hex(HMAC_SHA256(secret, X-FYRDrop-Timestamp + "." + raw_body))
```

Failed deliveries are retried after 10 s, 1 min and 5 min with the same `X-FYRDrop-Delivery` id; after 20 failures in a row the hook turns itself off. Redirects are not followed, link-local / metadata addresses are always refused, and only the instance owner may target loopback or private-network addresses.

## ✉️ Email

Settings → **Email (SMTP)** sets the relay (STARTTLS, TLS or plain for LAN relays), the sender and the public address of the instance. Email is used for address confirmation codes, password reset links and the notifications people opt into. For development, `FYRDROP_MAIL_OUTBOX=<dir>` writes each message as JSON into that directory instead of sending it.

## ⚙️ Scaling

FYRDrop is **stateless by design** - sessions are HMAC-signed tokens, so replicas verify independently:

- **1 replica** comfortably serves hundreds of concurrent users on a single node.
- **N replicas** behind any load balancer (nginx/Traefik/Caddy) scale to very large user counts: point them all at the same `DATA_DIR` volume for SQLite, and new logins/anonymous endpoints are protected by the shared IP whitelist.
- Realtime SSE and WebRTC signaling are per-instance; with a load balancer that's fine for chat-style updates, but for massive fan-out put an STUN/TURN-friendly setup in front.
- The honest caveat: SQLite caps single-node write throughput (~10k writes/s). For a true *1,000,000 concurrent users* deployment, run many stateless replicas (reads scale linearly), keep a single writer or shard instances per tenant, and front it with a CDN for static assets. The architecture (stateless tokens, streaming uploads/downloads, chunked transfers) is built so that step requires no application changes.

## 🌐 Hosting options

### Local (plain)

```bash
bun install && bun run build && bun run start   # http://localhost:3000
```

### Docker Compose (local)

`docker-compose.yml` ships a production-ready stack (volume, healthcheck, plain HTTP on port 3000; HTTPS is one setting away). Just `docker compose up -d`.

### Tailscale (private mesh - recommended for personal use)

```bash
TAILSCALE_AUTHKEY=tskey-auth-xxx \
TAILSCALE_HOSTNAME=fyrdrop.your-tailnet.ts.net \
docker compose -f docker-compose.yml -f docker-compose.remote.yml --profile tailscale up -d
```

- The sidecar joins your tailnet and runs `tailscale serve` (config in `deploy/tailscale-serve.json`) proxying `https://fyrdrop.<tailnet>` → the app. Enable Funnel in the serve config to expose it publicly.
- On bare metal instead: run the app on :3000 and `tailscale serve https / http://localhost:3000`, then set `TAILSCALE_HOSTNAME=your-name.ts.net` so the boot banner prints the URL.
- CSRF/origin checks pass automatically - Tailscale Serve preserves the Host header.

### Cloudflare Tunnel (public zero-trust)

```bash
CLOUDFLARE_TUNNEL_TOKEN=eyJ... \
CLOUDFLARE_HOSTNAME=fyrdrop.example.com \
TLS_ENABLED=0 TRUST_PROXY=1 \
docker compose -f docker-compose.yml -f docker-compose.remote.yml --profile cloudflare up -d
```

- `cloudflared` connects your tunnel to the app; TLS terminates at Cloudflare's edge (hence `TLS_ENABLED=0`).
- The app detects the tunnel at boot (`CLOUDFLARE_TUNNEL_TOKEN`) and logs the public URL; client IPs arrive via `cf-connecting-ip`.
- Add a Cloudflare Access application in front for zero-trust SSO layering, and turn on the instance PIN (Admin → Settings) as a second gate.
- Behind any proxy the origin check uses `x-forwarded-host`, so custom domains work unchanged.

### Pterodactyl / Pelican / FeatherPanel

See [Panel eggs](#-panel-eggs) above.

## 🔌 API sketch

All endpoints are JSON under `/api`, cookie-authenticated (httpOnly, SameSite=Lax). Highlights:

```
GET  /api/auth/status                     instance identity + registration state
POST /api/auth/login                      stage 1 - register this device (checks the instance PIN when it is on)
POST /api/auth/account/register           stage 2 - create an account on a paired device
POST /api/auth/account/login              stage 2 - sign in (session is rotated)
POST /api/auth/account/logout             switch account, keep the device paired
POST /api/auth/account/password           change password (signs other devices out)
GET  /api/auth/me                         paired device + current account
POST /api/auth/settings                   instance settings (owner only)
GET  /api/users/me | /directory | /all    own profile · access-picker list · owner stats
POST /api/users/:id/reset-password        issue a temporary password (owner only)
POST /api/items/upload                    multipart upload (≤48 MB; images auto-thumbnail)
POST /api/items/upload/begin|chunk|finish chunked upload for huge files (streamed)
POST /api/items/text | /url               notes + quick links (with access)
PATCH /api/items/:id/access|pin|name      per-item permissions, personal pins, rename
POST /api/items/:id/share                 public link (PIN, note, expiry, caps)
GET  /api/share/:token                    public metadata (+ /download?grant=…)
GET  /api/events                          SSE: realtime sync + WebRTC signaling (1 per tab)
POST /api/webrtc/presence|signal          P2P presence & SDP/ICE relay
GET  /api/admin/stats|storage|security    analytics, storage, security (owner only)
GET  /api/admin/devices                    every session with its account (owner only)
GET  /api/admin/logs                       activity log: q, category, severity, actor, days, before
PATCH/DELETE /api/sessions/:token          rename/MAC-note or revoke a device (owner, or your own)
POST /api/account/login/verify            second factor (TOTP, recovery code or passkey)
POST /api/account/password/forgot|reset   email reset link · set a new password with it
GET  /api/account/security                2FA, passkeys, email status (+ /totp/*, /passkeys/*, /email/*)
GET  /api/notifications                   inbox (+ /read, /prefs)
GET/POST /api/keys · /api/webhooks        personal API keys · webhooks (+ /:id/test, /deliveries)
GET  /api/items/shares/mine               your share links with totals (+ /:id/share/:token/stats)
GET  /api/items/upload/pending            unfinished chunked uploads to resume
GET/POST /api/backups                     backups (+ /file/:name, /schedule, /upload/*, /inspect, /restore)
GET  /api/cluster/replication             replica policy + status (+ /policy, /run)
GET/POST /api/mail                        SMTP settings (+ /test), owner only
```

## 🗂 Project layout

```
src/server          Hono API on Bun (routes, crypto, security, drizzle schema)
src/client          React 19 + Vite + Tailwind 4 SPA (route-level code splitting)
eggs/               Pterodactyl / Pelican / FeatherPanel eggs
.github/workflows   CI · Docker publish · Release binaries
Dockerfile          multi-arch production image
```

## 🗺 Roadmap

- [ ] Postgres/MySQL driver option for extreme horizontal scale
- [ ] TURN server integration for restrictive NATs
- [ ] Web push notifications (in-app and email notifications exist)
- [ ] Cluster replicas for items over 64 MB (streamed transfer)

## 📄 License

MIT - see [LICENSE](LICENSE).
