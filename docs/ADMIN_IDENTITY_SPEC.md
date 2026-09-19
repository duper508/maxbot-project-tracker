---
title: "Buzz Kanban — Identity, Admin & Secrets Management Spec (v2)"
status: proposed
created: 2026-09-19
author: Fizz
supersedes: "Locked Decisions 2 and 3 of the Backend Spec (v1)"
---

# Identity, Admin & Secrets Management (v2)

## 0. Why this exists

The v1 design deliberately deferred all administration to environment variables
("UI key management is post-MVP"). In practice that shipped an app where the only
way to get an owner session is to hand-edit `.env` on the VPS, and the only way to
give an agent an API key is to hand-edit `.env` and restart the container. Rotating
a key additionally requires deleting a row out of SQLite by hand.

That is the wrong cut line. This spec replaces it with a hard rule:

> **One secret in bash, everything else in the UI.**
>
> After a first boot, no administrative task — login, adding a human, adding an
> agent, issuing or rotating an API key, creating a board, configuring the Buzz
> relay — may require shell access, a file edit, or a container restart.

## 1. The bootstrap contract

`.env` in v2 carries **process configuration** and **exactly one secret**.

```env
# The only secret. 32+ bytes of hex. Root of trust for this instance.
APP_SECRET=<openssl rand -hex 32>

# Process config, not secrets — already defaulted in docker-compose.yml
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
SQLITE_PATH=file:/app/server/data/kanban.db
```

`APP_SECRET` is irreducible: it is the key that encrypts the settings table, so it
cannot itself live in that table. Two independent subkeys are derived from it with
HKDF-SHA256 and distinct `info` labels, so a JWT-signing compromise does not hand
over the settings-encryption key:

| Subkey | `info` label | Use |
|--------|--------------|-----|
| session key | `kanban/session-v1` | HS256 signing of session JWTs |
| data key | `kanban/settings-v1` | AES-256-GCM for secret settings at rest |

**Removed from `.env` entirely:** `OWNER_TOKEN`, `AGENT_API_KEYS`, `SESSION_SECRET`,
`JWT_EXPIRY`, `BUZZ_RELAY_URL`, `BUZZ_SERVICE_PUBKEY`, `BUZZ_VERIFY_SIGNATURES`.
Each of these becomes either a real credential (principals / API keys) or a row in
the `settings` table editable from **Settings → Integrations**.

## 2. First-run setup

Boot with zero human principals puts the server in **setup mode**:

- Every route except `/health` and `/api/v1/setup/*` returns `409 SETUP_REQUIRED`.
- The SPA sees that code and routes to `/setup`.
- A one-time **setup token** (32 hex) is generated in memory and printed to the
  container log on each boot while setup is pending. `POST /api/v1/setup` requires
  it. This closes the window where whoever reaches the URL first can claim the
  instance — the claimant must be able to read `docker compose logs`.

```
POST /api/v1/setup
  { setupToken, email, displayName, password }
  -> creates the first principal (kind=human, role=owner)
  -> creates the default board
  -> sets the session cookie
  -> setup mode ends permanently
```

That is the entire shell-bound surface: generate `APP_SECRET`, `docker compose up`,
read one token out of the log. Everything after is the UI.

### 2.1 Upgrading the existing deployment

The live instance already has an `OWNER_TOKEN` and agent rows. The migration must
not lock the owner out:

1. Migration runs. If `OWNER_TOKEN` is present in env and no human principal has a
   password, the server enables a **one-time claim path**: the old owner token is
   accepted exactly once and immediately forces "choose an email and password"
   before anything else is reachable.
2. The claim path requires **both** `OWNER_TOKEN` *and* the boot setup token from
   §2 — not the owner token alone. `OWNER_TOKEN` lives in `.env`, so accepting it
   by itself would let anyone with env access claim ownership ahead of the real
   owner. Requiring both raises the bar to "`.env` access **and** log access",
   which is exactly the bar first-boot setup already sets. *(Raised by Hexagon in
   review; the single-factor version was the weakest point in the draft.)*
