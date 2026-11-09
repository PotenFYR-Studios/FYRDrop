# 📡 FYRDrop

**Self-hosted sharing hub** - share files, notes, links and images between your own devices and people you trust. PIN-paired devices, real accounts, AES-256-GCM encrypted at rest, served over built-in HTTPS. Runs anywhere: Docker, Bun, Node-compatible hosts, Pterodactyl / Pelican / FeatherPanel eggs.

```
Files · Notepad · Links · Gallery · Certificates · P2P Transfer · Covert Tools · Federation
```

---

## ✨ Features

| Area | What you get |
| --- | --- |
| **Files** | Drag & drop / paste multi-upload, auto thumbnails, expiry, download counters, chunked uploads for huge files (streamed straight to disk) |
| **Notepad** | Shared, editable notes with per-note read/write/delete access |
| **Links** | Saved URLs with local monogram tiles (no third-party favicon requests), one-click open/copy, pinnable to the dashboard |
| **Gallery** | Image grid with WebP thumbnails, lightbox, realtime updates |
| **Share links** | Token-gated public links (`/s/<token>`) with optional per-link PIN (signed, short-lived grant - never in the URL), recipient note, expiry and atomic download caps |
| **Certificates** | Generate self-signed TLS certificates in-app or upload existing PEM pairs; every signed-in user can download the public cert, only the owner can download private keys |
| **Device transfer** | True peer-to-peer WebRTC file transfer between paired devices (server only does signaling - files never touch the server) |
| **Covert tools** | QR transfer, lossless text-to-image pixel encoding and base64 wrapping for networks where DLP software blocks normal file sharing |
| **Federation** | Register other FYRDrop instances and broadcast/push items between them (token-authenticated) |
| **Accounts** | Instance PIN pairs a device; each person then signs in to their own account (or registers one). The owner account sees every account and device, and the profile page lists your own devices |
| **Admin** | Analytics, a **Devices** page that ties every session to its account (rename, MAC note, revoke), a filterable **Activity log** with actor/target/IP and expandable details, storage breakdown & safe orphan cleanup, security center, instance settings, account management |
| **Realtime** | A single shared SSE stream per browser tab keeps every page live |

### Security

- **Two-stage sign-in.** A device is first paired with the **instance PIN** (argon2id-hashed). Then the person signs in to an account, or creates one. The session is **rotated** at account sign-in, so a pre-login token can't be reused (no session fixation).
- **Owner account with a one-time password.** First boot creates the `admin` account and prints its one-time password in the startup banner. It must be replaced at first sign-in; nothing else on the admin surface works until then.
- **Progressive lockout per username** after 5 wrong passwords, independent of IP, and login errors never reveal whether a username exists. Share-link PINs are locked out the same way.
- **AES-256-GCM at rest** - uploads, notes, links and certificate private keys are encrypted with a per-instance master key (`data/keys/master.key`). Nothing readable on disk without it.
- **HTTPS out of the box** - `TLS_ENABLED=auto` generates a self-signed certificate and serves TLS directly (HSTS is sent over HTTPS). Bring your own cert via `TLS_CERT_PATH` / `TLS_KEY_PATH`, or set `TLS_ENABLED=0` behind a reverse proxy.
- **OWASP hardening** - strict CSP (`default-src 'self'`), `X-Frame-Options: DENY`, nosniff, referrer policy, CSRF origin checks on all mutating API calls, rate limits, body limits, no stack traces to clients, path-safe stored filenames.
- **Safe inline serving** - only images, audio, video, PDF and plain text render inline; HTML/SVG/JS uploads always download (`Content-Disposition: attachment`), so an uploaded file can't XSS the hub.
- **Per-item access model** - every item has read / write / delete scopes (`everyone`, `selected`, `private`). New items default to *everyone can read, only the uploader (and owner) can edit or delete*. Write/delete never exceed read.
- **Honest client IPs** - `X-Forwarded-For` is ignored unless `TRUST_PROXY=1`, so rate limits and the IP whitelist can't be spoofed.
- **Stateless signed sessions** - HMAC-SHA256 tokens (no DB write per request), instant device revocation, per-user blocking with audit trail.
- **Bounded memory** - rate-limit maps, upload registries and the audit log are capped and swept; abandoned chunked uploads expire after 6 hours.
- **Activity log** - every sign-in, upload, download, share link, access change, certificate action, storage cleanup, cluster join and account change is recorded with the account that did it, the target, the client IP and a machine-readable detail blob. Filter by category, status, time range or account; new events arrive live. Admin → Security keeps a short recent view with a link to the full log.
- **Device inventory** - Admin → Devices lists every session with its account chip, host name, address plus address source, browser/OS, screen, first and last seen dates and MAC. Rename a device, annotate it, or revoke it; revoking asks for the instance PIN next time. Each person sees the same list for their own sessions under Profile.
- **Automatic device identity** - opening the app names the device before the PIN is even entered: the server resolves the host name of the client address through DNS and the OS resolver, and falls back to the browser and system name. The page also reports platform, screen, time zone, language, CPU threads, memory and, when the browser allows it, a local IPv4 gathered from WebRTC ICE candidates. Everything is stored with the session, not in a cookie.
- **Addresses and MAC** - the address column is always what the server saw on the socket, tagged `connection`, `proxy`, `docker bridge` or `loopback`, so a wrong-looking address is explained instead of silently trusted. Browsers cannot read the MAC address; on bare metal the app reads it from the server's neighbour table (ARP), and inside Docker it says so and relies on the manual MAC note. Run with host networking on Linux (see `docker-compose.yml`) for real LAN addresses and MACs.

