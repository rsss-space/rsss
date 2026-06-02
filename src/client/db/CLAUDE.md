# Client: Local-First Cache / Feed Cache Policy

Last verified: 2026-06-02

## Purpose
Decides, per feed, whether item bodies and images get cached into the
local OPFS-SQLite mirror during sync and on-demand fetch. A per-feed
override layers on top of the global `storeContent` setting so a user
can opt a single feed in or out without flipping the global default.

## Contracts

### Resolvers (`feed-cache-policy.ts`)
- **Exposes**:
  - `isContentCachedForPolicy(row):boolean` — returns
    `row.content_enabled === 1` when the override is set, else falls
    back to `storeContent.value`. This is the single source of truth
    for "should this feed's bodies be cached".
  - `isContentCachedForFeed(feedId):boolean` — same, reading the
    in-memory `feedPolicies` signal.
  - `getFeedCachePolicy`, `upsertFeedCachePolicy`,
    `resolveEffectivePolicy`, `loadFeedPolicies`, `feedPolicies`,
    `ensureFeedCachePolicyColumns`.
- **Guarantees**:
  - `content_enabled` is tri-state: `null` = inherit global, `1` =
    force on, `0` = force off.
  - `upsertFeedCachePolicy` DELETEs the row (returns to pure inherit)
    only when `cache_mode`, `max_size_bytes`, `max_age_seconds`, AND
    `content_enabled` are all null.
  - `ensureFeedCachePolicyColumns` is an additive, idempotent
    `ALTER TABLE` migration guarded by a per-DB `WeakSet`; safe to call
    before any read/write.
- **Expects**: callers pass an open `Sqlite3Db`.

## Dependencies
- **Uses**: `local-first-settings.ts` (`storeContent` and the default
  mode/size/age signals), `local-db.ts` helpers.
- **Used by**: `pull-sync.ts` (per-feed gate during sync),
  `cache-status.ts` (`wantBody`), `state.ts`
  (`fetchFullArticle`, `cacheUncachedItems`),
  `components/cache-settings.ts` (the panel UI).
- **Boundary**: per-feed body/image caching decisions MUST route
  through `isContentCachedForPolicy` / `isContentCachedForFeed`. Do
  NOT read `storeContent.value` directly for that decision. Reading the
  global signal is only for effect subscriptions and the global
  cache-status banner gate.

## Key Decisions
- **Resolver over scattered `storeContent` reads**: 029 introduced the
  override; the resolvers keep the inherit/force logic in one place so
  every call site agrees.
- **Preserve-on-disable**: `upsertItem` switches its body columns to
  `COALESCE(existing, excluded)` when caching is off for the feed, so a
  force-off feed keeps already-cached bodies across re-sync instead of
  nulling them.
- **Smart-checkbox writes null**: the panel writes `content_enabled =
  null` when the chosen value equals the current global, else explicit
  `0`/`1`, so a feed only carries an override when it genuinely differs.

## Invariants
- `feed_cache_policy` is client-only (never synced to the DO).
- The schema string in `local-schema.ts` and the
  `ensureFeedCachePolicyColumns` migration must stay in sync; new DBs
  get the column from CREATE TABLE, existing DBs from the ALTER.
- Caching content requires entitlement + local-first storage; the panel
  disables the toggle when unentitled or unsupported.

## Key Files
- `feed-cache-policy.ts` — row type, CRUD, resolvers
- `local-schema.ts` — `FEED_CACHE_POLICY_SQL` CREATE TABLE
- `pull-sync.ts` — per-feed sync gate + preserve-on-disable upsert
- `cache-status.ts` — per-feed `wantBody` accounting
- `../components/cache-settings.ts` — Cache Settings panel UI

## Gotchas
- `FeedCachePolicyRow` is exported from BOTH this module and
  `image-cache.ts`; `pull-sync.ts` imports it from here. Keep the two
  shapes compatible.
- Enabling a feed while storage is off triggers a bootstrap
  (`enableWithBootstrap`) that reuses the /settings flow without
  flipping global `storeContent`; the optimistic override is reverted
  if bootstrap fails or is blocked.
