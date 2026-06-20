# Test Requirements — scheduled-drain ingestion

This document maps every acceptance criterion (`scheduled-drain.AC{N}.{M}`) from
the six-phase implementation plan to either an automated test or human
verification. The plan's seam design — an injected socket-opener
(`DrainDeps.open`), an injectable `now()`, and tunable thresholds — makes the
drain loop's stop-conditions, ordering, and cursor advance fully unit-testable
without a network. The only things that genuinely require a live host are the
real outbound-WebSocket I/O (`openJetstreamSocket`) and the end-to-end
cold-start/self-perpetuation chain; everything else is automated.

Every AC below maps to exactly one of: automated or human. The typecheck gate
throughout is "no new errors vs. the 25-error baseline" (see each phase's
Verification gate), not a clean `tsc`.

## Automated coverage

### Phase 2 — `isValidRecord` (AC1.x) — `test/lexicon-validate.ts` (unit)

Pure function; no mocks. Each test calls the real `isValidRecord` export.

| AC | Restatement | Type | File | Asserts |
|----|-------------|------|------|---------|
| AC1.1 | Valid `feed.subscription` (feedUrl + createdAt strings) | unit | `test/lexicon-validate.ts` | returns `true` |
| AC1.2 | Valid `graph.follow` (subject + createdAt strings) | unit | `test/lexicon-validate.ts` | returns `true` |
| AC1.3 | Unknown collection (`space.rsss.post`) | unit | `test/lexicon-validate.ts` | returns `false` (dropped) |
| AC1.4 | Known collection missing a required field | unit | `test/lexicon-validate.ts` | returns `false` |
| AC1.5 | `$type` present but ≠ collection | unit | `test/lexicon-validate.ts` | returns `false` |
| AC1.6 | Non-object record (`null`, `[]`, `'x'`, `42`) | unit | `test/lexicon-validate.ts` | each returns `false` |
| AC1.7 | Declared property present with non-string value (`feedUrl: 123`) | unit | `test/lexicon-validate.ts` | returns `false` |
| AC1.8 | Required fields + extra undeclared key | unit | `test/lexicon-validate.ts` | returns `true` (lenient) |
| AC1.9 | Optional `title` typed (string valid; `title: 123` invalid) | unit | `test/lexicon-validate.ts` | `true` then `false` (optional-property type branch) |

### Phase 3 — `applyCommit` (AC2.x) — `test/apply-commit.ts` (unit)

Hand-rolled fake `SqlStorage` records every `exec(query, ...binds)` and returns
`fakeResult([])` (from `./helpers/sql-fake.js`). Asserts the SQL behavior the
index depends on, not internal wiring.

| AC | Restatement | Type | File | Asserts |
|----|-------------|------|------|---------|
| AC2.1 | `create` of valid record → upsert | unit | `test/apply-commit.ts` | exactly one `exec`; query matches `INSERT INTO items` + `ON CONFLICT(uri) DO UPDATE`; 8 binds, 8th is `typeof number` |
| AC2.2 | `update` of valid record → same upsert | unit | `test/apply-commit.ts` | identical upsert exec |
| AC2.3 | `delete` op | unit | `test/apply-commit.ts` | exactly one `exec`; `DELETE FROM items WHERE uri = ?`; binds `[uri]`; no validation/insert |
| AC2.4 | Off-lexicon / missing-required create | unit | `test/apply-commit.ts` | zero `exec` calls (each case) |
| AC2.5 | URI format | unit | `test/apply-commit.ts` | `uri` bind equals `at://<did>/<collection>/<rkey>` |
| AC2.6 | Idempotent write contract | unit | `test/apply-commit.ts` | create/update query contains `ON CONFLICT(uri)` |
| AC2.7 | Missing/empty `cid` on create/update | unit | `test/apply-commit.ts` | zero `exec` calls |

### Phase 4 — `drainOnce` / `jetstreamUrl` / failover (AC3.x) — `test/drain-once.ts` (unit)

`FakeSocket` implements `DrainSocket` (records listeners;
`emitMessage`/`emitClose`/`emitError`; `closed` flag). `deps.open` resolves the
fake; `deps.now` is a controllable closure; small `deps.idleMs` keeps idle waits
fast. No network.

