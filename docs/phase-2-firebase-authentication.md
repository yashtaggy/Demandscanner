# Phase 2 — Firebase Authentication & Internal User Access

Status: **implemented in this clone; Phase 2.1 authentication hardening applied; not deployed, not migrated against production.**

Phase 2 makes Firebase the official login for DemandScan and makes
`app_users.user_id` the only ownership identity for customer data. Firebase owns
passwords; PostgreSQL owns identity, role, status and audit. Kite remains the
broker/market-data integration and is no longer the application login.

Not included, by scope: admin dashboard UI, subscriptions/expiry, payments,
Upstox, customer broker connections, Live Trade ownership migration, scanner
algorithm changes, server-side scheduled scanners, production migration,
production Firebase configuration, Vercel deployment, and any Git operation.

---

## 1. Architecture at a glance

| Concern | Owner |
|---|---|
| Password storage and verification | Firebase Authentication |
| Firebase UID → app user mapping | `user_identities` (`provider = 'FIREBASE'`) |
| Application identity and ownership | `app_users.user_id` |
| Role (`SUPER_ADMIN` / `ADMIN` / `CUSTOMER`) | `app_users.role` |
| Status (`ACTIVE` / `SUSPENDED` / `DISABLED`) | `app_users.status` |
| Browser session | `ds_app_session` HttpOnly cookie containing a Firebase session cookie |
| Audit of admin/bootstrap mutations | `admin_audit_log` |
| Shared market data | Phase 1.5 system market-data connection |
| Live Trade ownership | Kite user id (unchanged in this phase) |

A Firebase UID and a Kite user id are **never** used as application ownership
keys. Every protected route resolves ownership through the session cookie →
Firebase UID → `user_identities` → `app_users.user_id`.

---

## 2. Database changes

Migration: `db/migrations/2026-11-12-add-phase2-firebase-auth.sql`

```sql
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'CUSTOMER'
    CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'CUSTOMER'));

ALTER TABLE scan_jobs
  ADD COLUMN IF NOT EXISTS initiator_user_id UUID
    REFERENCES app_users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scan_jobs_initiator_status
  ON scan_jobs (initiator_user_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  rate_key          TEXT        PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempt_count     INTEGER     NOT NULL CHECK (attempt_count >= 0),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated_at
  ON auth_rate_limits (updated_at);
```

Notes:

* **Dependency:** this migration builds on
  `2026-11-12-add-internal-identity-foundation.sql` (Phase 1), which creates
  `app_users` and `user_identities`. The Firebase UID is stored in
  `user_identities.provider_user_id`; there is no `provider_uid` column.
  The ordered set is Phase 1 → Phase 1.5 → Phase 2, which is the alphabetical
  order `db/migrate.js` uses.
* Existing `app_users` rows become `CUSTOMER` automatically.
* `scan_jobs.session_id_hash` is retained. It is used only to adopt scan jobs
  that were already running before Phase 2. New jobs store
  `initiator_user_id` instead.
* The migration is additive and idempotent. It does not alter or delete rows.
* `db/expected-schema.js` and the identity schema tests include these additions.

### Applying it to a disposable database

The broad migration runner is intentionally not used. A targeted runner exists:

```bash
PHASE2_DATABASE_URL="postgresql://...direct-neon-host..." \
EXPECTED_PHASE2_HOST="ep-...aws.neon.tech" \
ALLOW_PHASE2_MIGRATION=YES \
npm run db:phase2:migrate
```

Guards:

* reads only `PHASE2_DATABASE_URL` (never `DATABASE_URL`),
* requires `ALLOW_PHASE2_MIGRATION=YES`,
* requires `EXPECTED_PHASE2_HOST` to match and rejects
  `FORBIDDEN_DATABASE_HOST`,
* refuses pooled Neon hosts and `NODE_ENV=production`,
* accepts only this migration file,
* refuses to run when the Phase 1 tables/columns are absent
  (`app_users.user_id/email/status`, `user_identities.provider_user_id`,
  `scan_jobs.job_id`) and names the required migration order,
* verifies `app_users.role`, `scan_jobs.initiator_user_id` and
  `auth_rate_limits` afterwards, including the role CHECK constraint and the
  `scan_jobs.initiator_user_id → app_users(user_id)` foreign key.

