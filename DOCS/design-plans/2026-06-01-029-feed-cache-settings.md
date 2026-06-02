# Feed Cache Settings (per-feed opt-in caching) Design

## Summary

This feature adds a per-feed content-caching toggle to the feed-reader
route, giving users granular control over which feeds cache article bodies
locally without touching the global cache setting. Today, caching is an
all-or-nothing decision driven by the global "Store article content
locally" switch; every feed follows it. This design introduces a tri-state
per-feed override (`true` / `false` / `null`) stored in the existing
`feed_cache_policy` table inside the local SQLite database. A feed with no
override inherits the global setting; an explicit override wins regardless
of what the global says. The effective rule is simply `perFeedOverride ??
globalStoreContent`.

The change touches four areas: the data model (a new nullable
`content_enabled` column and an additive schema migration), the sync
pipeline (per-feed effective-state resolution replacing the single global
gate), the cache-status and on-demand article-fetch paths (so all three
agree on whether a feed should store content), and the Cache Settings UI
panel on the reader route (a new "Cache this feed" checkbox that gates the
existing mode/size/age controls). A notable edge case is handled
explicitly: a user who has never enabled local storage can turn on caching
for a single feed, which bootstraps the local database for them and writes
only that feed's override, leaving the global switch untouched and all
other feeds still inheriting the off state.

## Definition of Done

1. On the **feed-reader route**, the cache disclosure summary reads
   **"Cache Settings"** (static text; it no longer reflects the active
   cache mode).
2. The expanded panel gains a **"Cache this feed" on/off toggle**. A feed
   with no per-feed override **inherits the global "Store article content
   locally" setting**; the toggle is an explicit per-feed override.
   Effective caching for a feed = `perFeedOverride ?? globalStoreContent`.
   (Global content off — the common first-time case — means unset feeds
   are effectively off, so enabling one feed caches only that feed. Global
   content on means unset feeds cache by default and the toggle opts
   individual feeds out.)
3. Toggle **ON** → the existing mode (`text` / `text + images`) +
   max-size + max-age controls become active; mode defaults to the
   global default (`text_images`).
4. Toggle **OFF** → stops caching new items, **keeps** already-cached
   content (no purge), and grays out the mode/size/age controls.
5. **Entitled, local storage off** → the toggle is interactive (not
   grayed). Enabling it **bootstraps device local storage** (downloads
   data into local SQLite) and writes the feed's override-on, so **only
   that feed** caches (others inherit the still-off global; the global
   content switch is not flipped).
6. **No paid plan (unentitled)** → the per-feed toggle is grayed out
   with a "requires a paid plan" hint (matches the existing `/settings`
   pattern).
7. State persists in **local SQLite** (`feed_cache_policy`); client-only,
   no server sync.
8. **Scope: reader route only.** `/settings` (feature 027) is left
   unchanged — the two routes intentionally diverge.

### Resolved trade-offs
- **Discoverability over at-a-glance status** — the summary loses the
  active-mode hint to read simply "Cache Settings".
- **Inheritance over blanket default** — a feed with no override follows
  the global "Store article content locally" setting (consistent with how
  per-feed `cache_mode` already falls back to the global default). This
  preserves current behavior for users who already store content globally
  (feeds keep caching; the toggle lets them opt feeds out), while letting
  first-time cachers (global off) enable individual feeds one at a time.
- **Actionable control over consistency with /settings** — the
  reader-route toggle bootstraps storage instead of graying out (except
  for the no-plan case), diverging from feature 027.

### Out of scope
- Changes to the `/settings` per-feed cache control (feature 027).
- Purging already-cached content when a feed is disabled.
- Server-side / account-synced cache settings.

## Acceptance Criteria

### 029-feed-cache-settings.AC1: Summary reads a static "Cache Settings"
- **029-feed-cache-settings.AC1.1 Success:** The reader-route cache
  disclosure renders a fixed summary label.
- **029-feed-cache-settings.AC1.2 Success:** The summary label does not
  change when the feed's `cache_mode` changes (invariance).

