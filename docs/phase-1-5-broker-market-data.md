# Phase 1.5 — Broker Abstraction and System Market-Data Separation

Status: **implemented, awaiting operator credential provisioning.**

This phase separates *shared market data* (instruments, candles, quotes, zones)
from *customer broker sessions*, and introduces a provider seam so Kite is an
adapter rather than the application's only data source. It does **not** add
Upstox OAuth, Firebase login, subscriptions, payments or an admin panel, and it
does not change any scanner algorithm.

Anything marked *planned* or *future* below is a design decision, not code that
exists yet.

---

## 1. What changed, at a glance

| Area | Before | After |
|---|---|---|
| Instrument sync | Required a customer Kite token | Resolves a **system** market-data connection first |
| Daily / hourly candles | Kite SDK calls inside ingestion services | Provider adapter behind `MarketDataProvider` |
| Quotes (`/api/stocks`, `/api/kite/quote`) | Customer Kite token | System connection first, 503 when unavailable |
| Scanner ingestion | One browser-driven job at a time per job | Per-job lease **plus** a PostgreSQL global ingestion lease |
| Credentials | `kite_sessions` only | `market_data_connections` for the SYSTEM account; `kite_sessions` untouched |
| Provider surface | Kite-specific | Normalized types, error kinds and timestamps |

Existing scanner output, zone scoring, instrument ids (`instruments.instrument_id`)
and Live Trade behaviour are unchanged.

---

## 2. Provider interfaces

All modules live under `lib/market-data/`.

### 2.1 Normalized types — `lib/market-data/types.ts`

| Type | Purpose |
|---|---|
| `MarketDataProviderName` | `"KITE" \| "UPSTOX"` |
| `MarketDataCredentials` | `accessToken`, optional `apiKey`, optional `refreshToken`. `apiKey` is a public application identifier, not a secret. |
| `ProviderHistoricalCandle` | `timestamp: Date`, OHLCV numbers. Timestamps are absolute instants. |
| `ProviderInstrument` | Provider key, exchange, trading symbol, company name, instrument type, segment |
| `MarketDataContext` | `provider`, `credentials`, `source` (`SYSTEM` or `CUSTOMER_SESSION_COMPAT`), optional `connectionId` |
| `MarketDataProvider` | The seam: `listInstruments`, `getQuotes`, `getHistoricalCandles` |

No Kite SDK object crosses the seam. Services consume these structures only.

### 2.2 Provider registry — `lib/market-data/provider.ts`

A plain lookup with one entry (`KITE`). Adding Upstox means adding one adapter
and one registry entry; this is deliberately not a plugin framework. Asking for
an unimplemented provider throws `MarketDataUnavailableError` rather than
silently returning empty data.

### 2.3 Error normalization — `lib/market-data/errors.ts`

`classifyMarketDataProviderError(err, provider)` returns a stable kind:
`AUTH_EXPIRED`, `PERMISSION_DENIED`, `RATE_LIMITED`, `NETWORK`,
`INVALID_REQUEST`, `PROVIDER_ERROR`, plus `retryable`. It inspects Kite-style
`statusCode`/`error_type` and message patterns without requiring the raw error
to be an SDK class. Adapters rethrow provider errors unchanged, so the existing
`lib/scanner/retry.ts` transient/permanent classifier keeps working.

`MarketDataUnavailableError` (`code: MARKET_DATA_NOT_CONFIGURED`, `permanent:
true`) means no usable system connection exists. Routes map it to HTTP 503.
`retryable: false` for `AUTH_EXPIRED`/`PERMISSION_DENIED` prevents pointless
retry loops.

### 2.4 Timestamp normalization — `lib/market-data/timestamps.ts`

`normalizeProviderTimestamp(provider, value)` delegates to
`normalizeKiteTimestamp` for Kite. Kite's SDK turns zone-less IST wall clocks
into a `Date` in the *server's* timezone; the helper recovers the true IST
instant and emits ISO-8601 UTC or `null`. Future providers add their own case.

### 2.5 Instrument-key resolution — `lib/market-data/instrument-resolver.ts`

`instruments.instrument_id` is the canonical id and is never renumbered.

- Kite: the canonical id **is** the instrument token, so resolution is local.
- Other providers: `resolveProviderInstrumentKey` reads
  `instrument_aliases(provider, provider_instrument_key)` and throws when no
  alias exists.
