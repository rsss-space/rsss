# Human Test Plan: Scheduled-drain ingestion

Covers the runtime-only behaviors of the `space.rsss.*` App View that the
esbuild->node automated harness cannot exercise. All 36 acceptance criteria
(scheduled-drain.AC1.1-AC5.5) have passing automated coverage; this plan
verifies the live-runtime seams: real outbound WebSocket I/O, the live DO alarm
lifecycle, and the full ingest pipeline over a real socket.

## Prerequisites

- Local checkout at HEAD `d2e73bc` with the scheduled-drain feature.
- `wrangler dev` running with `NODE_ENV=development` in `.dev.vars`. Confirm the
  dev port matches `APP_ORIGIN` (a mismatch yields a 403 "Cross-origin request
  rejected" on non-exempt POSTs).
- A valid authenticated session (complete OAuth login in the dev app) so
  `requireAuth`-gated routes are reachable; have the session cookie available
  for `curl` (or drive the requests from the logged-in browser).
- All six feature suites green in isolation. The run-all harness is RED at
  baseline from two pre-existing, unrelated failures (an `email.ts`
  Resend-retry `console.error` that trips tapout, and an intermittent
  `EADDRINUSE :::8123` in `test:lazy-html-handler`) -- do not treat that
  redness as a scheduled-drain regression.
- `INDEXER_DO` bound with the `v5` sqlite migration in the active
  `wrangler.jsonc` env block.

## Phase H1: Real outbound WebSocket open against a live Jetstream host

Purpose: exercise `openJetstreamSocket` (the `fetch`->`resp.webSocket`->
`.accept()` I/O that only exists on the Workers runtime) and the real-network
primary->secondary failover, neither of which the esbuild->node harness can run.

1. With `wrangler dev` up and authenticated, `POST /api/dev/drain-now` (e.g.
   `curl -X POST -b "<session cookie>" -H "sec-fetch-site: same-origin"
   http://localhost:<port>/api/dev/drain-now`). Expect HTTP 200; JSON body
   `{ before, after, newItems, cursor }`.
2. Inspect the response body: `before`/`after`/`newItems` are numbers; with
   few/no live `space.rsss.*` events `newItems` may be 0; `cursor` is a
   plausible recent microsecond `time_us` (~16 digits) advanced past the prior
   state.
3. Confirm the call returned promptly (a few seconds, not ~20s): the drain
   reached live-edge or idle quickly; it did not run to the 20s `MAX_WALL_MS`
   backstop.
4. Check the `wrangler dev` console during the drain: no error logged; no
   `indexer drain failed` message.
5. Edit `JETSTREAM_HOSTS[0]` (in `src/server/indexer/drain.ts`) to an
   unreachable host, restart `wrangler dev`, repeat step 1: the drain still
   completes via the secondary host; response is the same 200 shape. Restore the
   original host afterward.

## Phase H2: End-to-end cold start and alarm self-perpetuation

Purpose: confirm the production cold-start arming path (first authed read
constructs the singleton, whose constructor arms the alarm) and that the
Cloudflare runtime fires and re-arms the alarm across DO re-instantiations -- the
live DO lifecycle the harness cannot simulate. AC4.2 covers only the in-process
constructor arming.

1. Deploy to staging (no prior alarm armed for the indexer singleton). Deploy
   succeeds.
2. Issue one authenticated `GET /api/index/feed` against staging: HTTP 200 with
   `{ items: [...] }` (possibly empty on a cold index); this read constructs the
   singleton and arms the alarm.
3. Note the current state via `GET /internal/index/stats` (or
   `/api/index/feed`): record `items` count and `cursor`.
4. Wait two-plus alarm intervals (~2+ minutes at the 60s `DRAIN_INTERVAL_MS`
   default) issuing NO further manual drain trigger.
5. Re-check `GET /internal/index/stats` (or the feed): `items`/`cursor` have
   advanced on their own, confirming the alarm fired and rescheduled without
   manual intervention.
6. Confirm a thrown drain does not strand the alarm: observe across at least one
   more interval after any transient drain error in logs. The alarm still
   re-arms and fires on the next tick (reschedule-before-drain contract);
   `cursor` continues to advance.

## Phase H3: Dev `drain-now` smoke under `wrangler dev` (full pipeline)

Purpose: exercise the full ingest pipeline against a real socket -- `runDrain`
-> `drainOnce` -> real `openJetstreamSocketWithFailover` -> `applyCommit` ->
SQLite -> cursor persist. Same live-socket constraint as H1.

1. Under `wrangler dev` (authenticated), `POST /api/dev/drain-now`: HTTP 200
   `{ before, after, newItems, cursor }`.
2. While the drain window is open, publish one or more `space.rsss.*` test
   records (e.g. a `space.rsss.feed.subscription` or `space.rsss.graph.follow`)
   via your PDS.
3. `POST /api/dev/drain-now` again after publishing: `newItems > 0`;
   `after > before`.
4. `GET /api/index/feed?collection=space.rsss.feed.subscription` (or the
   published collection): newly indexed records appear; each item's `record` is
   a parsed JSON object (not a string); items ordered `time_us DESC`.
5. `GET /api/index/feed?did=<publishing DID>`: returns only that DID's records.
6. `GET /api/index/feed?limit=1`: returns at most 1 item (limit honored).
7. Re-run `POST /api/dev/drain-now` over the same records with no new commits:
   idempotent -- `newItems` does not double-count already-indexed URIs
   (`ON CONFLICT(uri)` upsert); `after` unchanged.

## End-to-End: Publish -> drain -> read round trip

Purpose: validate that a record authored on the network surfaces correctly in
the read feed with the right shape and ordering -- the user-visible payoff of the
whole pipeline.

From a logged-in dev session, publish a `space.rsss.feed.subscription` record
with a known `feedUrl` and `createdAt`. Trigger `POST /api/dev/drain-now`. Then
`GET /api/index/feed?collection=space.rsss.feed.subscription&did=<your DID>` and
confirm the returned item's `uri` is
`at://<your DID>/space.rsss.feed.subscription/<rkey>`, its `record` is a parsed
object containing your `feedUrl`, and it appears ahead of any older record by
`time_us`. Then publish a malformed record (e.g. missing `createdAt`, or
`feedUrl` as a number) and confirm a subsequent drain + feed read does NOT
surface it (firehose-untrusted drop path; AC2.4/AC1.4 cover the unit boundary,
this confirms it end-to-end against a real commit).

## Human Verification Required

- H1 -- real WebSocket open + real-network failover. `Response.webSocket` exists
  only on the Workers runtime (not Node); a real host being down is a network
  condition the harness cannot reproduce. AC3.9 covers only the failover
  decision logic via an injected opener. Steps: Phase H1 1-5.
- H2 -- cold-start arming + alarm self-perpetuation. The live DO lifecycle (first
  authed read instantiating the DO, the platform firing the alarm on cadence,
  re-arming across instantiations) is not simulated by the harness. AC4.2 covers
  only in-process constructor arming. Steps: Phase H2 1-6.
- H3 -- full ingest pipeline over a real socket. Same live-socket constraint as
  H1; the dev route opens a real Jetstream connection. The DO-route dev gate
  (404 outside development) is already covered by AC4.6. Steps: Phase H3 1-7.

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1-AC1.9 | `test/lexicon-validate.ts` | E2E round trip (malformed-record drop) |
| AC2.1-AC2.7 | `test/apply-commit.ts` | H3 step 7 (idempotent upsert); E2E round trip |
| AC3.1-AC3.6, AC3.8 | `test/drain-once.ts` | H1 step 3 (live-edge/idle stop); H3 |
| AC3.7 (url builder) | `test/drain-once.ts` | H1 (real subscribe URL on the wire) |
| AC3.9 (failover logic) | `test/drain-once.ts` | H1 step 5 (real-network failover) |
| AC4.1 (reschedule-before-drain) | `test/indexer-alarm.ts` | H2 step 6 |
| AC4.2 (constructor arm) | `test/indexer-alarm.ts` | H2 steps 1-2 (production cold-start) |
| AC4.3-AC4.4 (overdue/idempotent arm) | `test/indexer-alarm.ts` | H2 step 5 (self-perpetuation) |
| AC4.5 (cursor persist) | `test/indexer-alarm.ts` | H1 step 2 / H3 step 7 |
| AC4.6 (dev gate) | `test/indexer-alarm.ts` | covered automatically; H3 happy path |
| AC5.1-AC5.4 (read query) | `test/indexer-feed.ts` | H3 steps 4-6; E2E round trip |
| AC5.5 (worker wiring) | `test/index-feed-route.ts` | H2 step 2; H3 step 4 |