### 029-feed-cache-settings.AC2: Tri-state effective resolution (`override ?? global`)
- **029-feed-cache-settings.AC2.1 Success:** override `null` + global on →
  effective on.
- **029-feed-cache-settings.AC2.2 Success:** override `null` + global off →
  effective off.
- **029-feed-cache-settings.AC2.3 Success:** override `true` + global off →
  effective on.
- **029-feed-cache-settings.AC2.4 Success:** override `false` + global on →
  effective off.
- **029-feed-cache-settings.AC2.5 Edge:** override `true` + global on →
  effective on.

### 029-feed-cache-settings.AC3: Toggle ON activates controls; mode default
- **029-feed-cache-settings.AC3.1 Success:** When effective-on, the
  mode/size/age controls are enabled.
- **029-feed-cache-settings.AC3.2 Success:** A feed with no `cache_mode`
  override resolves to the global default (`text_images`).
- **029-feed-cache-settings.AC3.3 Success:** Changing mode/size/age while
  on persists to the feed's policy row.

### 029-feed-cache-settings.AC4: Toggle OFF stops new caching, keeps existing, grays controls
- **029-feed-cache-settings.AC4.1 Success:** A force-off feed's new items
  are upserted as metadata-only (no body).
- **029-feed-cache-settings.AC4.2 Success:** A force-off feed's previously
  cached bodies survive a subsequent sync.
- **029-feed-cache-settings.AC4.3 Success:** When effective-off, the
  mode/size/age controls are disabled.
- **029-feed-cache-settings.AC4.4 Success:** A force-off feed caches no new
  images.

### 029-feed-cache-settings.AC5: Enable while storage off → bootstrap, only that feed
- **029-feed-cache-settings.AC5.1 Success:** Enabling while storage off +
  entitled calls `setSyncSubscriptions(true)` + `bootstrapLocalDb`.
- **029-feed-cache-settings.AC5.2 Success:** After bootstrap succeeds, the
  feed's `content_enabled=1` override is persisted.
- **029-feed-cache-settings.AC5.3 Success:** Post-enable, only that feed
  caches; inherit feeds (global off) do not.
- **029-feed-cache-settings.AC5.4 Failure:** Bootstrap failure reverts the
  optimistic override.
- **029-feed-cache-settings.AC5.5 Edge:** Enabling a feed does not flip the
  global `storeContent` on.

### 029-feed-cache-settings.AC6: Unentitled → grayed with plan hint
- **029-feed-cache-settings.AC6.1 Failure:** Billing loaded & not entitled
  → checkbox disabled.
- **029-feed-cache-settings.AC6.2 Success:** Unentitled → a "requires a
  paid plan" hint is associated with the control.
- **029-feed-cache-settings.AC6.3 Success:** Entitled but storage off →
  checkbox is interactive (not disabled).

### 029-feed-cache-settings.AC7: Persistence in local SQLite; tri-state; client-only
- **029-feed-cache-settings.AC7.1 Success:** `true` / `false` / `null`
  round-trip across reload.
- **029-feed-cache-settings.AC7.2 Success:** A `{content_enabled:0}` row
  with null mode/size/age survives upsert.
- **029-feed-cache-settings.AC7.3 Success:** An all-null row (override null
  + null mode/size/age) is deleted (back to inherit).
- **029-feed-cache-settings.AC7.4 Success:** No server/network write occurs
  for cache settings.

### 029-feed-cache-settings.AC8: Scope — /settings unchanged
- **029-feed-cache-settings.AC8.1 Success:** `/settings` per-feed control
  still grays out when storage is off (feature 027 intact).
- **029-feed-cache-settings.AC8.2 Success:** Enabling a feed on the reader
  route does not change the `/settings` global "Store article content
  locally" state.

### 029-feed-cache-settings.AC9: Smart-checkbox & read-path consistency
- **029-feed-cache-settings.AC9.1 Success:** Toggling to a value equal to
  the global clears the override (writes `null`).
- **029-feed-cache-settings.AC9.2 Success:** Toggling opposite the global
  writes an explicit override (`0`/`1`).
- **029-feed-cache-settings.AC9.3 Success:** All read paths (`pull-sync`,
  on-demand fetch, `cache-status`) agree with the resolver.