- `upsertInstrumentAlias` adds or refreshes an alias without touching the
  canonical id.

### 2.6 Context compatibility — `lib/market-data/context.ts`

`MarketDataInput = MarketDataContext | KiteSession`. `toMarketDataContext`
wraps a raw `KiteSession` as `CUSTOMER_SESSION_COMPAT`. This keeps existing
call sites and tests working while the system path is rolled out. It never
touches the database and never reads credentials.

---

## 3. Kite adapter — `lib/market-data/kite-adapter.ts`

`kiteMarketDataProvider` implements the seam and preserves the previously
working wire behaviour:

- **Instruments**: `getInstruments("NSE")`, normalized and filtered to rows with
  a trading symbol and a numeric instrument token.
- **Quotes**: delegates to the existing `getQuotes` in `lib/kite-client`, keyed
  by symbol, returning the existing `QuoteData` shape.
- **Daily candles**: interval `day`; windows formatted as UTC calendar dates
  with `09:15:00` / `15:30:00` session bounds.
- **Hourly candles**: interval `60minute`; windows formatted as IST wall-clock
  `YYYY-MM-DD HH:MM:SS` without a zone suffix.
- **Timestamps**: the SDK `Date` is preserved exactly as before, so candle
  timestamps do not shift relative to existing data.
- **Chunking and rate limiting** stay in the ingestion services; the adapter is
  one provider request per call.

`/api/kite/quote`, `/api/stocks` and `/api/stocks/[symbol]` now resolve the
system context first, then call the same underlying Kite client helpers with
`{ accessToken, apiKey }`.

---

## 4. System market-data connections

### 4.1 Table — `market_data_connections`

Created by `db/migrations/2026-11-12-add-phase1-5-broker-market-data.sql`.

| Column | Notes |
|---|---|
| `connection_id` | `UUID` primary key |
| `provider` | `KITE` or `UPSTOX` |
| `designation` | constrained to `SYSTEM` |
| `label` | optional, 1–120 chars |
| `encrypted_access_token` | AES-256-GCM ciphertext, non-blank |
| `encrypted_refresh_token` | optional ciphertext |
| `token_expires_at` | optional |
| `status` | `ACTIVE`, `EXPIRED`, `REVOKED`, `ERROR` |
| `provider_metadata` | JSON **object**; holds non-secret data (e.g. public Kite API key) |
| `last_successful_use_at` | best-effort success marker |
| `created_at`, `updated_at` | timestamps |

There is **no `user_id` column**. A `UNIQUE (designation, provider)` constraint
allows exactly one SYSTEM connection per provider. Because `designation` is
constrained to `SYSTEM`, this table cannot quietly become a per-customer
broker-connection table; customer connections, if introduced later, must use a
separate table with a non-nullable owner.

### 4.2 Resolution rules — `lib/market-data/credentials.ts`

`resolveMarketDataContext({ provider, session })`:

1. Load the SYSTEM row for the provider.
2. If `ACTIVE`, decrypt and return a `SYSTEM` context. **System wins.**
3. If `REVOKED`/`ERROR`, never fall back. `ERROR` is fatal (503); a decrypt or
   tamper failure is marked `ERROR` rather than silently treated as `MISSING`.
4. If `EXPIRED` (status or past `token_expires_at`), mark it expired and, only
   when policy allows, use the temporary customer-session compatibility path.
5. If `MISSING`, same fallback policy.
6. Otherwise throw `MarketDataUnavailableError`.

The compatibility path is controlled by
`MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK`: `true`/`false` override; the
default is **enabled outside production and disabled in production**. It logs a
warning every time it is used. It never writes the customer token into
`market_data_connections`.

`revokeSystemMarketDataConnection` keeps the row for audit (`REVOKED`) and
discards the refresh-token ciphertext. Customer `kite_sessions` are unaffected.

### 4.3 Encryption and AAD

All credentials use the existing AES-256-GCM helper in `lib/crypto.ts`:

- Key: `KITE_TOKEN_ENCRYPTION_KEY` (64 hex characters = 32 bytes).
- Wire format: `base64(iv[12] || authTag[16] || ciphertext)`.
- New functions: `encryptWithAad` / `decryptWithAad`.
- AAD layout:
  `demandscan:market-data:v1:<PROVIDER>:<connectionId>:<access|refresh>`.