3. On completion the server writes `settings['auth.legacyTokenDisabled'] = true`
   and never honours `OWNER_TOKEN` again, present in env or not.
4. `AGENT_API_KEYS`, if present, is imported once into `api_keys` (prefix + SHA-256
   of the existing raw key) so no running agent breaks, then ignored forever. The
   importer **skips and warns** on entries whose key still matches a `.env.example`
   placeholder (`oc_xxx`, `hex_xxx`, and similar) rather than minting them as live
   credentials.

Mandatory runbook step before upgrading:

```bash
cp data/kanban.db "data/kanban.db.$(date +%F).bak"
```

## 3. Data model changes

### 3.1 `agents` becomes `principals`

Today `agents` holds both agents and a fake `kind='manual'` row named "Owner" that
stands in for the human. Tasks, comments, resources and activities all FK to it.
Rather than add a parallel `users` table and rewrite every actor reference, the
table becomes what it already is in practice: a **principals** table.

```sql
ALTER TABLE agents RENAME TO principals;
```

Added columns:

```
email              text unique          -- humans only, stored lowercased
passwordHash       text                 -- humans only, bcrypt cost 12
status             text not null default 'active'   -- active | disabled
lastLoginAt        integer
failedLoginCount   integer not null default 0
lockedUntil        integer
passwordChangedAt  integer
updatedAt          integer
```

`kind` gains `human`. `role` stays a **three-value** enum — `owner`, `editor`,
`viewer`. No `admin` tier: this is a small instance, and every extra tier is another
authorization path to get wrong. All administrative endpoints are `owner`-gated.

Invariant enforced in the service layer: **the last active `owner` cannot be
disabled, deleted, or demoted.**

### 3.2 `api_keys` v2

Two problems with the current table. First, `resolveAgentByApiKey` in
`server/src/lib/auth.ts` selects *every* row and runs `bcrypt.compare` against each
one — that is O(n) bcrypt operations on every authenticated request, which is both a
latency cliff and a cheap DoS. Second, a key carries its own `role`, independent of
its principal's role, which is a confused-deputy bug waiting to be filed.

New key format, prefix-addressable:

```
bzk_<keyId:12 base32>_<secret:32 base32>
     ^ indexed lookup      ^ never stored
```

```
id            text primary key
principalId   text not null -> principals.id on delete cascade
name          text not null          -- "OpenClaw prod", human-chosen
prefix        text not null unique   -- the keyId segment, indexed
keyHash       text not null          -- sha256(secret), hex
createdBy     text not null -> principals.id
createdAt     integer not null
lastUsedAt    integer
expiresAt     integer                -- null = no expiry
revokedAt     integer                -- soft revoke, preserves audit trail
```

- **SHA-256, not bcrypt.** The secret is 160 bits of CSPRNG output; a password KDF
  buys nothing against a preimage search of that space and costs real latency.
- Verification is one indexed lookup on `prefix` + one hash + one constant-time
  compare. O(1), no bcrypt on the request path.
- **No per-key role.** Effective role is always the principal's current role, read
  live. Demoting a principal instantly demotes its keys.
- The plaintext key is returned **once**, at creation, and is not recoverable.
- `lastUsedAt` is written at most once per 60s per key so the hot path stays a read.

### 3.3 `settings` — DB-backed configuration

```
key             text primary key       -- 'buzz.relayUrl', 'buzz.webhookSecret', ...
value           text                   -- JSON, for non-secret settings
valueEncrypted  blob                   -- iv || ciphertext || tag, AES-256-GCM
isSecret        integer not null default 0
updatedBy       text -> principals.id
updatedAt       integer not null
```

Secret settings are **write-only over the API**. `GET /api/v1/settings` returns
metadata, never plaintext:

```json
{ "key": "buzz.webhookSecret", "isSecret": true, "isSet": true,
  "preview": "****1a2b", "updatedAt": 1758278400000 }
```

There is no endpoint, anywhere, that returns a stored secret's plaintext. The UI
renders a write-only field; re-entering a value replaces it.

