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

`APP_SECRET` has **no default and no fallback**: the process refuses to boot
without it. Today `SESSION_SECRET` ships a working default —
`change-me-in-production-32-char-min`, `server/src/config.ts:8` — so an instance can
run in production on a signing key that is public in the repo. v2 fails closed.

Anything sealed under the data key stores a **key-version marker** (`v1`) in its
envelope, so a future `APP_SECRET` rotation can decrypt-old / encrypt-new instead of
being a flag day.

> **Runbook warning.** A database backup taken without `APP_SECRET` cannot recover
> any secret setting. Back the secret up separately from the DB, or a restore comes
> back with an unreadable settings table.

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
- **The token expires 60 minutes after boot.** Printing it is the one deliberate
  exception to section 6's "no secret in any log line", and a log line is not
  transient: it rotates to a file, is readable by anyone in the `docker` group or
  holding a Portainer session, and is scraped by any shipper pointed at the host.
  Bounding the lifetime bounds that exposure. If setup is still pending after an
  hour, `docker compose restart` issues a fresh token.
- It is printed with an explicit warning so nobody reads it as a boot banner:

  ```
  ============================================================
  SETUP TOKEN: <32 hex>
  This token grants full ownership of this instance.
  Valid for 60 minutes. Treat it as a password, not a log line.
  ============================================================
  ```
- The "zero human principals" check and the owner `INSERT` happen in **one
  transaction**. Check-then-create leaves a window where two concurrent
  `POST /api/v1/setup` calls both pass the check and both mint an owner.

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
3. **The claim path expires 7 days after the migration runs.** Left open, it is a
   standing value-upgrade on a credential of unknown strength: a stolen
   `OWNER_TOKEN` buys a 7-day session today, but during an unbounded claim window it
   buys a *permanent account* that outlives the token's retirement. After expiry the
   path returns `410 CLAIM_EXPIRED`, and re-enabling it is a documented shell
   command (`docker compose exec app node scripts/reopen-claim.js`) — which puts it
   back on exactly the footing first-boot setup already has.
4. **The intermediate state is a scoped claim ticket, not a session.** Presenting
   both tokens returns a short-lived (10 min) ticket with `scope=claim`, and the
   only endpoint that accepts it is `POST /api/v1/auth/claim/complete`. If that
   state were a real session, "forces you to set a password" would be a UI
   convention and the whole API would be open to any caller holding `OWNER_TOKEN`.
5. Both tokens are compared with `crypto.timingSafeEqual` over their hashes, never
   `===`. The live code does `token === config.OWNER_TOKEN`
   (`server/src/lib/auth.ts:57`), and the legacy token was hand-created, so its
   entropy is unknown and a byte-wise leak is worth more against it than it would be
   against a CSPRNG value. Both claim endpoints are rate-limited (section 6).
6. The exactly-once transition — validate, create the principal, set
   `auth.legacyTokenDisabled` — is **one transaction**, for the same reason as
   section 2.
7. On completion the server writes `settings['auth.legacyTokenDisabled'] = true`
   and never honours `OWNER_TOKEN` again, present in env or not.
8. `AGENT_API_KEYS`, if present, is imported once into `api_keys` (prefix + SHA-256
   of the existing raw key) so no running agent breaks, then ignored forever. The
   importer **skips and warns** on entries whose key still matches a `.env.example`
   placeholder (`oc_xxx`, `hex_xxx`, and similar) rather than minting them as live
   credentials. Every existing `api_keys` row traces back to env seeding — v1 has no
   key-creation endpoint — so a key since removed from `.env` leaves a bcrypt row
   that **cannot** be migrated. The importer logs each such row loudly, by name and
   principal, rather than leaving a silently dead credential for an agent to
   discover at 3am.

Mandatory runbook steps:

```bash
# before upgrading
cp data/kanban.db "data/kanban.db.$(date +%F).bak"

# after upgrading: claim immediately, then retire the token by hand
docker compose logs app | grep 'SETUP TOKEN'   # the second factor for the claim
# ...complete the claim in the UI...
sed -i '/^OWNER_TOKEN=/d' .env                 # server ignores it; don't leave it lying around
```

Claim immediately after the migration. The window is real; the shortest window is
the one you close yourself.

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
mustChangePassword integer not null default 0   -- forces the claim flow on next login
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

`valueEncrypted` is `version || iv || ciphertext || tag` — see the key-version
marker in section 1. The `preview` is the last four characters **only when the
plaintext is 12 characters or longer**; below that, revealing a third of a short
secret is worse than showing nothing, and the field is omitted.

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
`{ key, isSecret: true }` and nothing more. For `login_failed` it is the attempted
**email and nothing else** — never the submitted password, not a prefix of it, not
its length. People type passwords into the email field, so even that value is
treated as possibly-sensitive and is never echoed back in an error.

## 4. API surface

### Auth

```
POST   /api/v1/setup                    -- first run only, setup token required
POST   /api/v1/auth/login               -- { email, password }
POST   /api/v1/auth/logout
GET    /api/v1/auth/me                  -- current principal + role  (NEW — the UI
                                           has no way to ask this today)
POST   /api/v1/auth/change-password     -- { currentPassword, newPassword }
POST   /api/v1/auth/claim               -- { ownerToken, setupToken } -> claim ticket
POST   /api/v1/auth/claim/complete      -- { ticket, email, displayName, password }
```

