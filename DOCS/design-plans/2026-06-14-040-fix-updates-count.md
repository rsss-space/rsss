# "N updates" Count Accuracy + Freshness Design

## Summary

This plan addresses three related but independent weaknesses in how the "N
updates" pending-count header behaves. Diagnosis was done first against the
live local development database before any fixes were designed. The
conclusion: the count math itself is correct, background feed discovery simply
never runs in the local dev environment (a known limitation of the Cloudflare
Workers local runtime with Durable Object alarms), and a tab that has been
open for a while has no way to refresh its count short of a hard reload.

The approach is a targeted three-strand fix. Strand 1 adds a regression test
that pins the verified-correct SQL logic so it cannot silently break in the
future. Strand 2 hardens the production alarm loop so an overdue alarm heals
itself on the next cold start, and adds a dev-only `POST /api/dev/poll-now`
endpoint that runs the real discovery path without advancing the "last read"
cursor — decoupling discovery from consumption so the pending count can be
observed growing. Strand 3 leverages that endpoint to verify the existing
WebSocket push reaches an open tab, and adds a focus/visibility handler so a
tab whose live socket was down re-fetches the canonical count when the user
returns to it. No count semantics, cache policies, or transport architecture
are changed.

## Definition of Done

This is a diagnose-first effort, not an assumed bug fix. There are three
strands.

