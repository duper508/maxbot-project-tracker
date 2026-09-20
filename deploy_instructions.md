# Buzz Kanban — Deploy Instructions

Target path: `https://apps.10ktechnology.com/kanban`

## What is being deployed

A single Buzz Kanban service that serves:
- React + Vite frontend at `/`
- Hono API at `/api/v1`
- SQLite database (file-based)

The Caddy reverse proxy on the VPS strips the `/kanban` prefix, so the app sees requests as `/` and `/api/v1/*`.

## Docker deployment (recommended)

### 1. Clone / pull the repo

```bash
cd /opt  # or your preferred deploy root
git clone https://github.com/duper508/maxbot-project-tracker.git buzz-kanban
cd buzz-kanban
git checkout rebuild/buzz-kanban-backend  # current deploy branch
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and set the required values:

- `APP_SECRET` — 64-character hex root secret; used to derive session and data subkeys. Generate with `openssl rand -hex 32`. The server rejects all-zero and repeated-character placeholders.
- `TRUSTED_PROXY_CIDR` — **required when running behind Caddy/reverse proxy**. CIDR of the Docker bridge subnet the container sees (e.g. `172.28.0.0/16` for the subnet declared in `docker-compose.yml`). Do **not** use `127.0.0.1/32`: from inside the container the socket peer is the Docker gateway, not the host loopback. Leave unset to use the socket peer directly.
- `OWNER_TOKEN` — legacy v1 owner token, consumed once during the claim window on migrated instances. Fresh instances use the setup token printed at first boot.
- `AGENT_API_KEYS` — optional, format `role:Name:bzk_<prefix>_<secret>`. Imported once at first boot.
- `BUZZ_RELAY_URL`, `BUZZ_SERVICE_PUBKEY` — optional Buzz webhook integration

`.env` is gitignored, so it will not be committed.

### 3. Build and start with Docker Compose

```bash
docker compose up -d --build
```

This builds the image, starts the container, and persists the SQLite database in a Docker volume named `kanban-data`.

The service listens on `http://0.0.0.0:8380`.

### 4. Verify

```bash
# Health check
curl http://localhost:8380/health

# Login (use the owner email and password set during setup/claim)
curl -c cookies.txt -X POST http://localhost:8380/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"the-password-you-set"}'

# List boards
curl -b cookies.txt http://localhost:8380/api/v1/boards
```

### 5. Updating

```bash
cd /opt/buzz-kanban
git pull origin rebuild/buzz-kanban-backend
docker compose up -d --build
```

### 6. Caddy configuration

If you want the app available at `https://apps.10ktechnology.com/kanban`, add this block to your Caddyfile:

```caddy
apps.10ktechnology.com {
    # ... existing sub-sites ...

    handle_path /kanban/* {
        reverse_proxy localhost:8380 {
            trusted_proxies 127.0.0.1
        }
    }
}
```

Then reload Caddy.

After reload:
- UI: `https://apps.10ktechnology.com/kanban`
- API base: `https://apps.10ktechnology.com/kanban/api/v1`
- Health check: `https://apps.10ktechnology.com/kanban/health`
- API docs: `https://apps.10ktechnology.com/kanban/api/v1/docs`

## Manual deployment

- Node.js 22+ and npm
- Git access to `https://github.com/duper508/maxbot-project-tracker.git`
- Caddy (already running as `guac-caddy` on the VPS)
- A host directory for the SQLite database file (suggested: `/home/lance/kanban-data`)

## 1. Clone / pull the repo

```bash
cd /opt  # or your preferred deploy root
git clone https://github.com/duper508/maxbot-project-tracker.git buzz-kanban
cd buzz-kanban
git checkout rebuild/buzz-kanban-backend  # current deploy branch
```

For updates:

```bash
cd /opt/buzz-kanban
git pull origin rebuild/buzz-kanban-backend
```

## 2. Install dependencies

```bash
# Frontend dependencies
npm install

# Backend dependencies
cd server
npm install
cd ..
```

## 3. Build

```bash
# Build the frontend into ./dist
npm run build

# Build the backend into ./server/dist
cd server
npm run build
cd ..
```

## 4. Environment variables

Create `server/.env` (or export the variables another way). Example:

```env
NODE_ENV=production
PORT=8380
HOST=0.0.0.0
SQLITE_PATH=file:/home/lance/kanban-data/kanban.db
# Generate a real 64-character hex value with: openssl rand -hex 32
APP_SECRET=REPLACE_WITH_64_HEX_CHARS_GENERATED_BY_OPENSSL_RAND_HEX_32
# Manual/host deployment: Caddy and the app are both on the host, so the peer is 127.0.0.1.
# For Docker Compose use the container bridge subnet (172.28.0.0/16 in docker-compose.yml).
TRUSTED_PROXY_CIDR=127.0.0.1/32
JWT_EXPIRY=7d
# Legacy v1 owner token, consumed once during the claim window on migrated instances.
OWNER_TOKEN=your-owner-token-for-human-login
# Imported once at first boot. Format: role:Name:bzk_<prefix>_<secret>
AGENT_API_KEYS=owner:OpenClaw:bzk_rz75ihlkajnp_rwwwl7d7qohupxceerkzt2gbkehtyhch,editor:Hexagon:bzk_gxhofcbufujw_2gvohuca23qmumlgzqxqwoyk6zh6ooxn
BUZZ_RELAY_URL=wss://buzz.10ktechnology.com
BUZZ_SERVICE_PUBKEY=<hex-pubkey-for-buzz-webhook-verification>
BUZZ_VERIFY_SIGNATURES=true
```

