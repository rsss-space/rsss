# rsss Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-06-02

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
- 030-article-source-url: Added TypeScript (browser, ES2022 lib via Vite) + Preact, `@preact/signals`, `htm/preact`
- 027-disable-cache-settings-link: Added TypeScript (browser, ES2022 lib via Vite) + Preact, `@preact/signals`, `htm/preact`
- 026-fix-reader-star-button: Added TypeScript (browser, ES2022 lib via Vite) + Preact, `@preact/signals`, `htm/preact`; Vite 7 +


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