1. **Correctness (diagnose, don't assume a bug).** Confirm "6" is genuinely
   the server's current truth in the local dev DB — per-feed counts sum to
   the header value, and `getFeedUpdateCounts()` computes what it should.
   "It is correct" is an acceptable outcome for this strand.

2. **Discovery reliability.** Empirically determine whether the per-DO alarm
   fires *and reschedules itself* under `wrangler dev`. If it doesn't run /
   dies silently / fails to reschedule / swallows errors, make background
   discovery reliable — and give local dev a usable way to exercise discovery
   so the count can grow without a manual click.

3. **Live count delivery (SSE).** Make the `feed-updates-available` push
   reliable so an already-open tab's "N updates" text updates without a hard
   reload, with a fallback (refresh-on-focus or light polling) for when the
   socket is down.

### Explicitly out of scope

- Redefining what "pending / available" means — the current
  "fetched-but-not-yet-pulled" semantics stay.
- Cache-policy changes.
- Reworking the fact that "fetch updates" and "Refresh Feeds" are the same
  content-pull action. Only the passive "N updates" text needs to
  auto-update.

### Key sequencing constraint

Brainstorming and design MUST resolve the key open question first — **does
the DO alarm actually fire and reschedule under `wrangler dev`?** — because
the empirical answer forks how much of strand 2 is a real bug versus expected
dev behavior. Verify before designing the strand-2 fix.

## Acceptance Criteria

### 040-fix-updates-count.AC1: Pending-count math is correct and pinned
- **040-fix-updates-count.AC1.1 Success:** `getFeedUpdateCounts()` counts,
  per feed, items with `pub_date > last_pulled_at`.
- **040-fix-updates-count.AC1.2 Success:** a feed with `last_pulled_at IS
  NULL` counts all its items that have a non-null `pub_date`.
- **040-fix-updates-count.AC1.3 Success:** the header total equals the sum of
  the per-feed counts (one source of truth).
- **040-fix-updates-count.AC1.4 Edge:** items with `pub_date IS NULL`, and
  items where `pub_date == last_pulled_at` (boundary), are excluded from the
  count.

### 040-fix-updates-count.AC2: Background discovery alarm self-heals and cannot silently die
- **040-fix-updates-count.AC2.1 Success:** an alarm whose stored fire-time is
  in the past is re-armed on the next DO construction/request.
- **040-fix-updates-count.AC2.2 Success:** `alarm()` schedules the next alarm
  even when a pre-discovery step (e.g. `sweepStuckResolvingFeeds`/
  `readAccountActivity`) throws.
- **040-fix-updates-count.AC2.3 Guard:** the inactivity gate still
  intentionally suppresses rescheduling (DO goes dormant), and the
  pending-deletion path is unaffected.

### 040-fix-updates-count.AC3: Dev discovery endpoint exercises discovery without pulling
- **040-fix-updates-count.AC3.1 Success:** in dev, `POST /api/dev/poll-now`
  runs discovery and inserts new items (when the source has them) without
  changing `last_pulled_at`, so the pending count grows.
- **040-fix-updates-count.AC3.2 Failure:** when `NODE_ENV !== 'development'`,
  the endpoint returns 404.
- **040-fix-updates-count.AC3.3 Edge:** a feed returning 304 yields no new
  items and does not error; the response still reports
  `{ polledFeeds, newItems, counts }`.

### 040-fix-updates-count.AC4: Live delivery to an open tab + focus fallback
- **040-fix-updates-count.AC4.1 Success:** when discovery inserts items, an
  already-open tab's "N updates" updates without a hard reload
  (`feed-updates-available` received and applied).
- **040-fix-updates-count.AC4.2 Success:** returning to a backgrounded tab
  (`visibilitychange`→visible / `focus`) re-fetches the canonical count.
- **040-fix-updates-count.AC4.3 Edge:** the focus/visibility re-sync is
  guarded against redundant/duplicate fetches.

## Glossary

- **Durable Object (DO):** A Cloudflare Workers primitive that provides a
  single-threaded, stateful execution context with its own SQLite database. In
  this project each user has one (`RsssUserDO`) that owns feed subscriptions,
  items, and the polling alarm.
- **DO alarm:** A Cloudflare Durable Object feature that schedules a future
  call to the DO's `alarm()` method. The alarm persists in storage and fires
  once at the scheduled time; the handler must reschedule it for the next
  tick. Under `wrangler dev` (the local emulator), alarms stored in
  `.wrangler/state` stop firing after a hot reload — the documented root cause
  of the dev symptom.
- **`wrangler dev`:** The Cloudflare CLI command that runs the worker and
  Durable Objects locally for development. Its alarm behavior differs from
  production (see DO alarm above).
- **Miniflare / workerd:** The local runtime that `wrangler dev` uses to
  emulate Cloudflare Workers. The alarm-firing gap is tracked in workers-sdk
  issue #5948 and workerd issue #3566.
- **discovery vs. pulling:** Two distinct operations on a feed. _Discovery_
  fetches the feed source and inserts new items into the local DB,
  incrementing the pending count. _Pulling_ (also called "refresh") advances
  `last_pulled_at` to the current `MAX(pub_date)`, zeroing the pending count
  for that feed. The key dev problem is that the only user-visible action
  (manual refresh) does both, so the count resets immediately.
- **`last_pulled_at`:** A per-feed timestamp column in the DO SQLite database
  recording when the user last explicitly pulled (read) that feed. The pending
  count for a feed is `items where pub_date > last_pulled_at`.
- **`getFeedUpdateCounts()`:** The DO method that computes per-feed pending
  counts and their sum. Strand 1 pins this logic with a regression test.
- **`advanceFeedCursor()`:** The DO method that writes a new `last_pulled_at`,
  zeroing the pending count. The dev endpoint deliberately does not call this.
- **`ensureFeedRefreshArmed()`:** The DO method that conditionally sets the
  next alarm. The strand-2 hardening extends it to also re-arm when the stored
  alarm time is already in the past.
- **`nextDueAt`:** A per-feed value that throttles how often a given feed is
  re-fetched (e.g., once per hour). The dev endpoint ignores this so it can be
  called repeatedly.
- **`etag` / `If-None-Match` / 304:** HTTP conditional-request headers. A
  server returns 304 Not Modified when the feed content has not changed since
  the last fetch; the client must not treat this as an error. The dev endpoint
  handles 304 correctly (no new items, no error).
- **`feed-updates-available`:** The WebSocket broadcast message the DO emits
  after inserting new items. The client listens for this to update the "N
  updates" header without a reload.
- **`visibilitychange`:** A browser DOM event that fires when a tab becomes
  hidden or visible again (e.g., switching tabs). The strand-3 fallback uses
  this to re-fetch the count when a user returns to a backgrounded tab.
- **`blockConcurrencyWhile`:** A Durable Object API method that holds an
  exclusive lock on the DO while an async initializer runs. The alarm
  self-heal runs here on cold start so it is atomic with respect to other
  requests.
- **`sweepStuckResolvingFeeds` / `readAccountActivity`:** Two fallible
  pre-discovery steps that currently run before `scheduleNextFeedRefresh()` in
  the `alarm()` handler. If either throws, the loop dies without rescheduling
  — the bug strand 2 fixes.
- **`sql-fake.ts` / `fakeResult(rows)`:** A shared test helper that stubs the
  DO's `SqlStorageCursor` interface. Project convention requires using this
  fake for all DO SQL handler tests so that `.one()` misuse on optional-row
  queries fails loudly.
- **`NODE_ENV`:** An environment variable set to `'development'` locally (via
  `.dev.vars`) and to `'staging'`/`'production'` in deployed environments. The
  dev endpoint gate uses this exact check, following an established pattern
  already in the server router.
- **`wrangler.jsonc`:** The Cloudflare Workers configuration file. It sets
  `NODE_ENV` per environment, controlling which routes and behaviors are
  active.

## Diagnosis (empirical)

The key open question was resolved empirically against the live local-dev DO
state (`.wrangler/state/v3/do/rsss-RsssUserDO`) before any design decision.

**Strand 1 — the count is correct.** The exact `getFeedUpdateCounts()` query
run against the live DB confirmed the header value is the genuine sum of
per-feed pending counts (items with `pub_date > feeds.last_pulled_at`, or
`last_pulled_at IS NULL`). When the user saw "6", it was real; it now reads
0 because a manual refresh bumped both feeds' `last_pulled_at` to their
`MAX(pub_date)`. No logic bug.

**Strand 2 — the alarm is not firing in dev; the prod logic is sound.** The
scheduled alarm in `_cf_METADATA` was timestamped ~8 days in the past and had
never executed (a healthy alarm reschedules to `now + 60min` on every tick).
This matches the documented Miniflare/workerd behavior where DO alarms persist
in storage but stop firing after code hot-reloads (workers-sdk #5948,
workerd #3566). The production reschedule path itself is resilient
(reschedule runs before per-feed work, per-feed fetches are isolated in
try/catch, and 304 handling correctly preserves `etag`/`lastModified`). Two
factors make the dev symptom worse: the constructor only arms an alarm when
none exists, so it leaves a stale/overdue alarm stranded on restart; and the
only discovery action a developer invokes — manual refresh — also pulls,
zeroing the count. Discovery and consumption are therefore never decoupled in
dev, so the passive count can never be observed growing.

Note: one of the two test feeds (`brittanyellich.com`, a personal blog) has
genuinely not published since 2026-03-30, so part of the "feels too low"
intuition is real low volume, not a bug.

**Strand 3 — the push is wired but never exercised.** `feed-updates-available`
fires only from the polling/discovery path, which never runs in dev, so an
open tab is never updated there. The client also has no focus/visibility
refresh and no polling fallback, so a tab whose live socket dropped goes
stale until a hard reload.

## Architecture

This is predominantly a local-dev observability fix plus defensive hardening
and a client fallback — not a rewrite of the count, discovery, or push logic
(all of which are largely correct). Three independent changes, one per strand.

### Strand 1 — lock in correctness (no logic change)

`getFeedUpdateCounts()` (`src/server/durable-objects/index.ts:736`) and the
single writer of `last_pulled_at`, `advanceFeedCursor()` (`index.ts:761`),
stay as-is. The deliverable is a regression test that pins the count math so
future changes can't silently break it, plus the diagnosis recorded above.

### Strand 2 — alarm self-heal + dev discovery endpoint

Two server-side changes in `RsssUserDO`
(`src/server/durable-objects/index.ts`):

1. **Alarm self-heal (production hardening).**
   - `ensureFeedRefreshArmed()` (`index.ts:3674`) re-arms not only when
     `getAlarm()` is `null` but also when the stored alarm time is in the
     past. Because the constructor calls the arming path inside
     `blockConcurrencyWhile`, the next cold start / request heals an overdue
     alarm instead of leaving it stranded. Idempotent.
   - `alarm()` (`index.ts:3591`) guarantees the reschedule happens before any
     fallible discovery work (currently `sweepStuckResolvingFeeds()` and
     `readAccountActivity()` run before `scheduleNextFeedRefresh()`; a throw
     there kills the loop). The only non-rescheduling exits remain the
     intentional ones: the inactivity gate and pending-deletion execution.

2. **Dev discovery endpoint — `POST /api/dev/poll-now`.** A route that runs
   the real discovery path so the count can grow and the push can be
   exercised, decoupled from pulling.

   Contract:

   ```
   POST /api/dev/poll-now
     Guard:    NODE_ENV !== 'development'  -> 404
     Action:   force-fetch ALL feeds via the same fetchFeed() the alarm uses,
               ignoring per-feed nextDueAt, and WITHOUT calling
               advanceFeedCursor() (last_pulled_at untouched).
     Effects:  new items inserted with pub_date -> pending count grows;
               feed-updates-available broadcast fires per touched feed,
               exactly as a genuine alarm tick would. 304s yield nothing.
     Response: 200 { polledFeeds:number, newItems:number,
                     counts:Record<string, number> }
   ```

   The dev gate reuses the established `NODE_ENV === 'development'` pattern
   (e.g. `src/server/index.ts:1030`). The endpoint is unreachable in
   staging/production.

### Strand 3 — live delivery: verify, then add focus fallback

1. **Verify-then-fix (gated on the strand-2 endpoint).** With `poll-now`
   available, confirm an already-open tab receives `feed-updates-available`
   and updates the header without a reload. The push is wired
   (`index.ts:2729` broadcasts on `newItems > 0`; the client handler in
   `src/client/state.ts` updates counts), so the expected outcome is "it
   works, it was just never exercised." If it does not reach the tab, fix the
   broadcast; otherwise no push change.

2. **Focus/visibility fallback.** Add a `visibilitychange`→visible / window
   `focus` handler in `src/client/state.ts`, alongside the existing
   `online`/WS-reconnect handlers that already call `State.loadFeedStatus`.
   Returning to a backgrounded tab re-syncs the canonical count, covering the
   socket-was-down case. Guarded against redundant calls.

   Transport note: the live channel is the WebSocket `broadcast()`
   (LIVE_PING/LIVE_PONG hibernation), though the clarification calls it "SSE."
   The existing transport is retained; "make the push reliable" means verify
   plus the focus fallback, not re-architecting the channel.

## Existing Patterns

This design follows established patterns; it introduces no new architecture.

- **Dev-gated server route:** `src/server/index.ts:1030` already guards a
  route with `c.env.NODE_ENV !== 'development'`. `poll-now` reuses this exact
  gate. `NODE_ENV` is set per environment in `wrangler.jsonc`
  (`staging`/`production`) and via `.dev.vars` locally.
- **Discovery path reuse:** the dev endpoint calls the same `fetchFeed()` /
  per-feed refresh code the alarm uses (`index.ts:2566`, `3689`), so it
  exercises the genuine path rather than a parallel implementation. The
  established rule that only the two manual-refresh endpoints
  (`index.ts:1853`, `1880`) call `advanceFeedCursor()` is preserved — the dev
  endpoint deliberately does not pull.
- **Idempotent alarm arming:** `ensureFeedRefreshArmed()` (`index.ts:3674`)
  already does a `getAlarm()`-guarded conditional `setAlarm()`; the self-heal
  extends that same method's condition rather than adding a new mechanism.
- **DO SQL testing:** DO handlers are tested with the shared fake at
  `test/helpers/sql-fake.ts` (`fakeResult(rows)`), per the project's
  correctness conventions. The strand-1 and alarm tests use this fake.
- **Client live-state handlers:** `src/client/state.ts` already centralizes
  re-sync triggers (initial load, `online`, WS reconnect, live events) that
  call `State.loadFeedStatus`. The focus/visibility handler is added in the
  same place, following the same shape.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Lock in count correctness (Strand 1)
**Goal:** Pin the verified-correct pending-count math with a regression test;
record the diagnosis.

**Components:**
- Test for `getFeedUpdateCounts()` in the DO test suite (alongside existing
  DO tests), using `test/helpers/sql-fake.ts`. Fixture mixes `last_pulled_at`
  of {null, past, equal-to-`MAX(pub_date)`} and items with/without
  `pub_date`; asserts per-feed numeric counts and the summed total.
- No change to `getFeedUpdateCounts()` or `advanceFeedCursor()`.

**Dependencies:** None.

**Done when:** The new test passes and fails if the count predicate is
altered (e.g. `>` flipped to `>=`, or the `last_pulled_at IS NULL` branch
removed). `npm test && npm run lint` green.

**Covers:** 040-fix-updates-count.AC1.1, .AC1.2, .AC1.3, .AC1.4
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Alarm self-heal (Strand 2 hardening)
**Goal:** A stale/overdue alarm heals on next construction/request, and the
alarm loop can never die before rescheduling.

**Components:**
- `ensureFeedRefreshArmed()` (`src/server/durable-objects/index.ts:3674`) —
  extend the arm condition to also fire when the stored alarm time is in the
  past.
- `alarm()` (`index.ts:3591`) — guarantee `scheduleNextFeedRefresh()` runs
  before any fallible discovery work; preserve the inactivity-gate and
  pending-deletion early exits as the only non-rescheduling paths.
- DO tests (`test/helpers/sql-fake.ts` + storage/alarm fakes): overdue alarm
  is re-armed; reschedule still occurs when a pre-discovery step throws;
  inactivity gate still suppresses rescheduling.

**Dependencies:** None (independent of Phase 1).

**Done when:** Tests prove re-arm-on-overdue, reschedule-survives-throw, and
inactivity-gate-still-dormant. `npm test && npm run lint` green.

**Covers:** 040-fix-updates-count.AC2.1, .AC2.2, .AC2.3
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Dev discovery endpoint (Strand 2 affordance)
**Goal:** A dev-only way to run discovery without pulling, so the count grows
and the push can be exercised.

**Components:**
- `POST /api/dev/poll-now` mounted in the worker/DO router, guarded by
  `NODE_ENV !== 'development'` (pattern from `src/server/index.ts:1030`).
- Handler invokes the shared discovery path over all feeds, ignoring
  `nextDueAt`, without `advanceFeedCursor()`; returns
  `{ polledFeeds, newItems, counts }`.
- Tests: endpoint returns 404 when `NODE_ENV !== 'development'`; in dev it
  runs discovery and does NOT advance `last_pulled_at` (count not zeroed).

**Dependencies:** Phase 2 (shares the discovery/alarm code being hardened),
though it can be built in parallel if Phase 2 lands first.

**Done when:** Endpoint is 404 outside dev; in dev a call inserts new items
(when the source has them) and leaves `last_pulled_at` unchanged. Tests pass;
`npm test && npm run lint` green.

**Covers:** 040-fix-updates-count.AC3.1, .AC3.2, .AC3.3
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Live delivery verify + focus fallback (Strand 3)
**Goal:** An open tab updates "N updates" without a reload when items are
discovered, and recovers a fresh count when its socket was down.

**Components:**
- Manual verification (using Phase 3's `poll-now`) that an open tab receives
  `feed-updates-available` and updates the header. Fix the broadcast only if
  verification shows it does not arrive.
- `visibilitychange`→visible / window `focus` handler in
  `src/client/state.ts`, beside the existing `online`/reconnect re-sync
  handlers, calling `State.loadFeedStatus`; guarded against redundant calls.
- Test: the focus/visibility handler triggers `loadFeedStatus`. No brittle
  DOM-text assertions.

**Dependencies:** Phase 3 (the dev endpoint is how this is exercised).

**Done when:** With a tab open, a `poll-now` call updates the header count
without reload; returning to a backgrounded tab re-fetches the count. Test
passes; `npm test && npm run lint` green.

**Covers:** 040-fix-updates-count.AC4.1, .AC4.2, .AC4.3
<!-- END_PHASE_4 -->

## Additional Considerations

**Self-heal fire timing.** When `ensureFeedRefreshArmed()` re-arms an overdue
alarm it should schedule a near-immediate fire (not `now + 60min`), so the
heal actually runs a discovery pass promptly. It must not create a tight loop:
once `alarm()` runs it reschedules to `now + interval`, returning to the
healthy cadence.

**Dev endpoint and `nextDueAt`.** Forcing discovery ignores per-feed
`nextDueAt` so the endpoint is usable repeatedly within an hour. It does not
bypass `etag`/`If-None-Match`; a feed returning 304 yields no items by design.
This is honest behavior, not a bug — to watch the count grow, point at a feed
with genuinely new content.

**Production safety of the dev endpoint.** The route is gated to
`NODE_ENV === 'development'` and returns 404 otherwise; it is never mounted in
a way that is reachable from staging/production. A test asserts the 404 to
prevent regressions that would expose an unauthenticated discovery trigger.

**Strand 3 is verify-first.** The push may already work end-to-end once
discovery can be triggered; the plan does not assume a broadcast bug. Any
broadcast fix is contingent on verification failing.