MVP keys: `instance.name`, `session.jwtExpiry`, `buzz.relayUrl`,
`buzz.servicePubkey`, `buzz.verifySignatures`, `buzz.webhookSecret`.

Settings are read through a small cache invalidated on write, so changing the relay
URL in the UI takes effect without a restart.

### 3.4 `activities` becomes the full audit log

Admin actions must be auditable, but `activities.taskId` is `NOT NULL` today.
Change: `taskId` becomes nullable, and two columns are added —

```
targetType  text   -- task | principal | api_key | setting | board
targetId    text
```

`action` gains: `principal_created`, `principal_updated`, `principal_disabled`,
`key_created`, `key_rotated`, `key_revoked`, `setting_updated`, `login_succeeded`,
`login_failed`, `password_changed`.

**A secret value never enters `payload`.** For `setting_updated` the payload is
`{ key, isSecret: true }` and nothing more.

## 4. API surface

### Auth

```
POST   /api/v1/setup                    -- first run only, setup token required
POST   /api/v1/auth/login               -- { email, password }
POST   /api/v1/auth/logout
GET    /api/v1/auth/me                  -- current principal + role  (NEW — the UI
                                           has no way to ask this today)
POST   /api/v1/auth/change-password     -- { currentPassword, newPassword }
```

Session JWTs carry `{ principalId, role, pwv }` where `pwv` is `passwordChangedAt`
in ms. `verifySession` rejects a token whose `pwv` does not match the stored value,
so changing a password invalidates every existing session with no session table.

### Principals — owner only

```
GET    /api/v1/principals?type=human|agent
POST   /api/v1/principals               -- human (with temp password) or agent
PATCH  /api/v1/principals/:id           -- displayName, role, status
DELETE /api/v1/principals/:id           -- soft disable; hard delete refused if referenced
POST   /api/v1/principals/:id/reset-password
```

### API keys — owner only

```
GET    /api/v1/principals/:id/keys      -- metadata only, never the key
POST   /api/v1/principals/:id/keys      -- { name, expiresAt? } -> { key } ONCE
POST   /api/v1/keys/:id/rotate          -- { graceHours? } -> { key } ONCE
DELETE /api/v1/keys/:id                 -- revoke immediately
```

**Rotation with a grace window is the feature that makes this usable for agents.**
`rotate` issues a new key and sets `expiresAt = now + graceHours` on the old one
(default 24h, `0` for immediate cutover), so a mid-task agent does not hard-fail the
moment a key is rolled.

### Settings — owner only

```
GET    /api/v1/settings                 -- metadata; secrets masked
PUT    /api/v1/settings/:key
POST   /api/v1/settings/buzz/test       -- dial the relay, report reachability,
                                           before the value is committed
```

### Boards

`POST /api/v1/boards` already exists; `PATCH` and `DELETE` are added, and the UI is
wired to all three. Board creation requires `owner` or `editor`; deletion `owner`.
Both new endpoints land in **A1** — they are small, and shipping them early lets the
Settings → Boards tab go out without waiting for the rest of the admin surface.

## 5. Frontend

The app currently has no router — `src/components/Sidebar.tsx` renders "Settings"
and "Agents" as `href="#"` links with `onClick={(e) => e.preventDefault()}`. Adding
`react-router-dom` is a prerequisite for everything below.

| Route | Contents |
|-------|----------|
| `/setup` | First-run wizard: setup token, owner account, instance name, optional Buzz relay |
| `/login` | Email + password. Replaces the owner-token dialog entirely |
| `/settings/members` | Humans and agents in one table. Role dropdown, enable/disable, invite human, add agent |
| `/settings/keys` | Per-principal keys: name, prefix, last used, expires, status. Create / rotate / revoke |
| `/settings/boards` | Create, rename, edit columns, delete |
| `/settings/integrations` | Buzz relay URL, service pubkey, verify-signatures toggle, webhook secret (write-only), **Test connection** |
| `/settings/account` | Change own password |