It must be run against a disposable database first. This document does not
authorize a production migration.

---

## 3. Firebase setup

1. Create a Firebase project (staging and production may be separate).
2. Enable **Authentication → Sign-in method → Email/Password**. Do not enable
   public sign-up flows in the UI. DemandScan has no registration page.
3. Register a **Web app** for the client SDK.
4. Generate a service-account key under **Project settings → Service accounts**.
5. Register the deployed origins under Authentication → Settings → Authorized
   domains. `localhost` is present by default for development.

Passwords are set only through Firebase's password-reset/action link. The
application never receives, stores or logs a password.

---

## 4. Environment variables

Client (safe to expose, by design):

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

Server only:

```
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=      # PEM; literal \n accepted
```

Market-data policy:

```
MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK=false
```

This flag must be explicitly `false` in production. When `false`, scanner and
quote access require a configured system market-data connection and never fall
back to a customer Kite token. Staging may set it to `true` to test the
compatibility path.

Phase 2 does not remove or invalidate any existing Kite environment variable.
`KITE_API_KEY`/`KITE_API_SECRET` remain broker-login credentials only.

`.env.example` contains placeholders only. Real values are never committed.

---

## 5. Client and Admin SDK boundaries

| Module | Environment | Purpose |
|---|---|---|
| `lib/firebase/client.ts` | browser | Web SDK initialization using only `NEXT_PUBLIC_FIREBASE_*` |
| `lib/auth/firebase-admin.ts` | server | ID-token verification, session-cookie creation/verification, user creation, reset links, revocation |

`firebase-admin` is listed in `serverExternalPackages` in `next.config.ts`.
`lib/auth/firebase-admin.ts` throws if it is ever evaluated with a `window`
object, so an accidental client import fails loudly rather than shipping
credentials.

The Admin service account is read lazily from `lib/env.ts`; no secret has a
default or is hardcoded.

---

## 6. Login and session flow

```
Browser                         Server
  │ signInWithEmailAndPassword    │
  │ getIdToken(/* forceRefresh */)│
  │──── POST /api/auth/session ──▶│ verify ID token (Admin SDK)
  │      { idToken }              │ resolve UID → user_identities → app_users
  │                               │ require status = ACTIVE
  │                               │ create Firebase session cookie (5 days)
  │◀── Set-Cookie ds_app_session ─│ HttpOnly; Secure in prod; SameSite=Lax
  │                               │
  │──── GET /api/... ────────────▶│ verify cookie (checkRevoked=true)
  │                               │ resolve internal user + role from PostgreSQL
```

* `POST /api/auth/session` checks same-origin, rate limits per IP, verifies the
  ID token, requires an existing identity mapping and an `ACTIVE` app user, then
  sets the cookie. It returns only public user fields.
* `GET /api/auth/session` returns the current public user or `401`.
* `DELETE /api/auth/session` is **normal logout**: it clears only the current
  browser's `ds_app_session` cookie. It does not call Firebase and does not
  revoke the user's other devices.
* `POST /api/auth/session/logout-all` is the explicit **sign out everywhere**
  operation. It requires an active same-origin session, calls
  `revokeRefreshTokens(uid)`, and clears the current cookie. Other devices'
  sessions fail on their next request because verification uses
  `checkRevoked=true`. Firebase's own revocation propagation may take a short
  time; the current device is signed out immediately.
* `ds_app_session` is opaque to JavaScript. It is not a Firebase ID token and is
  never placed in local storage.
* `checkRevoked=true` means revoked refresh tokens invalidate outstanding
  sessions on the next request. Session cookies also expire naturally after
  five days.
* The client hook's normal sign-out also calls Firebase Web `signOut()`, which
  clears that browser's local Firebase credentials only.

No `app_users` row is created just because Firebase authentication succeeded.

---

## 7. Central authorization helpers

`lib/auth/session.ts` (server only):

