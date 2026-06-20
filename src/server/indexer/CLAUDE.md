# Server: Indexer (App View)

Last verified: 2026-06-20

## Purpose
A global-singleton App View over `space.rsss.*` records. It tails the
Bluesky Jetstream firehose on a timer, upserts matching records into a
`items` SQLite index keyed by `at://` URI, and serves a read-only feed.
It is server-authoritative and never written from the client.

## Contracts

### `RsssIndexerDO` (`src/server/durable-objects/indexer.ts`)
- **Singleton**: resolved by `idFromName('rsss-indexer')` only
  (`getIndexerDO` in `src/server/index.ts`). There is exactly one instance.
- **Storage**: `items` table (PK `uri`; columns `did, collection, rkey,
  cid, record, time_us, indexed_at`) plus a `cursor` storage key.
  Bound as `INDEXER_DO`, wired with a `v5` sqlite migration in all three
  `wrangler.jsonc` env blocks.
- **Internal routes** (DO-only, reached via the worker proxy):
  - `GET /internal/index/feed?collection=&did=&limit=` — `time_us DESC`,
    `limit` clamped to `[1,200]` (default 50), `record` JSON-parsed.
  - `GET /internal/index/stats` — `{ items, cursor }`.
  - `POST /internal/dev/drain-now` — dev-gated (see root invariants).

### `applyCommit` (`src/server/indexer/apply-commit.ts`)
- Idempotent `uri`-keyed upsert/delete from a Jetstream commit. `delete`
  removes by `uri`; `create`/`update` drop the event when `cid` is missing
  or `isValidRecord` rejects the record, else `ON CONFLICT(uri)` upserts.

### `drainOnce` (`src/server/indexer/drain.ts`)
- Bounded single drain. Returns the advanced cursor (`time_us`). Stops on
  the first of: idle (`IDLE_MS` 2s of silence), live-edge
  (`CAUGHT_UP_US`, within 5s of now), wall budget (`MAX_WALL_MS` 20s), or
  socket close. Persists in arrival order; advances `last` only after a
  successful `apply` — a persist failure rejects without advancing.
- `jetstreamUrl(cursor, base)` builds the subscribe URL
  (`wantedCollections=space.rsss.*`). `openJetstreamSocketWithFailover`
  tries the primary host, then the secondary on an open failure,
  preserving the query string. `open` is injectable for tests.

### `isValidRecord` (`src/shared/lexicons/validate.ts`)
- Lenient lexicon-validation boundary for untrusted firehose records.
  Returns `false` for an unknown collection, a non-object record, a
  `$type` that disagrees with the collection, a missing/empty required
  string field, or a declared property with the wrong type. Extra keys
  are tolerated.

### Worker read API (`src/server/index.ts`)
- `GET /api/index/feed` — `requireAuth`; forwards the query string to the
  singleton; `404` when `INDEXER_DO` is unbound. Registered BEFORE the
  `/api` `dataRouter` mount. The first authed read is the production
  cold-start arming path (constructor arms the alarm).

## Dependencies
- **Uses**: Cloudflare Jetstream firehose (`fetch` WebSocket upgrade),
  DO SQLite, `src/shared/lexicons` (`isValidRecord`, `rsssLexicons`).
- **Used by**: client feed reads via `GET /api/index/feed`.
- **Boundary**: the index is read-only to clients. Only `applyCommit`
  (driven by the drain) writes the `items` table.

## Key Decisions
- **Live-from-now on a null cursor**: a fresh singleton starts at the live
  edge; records committed before first construction are not backfilled.
- **Cursor advances only when it moves forward** (`runDrain` guards
  `next > (cursor ?? 0)`), so a no-progress drain never rewinds.
- **Firehose is untrusted**: every record passes `isValidRecord` and a
  `cid` presence check before insert.
- **Backfill is out of scope**: history older than Jetstream's replay
  window (`event-ttl`, ~24h) is a separate one-shot job, not this DO.

## Invariants
- One singleton (`idFromName('rsss-indexer')`); never per-user.
- `applyCommit` is idempotent — replays and overlapping cursors converge.
- The alarm reschedules BEFORE the fallible drain (root invariant).
- `/internal/dev/drain-now` is dev-gated at the DO layer too (root
  invariant); the worker route is gated independently.

## Key Files
- `src/server/durable-objects/indexer.ts` — DO, alarm, router, storage
- `src/server/indexer/drain.ts` — `drainOnce`, Jetstream socket + failover
- `src/server/indexer/apply-commit.ts` — `applyCommit` upsert/delete
- `src/server/indexer/types.ts` — Jetstream event types
- `src/shared/lexicons/validate.ts` — `isValidRecord`

## Gotchas
- `openJetstreamSocket` reads `Response.webSocket`, a Workers-runtime-only
  field; it runs only on the live edge and tests inject a fake opener.
- The index trails the network by up to one alarm interval
  (`DRAIN_INTERVAL_MS`, 60s) plus firehose propagation — not real-time.
