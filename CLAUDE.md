# rsss Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-06-15

## Active Technologies
- Per-user Durable Object SQLite (server-authoritative); local (002-full-article-fetch)
- TypeScript (Cloudflare Workers + ES2022 lib) + Hono (server), Preact + `@preact/signals` (003-defer-new-feed-items)
- TypeScript (browser, ES2022 lib via Vite) + Preact, `@preact/signals`, `htm/preact` (006-sync-status-legend)
- N/A (pure UI; consumes existing client signals) (006-sync-status-legend)
- TypeScript (browser, ES2022 lib via Vite) + Preact + `@preact/signals`; per-DID `localStorage` (paint cache); `@stripe/stripe-js/pure` for deferred script injection (023-fix-initial-load)
- localStorage (paint cache, keys `rsss.paintCache.v1.<did>` + `rsss.lastSessionDid`); OPFS-SQLite + remote HTTP remain authoritative (023-fix-initial-load)
- TypeScript (browser, ES2022 lib via Vite) + Preact, `@preact/signals`, `htm/preact`, (007-cache-settings-disclosure)
- N/A (UI-only; reuses existing per-feed cache policy (007-cache-settings-disclosure)
- TypeScript (Cloudflare Workers + ES2022 lib for + Hono (server router), `@cloudflare/workers- (008-fix-up-to-date-dot)
- TypeScript (Cloudflare Workers runtime, ES2022 + Hono (server router), (009-background-feed-polling)
- Per-user Durable Object SQLite (existing `feeds`, (009-background-feed-polling)
- TypeScript (browser, ES2022 lib via Vite for + Preact + `@preact/signals` (client state (010-fix-refresh-feedback)
- N/A. The feature is UI-state lifecycle only — no (010-fix-refresh-feedback)
- TypeScript (browser, ES2022 lib via Vite for the + Preact + `@preact/signals` (client state and (012-updating-status-dot)
- N/A. Client-side render-time state only. No SQLite schema, (012-updating-status-dot)
- TypeScript (browser, ES2022 lib via Vite for + Preact + `@preact/signals`, `htm/preact`, (013-remove-sync-button)
- TypeScript (browser, ES2022 lib via Vite for the + Preact + `@preact/signals`, `htm/preact` (014-sidebar-pending-count)
- TypeScript (browser, ES2022 lib via Vite for + Vite 7 + lightningcss (CSS pipeline), (015-fix-fouc-on-refresh)
- N/A. No SQLite schema change, no DO schema change, no (015-fix-fouc-on-refresh)
- TypeScript (browser, ES2022 lib via Vite for the + Vite 7 + `@cloudflare/vite-plugin` (build (016-fix-dev-server-fouc)
- N/A. Client signals only; no DO SQLite changes, no local (016-fix-dev-server-fouc)
- TypeScript (browser, ES2022 lib via Vite for the + Hono (worker router), `@cloudflare/durable-objects`, (018-fix-feed-resolving-stuck)
- Per-user Durable Object SQLite (server-authoritative, (018-fix-feed-resolving-stuck)
- TypeScript (browser, ES2022 lib via Vite for + Preact + `@preact/signals` (UI + state), (021-fix-view-switch-lag)
- Per-user Durable Object SQLite (server, unchanged) + (021-fix-view-switch-lag)
- TypeScript (browser, ES2022 lib via Vite for + Preact, `@preact/signals`, `htm/preact` (024-gate-cache-on-storage)
- N/A. The feature is UI-state lifecycle only — no SQLite (024-gate-cache-on-storage)
- TypeScript (browser, ES2022 lib via Vite) + Preact, `@preact/signals`, `htm/preact`; Vite 7 + (026-fix-reader-star-button)
- N/A for this feature. The `is_starred` state is already (026-fix-reader-star-button)
- N/A — UI-only. Reuses the existing client signal (027-disable-cache-settings-link)
- N/A for this feature. Reuses existing `Item.link` already (030-article-source-url)
- N/A — presentation-only. No SQLite (local or DO) schema (031-animate-cache-settings)
- TypeScript (Cloudflare Workers runtime, ES2022 lib) for + `@sentry/cloudflare` (worker + DO), (033-no-sentry-in-dev)
- N/A — no local SQLite or DO schema change (033-no-sentry-in-dev)
- N/A — UI-only. No local SQLite, DO SQLite, or `/api/sync` (034-fetch-updates-button)
- N/A — reads existing per-DID client signals (041-cache-default-labels)
- TypeScript (browser, ES2022 lib via Vite); the change + Preact, `@preact/signals`, `htm/preact`, (042-fix-cache-settings-width)
- N/A — presentation-only. No local SQLite, DO SQLite, or (042-fix-cache-settings-width)

- TypeScript (Cloudflare Workers runtime, ES2022 lib) + `hono`, `@cloudflare/workers-types`, `fast-xml-parser` (001-fix-og-image-redirects)

## Project Structure

```text
backend/
frontend/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript (Cloudflare Workers runtime, ES2022 lib): Follow standard conventions

## Recent Changes
- 042-fix-cache-settings-width: Added TypeScript (browser, ES2022 lib via Vite); the change + Preact, `@preact/signals`, `htm/preact`,
- 041-cache-default-labels: Added TypeScript (browser, ES2022 lib via Vite) + Preact, `@preact/signals`, `htm/preact`
- 034-fetch-updates-button: Added TypeScript (browser, ES2022 lib via Vite) + Preact, `@preact/signals`, `htm/preact`


<!-- MANUAL ADDITIONS START -->

## Correctness Conventions

Last verified: 2026-06-15

These are project-wide invariants confirmed by the correctness audit. They
are durable contracts, not implementation notes — keep them true.

### Durable Object SQLite: no bare `.one()`

`SqlStorageCursor.one()` throws unless the result set has exactly one row.
For any query that can legitimately return zero rows (lookups by id,
optional-row reads), use `.toArray()[0] ?? null` instead of `.one()`. Bare
`.one()` is reserved for queries guaranteed to return exactly one row
(e.g. `SELECT count(*)`).

DO tests model this with the shared fake at `test/helpers/sql-fake.ts`
(`fakeResult(rows)`). Its `one()` throws on a non-singleton result set, so a
test that exercises an optional-row path through `.one()` fails loudly. Use
this fake — not an ad-hoc stub — when testing DO SQL handlers, so optional-row
regressions are caught.

### `parseIdParam` for numeric route params

`parseIdParam` (exported from `src/server/durable-objects/index.ts`) is the
single validator for `:id`-style numeric path params. It returns `null` for
anything that is not a positive integer whose canonical string equals the
input (rejects `1.5`, `0`, `-1`, `01`, `1e3`, trailing junk). Route handlers
return `400` when it returns `null`; never pass an unvalidated id into a DO
SQL bind.

### Security invariants

- **OAuth `iss` binding (RFC 9207):** `OAuthState` persists the `authServer`
  resolved at flow start; the callback rejects (`invalid_iss`) when the
  returned `iss` is not byte-exactly equal to it. Fails closed.
- **Admin token compare is constant-time:** admin auth uses
  `constantTimeEqual` (exported from `src/server/index.ts`), never `===`, to
  avoid timing leaks.
- **Untrusted URLs are http(s)-validated:** subscription-record `feedUrl`/
  `siteUrl` (and other URLs from remote sources) pass through
  `httpUrlOrNull` (`src/shared/publisher-link.ts`) at parse time;
  `listRemoteSubscriptions` SSRF-guards its PDS fetch.

### Sync / outbox contracts

- **Subscription identity is the canonical feed URL.** Record, reconcile, and
  the local subscription row all key on the canonical (normalized) URL, not
  the raw input — a feed has one identity across push, pull, and reconcile.
- **Outbox dead-letters after `DEAD_LETTER_ATTEMPT_LIMIT` (10) transient
  failures.** Transient (5xx/network) failures now count toward the cap, not
  just permanent ones; an op that keeps failing transiently is dead-lettered
  rather than retried forever. (Constant in `src/client/db/push-sync.ts`.)
- **Push-sync 409 reconcile is cache-policy-aware.** When the server reports a
  conflict it restores items and writes the sync-status columns; body columns
  are only overwritten when the per-feed cache policy says to keep content
  (`isContentCachedForPolicy`), otherwise `COALESCE`-preserved.
- **`getBlueskyFollows` / `listRemoteSubscriptions` are pagination-bounded**
  and report truncation. `getBlueskyFollows` returns `{ follows, ok }` where
  `ok:false` signals a fetch error, page cap, or cursor stall truncated the
  result; callers must treat a partial list as incomplete.

### Feed-polling alarm contracts

The per-user `RsssUserDO` polling alarm (`src/server/durable-objects/index.ts`)
drives background feed discovery on a `FEED_REFRESH_INTERVAL_MS` (1h) cadence.

- **`alarm()` reschedules BEFORE any fallible discovery work.** It calls
  `scheduleNextFeedRefresh()` (now + interval) first, then runs the fallible
  steps (`sweepStuckResolvingFeeds`, `readAccountActivity`, `refreshFeedBatches`)
  each wrapped in try/catch (swallow-and-log, no re-throw). A throw in
  discovery must never leave the DO without a future alarm. The two
  intentional early returns that deliberately do NOT reschedule are the only
  exceptions: pending-deletion-due (the DO is being deleted) and the
  inactivity gate (FR-008/AC2.3, dormancy when no deletion is pending).
- **`ensureFeedRefreshArmed()` self-heals an overdue alarm.** It arms a fresh
  alarm when none exists, and re-arms an already-overdue stored alarm to fire
  in `OVERDUE_ALARM_REARM_DELAY_MS` (5s) — not a full interval out — so a
  dropped/never-fired alarm (e.g. under `wrangler dev`) heals promptly without
  a tight loop (`alarm()` then reschedules to now + interval). It is the single
  cold-start arming path (constructor) and the returning-user resume path
  (`maybeKickCatchUp`). Idempotent: a no-op when a future alarm is already set.

### Dev-only poll trigger

- **`POST /api/dev/poll-now` is development-gated, defense-in-depth.** The
  worker route (`src/server/index.ts`) gates on `NODE_ENV === 'development'`
  BEFORE `requireAuth`, so production returns `404` (not `401`) regardless of
  session, and is registered above the `dataRouter` catch-all. It forwards to
  the internal DO route `POST /internal/dev/poll-now`
  (`src/server/durable-objects/index.ts`), which independently re-checks
  `this.env.NODE_ENV === 'development'` — the gate must live on the DO handler
  too, because the `dataRouter` proxies `/api/internal/*` to the DO. The DO
  route runs the real discovery path (`runFeedPool` + `fetchFeed`) over ALL
  feeds, ignoring per-feed due times and WITHOUT advancing `last_pulled_at`, so
  the pending "N updates" count grows observably; returns
  `{ polledFeeds, newItems, counts }`. Both layers `404` outside development.

### Cache-storage / OPFS atomicity

- **Image cache writes are atomic across two stores.** On a DB-write failure
  the Cache Storage blob is rolled back, so a cached image never exists in one
  store without its row in the other.
- **Cache eviction excludes the currently-open item** from the size total so
  the item being read is never evicted out from under the reader.
- **OPFS deletion holds the tab lock through the delete** and unlinks via the
  sqlite worker's SAH-pool `remove` RPC. The worker protocol gained a
  `remove` request (`src/client/db/sqlite-worker-protocol.ts`); local-first
  reset also clears the per-DID paint cache.

<!-- MANUAL ADDITIONS END -->