## Glossary

- **tri-state override**: A value that can be `true` (force on), `false`
  (force off), or `null` (inherit the global setting), as opposed to a
  plain boolean.
- **`feed_cache_policy`**: A client-only SQLite table that stores per-feed
  caching preferences — cache mode, max size, max age, and (new) the
  content-enabled override. Lives in the local database, never synced to
  the server.
- **`storeContent`**: A Preact signal representing the global "Store
  article content locally" user preference. Acts as the fallback when no
  per-feed override is set.
- **`feedPolicies`**: A Preact signal (keyed by feed ID) holding the
  in-memory view of each feed's `feed_cache_policy` row.
- **effective state / effective resolver**: The computed result of
  `perFeedOverride ?? globalStoreContent` — the actual caching decision for
  a given feed after inheritance is resolved.
- **smart checkbox**: A toggle that clears its override (writes `null`)
  when the user picks the value that already matches the global, avoiding a
  redundant explicit override.
- **bootstrap / `bootstrapLocalDb`**: The process of initializing the local
  SQLite database for a user — downloading their subscription data into an
  on-device store — when local-first storage has not yet been enabled.
- **`setSyncSubscriptions`**: A client function that activates the sync
  subscription (marks the user as opted in to local sync) before
  `bootstrapLocalDb` is called.
- **local-first / `isLocalFirstActive`**: The mode in which article data is
  mirrored to an on-device SQLite database (via OPFS), enabling offline
  reading and faster loads.
- **OPFS (Origin Private File System)**: A browser API that provides
  sandboxed local file storage; used here to persist the SQLite database
  on-device.
- **Durable Object (DO)**: A Cloudflare Workers primitive providing
  per-user stateful compute with its own SQLite storage. The server-side
  authoritative store for feed metadata and article bodies; not affected by
  this feature.
- **`pull-sync.ts`**: The client module that fetches new feed items from
  the server and writes them into the local SQLite database, including
  optional body/image caching.
- **`upsertFeedCachePolicy`**: A DB helper that inserts or updates a feed's
  policy row, with a rule that an all-null row is deleted (reverting to
  inherit). This rule must be updated to preserve rows that have only
  `content_enabled` set.
- **`resolveEffectivePolicy`**: An existing function in
  `feed-cache-policy.ts` that resolves a feed's `cache_mode`, size, and age
  by falling back to global defaults. The new `content_enabled` override
  extends this same pattern.
- **`<fieldset disabled>`**: A native HTML element whose `disabled`
  attribute propagates to all descendant form controls, used here to gray
  out the mode/size/age controls when caching is effectively off.
- **billing gate / entitled**: Whether the current user has an active paid
  plan. Certain caching controls are restricted to paying users; the
  unentitled state renders the toggle disabled with a "requires a paid
  plan" hint.
- **`@substrate-system/check-box` (`CheckBox.TAG`)**: A custom-element
  checkbox component used throughout the app, consumed via its tag name and
  standard DOM properties (`checked`, `disabled`, `onChange`).
- **`@substrate-system/details-summary`**: A custom-element disclosure
  widget (a styled `<details>`/`<summary>`) used to wrap the Cache Settings
  panel.
- **additive migration**: A schema change that only adds new nullable
  columns to an existing table, so existing rows remain valid and read as
  `null` for the new column — no data loss, no breaking change.
- **`cache-status.ts`**: A client module that computes and surfaces the
  cache status indicator shown in the reader UI. Its `wantBody` logic must
  become per-feed-aware to match the new resolver.
- **feature 027**: A prior feature (`027-disable-cache-settings-link`) that
  governs the `/settings` route's per-feed cache control — intentionally
  left unchanged by this feature.

## Architecture

The feature adds a per-feed content-caching override on top of the
existing global/local-first machinery. The override is **tri-state**
(`true` / `false` / `null`), stored per feed; `null` means "inherit the
global setting."

The linchpin is a single effective-state resolver used by both the UI and
the sync pipeline:

```ts
// override ?? global
function isContentCachedForFeed (feedId:number):boolean {
    const o = feedPolicies.value[feedId]?.content_enabled ?? null
    return o ?? storeContent.value
}
```

Today body-content caching is decided once per sync from the global
`storeContent` signal. This design pushes that decision down to per-feed
granularity. The override lives in the existing `feed_cache_policy` table
(local SQLite, client-only) alongside the existing `cache_mode`,
`max_size_bytes`, and `max_age_seconds` columns.

**Data flow — display:** `cache-settings.ts` reads `feedPolicies` +
`storeContent` → resolves effective state → renders a "smart" checkbox.
Toggling writes a tri-state value (clearing the override when the chosen
value equals the global) through `upsertFeedCachePolicy`.

**Data flow — caching:** `pull-sync.ts` resolves the effective state per
feed (DB-side, reading `content_enabled` from each feed's policy row) and
gates body storage + image caching accordingly. The on-demand article
fetch (`state.ts`) and the cache-status indicator (`cache-status.ts`) use
the same resolver so all read paths agree.

**Bootstrap interaction:** because `feed_cache_policy` lives inside the
local DB that bootstrap creates, enabling a feed while local storage is
off reuses the `/settings` bootstrap flow (`setSyncSubscriptions` +
`bootstrapLocalDb`) and persists the override **after** bootstrap
succeeds. The global `storeContent` switch is never auto-flipped — the
per-feed override alone carries that feed's caching.

## Existing Patterns

Investigation grounded this design in established codebase patterns:

- **Effective-policy fallback to global** — `resolveEffectivePolicy` in
  `src/client/db/feed-cache-policy.ts` already resolves a feed's
  `cache_mode`/size/age from the per-feed row falling back to the global
  default. The new `content_enabled` override extends this exact pattern.
- **CheckBox component** — `@substrate-system/check-box`
  (`CheckBox.TAG`), used on `/settings` (`settings.ts`) with
  `name`/`checked`/`disabled`/`onChange` and a standard `change` event
  (`ev.target.checked`). The new toggle reuses it.
- **Bootstrap-on-enable** — `handleSyncChange` in `src/client/routes/
  settings.ts` already pairs `setSyncSubscriptions(true)` (returns
  `'applied' | 'pending' | 'blocked'`) with `bootstrapLocalDb(did, fetch,
  { confirmTerminalReset, confirmLowStorage })`, surfacing progress via
  the `bootstrapInProgress` / `bootstrapError` signals. The reader-route
  enable path reuses this verbatim.
- **`<fieldset disabled>` gating** — `/settings` grays its cache section
  with a disabled `<fieldset>` (native control disabling, no
  `aria-disabled`). The panel's mode/size/age controls reuse this.
- **Disclosure** — `cache-settings.ts` already wraps the panel in the
  `@substrate-system/details-summary` component; only the `<summary>`
  label text changes.
- **Billing gate** — the unentitled-disable expression
  `(isBillingLoaded && !isEntitled) || !supported` is copied from the
  `/settings` sync/store-content toggles.

**Divergence:** the reader-route control intentionally does **not** gray
out when local storage is merely off (feature 027 does, on `/settings`).
Here it stays interactive and bootstraps. This is a deliberate,
documented divergence.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Data model & effective-state resolver
**Goal:** Persist the tri-state per-feed override and expose a single
resolver shared by all consumers.

**Components:**
- `src/client/db/local-schema.ts` — add nullable `content_enabled
  INTEGER` to `feed_cache_policy`; additive migration for existing local
  DBs (verify the repo's migration mechanism — `CREATE TABLE IF NOT
  EXISTS` will not add the column to existing DBs).
- `src/client/db/feed-cache-policy.ts` — add `content_enabled:boolean|
  null` to `FeedCachePolicyRow`; update `upsertFeedCachePolicy` so the
  "all-null → DELETE" rule excludes a non-null `content_enabled` (a
  `{content_enabled: 0}` row must survive); extend `resolveEffectivePolicy`
  / add `isContentCachedForFeed(feedId)` (signal-based) and a DB-side
  resolver for the sync pipeline.

**Dependencies:** None.

**Done when:** Column + migration land; round-trip persistence of all
three states works; resolver returns `override ?? global` correctly.
Covers **AC2**, **AC7**, and the upsert portion of **AC9**.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Sync & read-path gating
**Goal:** Make content/image caching honor the per-feed effective state,
and preserve already-cached content when a feed is force-off.

**Components:**
- `src/client/db/pull-sync.ts` — replace the single `keepContent =
  storeContent.value` with a per-feed effective value; gate `upsertItem`
  and image-cache push per feed. Ensure `upsertItem` **preserves existing
  non-null content** on update when `keepContent` is false (do not strip
  bodies already cached).
- `src/client/state.ts` — on-demand full-article fetch gate becomes
  `item.missingBody && isContentCachedForFeed(item.feed_id)`.
- `src/client/db/cache-status.ts` — `wantBody` becomes per-feed effective
  so the status indicator reflects the feed's real policy.

**Dependencies:** Phase 1.

**Done when:** Force-on feed caches with global off; force-off feed stops
new caching while existing bodies survive a re-sync; inherit feed follows
the global. Covers **AC4**, the sync portion of **AC5**, and **AC2**
applied in the pipeline.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Cache Settings panel UI
**Goal:** Rename the summary and add the smart checkbox gating the
existing controls.

**Components:**
- `src/client/components/cache-settings.ts` — replace the computed
  `Cache: {mode}` summary with static **"Cache Settings"**; add the
  `CheckBox.TAG` "Cache this feed" control showing effective state, with
  the smart-clear logic (value equal to global → write `null`; else write
  explicit override); wrap mode/size/age in `<fieldset disabled=${!
  effective}>`; apply the billing gate `(isBillingLoaded && !isEntitled)
  || !supported` with a "requires a paid plan" hint via
  `aria-describedby`; wire `aria-controls` to the fieldset.

**Dependencies:** Phase 1.

**Done when:** Summary reads "Cache Settings"; checkbox reflects effective
state and writes correct tri-state values; sub-controls gray out when
effective-off; checkbox grays with hint when unentitled but stays
interactive when storage is merely off. Covers **AC1**, **AC3**, the UI
portion of **AC4**, **AC6**, and **AC9**.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Enable-while-storage-off bootstrap flow
**Goal:** Let the toggle turn on local storage and persist the override
once the DB exists.

**Components:**
- `src/client/components/cache-settings.ts` — when enabling makes the feed
  effectively-on and `!isLocalFirstActive`, call `setSyncSubscriptions(
  true)` + `bootstrapLocalDb(...)` (reusing the settings confirmations);
  set the in-memory `feedPolicies` override optimistically; persist
  `content_enabled:1` to the DB **after** bootstrap succeeds; on
  `bootstrapError`, revert the optimistic override. Handle `'pending'`
  (stash intent, apply when billing resolves) and `'blocked'` defensively
  (no-op + plan hint). Reflect `bootstrapInProgress` as a pending/disabled
  checkbox state.

**Dependencies:** Phases 1 and 3.

**Done when:** Enabling a feed while storage is off (entitled) bootstraps,
then writes the override so only that feed caches; bootstrap failure
reverts cleanly; `/settings` behavior is unchanged. Covers **AC5** and
**AC8**.
<!-- END_PHASE_4 -->

## Additional Considerations

**Migration safety.** The `content_enabled` column is additive and
nullable; existing rows read as `null` (inherit), preserving current
effective behavior for users who already store content globally. The
exact migration hook must be confirmed against the repo's local-schema
versioning during Phase 1.

**Initial-bootstrap body gap.** The bootstrap `pullSync` runs before the
override row is written, so a just-enabled feed's existing items arrive
body-less; bodies fill in on the next sync or on demand via the
now-per-feed-aware `fetchFullArticle`. Acceptable; no extra re-sync is
forced.

**Preserve-on-disable is a deliberate divergence.** Per-feed force-off
keeps existing bodies, unlike toggling the *global* `storeContent` off
(which strips bodies on re-sync). The `upsertItem` update path must
distinguish these so a disabled feed's cached content is not collaterally
removed.