The AAD is authenticated but not stored. Decryption therefore fails unless the
ciphertext is read from the same provider, connection id and token kind it was
written for. Copying a ciphertext into another row does not make it
decryptable. The version segment allows a future binding change without
silently accepting old ciphertext.

The connection id is generated **before** encryption (a new row) and reused
for updates, which is what makes the binding stable across reconnects.
Plaintext tokens are never persisted, returned by an API, or logged. Log
messages contain only status text and connection ids.

### 4.4 Operator flow (temporary gate)

System credentials cannot be created from a customer session. Three operator
routes exist under `app/api/admin/market-data/`:

| Route | Method | Behaviour |
|---|---|---|
| `/kite/login` | POST | Verifies `x-market-data-admin-token`; creates a single-use state; returns the Kite login URL as JSON; sets the HttpOnly state cookie |
| `/kite/callback` | GET | Public OAuth redirect; verifies cookie state + atomically consumes the DB hash; exchanges the request token; stores encrypted credentials; redirects to `/?market_data=connected` |
| `/kite/revoke` | POST | Marks the connection `REVOKED`, discards refresh ciphertext |
| `/status` | GET | Safe metadata only: status, expiry, last use, whether API key / refresh token are configured |

Auth is a constant-time comparison against `MARKET_DATA_ADMIN_TOKEN`. This is a
deliberate temporary operator gate, **not** the final admin panel; Firebase
admin authorization replaces it in a later phase. No credential-mutating route
is unauthenticated.

OAuth state:

- 256 bits of entropy, 10-minute TTL.
- Plaintext lives only in an HttpOnly, `SameSite=Lax`, path-scoped cookie.
- Only its SHA-256 hash is stored in `market_data_oauth_states`.
- Callback compares cookie vs query in constant time, then consumes the hash
  atomically (`consumed_at IS NULL AND expires_at > NOW()`), so replay and
  concurrent double-use fail.
- Expired, never-consumed rows can be removed by `cleanupExpiredOAuthStates()`;
  no cron was added.

Required environment variables (not provisioned by this phase):
`MARKET_DATA_KITE_API_KEY`, `MARKET_DATA_KITE_API_SECRET`,
`MARKET_DATA_KITE_REDIRECT_URL`, `MARKET_DATA_ADMIN_TOKEN`, and the existing
`KITE_TOKEN_ENCRYPTION_KEY`.

### 4.5 Customer vs system isolation

- `kite_sessions` continues to hold customer tokens; it is not read or written
  by the system connection path.
- `market_data_connections` has no customer owner and is only reachable through
  server-side modules. No customer route reads or mutates it.
- Revoking the system connection does not log out any customer.
- Customer Live Trade data, notes, groups and plans are unchanged and still
  keyed by the existing customer/Kite ownership; they are never derived from
  the system connection.

---

## 5. Global ingestion lease — `lib/market-data/lock.ts`

Table `global_ingestion_locks` (PostgreSQL only, no in-memory state):

| Column | Notes |
|---|---|
| `lock_name` | primary key (`market-data:ingestion`) |
| `lease_owner` | random UUID per acquisition |
| `acquired_at`, `heartbeat_at` | timestamps |
| `lease_expires_at` | must be after `acquired_at` |
| `released_at` | `NULL` while held |

Behaviour:

- **Atomic acquire**: one
  `INSERT ... ON CONFLICT (lock_name) DO UPDATE ... WHERE released_at IS NOT NULL OR lease_expires_at < NOW() RETURNING`.
  A live lease cannot be stolen.
- **Contention**: acquisition returns `null`; callers return HTTP 409 with
  `code: INGESTION_IN_PROGRESS` and `retryAfterMs`, or defer the browser batch
  with `retryAfterMs: 15000`. Contention is not a failed scan.
- **Release**: scoped by `lock_name AND lease_owner`, so a worker whose lease
  expired cannot release the new owner's lease.
- **Stale recovery**: an expired lease is reclaimed by the same atomic upsert;
  no manual intervention is needed after a crash.
- **Renewal**: `renewGlobalIngestionLock` extends the lease only while the owner
  still holds it and it has not expired; `false` means the lease was lost.
