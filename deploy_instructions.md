# Buzz Kanban — Deploy Instructions

Target path: `https://apps.10ktechnology.com/kanban`

## What is being deployed

A single Buzz Kanban service that serves:
- React + Vite frontend at `/`
- Hono API at `/api/v1`
- SQLite database (file-based)

The Caddy reverse proxy on the VPS strips the `/kanban` prefix, so the app sees requests as `/` and `/api/v1/*`.

## Prerequisites

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
SESSION_SECRET=change-this-to-a-32-char-random-string
JWT_EXPIRY=7d
OWNER_TOKEN=your-owner-token-for-human-login
AGENT_API_KEYS=owner:OpenClaw:oc_xxx,editor:Hexagon:hex_xxx
BUZZ_RELAY_URL=wss://buzz.10ktechnology.com
BUZZ_SERVICE_PUBKEY=<hex-pubkey-for-buzz-webhook-verification>
BUZZ_VERIFY_SIGNATURES=true
```

Notes:
- `OWNER_TOKEN` is the pre-shared token humans exchange for a session cookie at `POST /api/v1/auth/login`.
- `AGENT_API_KEYS` format: `role:Name:key`. Roles can be `owner`, `editor`, or `viewer`.
- `SESSION_SECRET` must be at least 32 characters.
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
        reverse_proxy localhost:8380
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

Bearer-token auth using a key from `AGENT_API_KEYS`. Supports:
`create_task`, `close_task`, `reopen_task`, `comment`, `assign`, `attach_resource`.

Example:
```bash
curl -X POST https://apps.10ktechnology.com/kanban/api/v1/agent-actions \
  -H "Authorization: Bearer hex_yourKey" \
  -H "Content-Type: application/json" \
  -d '{"action":"create_task","payload":{"title":"From agent"}}'
```

### OpenClaw webhook
`POST /kanban/api/v1/openclaw`

Same auth and action vocabulary as `/agent-actions`, plus an optional `artifact` object that is automatically attached as a resource to the affected task.

Example:
```bash
curl -X POST https://apps.10ktechnology.com/kanban/api/v1/openclaw \
  -H "Authorization: Bearer oc_yourKey" \
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

# Login (replace OWNER_TOKEN)
curl -c cookies.txt -X POST https://apps.10ktechnology.com/kanban/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"token":"YOUR_OWNER_TOKEN"}'

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