Notes:
- `OWNER_TOKEN` is a legacy v1 credential. On migrated instances it is consumed once during the claim window; on fresh instances the owner is created with the setup token printed at first boot. Humans log in with email + password at `POST /api/v1/auth/login`.
- `AGENT_API_KEYS` format: `role:Name:bzk_<prefix>_<secret>`. Roles can be `owner`, `editor`, or `viewer`.
- `APP_SECRET` must be exactly 64 hex characters and cannot be an obvious placeholder; the server fails closed on boot if it is missing, malformed, or weak.
- `TRUSTED_PROXY_CIDR` must match the actual socket peer the app sees. For Docker Compose that is the bridge gateway/subnet (see `.env.example`), not `127.0.0.1/32`. When unset, rate limits key on the socket peer address and `X-Forwarded-For` is ignored to prevent spoofing.
- Ensure the SQLite parent directory exists and is writable: `mkdir -p /home/lance/kanban-data`.

## 5. Database

Migrations run automatically on server startup. To run them manually:

```bash
cd server
npm run db:migrate
```

The seed routine auto-creates an owner agent and a default "Main Board" on first boot if they do not exist.

## 6. Start the service

### Option A: systemd service (recommended)

Create `/etc/systemd/system/buzz-kanban.service`:

```ini
[Unit]
Description=Buzz Kanban
After=network.target

[Service]
Type=simple
User=lance
WorkingDirectory=/opt/buzz-kanban/server
EnvironmentFile=/opt/buzz-kanban/server/.env
ExecStart=/usr/bin/node /opt/buzz-kanban/server/dist/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now buzz-kanban
sudo systemctl status buzz-kanban
```

### Option B: direct start

```bash
cd /opt/buzz-kanban/server
set -a; source .env; set +a
npm start
```

The service listens on `http://0.0.0.0:8380` by default.

## 7. Caddy configuration

Add this block to `/home/lance/guacamole-deploy/Caddyfile` inside the existing `apps.10ktechnology.com` site:

```caddy
apps.10ktechnology.com {
    # ... existing sub-sites ...

    handle_path /kanban/* {
        reverse_proxy localhost:8380 {
            trusted_proxies 127.0.0.1
        }
    }
}
```

Then reload Caddy:

```bash
sudo systemctl reload caddy
# or, if Caddy is managed via docker-compose:
# docker compose -f /home/lance/guacamole-deploy/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
```

After reload:
- UI: `https://apps.10ktechnology.com/kanban`
- API base: `https://apps.10ktechnology.com/kanban/api/v1`
- Health check: `https://apps.10ktechnology.com/kanban/health`
- API docs: `https://apps.10ktechnology.com/kanban/api/v1/docs`

## Agent ingress endpoints

Two authenticated endpoints are available for agents:

### Generic agent actions
`POST /kanban/api/v1/agent-actions`

Bearer-token auth using a key from `AGENT_API_KEYS` (`bzk_<prefix>_<secret>` format). Supports:
`create_task`, `close_task`, `reopen_task`, `comment`, `assign`, `attach_resource`.

Example:
```bash
curl -X POST https://apps.10ktechnology.com/kanban/api/v1/agent-actions \
  -H "Authorization: Bearer bzk_rz75ihlkajnp_rwwwl7d7qohupxceerkzt2gbkehtyhch" \
  -H "Content-Type: application/json" \
  -d '{"action":"create_task","payload":{"title":"From agent"}}'
```

### OpenClaw webhook
`POST /kanban/api/v1/openclaw`

Same auth and action vocabulary as `/agent-actions`, plus an optional `artifact` object that is automatically attached as a resource to the affected task.

Example:
```bash
curl -X POST https://apps.10ktechnology.com/kanban/api/v1/openclaw \
  -H "Authorization: Bearer bzk_gxhofcbufujw_2gvohuca23qmumlgzqxqwoyk6zh6ooxn" \
  -H "Content-Type: application/json" \
  -d '{
    "action":"create_task",
    "payload":{"title":"From OpenClaw"},
    "artifact":{"id":"art_123","name":"output.md","url":"https://..."}
  }'
```

### Buzz webhook
`POST /kanban/api/v1/webhooks/buzz`

Receives Nostr events. Set `BUZZ_SERVICE_PUBKEY` to the hex pubkey the service listens for, and `BUZZ_VERIFY_SIGNATURES=true` to validate event signatures.

## 8. Verify

```bash
# Health check
curl https://apps.10ktechnology.com/kanban/health

# Login (use the owner email and password set during setup/claim)
curl -c cookies.txt -X POST https://apps.10ktechnology.com/kanban/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"the-password-you-set"}'

# List boards
curl -b cookies.txt https://apps.10ktechnology.com/kanban/api/v1/boards
```

## 9. Updating

```bash
cd /opt/buzz-kanban
git pull origin rebuild/buzz-kanban-backend
npm install
cd server && npm install && cd ..
npm run build
cd server && npm run build && cd ..
sudo systemctl restart buzz-kanban
```

## Backup

The only state is the SQLite file. Back it up regularly:

```bash
sqlite3 /home/lance/kanban-data/kanban.db ".backup /home/lance/kanban-data/kanban.db.backup"
```