Key-reveal modal: shows the plaintext exactly once, with a copy button and explicit
"this will not be shown again" copy. No "reveal" affordance anywhere else in the UI,
because the server cannot satisfy one.

Navigation is role-aware — `owner`-only tabs are hidden from editors and viewers.
Hiding is presentation only; the server enforces every gate independently.

## 6. Security requirements

| Area | Requirement |
|------|-------------|
| Passwords | bcrypt cost 12; min 12 chars; checked against a small common-password deny list |
| API keys | 160-bit CSPRNG secret; SHA-256 at rest; constant-time compare; O(1) lookup by prefix |
| Secret exposure | No secret in any GET response, log line, error message, or audit payload |
| Login | Generic `Invalid email or password` — no user enumeration. 5 failures per account per 15 min sets `lockedUntil`. Per-IP throttle on top |
| Rate limits | `/auth/login`, `/setup`, and key creation |
| CSRF | Same-origin SPA with `SameSite=Lax` cookie, plus an `Origin` / `Sec-Fetch-Site` check on every state-changing request |
| Cookies | `httpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`. TLS terminates at Caddy |
| Authorization | Role checked server-side on every mutating endpoint. Last-owner invariant enforced in the service layer, not the route |
| Audit | Every admin action written to `activities` with actor, target, and timestamp |
| Tests | **The repo has zero test files today** — `vitest` is configured in `server/package.json` but no `*.test.ts` exists outside `node_modules`. This feature does not ship untested |

## 7. Delivery plan

**A1 — Backend foundation (Hexagon).** Migration (rename to `principals`, new
columns, `settings`, `api_keys` v2, nullable `activities.taskId`), HKDF subkey
derivation, password auth, `/auth/me`, change-password, setup flow, one-time legacy
`OWNER_TOKEN` claim and `AGENT_API_KEYS` import, board `PATCH` / `DELETE`. Tests.
*This is the slice that ends hand-editing `.env`; ship it first and alone.*

Migration is executed against a backup copy first, verified with
`PRAGMA foreign_key_check` and a `.schema` inspection, with copy-and-swap as the
fallback if `ALTER TABLE ... RENAME TO` leaves any stale FK reference. The same
change turns on `PRAGMA foreign_keys = ON` in `db/index.ts`, which is currently off.

**A2 — Admin API (Hexagon).** Principals CRUD, key issue/rotate/revoke with grace
window, settings read/write with AES-256-GCM, relay test endpoint, admin audit
entries. Tests.

**B — Admin UI (Comb).** Router, `/setup`, `/login`, the five settings tabs,
role-aware nav, key-reveal modal, wire the dead sidebar links. Depends on A1 for
login and A2 for the rest; `/login` can land against A1.

**C — Security review (Guard).** Review this spec before A1 opens, then review the
A1 and A2 PRs against section 6.

## 8. Decisions this spec locks

1. One secret in env (`APP_SECRET`); all other configuration is DB-backed and
   UI-managed. **Supersedes v1 Locked Decision 3.**
2. Human auth is email + password with a first-run setup wizard. The pre-shared
   `OWNER_TOKEN` is removed, with a one-time claim path for the existing deploy.
   **Supersedes v1 Locked Decision 2.**
3. `agents` is renamed to `principals` and holds humans and agents alike. One actor
   table, one audit log.
4. Three roles: `owner`, `editor`, `viewer`. All admin surfaces are `owner`-gated.
5. API keys are SHA-256 hashed and prefix-addressable; no per-key role; plaintext
   shown once; rotation supports a grace window.
6. Secret settings are write-only over the API. No endpoint returns a stored
   secret's plaintext.

## 9. Open questions for the owner

- **Email delivery.** Inviting a human currently means the owner reads a generated
  temporary password off the screen and hands it over. Real invite emails need SMTP
  config — worth it, or is hand-off fine for an instance with one human?
- **Nostr / NIP-07 login.** v1 listed it as post-MVP. Password auth makes it
  optional rather than necessary. Still wanted?