- **Guaranteed release**: `finally` in both the batch runner and
  `/api/scanner/ingest`; release errors are logged and never mask the result.

Default lease is 120 seconds. The fire-and-forget ingest route heartbeats every
40 seconds. A batch invocation that overruns its lease can have a later batch
deferred, but the scan job checkpoint is preserved and resumes.

---

## 6. Browser-driven flow after changes

The execution model is unchanged: the browser starts and drives the scan.

1. Browser `POST /api/scanner/run`.
   - Customer auth is still required; the job is still owned by the customer's
     session hash for visibility and access control.
   - `processScanBatch` claims the per-job lease, then, for provider stages,
     acquires the global ingestion lease.
   - The provider context is resolved from the system connection (or the
     compatibility session if policy allows).
   - If no usable credentials exist, the route returns 503
     `MARKET_DATA_NOT_CONFIGURED` before any work starts.
   - If another ingestion holds the global lease, the job defers with
     `retryAfterMs` instead of calling the provider twice.
2. Browser continues `POST /api/scanner/batch`.
   - Each call processes one bounded slice: `SYNC_INSTRUMENTS`,
     `INGEST_DAILY`, `INGEST_HOURLY`, `AGGREGATE_DAILY`, `AGGREGATE_4H`,
     `DETECT_ZONES`, `LIFECYCLE`.
   - Only the first three stages hold the global lease and call the provider;
     aggregation and detection use shared database candles and hold only the
     per-job lease.
   - Checkpoints, `instrument_ids`, cursor and progress persist as before, so a
     closed browser pauses the scan and a reopened one resumes it.
3. `POST /api/scanner/ingest` (legacy synchronous kickoff).
   - Resolves the system context, acquires the global lease, releases it in
     `finally`, heartbeats while running, and returns 409 on contention.

There is no Vercel Cron and no scheduled worker.

---

## 7. Shared vs customer data

| Data | Ownership | Written from |
|---|---|---|
| `instruments`, `instrument_aliases` | shared | system provider sync |
| `daily_candles`, `hourly_candles`, aggregates | shared | system provider ingestion |
| `zones`, `scan_jobs`, `scan_batches` | shared scanner data; jobs carry the initiator's session hash for visibility | system provider ingestion + shared DB reads |
| `market_data_connections` | operator system | operator OAuth only |
| `kite_sessions` | customer | existing customer Kite login |
| Live Trade notes/groups/plans | customer | unchanged customer session |

Shared scanner data is stored once and never copied per customer. Customer data
is never inferred from the system connection, and Live Trade ownership is not
migrated in this phase.

---

## 8. Upstox readiness and blockers

Implemented now: the `UPSTOX` enum values, provider-neutral types, error kinds,
timestamp hook, `instrument_aliases` resolution, and a schema that already
accepts an UPSTOX SYSTEM row. The adapter registry deliberately has no Upstox
entry, so requesting Upstox fails closed.

Planned (not implemented): an Upstox adapter, Upstox OAuth, token exchange,
customer broker connections and production Upstox ingestion. Implementing them
requires decisions and credentials this phase does not have.

Blocking issues to resolve first:

1. **Licensing / redistribution.** A free Upstox API plan does not by itself
   grant the right to redistribute market data to other users. Written
   confirmation is required before any production Upstox ingestion. Until then,
   Upstox must not be used as a shared data source.
2. **No shared customer credentials.** One customer's Upstox credentials must
   never be used to distribute data. A future system connection needs an
   operator-owned Upstox application, exactly like the Kite SYSTEM row.
3. **Provider key mapping.** Upstox instrument keys differ from Kite tokens;
   every instrument needs an `instrument_aliases` row before it can be ingested.
4. **Historical interval/date semantics** differ from Kite and must be encoded
   in the adapter, not in scanner services.
5. **Market-data terms review** for caching and redistribution of quotes and
   candles.

None of these are invented or assumed satisfied. No Upstox token, key or
credential was created or used.

---

## 9. Database migration and contract

File: `db/migrations/2026-11-12-add-phase1-5-broker-market-data.sql`.

- Additive and idempotent: only `CREATE TABLE IF NOT EXISTS` and
  `CREATE INDEX IF NOT EXISTS`. No `ALTER`, `DROP`, `TRUNCATE` or `DELETE`.