| AC | Restatement | Type | File | Asserts |
|----|-------------|------|------|---------|
| AC3.1 | Idle stop after events then silence | unit | `test/drain-once.ts` | resolves once `idleMs` elapses with cursor = last event `time_us` |
| AC3.2 | Live-edge stop (within `caughtUpUs`) | unit | `test/drain-once.ts` | resolves promptly (well under `idleMs`) with that `time_us` |
| AC3.3 | Budget stop (`now` passes deadline) | unit | `test/drain-once.ts` | resolves on budget with a small `maxWallMs` |
| AC3.4 | In-order persist | unit | `test/drain-once.ts` | `apply` receives `[e1,e2,e3]` in order; cursor = `e3.time_us` |
| AC3.5 | Persist-before-advance on apply failure | unit | `test/drain-once.ts` | `apply` throws on 2nd event → `drainOnce` rejects, cursor not advanced |
| AC3.6 | Socket `close` | unit | `test/drain-once.ts` | resolves with current cursor; `fakeSocket.closed === true` |
| AC3.7 | URL builder | unit | `test/drain-once.ts` | `jetstreamUrl(null)` → `https://`, `wantedCollections=space.rsss.*`, no `cursor`; `jetstreamUrl(123)` → `cursor=123` (parse via `new URL`, assert `searchParams`) |
| AC3.8 | Non-commit advances cursor without apply | unit | `test/drain-once.ts` | `kind:'identity'` event → `apply` not called; cursor = that event's `time_us` |
| AC3.9 | Host failover retry logic | unit | `test/drain-once.ts` | `openJetstreamSocketWithFailover(url, fakeOpen)`: primary host throws → returns secondary socket; 2nd call carries original query string |

Note: `openJetstreamSocket` (real `fetch`→`resp.webSocket`→`.accept()`) is
deliberately NOT unit-tested — it is thin I/O exercised only on the live runtime
(see Human verification H1). AC3.9 covers the failover *decision logic* via the
injected opener, not the real network failover.

### Phase 5 — alarm / `runDrain` / dev gate (AC4.x) — `test/indexer-alarm.ts` (unit/integration)

Constructs `RsssIndexerDO` with a fake `DurableObjectState` (records `setAlarm`;
returns chosen `getAlarm`; `get`/`put` for cursor; fake `sql` returning
`fakeResult`). Subclasses to inject `runDrain`/`drainDeps` seams. Registered
WITH the `cloudflare:workers` alias. Timing assertions use a ±tolerance window,
never exact timestamps.

| AC | Restatement | Type | File | Asserts |
|----|-------------|------|------|---------|
| AC4.1 | Reschedule before fallible drain | unit | `test/indexer-alarm.ts` | `runDrain` overridden to throw → `setAlarm` still called (~`now + DRAIN_INTERVAL_MS`); `alarm()` does not reject; reschedule precedes the throw. Test spies/restores `console.error` and asserts it was called (tapout console-error rule) |
| AC4.2 | Cold-start arm (constructor) | unit | `test/indexer-alarm.ts` | `getAlarm`→`null` → constructor armed `setAlarm(now + DRAIN_INTERVAL_MS)` within tolerance |
| AC4.3 | Overdue re-arm | unit | `test/indexer-alarm.ts` | `getAlarm`→past → `setAlarm(now + OVERDUE_ALARM_REARM_DELAY_MS)` |
| AC4.4 | Idempotent arm | unit | `test/indexer-alarm.ts` | `getAlarm`→far-future → `setAlarm` NOT called during arming |
| AC4.5 | Cursor persists after drain; null → live-from-now | unit/integration | `test/indexer-alarm.ts` | `drainDeps()` overridden with fake opener + 2 stale events; `get('cursor')`→null → `put('cursor', <2nd time_us>)`; opener url has NO `cursor` param |
| AC4.6 | Dev gate on DO route | unit/integration | `test/indexer-alarm.ts` | `POST /internal/dev/drain-now` with `NODE_ENV !== 'development'` → status 404; no drain attempted |

Note: AC4.2 verifies the *unit-level* constructor arming. The *production*
"deploy → first authed read arms the singleton → alarm self-perpetuates" chain
is Human verification H2 — the runtime's durable re-instantiation of the DO to
fire each alarm cannot be exercised in this harness.

### Phase 6 — read API (AC5.x)

DO route logic in `test/indexer-feed.ts` (unit; fake `ctx` with capturing
`sql.exec` returning `fakeResult`, driven via `do.fetch`). Worker wiring in
`test/index-feed-route.ts` (integration; mirrors `test/dev-poll-now.ts` — mock
env whose `INDEXER_DO.get().fetch()` records the DO path + search, session
injected for auth).

| AC | Restatement | Type | File | Asserts |
|----|-------------|------|------|---------|
| AC5.1 | Read returns items, record parsed, `time_us DESC` | unit | `test/indexer-feed.ts` | query has `ORDER BY time_us DESC`, no `WHERE`; `items[i].record` is the parsed object (not string); row order preserved |
| AC5.2 | Collection filter | unit | `test/indexer-feed.ts` | query contains `collection = ?`; binds include the value |
| AC5.3 | Did filter (and both together) | unit | `test/indexer-feed.ts` | query contains `did = ?`; both → `WHERE collection = ? AND did = ?` |
| AC5.4 | Limit clamp/default | unit | `test/indexer-feed.ts` | no `limit`→final bind `50`; `?limit=500`→`200`; `?limit=abc`→`50` |
| AC5.5 | Worker wiring (auth, forward, 404 when unbound) | integration | `test/index-feed-route.ts` | authed `GET /api/index/feed?collection=X` calls stub with `/internal/index/feed` + `?collection=X`, returns its body; `INDEXER_DO` absent → 404; no session → `requireAuth` 401, no stub call |