Session JWTs carry **`{ principalId, pwv }` and nothing else.** `pwv` is
`passwordChangedAt` in ms; `verifySession` rejects a token whose `pwv` does not
match the stored value, so changing a password invalidates every existing session
with no session table.

**`role` is deliberately not in the token.** Section 3.2 already reads an API key's
role live from its principal; a session deserves the same treatment for the same
reason. A role baked into a 7-day JWT means a demoted or disabled owner keeps full
rights for up to a week after you revoke them — precisely the moment you most need
the revocation to bite. The middleware loads the principal row on every request
regardless, so reading `role` and `status` from that row costs nothing and makes
`status = 'disabled'` take effect on the very next request.

`mustChangePassword` is checked on login: a principal carrying it receives the same
scoped ticket as the claim path (`scope=claim`, 10 min) instead of a session, so a
temp password can never become a working long-term credential. Without it, the owner
retains a valid login for every human they invite, and the audit log cannot tell the
two of them apart.

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
| Secret exposure | No secret in any GET response, error message, or audit payload. **One exception, by design:** the boot setup token is printed to the container log (section 2), bounded by a 60-minute expiry. No other secret is ever logged |
| Login | Generic `Invalid email or password` — no user enumeration. **Per-IP throttle is the primary control.** The per-account lockout is secondary: short (15 min), auto-expiring, keyed on IP + account, cleared on success. An indefinite lockout hands anyone who knows the owner's email a denial of service whose only recovery is the shell — the thing this spec exists to eliminate |
| Rate limits | `/auth/login`, `/setup`, `/auth/claim`, `/auth/claim/complete`, and key creation |
| CSRF | Same-origin SPA with `SameSite=Lax` cookie, plus an `Origin` / `Sec-Fetch-Site` check on every state-changing method (`POST` / `PUT` / `PATCH` / `DELETE`). Reject `Sec-Fetch-Site: cross-site` and `Origin: null`; require the `Origin` host to equal `Host`. No CSRF token needed |
| CORS | **No CORS headers are ever sent.** The API serves its own SPA from the same origin and has no other legitimate caller. This is a stated decision, not an omission — an `Access-Control-Allow-Origin` added later is exactly what would turn the row above into a CSRF hole |
| Sessions | JWTs carry `{ principalId, pwv }` only. `role` and `status` are read live from the principal row on every request, so revocation is immediate |
| Cookies | `httpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`. TLS terminates at Caddy |
| Authorization | Role checked server-side on every mutating endpoint. Last-owner invariant enforced in the service layer, not the route |
| Audit | Every admin action written to `activities` with actor, target, and timestamp |
| Tests | **The repo has zero test files today** — `vitest` is configured in `server/package.json` but no `*.test.ts` exists outside `node_modules`. This feature does not ship untested |

## 7. Delivery plan

**A1 — Backend foundation (Hexagon).** Migration (rename to `principals`, new
columns including `mustChangePassword`, `settings`, `api_keys` v2, nullable
`activities.taskId`), HKDF subkey derivation, password auth, `/auth/me`,
change-password, setup flow, one-time legacy `OWNER_TOKEN` claim and
`AGENT_API_KEYS` import, board `PATCH` / `DELETE`. Tests.
*This is the slice that ends hand-editing `.env`; ship it first and alone.*

From the security review, A1 also carries: fail-closed `APP_SECRET` validation,
setup-token expiry and warning banner, transactional setup and claim, the scoped
`scope=claim` ticket, `timingSafeEqual` on both legacy tokens, per-IP login
throttling with a short auto-expiring account lockout, `role` and `status` read live
from the principal row rather than the JWT, and `scripts/reopen-claim.js` for the
expired-claim path. Rate limiting does not exist anywhere in `server.ts` today, so
the middleware itself is new work.

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
7. Sessions carry no authorization claims. `role` and `status` are read live from
   the principal row, so demotion and disabling take effect on the next request
   rather than at token expiry.
8. The one-time legacy `OWNER_TOKEN` claim path expires 7 days after migration and
   issues a scoped claim ticket, never a session.

## 8a. Review history

- **Hexagon** (backend, 2026-09-19) — migration feasibility, `activities` query
  impact, A1/A2 split. Raised the single-factor weakness in section 2.1 and the
  placeholder-import gap.
- **Guard** (security, 2026-09-19) — threat review of sections 0-9 against the live
  code. Verdict: sound architecture, ship after fixes. Every finding is folded in
  above: setup-token lifetime and TOCTOU (2), claim-path expiry, scoped ticket,
  constant-time compare and unimportable-key logging (2.1), fail-closed `APP_SECRET`
  and key versioning (1), live role reads (4), `mustChangePassword` (3.1, 4),
  lockout DoS and the explicit no-CORS decision (6), short-secret previews (3.3),
  `login_failed` payload (3.4). Full text:
  `docs/reviews/2026-09-19-security-review-guard.md`.

## 9. Open questions for the owner

- **Email delivery.** Inviting a human currently means the owner reads a generated
  temporary password off the screen and hands it over. Real invite emails need SMTP
  config — worth it, or is hand-off fine for an instance with one human?
- **Nostr / NIP-07 login.** v1 listed it as post-MVP. Password auth makes it
  optional rather than necessary. Still wanted?