- Three new tables only; existing tables are untouched.
- `db/expected-schema.js` lists the new columns.
- Targeted runner: `db/migrate-phase1-5.js` (`npm run db:phase1-5:migrate`).
  - Reads only `PHASE15_DATABASE_URL`; never falls back to `DATABASE_URL`.
  - Requires `ALLOW_PHASE15_MIGRATION=YES`, `EXPECTED_PHASE15_HOST`, refuses
    `FORBIDDEN_DATABASE_HOST`, Neon host mismatch, pooled hosts and
    `NODE_ENV=production`.
  - Executes only statements beginning with `CREATE`.
  - Verifies the three tables exist and prints no credentials.

The existing broad `db/migrate.js` was not changed and was not run.

---

## 10. Tests

Unit suites (`npx jest`):

- `__tests__/market-data/crypto-aad.test.ts` — AAD round-trip, cross-row /
  provider / kind rejection, tamper rejection, fresh IV, legacy compatibility,
  AAD format.
- `__tests__/market-data/errors-timestamps.test.ts` — every error kind,
  Upstox labels, auth-expired detection, timestamp normalization.
- `__tests__/market-data/kite-adapter.test.ts` — instrument normalization,
  quote delegation, daily/hourly intervals and wire date formats, numeric
  instrument-token validation.
- `__tests__/market-data/credentials.test.ts` — save/load/revoke, AAD binding,
  expiry, ERROR-vs-MISSING, no fallback after ERROR, five-minute touch throttle.
- `__tests__/market-data/lock.test.ts` — atomic acquire, reclaim clause, lease
  clamp, owner-scoped release, renewal, contention, release after success and
  failure.
- `__tests__/market-data/resolver-context.test.ts` — system wins, compat
  fallback policy, missing/expired/revoked handling.
- `__tests__/market-data/oauth-state.test.ts` — entropy, hashing, constant-time
  match, atomic consume, expiry.
- `__tests__/market-data/admin-auth.test.ts` — unconfigured, wrong and correct
  operator token.
- `__tests__/market-data/quote-routes.test.ts` — system token used, explicit
  fallback, 503 when unavailable, no fallback after ERROR, 401.
- `__tests__/scanner/batchRunnerMarketData.test.ts` — provider stages resolve
  system context, contention defers, release on success/failure, and two
  simultaneous scan initiations produce exactly one provider call.
- `__tests__/identity/phase1-5-schema.test.ts` — static contract checks.

Disposable-database integration suites (run only with explicit env vars):

- `tests/phase1-5/market-data.integration.test.ts` — applies `schema.sql` and
  every migration, re-applies Phase 1.5, then verifies the schema contract, no
  `user_id`, provider/designation/status/token/metadata constraints, one SYSTEM
  connection per provider, OAuth-state constraints, stale-lease reclaim with
  the application's exact upsert, and an AAD ciphertext round-trip through real
  storage including copied-row rejection.
- `tests/phase1/identity-schema.integration.test.ts` — re-run unchanged to
  confirm Phase 1 invariants still hold with the new migration in order.

Neither suite runs during a plain `npm test`, and neither reads `DATABASE_URL`.

---

## 11. Deployment and environment notes

New optional/temporary variables (all unset by default):

| Variable | Purpose |
|---|---|
| `MARKET_DATA_KITE_API_KEY` | Operator Kite application id |
| `MARKET_DATA_KITE_API_SECRET` | Operator Kite application secret |
| `MARKET_DATA_KITE_REDIRECT_URL` | Callback URL registered with Kite |
| `MARKET_DATA_ADMIN_TOKEN` | Temporary operator gate for admin routes |
| `MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK` | Explicit override of the compatibility policy |

Without these, customer routes that need shared market data return 503. The
compatibility fallback is off in production by default, so a production
deployment cannot silently keep using a customer token as the system source.

## 12. Not implemented (future phases)

- Firebase login, sessions and admin authorization.
- Upstox OAuth, adapter, token exchange or ingestion.
- Customer broker connections and a customer-facing connection UI.
- Subscriptions, payments, admin panel.
- Live Trade ownership migration or data import.
- Scheduled cleanup of expired OAuth states.
- Any change to scanner algorithms, scoring or the browser-driven model.