| Helper | Behaviour |
|---|---|
| `requireAppUser(cookieHeader)` | Validates the session cookie, resolves the UID mapping, reads role/status from PostgreSQL, requires `ACTIVE`. |
| `requireAdmin(cookieHeader)` | `requireAppUser` + role `ADMIN` or `SUPER_ADMIN`. |
| `requireSuperAdmin(cookieHeader)` | `requireAppUser` + role `SUPER_ADMIN`. |
| `findAppUserByFirebaseUid(uid)` | Fails closed on missing/ambiguous mappings. |
| `getAppUser(cookieHeader)` | Non-throwing variant for rendering. |

Failure reasons map to HTTP in `lib/auth/http.ts`:

| Reason | HTTP |
|---|---|
| Missing/invalid cookie, no mapping, ambiguous mapping | 401 |
| `SUSPENDED`, `DISABLED`, `FORBIDDEN` | 403 |
| Unexpected error | 500 |

Roles and statuses are read from PostgreSQL on every request. Firebase custom
claims, the frontend, and request bodies are never trusted for authorization.

---

## 8. Role and permission matrix

| Action | CUSTOMER | ADMIN | SUPER_ADMIN |
|---|---|---|---|
| Use scanner, zones, quotes, exports | yes | yes | yes |
| Resume own scan job | yes | yes | yes |
| Provision customers | no | yes | yes |
| Suspend / re-enable / disable customers | no | yes | yes |
| Suspend / re-enable / disable administrators | no | no | yes |
| Change roles | no | no | yes |
| Create/promote an administrator | no | no | yes |
| Bootstrap super admin | operator script only | — | — |

Additional invariants:

* No self-service role change.
* The last active `SUPER_ADMIN` cannot be suspended, disabled or demoted.
* The last active administrator cannot be suspended or disabled.
* Admin rights are never derived from email domain or client claims.

---

## 9. Super-admin bootstrap

The operator creates the Firebase email/password account **first**, in the
Firebase console. The script never invents credentials and never creates a
Firebase account.

Procedure against a disposable/target database:

```bash
FIREBASE_PROJECT_ID="..." \
FIREBASE_CLIENT_EMAIL="..." \
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" \
BOOTSTRAP_DATABASE_URL="postgresql://...direct-neon-host..." \
EXPECTED_BOOTSTRAP_HOST="ep-...aws.neon.tech" \
FORBIDDEN_DATABASE_HOST="prod-host" \
ALLOW_SUPER_ADMIN_BOOTSTRAP=YES \
SUPER_ADMIN_FIREBASE_UID="<uid-from-firebase-console>" \
SUPER_ADMIN_EMAIL="operator@example.com" \
npm run auth:bootstrap-super-admin
```

`--uid=<uid>` and `--email=<email>` may be used instead of the two
`SUPER_ADMIN_*` variables.

Safety properties:

* uses only `BOOTSTRAP_DATABASE_URL`; never falls back to `DATABASE_URL`,
* refuses `NODE_ENV=production`, pooled hosts, non-Neon hosts, and host
  mismatches,
* verifies the Firebase UID exists and its email matches exactly,
* cross-checks `getUserByEmail` resolves to the same UID,
* refuses to promote an existing `app_users` row, an existing identity that is
  not already an active `SUPER_ADMIN`, or an ambiguous mapping,
* if the account is already an active `SUPER_ADMIN`, reports success without
  changing anything (safe rerun),
* creates `app_users` (role `SUPER_ADMIN`, status `ACTIVE`), the `FIREBASE`
  identity and the `SUPER_ADMIN_BOOTSTRAPPED` audit row in one transaction,
* prints no tokens, keys or connection strings.

Future administrators are created by a `SUPER_ADMIN` through the provisioning
role flow, never by editing Firebase claims.

---

## 10. Customer provisioning

`POST /api/admin/customers` (ADMIN or SUPER_ADMIN):

Request:

```json
{ "email": "customer@example.com", "displayName": "Optional Name" }
```

Steps:

1. normalize and validate the email;
2. reject an existing `app_users` email;
3. reject an existing Firebase account that is not already linked;
4. create a Firebase user **without a password**;
5. generate a password-reset/action link;
6. in one PostgreSQL transaction, insert:
   * `app_users` with role `CUSTOMER`, status `ACTIVE`,
   * `user_identities` with provider `FIREBASE`,
   * `admin_audit_log` with action `CUSTOMER_PROVISIONED` (no link stored);