> **About MAC addresses:** HTTP cannot see client MAC addresses (they die at the first hop). FYRDrop shows IP + user-agent per connection and lets admins **annotate devices with their MAC** in Admin → Connections for LAN inventory.

---

## 🚀 Quick start (Docker)

```bash
docker run -d \
  --name fyrdrop \
  -p 3000:3000 \
  -e TLS_ENABLED=auto \
  -v fyrdrop-data:/app/data \
  ghcr.io/potenfyr-studios/fyrdrop:latest
```

Or with docker compose:

```bash
git clone https://github.com/PotenFYR-Studios/FYRDrop
cd FYRDrop && docker compose up -d
```

Open `https://localhost:3000` (accept the self-signed certificate - or download it from Certificates to trust it), then:

1. **Read the startup banner** - it prints the **instance PIN** and the owner login (`admin` + one-time password).
2. Enter the PIN to pair the device.
3. Sign in as `admin` and set a real password.
4. Other people pair with the same PIN, then **create their own account** - or sign in to an existing one (`Switch account` keeps the device paired).

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

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` / `SERVER_PORT` | `3000` | Listen port (wings injects `SERVER_PORT`) |
| `DATA_DIR` | `./data` | SQLite DB, uploads, keys, certs, TLS volume |
| `TLS_ENABLED` | `auto` | `auto`/`1` = self-signed HTTPS; `0` = plain HTTP behind a proxy |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | - | Bring your own PEM cert/key |
| `TLS_COMMON_NAME` | `fyrdrop.local` | CN of the auto-generated cert |
| `SESSION_TTL_DAYS` | `30` | Device session lifetime |
| `MAX_UPLOAD_MB` | `512` | Upload cap (also configurable in Admin → Settings) |
| `TRUST_PROXY` | `0` | Set to `1` only behind a trusted reverse proxy so `X-Forwarded-For` is used |
| `THUMB_THREADS` | `1` | Worker threads for thumbnail generation (keep at 1 on a Pi) |

## 🧩 Panel eggs

| Panel | Egg | Import |
| --- | --- | --- |
| Pterodactyl 1.x | `eggs/pterodactyl/fyrdrop-egg.json` | Egg → Import |
| Pelican (Wings ≥1.11) | `eggs/pelican/fyrdrop-egg.json` | Import directly (or re-import the Pterodactyl egg) |
| FeatherPanel | `eggs/feather/fyrdrop-egg.json` | Import; if your version rejects it, import the Pterodactyl egg instead |

Eggs use the official `ghcr.io/potenfyr-studios/fyrdrop` image - no runtime install needed. Data persists under `/home/container/data`. Configurable variables: max upload size, TLS mode, TLS CN, session TTL. Releases also attach ready-made `fyrdrop-*-egg.json` files.

## 📦 Standalone binaries

Every release ships standalone executables (Bun compile) for **linux x64/arm64, Windows x64, macOS x64/arm64**, plus a `fyrdrop-client-<tag>.tar.gz` bundle:

```bash
tar -xzf fyrdrop-v1.0.0-linux-x64.tar.gz
tar -xzf fyrdrop-client-v1.0.0.tar.gz -C dist/public   # client bundle → ./dist/public
TLS_ENABLED=auto PORT=3000 ./fyrdrop-linux-x64
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