## Human verification

These three cannot be meaningfully automated in this harness because they
require real outbound-WebSocket I/O against a live Jetstream host and/or the
Cloudflare runtime's durable DO re-instantiation, neither of which exists in the
esbuild→node→tap-spec test path.

### H1 — Real outbound WebSocket open against a live Jetstream host

Covers: `openJetstreamSocket` (the thin `fetch`→`resp.webSocket`→`.accept()`
I/O) and `openJetstreamSocketWithFailover`'s *real-network* primary→secondary
fallback.

Why not automated: `Response.webSocket` exists only on the Workers runtime (not
Node); the plan explicitly leaves this function untested at the unit level. The
failover *retry logic* is unit-tested with an injected opener (AC3.9), but a real
host being down is a network condition the harness cannot reproduce.

Manual approach: Run `wrangler dev` with `NODE_ENV=development`, authenticate,
then `POST /api/dev/drain-now`. With few/no live `space.rsss.*` events it should
reach the live edge / idle and return quickly. Confirm the response shape
`{ before, after, newItems, cursor }`, that `cursor` is a plausible recent
`time_us` (advanced past `before`'s state), and that no error is logged. To
exercise real failover, point `JETSTREAM_HOSTS[0]` at an unreachable host and
confirm the drain still completes via the secondary.

### H2 — End-to-end cold start: deploy → first authenticated read arms the singleton → alarm self-perpetuates

Covers: the production cold-start arming path (Phase 6 read route constructs the
singleton, whose constructor arms the alarm per AC4.2) and the alarm
self-perpetuation (Cloudflare durably re-instantiates the DO to fire each alarm,
which reschedules first).

Why not automated: AC4.2 verifies constructor-level arming in isolation, but the
runtime behavior — first authed read instantiating the DO, then the platform
firing the alarm on the `DRAIN_INTERVAL_MS` cadence and the alarm re-arming
itself across instantiations — depends on the live DO lifecycle, which the test
harness does not simulate.

Manual approach: Deploy to staging. Issue an authenticated
`GET /api/index/feed` (no prior alarm). Then observe over two-plus intervals
(~2+ min at the 60s default) via `GET /internal/index/stats` (or the feed) that
`items`/`cursor` advance without any further manual trigger, confirming the
alarm is firing and rescheduling on its own. Confirm a thrown drain does not
strand the alarm (the alarm still re-arms on the next tick).

### H3 — Dev `drain-now` smoke under `wrangler dev`

Covers: the full ingest pipeline against a real socket (`runDrain` →
`drainOnce` → real `openJetstreamSocketWithFailover` → `applyCommit` → SQLite →
cursor persist).

Why not automated: same live-socket constraint as H1; the dev route opens a real
Jetstream connection.

Manual approach: As in H1, `POST /api/dev/drain-now` under `wrangler dev` and
observe the returned `{ before, after, newItems, cursor }`. If `space.rsss.*`
test records are published during the burst, confirm `newItems > 0` and that a
subsequent `GET /api/index/feed` returns them with `record` parsed and ordered
`time_us DESC`. The DO-route dev gate (404 outside development) is already
covered automatically by AC4.6.

## Coverage summary

Every acceptance criterion maps to exactly one of automated / human:

- AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC1.6, AC1.7, AC1.8, AC1.9 → automated (`test/lexicon-validate.ts`)
- AC2.1, AC2.2, AC2.3, AC2.4, AC2.5, AC2.6, AC2.7 → automated (`test/apply-commit.ts`)
- AC3.1, AC3.2, AC3.3, AC3.4, AC3.5, AC3.6, AC3.7, AC3.8, AC3.9 → automated (`test/drain-once.ts`)
- AC4.1, AC4.2, AC4.3, AC4.4, AC4.5, AC4.6 → automated (`test/indexer-alarm.ts`)
- AC5.1, AC5.2, AC5.3, AC5.4 → automated (`test/indexer-feed.ts`); AC5.5 → automated (`test/index-feed-route.ts`)

Total: 36 ACs, all automated. The three Human verification items (H1, H2, H3)
are NOT acceptance criteria — they are runtime/integration behaviors (real
socket I/O, live cold-start self-perpetuation) that back the automated seams but
cannot be exercised in the esbuild→node→tap-spec harness. AC3.9 (failover logic)
and AC4.2 (constructor arming) are automated at the seam level; their
real-network / real-lifecycle counterparts are observed under H1/H2.