7. return the link to the initiating admin only, with `Cache-Control: no-store`.

There is no automatic email. The admin shows the link to the customer once.

Failure handling:

* Firebase creation fails → no database rows; safe error.
* Database/identity/audit insert fails → the Firebase user is deleted
  (compensating cleanup), so no half-created account remains.
* Reset-link generation fails → same cleanup.
* A unique violation maps to `EMAIL_EXISTS`.
* The reset link is never logged and never persisted.

### Suspension, re-enable, disable

`PATCH /api/admin/users/:userId/status` with `{ "status": "SUSPENDED" }`,
`"ACTIVE"` or `"DISABLED"`.

* Status changes are audited (`USER_SUSPENDED`, `USER_ENABLED`, `USER_DISABLED`).
* Non-`ACTIVE` users have Firebase refresh tokens revoked, and each request
  checks PostgreSQL, so a valid Firebase cookie alone is not enough.
* Last-admin and last-super-admin protections apply.

### Role changes

`POST /api/admin/users/:userId/role` with `{ "role": "ADMIN" }` or
`{ "role": "CUSTOMER" }`.

* Super-admin only.
* `SUPER_ADMIN` cannot be assigned through this route.
* A user cannot change their own role.
* The last active super admin cannot be demoted.
* Audited as `USER_ROLE_CHANGED`.

---

## 11. Protected route migration

### App-user routes

The following now use `requireAppUser()` (no Kite login required):

* `/api/scanner/run` (GET resume lookup, POST start)
* `/api/scanner/batch`
* `/api/scanner/job/[jobId]`
* `/api/scanner/zones`
* `/api/scanner/aggregate`
* `/api/scanner/backfill`
* `/api/scanner/confluence`
* `/api/scanner/coverage`
* `/api/scanner/export`
* `/api/scanner/ingest`
* `/api/stocks`
* `/api/stocks/[symbol]`
* `/api/kite/quote`

The scanner page, dashboard, login page and header use the app session. Shared
zone results and market data remain global: they are not partitioned per
customer.

### Scan job ownership

* New jobs store `scan_jobs.initiator_user_id = app_users.user_id`.
* A customer may resume only jobs they initiated.
* A job created before Phase 2 (no `initiator_user_id`) may still be adopted by
  the browser holding the matching legacy Kite session hash; the first claim
  fills in the internal user id.
* A legacy hash never grants access to an internally owned job. Legacy jobs
  with no stored hash (or a request with no matching hash) fail closed.
* The `/run` + `/batch` browser-driven workflow, batch sizing, leasing, retries,
  resume checkpoints and global ingestion lock are unchanged.

### Market data

* Provider stages resolve the Phase 1.5 **system** connection first.
* No customer Kite login is required when a system connection is configured.
* A missing/unusable system connection returns a safe 503/market-data error, not
  a request to reconnect a personal Kite account.
* The optional customer-session fallback is controlled by
  `MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK` and must be false in production.
* Operator-only market-data routes keep their separate operator token. That
  token is never reused for Firebase admin authorization and is never exposed to
  the browser.

### Broker routes

`/api/kite/login`, `/api/kite/callback`, `/api/kite/status` and
`/api/kite/logout` remain broker-specific OAuth/session routes. They are not
the application login. The broker adapter and legacy Kite functionality are
untouched.

### Live Trade boundary

Live Trade still authenticates and resolves ownership through the Kite session
and Kite user id. Phase 2 does **not** migrate Live Trade ownership, does not
replace Kite user ids with Firebase/internal ids there, and modifies no Live
Trade data. A Firebase-only customer cannot use Live Trade until a later phase
migrates it.

---

## 12. Security properties

* No public registration route or page.
* No unauthenticated access to scanner, stock or quote APIs.
* Role/status always read from PostgreSQL; client-supplied roles are ignored.
* Every authenticated request re-checks `SUSPENDED`/`DISABLED`.
* Identity mapping is mandatory and must be unique; missing/ambiguous mappings
  fail closed.
* Session cookie: `HttpOnly`, `Secure` in production, `SameSite=Lax`, path `/`,
  five-day max age.