Files over 32 MB must use the chunked path (`/api/items/upload/begin` → `PUT …/chunk/:id/:index` → `/finish`). Chunks are streamed to disk, never held in memory, and assembled with a streamed AES-256-GCM container that declares its format in the header (`FDCHUNK1`). On boot the server **verifies and repairs** files written by older versions in the legacy raw-append layout, so existing large uploads keep working after an upgrade.

## 🔗 Clusters

Link multiple FYRDrop instances with strong keys so they can browse each other's content and pool storage - same LAN or across networks (use HTTPS/Tailscale/Cloudflare Tunnel between them):

1. Instances announce themselves on the local network (multicast and broadcast every 20 s) and can be probed with **Scan network**. The packet carries only the node id, name, URL and public key. Set `CLUSTER_URL` when running in Docker with a published port, otherwise the beacon advertises the container address.
2. **Connect** on the discovered instance (or paste its address) sends a link request. The other admin sees who asked, from which address, and picks **Approve** or **Reject**.
3. The requesting admin then approves too. **Both approvals are required before either side stores a link.** The two admins see the same pair fingerprint and can compare it out of band.
4. The link key is never sent over the wire: each side contributes an ephemeral X25519 key and both derive the same 32-byte key with three Diffie-Hellman results. Payloads are sealed with **AES-256-GCM** and signed with **HMAC-SHA256** using that key, so cross-node traffic stays private and tamper-evident even on plain HTTP. The key is encrypted at rest and destroyed on unlink.

Manual pairing still works by entering the other instance's address; there is no code to copy.

From Admin → Cluster you can **refresh** a node's manifest (items + storage), **push** local items into a peer's storage, and **unlink**. Only items readable by everyone are advertised and transferable; per-user cross-instance access is not part of this version. Unlinking asks the peer to hand back everything, deletes the copies, destroys the link key on both sides, and removes any pending requests. Unlinking triggers a **reclaim**: the peer hands back everything you pushed into its storage, deletes its copies, and both sides forget the link. If the peer can't be reached, force-unlink is offered with an explicit data-loss warning. Storage pressure (quota/full disk) is reported as a 507 with `needsSpace: true`, so the UI tells you exactly which node needs more space.

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

`docker-compose.yml` ships a production-ready stack (volume, healthcheck, optional HTTPS). Just `docker compose up -d`.

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
- Add a Cloudflare Access application in front for zero-trust SSO layering; keep the app's own PIN as a second factor.
- Behind any proxy the origin check uses `x-forwarded-host`, so custom domains work unchanged.

### Pterodactyl / Pelican / FeatherPanel

See [Panel eggs](#-panel-eggs) above.

## 🔌 API sketch

All endpoints are JSON under `/api`, cookie-authenticated (httpOnly, SameSite=Lax). Highlights:

```
GET  /api/auth/status                     instance identity + registration state
POST /api/auth/login                      stage 1 - pair a device with the instance PIN
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
GET/POST /api/federation/…                instance federation & broadcast
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
- [ ] Federation pull-sync + peer discovery
- [ ] TURN server integration for restrictive NATs
- [ ] Mobile PWA install + push notifications

## 📄 License

MIT - see [LICENSE](LICENSE).
