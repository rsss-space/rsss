# rsss Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-05-29

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
- 025-fix-sentry-cross-request-warning: Bump `@sentry/cloudflare` + `@sentry/browser` to `^10.55.0` (root-cause fix for cross-request `waitUntil` span-completion); gate `tracesSampleRate` on DSN presence in the worker/DO Sentry options so tracing is fully disabled (key omitted) when no DSN is set. No persistent storage change.
- 024-gate-cache-on-storage: Added TypeScript (browser, ES2022 lib via Vite for + Preact, `@preact/signals`, `htm/preact`
- fix-silent-update-gap: Refcount-backed refresh-indicator lifecycle in `src/client/state.ts`. `AppState.refreshInProgress` is now `ReadonlySignal<boolean>` (external writes are a TypeScript error); all writes flow through module-private `acquireRefresh`/`releaseRefresh` backed by `_refreshRefCounts` and `_refreshSignals` WeakMaps, with fail-fast on unregistered states. New canonical wrapper `trackRefresh<T>(state, name, fn)` plus `RefreshOpName` union (`'add-feed' | 'resolve-convergence' | 'sse-feed-updated' | 'online-recovery'`) acquires the refcount, runs `fn`, and on rejection batches release + `feedSyncStatus = 'error'` so the UI transitions atomically. New module `src/client/displayed-refresh-in-progress.ts` exports `displayedRefreshInProgress:ReadonlySignal<boolean>` (5-state machine, `SHOW_DELAY_MS = 300`, `MIN_VISIBLE_MS = 500`) and `init(rawSignal)` / `_resetForTest` / `_setClockForTest`; `displayedFeedSyncStatus` is now debounced through this signal instead of raw `refreshInProgress`, so `'syncing'` requires the raw signal to be true for at least 300 ms before the UI shows it. `State.addFeed`, the extracted `runResolveConvergence(state, feedId)`, the SSE `feed-updated` debounce body, and the new `_onlineRecoverySync(state)` (extracted from `handleOnline`) are all wrapped in `trackRefresh`. New constants `RESOLVE_WINDOW_MS = 30_000`, `CLIENT_GRACE_MS = 5_000` (hard timeout `RESOLVE_WINDOW_MS + CLIENT_GRACE_MS = 35 s` for add-feed acquires). New add-feed coordination: `_pendingAddFeedAcquires` Map + `waitForAddFeedRelease(feedId)` + `drainAddFeedAcquires(feedIds)` (SSE `feed-updates-available` drains acquires after the count-update batch). Test-only exports: `_acquireRefreshForTest`, `_releaseRefreshForTest`, `_resetRefreshRefCountForTest`, `_registerRefreshSignalForTest`, `_setRunResolveConvergenceDepsForTest` / `_resetRunResolveConvergenceDepsForTest`, `_setIsLocalFirstActiveForTest` / `_resetIsLocalFirstActiveForTest`, `_setAddFeedAdapterForTest`, `_setAddFeedHardTimeoutForTest`, `_resetPendingAddFeedAcquiresForTest`, `_onlineRecoverySyncForTest`, `_runResolveConvergenceForTest`, `_resolveConvergenceForTest`, `_resetDisplayedRefreshForTest`. Removed stale `test/ci-workflow.mjs`.


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
