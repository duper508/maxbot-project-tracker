# Security review — ADMIN_IDENTITY_SPEC.md (v2)

**Reviewer:** Guard · **Basis:** spec at commit `7434276` (PR #6), current code at `c113382` on `rebuild/buzz-kanban-backend`
**Type:** design-level review; no implementation exists yet. CONFIRMED = verified in the spec text or current code. PLAUSIBLE = reasoned, not reproduced.

**Verdict: sound architecture — ship it after the fixes below.** v2 is a large net improvement over what is deployed: the current login is a non-constant-time token compare (`server/src/routes/auth.ts:41`, `token === config.OWNER_TOKEN`), there is no rate limiting anywhere in `server.ts`, every API request runs an O(n) bcrypt scan, and administration requires shell access. v2 fixes all four.

## Fizz's five questions

### 1. Setup token — closes the first-claim window, with one exposure and one race

The model is right (Gitea-style): a remote first-comer without log access cannot claim the instance.

- **[MEDIUM] Standing exposure in the container log.** The token sits in the log for the entire pending window. Docker logs rotate to files and are readable by the `docker` group, Portainer-style tooling, and log shippers. Exposure = everyone who can read logs × however long setup stays pending, which could be days. Fix: expire the setup token 60 minutes after boot (restart re-issues), print it with an explicit "this grants full ownership" warning, and reconcile §6's "no secret in any log line," which currently contradicts §2 — the setup token is a bearer credential in a log line by design.
- **[LOW] TOCTOU race.** The "zero human principals" check and principal creation must be one transaction (or a unique partial index), or two concurrent `POST /api/v1/setup` calls both mint owners. One line in the spec.

Verdict: approve with those two fixes. (CONFIRMED at design level)

### 2. One root secret + HKDF subkeys — acceptable

Standard pattern (Rails `secret_key_base` precedent). Distinct HKDF `info` labels give real domain separation: compromise of the session subkey cannot yield the settings key, and vice versa. Three additions:

- Boot must **fail closed** without `APP_SECRET` — no default. Today's `SESSION_SECRET` ships a default (`change-me-in-production-32-char-min`, `server/src/config.ts:14`); do not repeat that.
- Carry a **key-version marker** on the settings blob. The `-v1` label implies future rotation; the ciphertext must record which key made it, or rotation becomes a flag day.
- Runbook: a `kanban.db` backup without `APP_SECRET` cannot recover secret settings — state that next to the backup step in §2.1.

### 3. SHA-256 for API keys — agreed, no pushback

At 160 bits of CSPRNG entropy there is no dictionary to defend; bcrypt protects human-chosen secrets, not random keys. This is industry standard for token storage (GitHub PATs, Stripe). Keep the constant-time compare on the stored hash; timing on the indexed prefix lookup is harmless because the prefix is not the credential. bcrypt cost 12 for human passwords stays. (CONFIRMED)

### 4. The one-time OWNER_TOKEN claim path — needs the most work

- **[MEDIUM] Unbounded window + credential upgrade.** Today a stolen `OWNER_TOKEN` buys a 7-day session. During the claim window it buys a **permanent** owner account that survives the token's own retirement. The token has lived in plaintext `.env` and plausibly in shell history and backups. "Accepted exactly once" means whenever someone shows up — possibly a year from now. Fix: the claim path expires (e.g., 7 days post-migration, then permanently off, re-enable only via a documented shell command), and the runbook must say: claim immediately after upgrade, then delete `OWNER_TOKEN` from `.env`.
- **[MEDIUM] Brute force and compare.** `OWNER_TOKEN` was hand-created by a human — entropy unknown. §6 rate-limits `/auth/login` and `/setup` but never names the claim endpoint; add it explicitly. Compare hashes, not strings: SHA-256 both sides + `timingSafeEqual`. The current `===` is non-constant-time (`auth.ts:41`).
- **[MEDIUM] The intermediate state must be single-purpose.** "Accepted exactly once and forces credential set" must be a scoped ticket (JWT with `scope=claim`, ~10-minute expiry) that reaches only the set-credentials endpoint — not a normal session. If it is a normal session, the "force" is UI-side and the API stays open.
- **[LOW] Exactly-once is a transaction.** Flip `auth.legacyTokenDisabled` and create the principal atomically, or concurrent claims double-mint.
- **[LOW] Orphan keys.** Every `api_keys` row today traces to `AGENT_API_KEYS` seeding — no key-creation endpoint exists (verified: `routes/agents.ts` has list/get/create agent only). Import covers keys still present in env at migration time; a key removed from `.env` since seeding leaves an unmigratable bcrypt row whose agent dies silently. The migration must loudly log every row it cannot import.

### 5. CSRF — sufficient as designed, no token needed

`SameSite=Lax` already withholds the cookie on cross-site POSTs in all current browsers; the API accepts only `application/json`, so no simple-request CSRF is possible anyway; the `Origin` / `Sec-Fetch-Site` check is sound defense in depth. Implementation notes: enforce on mutating methods only; reject `Sec-Fetch-Site: cross-site`; require `Origin` == `Host` when `Origin` is present; reject `Origin: null` on mutations. And add the missing line: **no CORS headers, ever** — same-origin only. The spec is silent on CORS; make it a stated decision so nobody "fixes" a future fetch error with `Access-Control-Allow-Origin: *`.

## Findings beyond the five questions

- **[MEDIUM] Session role goes stale.** §4 puts `role` in the JWT; §3.2 correctly reads key roles live. Sessions deserve the same treatment: the middleware already loads the principal row on every request (`resolveAgentById` today), so read `role` and `status` from the row and cut the JWT to `{ principalId, pwv }`. Otherwise a demoted or disabled principal holds full rights until token expiry — 7 days at current settings. This also makes disabling a human kill their sessions for free.
- **[MEDIUM] Temporary passwords are permanent as specced.** `POST /principals` creates a human "with temp password," but nothing forces a change — so the owner who generated it retains a working credential on the other human's account, and the audit log cannot tell the two apart. Add `mustChangePassword`; reuse the claim flow's forced-set-credentials path.
- **[LOW] Owner lockout DoS.** A 5-failures-per-15-minutes account lockout lets anyone who knows the owner's email keep them locked out indefinitely — and with no SMTP, recovery is shell access, the very thing v2 exists to eliminate. Keep the per-IP throttle as the primary control; make account lockout short and auto-expiring, keyed on (IP + account); reset the counter on success. The generic error already covers enumeration.
- **[LOW] Hygiene.** Suppress the `****1a2b` preview for short secrets (<12 chars), where the last-4 is a meaningful fraction of the value. The `login_failed` audit payload must contain the attempted email only — people paste passwords into the email field.

## Confirmed strengths — these must survive implementation

- O(n) bcrypt scan removal — confirmed in `auth.ts:67-78` (`resolveAgentByApiKey` selects all rows, compares each); both a latency cliff and a cheap DoS. Real fix.
- Per-key role removal — confirmed confused deputy: `apiKeys.role` is independent of `agents.role` in `db/schema.ts`. Real fix.
- Write-only secret settings with no plaintext endpoint anywhere.
- `pwv` session invalidation without a session table.
- Last-owner invariant enforced in the service layer, not the route.
- Three roles. Every extra tier is another authorization path to get wrong — right call.

## Coverage

Reviewed spec §0–§9 against `server/src/lib/auth.ts`, `routes/{auth,agents,webhooks,openclaw}.ts`, `db/schema.ts`, `config.ts`, `server.ts`, `docker-compose.yml`, `deploy_instructions.md` at the commits above. Not covered: Hexagon's migration-safety and `activities`-query questions (his call), Comb's UI questions, and code that does not exist yet — the A1/A2 PRs get their own review against §6 per the delivery plan.
