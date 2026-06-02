# Feed Cache Settings — Phase 2: Sync & read-path gating

**Goal:** Make body-content and image caching honor each feed's effective
state (`override ?? storeContent.value`) instead of the single global
gate, and preserve already-cached bodies when a feed is force-off.

**Architecture:** Replace the one-shot `keepContent = storeContent.value`
in `pull-sync` with a per-feed decision derived from each feed's policy
row (via Phase 1's `getFeedCachePolicy` + `isContentCachedForPolicy`).
Make `upsertItem` preserve existing body columns on UPDATE when content is
not being kept (so a disabled feed's cached bodies survive re-sync).
Point the on-demand article-fetch gate (`state.ts`) and the cache-status
`wantBody` computation (`cache-status.ts`) at the same resolver so all
read paths agree.

**Tech Stack:** TypeScript (browser, ES2022 lib via Vite) + `@preact/signals`;
`@sqlite.org/sqlite-wasm`; tests with `@substrate-system/tapzero` + real
WASM SQLite.

**Scope:** Phase 2 of 4. **Depends on Phase 1** (the `content_enabled`
column, `getFeedCachePolicy` returning it, and
`isContentCachedForPolicy` / `isContentCachedForFeed`).

**Codebase verified:** 2026-06-01

---

## Acceptance Criteria Coverage

### 029-feed-cache-settings.AC4: Toggle OFF stops new caching, keeps existing
- **029-feed-cache-settings.AC4.1 Success:** A force-off feed's new items
  are upserted as metadata-only (no body).
- **029-feed-cache-settings.AC4.2 Success:** A force-off feed's previously
  cached bodies survive a subsequent sync.
- **029-feed-cache-settings.AC4.4 Success:** A force-off feed caches no new
  images.

### 029-feed-cache-settings.AC2 (applied in the pipeline)
- **029-feed-cache-settings.AC2.3 Success:** override `true` + global off →
  effective on (a force-on feed caches even though global content is off).

### 029-feed-cache-settings.AC5 (sync portion)
- **029-feed-cache-settings.AC5.3 Success:** Post-enable, only that feed
  caches; inherit feeds (global off) do not. *(Sync-pipeline half:
  per-feed gating means an override-on feed caches while inherit feeds with
  global off do not. The enable/bootstrap UI is Phase 4.)*

### 029-feed-cache-settings.AC9: read-path consistency
- **029-feed-cache-settings.AC9.3 Success:** All read paths (`pull-sync`,
  on-demand fetch, `cache-status`) agree with the resolver.

> AC4.3 (UI grays controls) is Phase 3.

---

## Verified Codebase Context (read before coding)

**`src/client/db/pull-sync.ts`:**
- `const keepContent = storeContent.value` at **line 346** (read once,
  module-scope, before the page loop). `storeContent` is imported at
  line 2.
- The items loop **lines 399-408**: `await upsertItem(db, item,
  keepContent)` (line 404) and `if (keepContent) itemsToCache.push(item)`
  (line 407).
- The image-cache block **lines 433-464**: guarded by `if (keepContent &&
  itemsToCache.length > 0)`; it builds a per-page `policyByFeed` map with
  a manual `SELECT cache_mode FROM feed_cache_policy WHERE feed_id = ?`
  (lines 437-444) and calls `cacheItemImages(db, item, policy)`.
- **Import naming caveat:** `pull-sync.ts` imports `type
  FeedCachePolicyRow` from **`./image-cache.js`** (lines 9-12), where it is
  the minimal shape `{ cache_mode:CacheMode|null }`. That is a *different*
  type from the full `FeedCachePolicyRow` (with `content_enabled`) exported
  by **`./feed-cache-policy.js`**. `cacheItemImages(db, item, policy)`
  takes the minimal `{cache_mode}` shape, and the full row is structurally
  assignable to it (it has `cache_mode`), so passing the full row to
  `cacheItemImages` is fine. Task 2 must replace the minimal import with
  the full one (see below) — do not "extend" the image-cache import.
- The page transaction is `BEGIN` (line 385) … `COMMIT` (line 422) /
  `ROLLBACK` (line 426).
- `upsertItem` **lines 188-258**: builds `content` / `description` /
  `fullContent` as the item value when `keepContent`, else `null`
  (lines 195-203); INSERT…ON CONFLICT DO UPDATE SET overwrites
  `description = excluded.description` (219), `content = excluded.content`
  (220), `full_content = excluded.full_content` (231),
  `full_content_fetched_at = excluded.full_content_fetched_at` (232),
  `full_content_status = excluded.full_content_status` (233).
  **This is the strip-on-disable bug** — on UPDATE with `keepContent`
  false these bind `null` and wipe an existing cached body.

**`src/client/state.ts`:**
- `State.fetchFullArticle` **lines 2649-2711**: mirrors the fetched item
  into the local DB via `pullSyncUpsertItem(db, updated, storeContent.value)`
  at **line 2685** (`updated` is the fetched `Item`, has `feed_id`).
- `State.cacheUncachedItems` **lines 2718-…**: gate `if (item.missingBody
  && storeContent.value)` at **line 2745** (`item` is an `ItemToCache`,
  has `feed_id`). Image branch at 2748 already reads
  `feedPolicies.value[item.feed_id]`.
- `storeContent` imported lines 37-40; `feedPolicies` already imported
  (used at line 2749).

**`src/client/db/cache-status.ts`:**
- Imports `feedPolicies`, `resolveEffectivePolicy` (lines 3-6) and
  `storeContent` (line 7).
- `const wantBody = storeContent.value` at **line 70** (global).
- Per-row loop **lines 108-135** already computes
  `const policy = policiesByFeed[row.feed_id] ?? null` (109) and
  `resolveEffectivePolicy(policy)` (110); body decision
  `const missingBody = wantBody && !hasBody` at **line 115** uses the
  global `wantBody`.

**Tests:**
- `test/pull-sync.ts` — run with `npm run test:pull-sync` (`esbuild
  ./test/pull-sync.ts --bundle --loader:.wasm=dataurl | tapout`). Real
  WASM SQLite; seeds `feeds`/`items`; stubs `fetch` for `/api/sync`.
- `test/cache-status.ts` — run with `npm run test:cache-status`.
- Honor global CLAUDE.md style (≤80 cols, `x:Type`, ternary on its own
  lines, `batch()` for multi-signal writes). Do not assert HTML text.

---

## Design Note: preserve-on-disable (why not a blanket COALESCE)

A single unconditional `content = COALESCE(content, excluded.content)`
would also prevent the *keep-on* path from refreshing an updated body, so
the SET clause must branch on the effective `keepContent`:
- **keep-on:** keep today's behavior — `content = excluded.content`, etc.
- **keep-off:** preserve existing — `content = COALESCE(content,
  excluded.content)` (and the same for `description`, `full_content`,
  `full_content_fetched_at`, `full_content_status`). In this branch the
  bound values are `null`, so `COALESCE` returns the existing row value
  (an existing body is kept; a brand-new INSERT still lands body-less).
In a SQLite UPSERT `DO UPDATE SET`, an unqualified column name refers to
the existing row's value and `excluded.x` to the proposed value.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Preserve existing bodies in `upsertItem` when content is off

**Verifies:** AC4.1, AC4.2.

**Files:**
- Modify: `src/client/db/pull-sync.ts:188-258` (`upsertItem`)

**Implementation:**
Keep the signature `upsertItem(db, item, keepContent)`. Keep the
body-value binding (null when `!keepContent`) as-is. Branch the
`ON CONFLICT(id) DO UPDATE SET` body columns on `keepContent`:
- When `keepContent` is `true`: the five body-related assignments stay
  `… = excluded.…` (current behavior, lines 219, 220, 231, 232, 233).
- When `keepContent` is `false`: emit
  `content = COALESCE(content, excluded.content)`,
  `description = COALESCE(description, excluded.description)`,
  `full_content = COALESCE(full_content, excluded.full_content)`,
  `full_content_fetched_at = COALESCE(full_content_fetched_at,
  excluded.full_content_fetched_at)`,
  `full_content_status = COALESCE(full_content_status,
  excluded.full_content_status)`.

Implement by building the SET clause from a small conditional (two string
fragments for the body columns selected by `keepContent`), leaving all
other columns (`feed_id`, `title`, image metadata, `is_read`,
`is_starred`, `updated_at`, etc.) overwriting from `excluded` exactly as
today. Do not change the INSERT column list, the `VALUES` list, or the
`bind` array.

**Testing:** covered by Task 4.

**Verification:**
Run: `npm run lint`
Expected: passes.

**Commit:** `fix: preserve cached bodies on upsert when content is off`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Per-feed effective gating in `pullSync`

**Verifies:** AC4.1, AC4.4, AC2.3, AC5.3, AC9.3 (pull-sync path).

**Files:**
- Modify: `src/client/db/pull-sync.ts` (imports; the `pullSync` body
  around lines 336-468)

**Implementation:**
1. Fix the imports (mind the `FeedCachePolicyRow` name collision):
   - Change the existing `./image-cache.js` import to bring in only
     `cacheItemImages` (drop its `type FeedCachePolicyRow` — it will no
     longer be referenced by name once the map is retyped below).
   - Add a new import from `./feed-cache-policy.js`:
     `getFeedCachePolicy`, `isContentCachedForPolicy`,
     `ensureFeedCachePolicyColumns`, and `type FeedCachePolicyRow` (the
     **full** row, with `content_enabled`).
   - Keep the existing `storeContent` import (the resolver reads it).
   The `policyByFeed` map and `policyFor` helper below are typed with this
   **full** `FeedCachePolicyRow`; the full row is structurally assignable
   to `cacheItemImages`'s minimal `{cache_mode}` parameter, so no cast is
   needed. (If you prefer to keep both imports, alias one, e.g.
   `type FeedCachePolicyRow as FeedCachePolicyFullRow`, and type the map
   with the alias — but dropping the unused minimal import is cleaner.)
2. Remove the single `const keepContent = storeContent.value` (line 346).
   Before the `while (!done)` loop, pre-warm the migration once:
   `await ensureFeedCachePolicyColumns(db)` (so the per-item policy reads
   inside the transaction never trigger an `ALTER`).
3. Add a function-scoped memoized policy map + helper so each feed's
   policy is read at most once for the whole `pullSync` call:
   ```ts
   const policyByFeed = new Map<number, FeedCachePolicyRow|null>()
   async function policyFor (feedId:number) {
       if (!policyByFeed.has(feedId)) {
           policyByFeed.set(feedId, await getFeedCachePolicy(db, feedId))
       }
       return policyByFeed.get(feedId) ?? null
   }
   ```
   (Hoist this above the `while` loop so it spans pages.)
4. In the items loop (399-408), compute the per-feed decision and use it:
   ```ts
   const feedId = item.feed_id as number
   const keep = isContentCachedForPolicy(await policyFor(feedId))
   await upsertItem(db, item, keep)
   itemCount++
   opts.onItemUpserted?.(itemCount)
   if (keep) itemsToCache.push(item)
   ```
5. In the image block (433-464): change the outer guard to
   `if (itemsToCache.length > 0)` (the array now contains only
   per-feed-kept items, so the old global `keepContent` guard is
   redundant). Replace the inline `SELECT cache_mode` map with the shared
   `await policyFor(feedId)` so images reuse the already-loaded policy;
   pass that policy to `cacheItemImages` unchanged. Because force-off
   items are never pushed to `itemsToCache`, a force-off feed caches no
   new images (AC4.4).

**Testing:** covered by Task 4.

**Verification:**
Run: `npm run lint`
Expected: passes.

**Commit:** `feat: gate pull-sync body and image caching per feed`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-3) -->

<!-- START_TASK_3 -->
### Task 3: Per-feed read-path gates (on-demand fetch + cache-status)

**Verifies:** AC9.3 (on-demand fetch + cache-status paths), AC2.3 (read
side).

**Files:**
- Modify: `src/client/state.ts` (lines 2685 and 2745; imports)
- Modify: `src/client/db/cache-status.ts` (lines 7, 70, 108-115; imports)

**Implementation:**
1. **state.ts:**
   - Import `isContentCachedForFeed` from `./db/feed-cache-policy.js` (the
     file already imports `feedPolicies` from there — extend that import).
   - Line 2685: replace `storeContent.value` with
     `isContentCachedForFeed(updated.feed_id)` so the local mirror of an
     on-demand fetch only persists the body for feeds that cache. (With
     Task 1's preserve-on-disable, a non-caching feed keeps whatever body
     already existed and does not get the freshly fetched body written —
     the article still displays from in-memory state.)
   - Line 2745: replace `item.missingBody && storeContent.value` with
     `item.missingBody && isContentCachedForFeed(item.feed_id)`.
   - If `storeContent` becomes unused in `state.ts` after this change,
     remove it from the import to satisfy lint; if it is still used
     elsewhere, leave it.
2. **cache-status.ts:**
   - Import `isContentCachedForPolicy` from `./feed-cache-policy.js`
     (extend the existing import of `feedPolicies`,
     `resolveEffectivePolicy`).
   - Remove the module-level `const wantBody = storeContent.value`
     (line 70). In the per-row loop (108-135), compute per feed:
     `const wantBody = isContentCachedForPolicy(policy)` (right after
     `const policy = …`), then keep `const missingBody = wantBody &&
     !hasBody`.
   - Remove the now-unused `import { storeContent }` (line 7) if nothing
     else in the file uses it.

**Testing:** covered by Task 4 (cache-status) and human verification for
the on-demand fetch wiring (see test-requirements).

**Verification:**
Run: `npm run lint`
Expected: passes (no unused imports).

**Commit:** `feat: gate on-demand fetch and cache-status per feed`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 4-4) -->