* Mutating auth/admin routes require a same-origin request, checked via
  `Origin`/`Sec-Fetch-Site`; absent `Origin` is rejected in production.
* Rate limiting (`auth_rate_limits`): session exchange 30 per 5 minutes per IP;
  provisioning 20 per hour per actor+IP; admin mutations 60 per hour per actor;
  logout-all 10 per hour per user.
  The limiter **fails closed**. If PostgreSQL cannot be reached or the
  rate-limit query fails, the route returns `503 RATE_LIMIT_UNAVAILABLE` with a
  `Retry-After` header instead of allowing the attempt. The database error is
  logged server-side and never returned to the client. The counters persist in
  PostgreSQL, so limits resume automatically when the database recovers.
* Safe error messages: no stack traces, tokens, connection strings or reset
  links in responses or logs.
* No secrets in Git; `.env*` is ignored. No Firebase credential is hardcoded.
* Admin/operator authorization is separate from Firebase admin authorization.
* Scan job access is scoped to the initiating internal user.

### Known residual risks

* Browser-driven scans pause when the browser closes (unchanged; no server-side
  scheduled workers in this phase).
* `checkRevoked=true` adds a Firebase Admin call per authenticated request. This
  is intentional for immediate suspension enforcement and should be measured
  under load.
* Rate limiting is database-backed fixed-window and fails closed during a
  database outage. An external limiter is a future availability hardening
  option, not a correctness requirement.
* `logout-all` depends on Firebase revocation propagation across regions; the
  current device is signed out immediately, other devices shortly after.
* Legacy in-flight jobs fall back to the Kite session hash for adoption only;
  once claimed they become app-user-owned. Legacy jobs without a hash are
  intentionally inaccessible.

---

## 13. Testing

Unit/contract tests (no credentials, no database):

```bash
npx jest __tests__/auth __tests__/identity/phase2-schema.test.ts
npx jest __tests__/scanner/jobs.test.ts __tests__/scanner/batchRunner.test.ts
npm test
```

Covered:

* valid, invalid/revoked, missing-mapping, ambiguous-mapping, suspended and
  disabled sessions;
* customer denied admin, admin denied super-admin, role resolution from the
  database;
* session route status codes, origin rejection, cookie attributes;
* normal logout stays cookie-only; logout-all revokes Firebase sessions and
  fails safely without clearing the cookie when revocation fails;
* rate limiter allow/deny, connection failure, query failure and recovery,
  including 503 fail-closed responses for every sensitive route;
* provisioning success, duplicate email, unlinked Firebase account, Firebase
  failure, reset-link failure, database failure, compensation, unique
  violation, audit rows and link non-persistence;
* status/role least privilege, self-change block, last-admin protection;
* scanner app-user ownership, legacy adoption, cross-user isolation and
  fail-closed legacy job reads;
* Phase 1 → Phase 2 dependency, `provider_user_id` mapping and
  migration/operator-script static guards.

Disposable PostgreSQL integration tests (skipped unless explicitly pointed at a
test database):

```bash
PHASE2_TEST_DATABASE_URL="postgresql://...disposable..." \
PHASE2_PSQL_BIN=psql \
npx jest tests/phase2/auth-schema.integration.test.ts
```

They create no production data, never read `DATABASE_URL`, and cover the full
expected-column contract, key column types and defaults, role default/check,
identity uniqueness and cascade, owner foreign-key rejection, nullable job
owner, `ON DELETE SET NULL`, rate-limit primary key/constraint and migration
idempotency.

Other verification:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

---

## 14. Remaining blockers / follow-ups

* Firebase project and service-account credentials must be provisioned by the
  operator for the target environment.
* The Phase 2 migration has not been applied to production and must be run
  against a disposable/staging database first.
* The first super admin must be bootstrapped with the operator procedure above.
* Existing customers need a `user_identities` mapping before they can sign in;
  provisioning creates one for new customers.
* Live Trade remains Kite-only until a later ownership migration.
* Admin operations currently have API endpoints only; the admin dashboard UI is
  out of scope for Phase 2.
* No subscription, expiry or payment enforcement exists in this phase.

Phase 2.1 stops here. Phase 3 is not started.