<!-- START_TASK_4 -->
### Task 4: Tests — sync gating, preserve-on-disable, cache-status

**Verifies:** AC4.1, AC4.2, AC4.4, AC2.3, AC5.3, AC9.3.

**Files:**
- Modify: `test/pull-sync.ts`
- Modify: `test/cache-status.ts`

**Testing:** Generate test code at execution time matching each file's
existing patterns (real WASM SQLite, seeded `feeds`/`items`, `fetch`
stub returning a `SyncResponse`). Add cases:

**pull-sync (`test/pull-sync.ts`):**
- **AC4.1 metadata-only:** with global `storeContent=false` and a feed
  whose policy has `content_enabled=0`, sync new items → the upserted
  rows have null `content`/`description`/`full_content`.
- **AC2.3 / AC5.3 force-on:** with global `storeContent=false` and a feed
  whose policy has `content_enabled=1`, sync → that feed's items store
  body content; a second feed with no policy row (inherit, global off)
  stores none. (Proves only the override feed caches.)
- **AC4.2 preserve-on-disable:** seed an item that already has non-null
  `content`; set the feed `content_enabled=0`; run a sync that updates
  that item (same id) with body-bearing payload → the existing `content`
  is still present afterward (not nulled). Also assert a *new* item in the
  same sync lands body-less.
- **AC4.4 no new images:** with a force-off feed, after sync assert no new
  rows were added to `cached_images` for that feed. (Follow the existing
  image-cache assertions in the file / `test/image-cache.ts` for how
  cached images are counted.)
- Set/restore `storeContent.value` and `feedPolicies`/DB policy rows in
  each test; reset with `_resetFeedPolicies()` where the signal path is
  involved.

**cache-status (`test/cache-status.ts`):**
- **AC9.3 wantBody per feed:** seed body-less items across two feeds; with
  global `storeContent=false`, set one feed `content_enabled=1` (via its
  `feedPolicies` entry) → `computeCacheStatus` reports that feed's items
  as `missingBody:true` and the inherit feed's items as `missingBody:false`.
  Flip global on and a feed `content_enabled=0` → that feed's items are
  not flagged missing-body while inherit feeds are. This exercises the
  resolver agreement between cache-status and the override.

Do not assert HTML/DOM text.

**Verification:**
Run: `npm run test:pull-sync`
Expected: passes.
Run: `npm run test:cache-status`
Expected: passes.
Run: `npm test && npm run lint`
Expected: full suite + lint pass.

**Commit:** `test: per-feed sync gating and preserve-on-disable`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_C -->

---

## Phase 2 Done When

- A force-on feed caches bodies/images even when global content is off; an
  inherit feed with global off caches nothing.
- A force-off feed upserts new items metadata-only, caches no new images,
  and its previously cached bodies survive a re-sync.
- `pull-sync`, the on-demand `fetchFullArticle` mirror, and
  `cache-status.wantBody` all decide via `isContentCachedFor…`.
- `npm test` and `npm run lint` pass.
