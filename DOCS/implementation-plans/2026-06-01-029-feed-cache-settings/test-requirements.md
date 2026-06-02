# Feed Cache Settings (029) — Test Requirements

This document maps every acceptance-criterion sub-case from the design plan
(`DOCS/design-plans/2026-06-01-029-feed-cache-settings.md`, AC1–AC9) to a
concrete verification: an automated test (with its type and the file path
that hosts it) or human verification (with justification and steps).

The harness is fixed and is not invented here:

- Test runner: `@substrate-system/tapzero` (TAP). Full suite `npm test`;
  lint `npm run lint`.
- DB/logic tests use REAL WASM SQLite via `openLocalDb('did:test:<unique>')`
  + `setTestMode(true, wasmUrl)`. SQLite is never mocked.
- Component tests render Preact components/routes with `render` from
  `preact` and query the DOM with `querySelector`. Per project rule, no
  test asserts specific HTML text content; UI tests query by `name`/`id`
  attributes and assert structural/property state (e.g. `disabled`,
  `aria-describedby`, signal values), or assert `textContent` invariance
  rather than a literal string.

Test files used by this feature:

- `test/feed-cache-policy.ts` — Phase 1 resolver + persistence (unit;
  real WASM SQLite). Wired into `test/index.ts`; runs under `npm test`.
- `test/pull-sync.ts` — Phase 2 sync gating + preserve-on-disable
  (integration; real WASM SQLite + `fetch` stub). Run via
  `npm run test:pull-sync`.
- `test/cache-status.ts` — Phase 2 per-feed `wantBody`
  (integration; real WASM SQLite). Run via `npm run test:cache-status`.
- `test/feed-reader-cache-disclosure.ts` — Phase 3 + 4 UI (component;
  renders `FeedReader` with a mock `AppState`). Wired into `test/index.ts`.
- `test/settings-route.ts` — pre-existing `/settings` regression suite
  (component). Referenced for AC8.1 regression protection; not modified by
  this feature.

Coverage summary: every AC sub-case maps to exactly one of automated or
human-verified. The Human Verification Checklist at the end gathers all
manual items with copy-pasteable steps.

---

## AC1: Summary reads a static "Cache Settings"

| Sub-case | Type | Location / approach |
| --- | --- | --- |
| `029-feed-cache-settings.AC1.1` Success | Automated — component | `test/feed-reader-cache-disclosure.ts`. Render the disclosure and assert a fixed `<summary>` is present. Tested together with AC1.2 as `textContent` invariance — do NOT assert the literal "Cache Settings" string (project rule; the literal is brittle copy). |
| `029-feed-cache-settings.AC1.2` Success | Automated — component | `test/feed-reader-cache-disclosure.ts`. Capture the `<summary>` `textContent` with `cache_mode` unset, then re-render with `cache_mode='text'` and `'text_images'` (via `feedPolicies`); assert `textContent` is identical across all three. This proves the summary no longer reflects the active cache mode (invariance), without coupling to specific text. |

## AC2: Tri-state effective resolution (`override ?? global`)

These are pure resolver truth-table cases driven directly against
`isContentCachedForPolicy` with `storeContent.value` set in the test and
restored afterward. AC2.3 is additionally re-verified inside the sync
pipeline (Phase 2) since it is the load-bearing "force-on beats global-off"
case.

| Sub-case | Type | Location / approach |
| --- | --- | --- |
| `029-feed-cache-settings.AC2.1` Success (override null + global on → on) | Automated — unit | `test/feed-cache-policy.ts`. `isContentCachedForPolicy({content_enabled:null})` with `storeContent.value=true` → `true`. |
| `029-feed-cache-settings.AC2.2` Success (override null + global off → off) | Automated — unit | `test/feed-cache-policy.ts`. `content_enabled:null` + `storeContent.value=false` → `false`. |
| `029-feed-cache-settings.AC2.3` Success (override true + global off → on) | Automated — unit + integration | `test/feed-cache-policy.ts` (resolver: `content_enabled:1` + global off → `true`). Re-verified in the pipeline in `test/pull-sync.ts` (a `content_enabled=1` feed caches bodies even with `storeContent=false`). |
| `029-feed-cache-settings.AC2.4` Success (override false + global on → off) | Automated — unit | `test/feed-cache-policy.ts`. `content_enabled:0` + `storeContent.value=true` → `false`. |
| `029-feed-cache-settings.AC2.5` Edge (override true + global on → on) | Automated — unit | `test/feed-cache-policy.ts`. `content_enabled:1` + `storeContent.value=true` → `true`. |

## AC3: Toggle ON activates controls; mode default

| Sub-case | Type | Location / approach |
| --- | --- | --- |
| `029-feed-cache-settings.AC3.1` Success (effective-on → controls enabled) | Automated — component | `test/feed-reader-cache-disclosure.ts`. Entitled, `storeContent=true`, no override → effective-on → assert the mode/size/age `<fieldset>` has `disabled === false` (query the fieldset by `id="feed-cache-fields-<id>"`). |
| `029-feed-cache-settings.AC3.2` Success (no `cache_mode` override → default `text_images`) | Automated — unit | `test/feed-reader-cache-disclosure.ts` (pure resolver assertion): with `cache_mode` null, `resolveEffectivePolicy(feedPolicies.value[id]).cacheMode === 'text_images'`. (Exercises the existing `resolveEffectivePolicy` default contract, unchanged by this feature.) |
| `029-feed-cache-settings.AC3.3` Success (mode/size/age change persists) | Automated — component | `test/feed-reader-cache-disclosure.ts`. With a `content_enabled` override set, change `cache_mode` via the select and assert `feedPolicies.value[id].content_enabled` is preserved (the `saveFeedPolicy` merge keeps the override) and the new mode is recorded. Persistence to the policy row through `upsertFeedCachePolicy` is independently covered by AC7.1/AC9.2 in `test/feed-cache-policy.ts`. |

## AC4: Toggle OFF stops new caching, keeps existing, grays controls

AC4.1/AC4.2/AC4.4 are sync-pipeline behaviors (integration, real WASM
SQLite + `fetch` stub returning a `SyncResponse`). AC4.3 is the UI gray-out
(component, native `<fieldset disabled>`).

| Sub-case | Type | Location / approach |
| --- | --- | --- |
| `029-feed-cache-settings.AC4.1` Success (force-off feed → new items metadata-only) | Automated — integration | `test/pull-sync.ts`. Global `storeContent=false`, feed policy `content_enabled=0`; sync new items → upserted rows have null `content`/`description`/`full_content`. |
| `029-feed-cache-settings.AC4.2` Success (force-off feed → previously cached bodies survive re-sync) | Automated — integration | `test/pull-sync.ts`. Seed an item with non-null `content`; set the feed `content_enabled=0`; re-sync the same id with a body-bearing payload → existing `content` is still present (preserve-on-disable `COALESCE`), and a brand-new item in the same sync lands body-less. |
| `029-feed-cache-settings.AC4.3` Success (effective-off → controls disabled) | Automated — component | `test/feed-reader-cache-disclosure.ts`. Entitled, `storeContent=false`, no override → effective-off → assert the mode/size/age `<fieldset>` is `disabled`. |
| `029-feed-cache-settings.AC4.4` Success (force-off feed → no new images) | Automated — integration | `test/pull-sync.ts`. With a force-off feed, after sync assert no new rows were added to `cached_images` for that feed (force-off items are never pushed to `itemsToCache`). |

## AC5: Enable while storage off → bootstrap, only that feed

The bootstrap orchestration is imperative wiring observed through signal
effects and a global `fetch` stub. The full happy-path OPFS bootstrap is
flaky to drive end-to-end inside the render suite, so AC5.2 is best-effort
automated and otherwise human-verified.

| Sub-case | Type | Location / approach |
| --- | --- | --- |
| `029-feed-cache-settings.AC5.1` Success (enable while off + entitled → `setSyncSubscriptions(true)` + `bootstrapLocalDb`) | Automated — component | `test/feed-reader-cache-disclosure.ts`. Entitled, `storeContent=false`, `isLocalFirstActive=false`, no override; stub global `fetch` so bootstrap starts but stays pending. Dispatch checkbox `change` `checked=true`; assert `syncSubscriptions.value === true` (proves `setSyncSubscriptions(true)` ran) and that `fetch` was called with the `/api/sync` URL (proves `bootstrapLocalDb` started). |
| `029-feed-cache-settings.AC5.2` Success (after bootstrap success → `content_enabled=1` persisted) | Best-effort automated, else HUMAN | `test/feed-reader-cache-disclosure.ts` if the `test/bootstrap.ts` `fetch` stub + WASM/OPFS path can be reused reliably (stub returns a minimal valid `SyncResponse`, bootstrap produces a DB, read back `content_enabled=1` via `getFeedCachePolicy`). If a reliable OPFS bootstrap is not available in the render suite, leave to human verification rather than write a flaky test. See HV-1. |
| `029-feed-cache-settings.AC5.3` Success (post-enable → only that feed caches; inherit feeds do not) | Automated — integration | Covered by the Phase 2 pull-sync tests in `test/pull-sync.ts` (an `content_enabled=1` feed caches; an inherit feed with global off does not). No new component test needed; this is the same per-feed gating proven for AC2.3. |
| `029-feed-cache-settings.AC5.4` Failure (bootstrap failure reverts the optimistic override) | Automated — component | `test/feed-reader-cache-disclosure.ts`. Stub `fetch` to reject / return an error response that drives `bootstrapLocalDb` to its failure path (no DB produced). Dispatch `change` `checked=true`; await microtasks / `bootstrapInProgress` settling; assert `feedPolicies.value[id].content_enabled` reverted to `null` (prior value) and `storeContent.value === false`. |
| `029-feed-cache-settings.AC5.5` Edge (enabling a feed does not flip global `storeContent` on) | Automated — component | `test/feed-reader-cache-disclosure.ts`. Same setup as AC5.1; after dispatching `change` `checked=true`, assert `storeContent.value === false`. (`setSyncSubscriptions(true)` flips only `syncSubscriptions`.) |

## AC6: Unentitled → grayed with plan hint

| Sub-case | Type | Location / approach |
| --- | --- | --- |
| `029-feed-cache-settings.AC6.1` Failure (billing loaded & not entitled → checkbox disabled) | Automated — component | `test/feed-reader-cache-disclosure.ts`. Set `billingStatus` loaded with `entitled:false`; query the checkbox by `name="feed-cache-content-<id>"` and assert it is `disabled`. |
| `029-feed-cache-settings.AC6.2` Success (unentitled → plan hint associated with control) | Automated — component | `test/feed-reader-cache-disclosure.ts`. Unentitled → assert an element with `id="feed-cache-plan-hint-<id>"` exists and the checkbox's `aria-describedby` references that id (association, not the hint's literal text). |
| `029-feed-cache-settings.AC6.3` Success (entitled but storage off → checkbox interactive) | Automated — component | `test/feed-reader-cache-disclosure.ts`. Entitled, `isLocalFirstActive=false`, `storeContent=false` → assert the checkbox is NOT `disabled` (the deliberate divergence from `/settings`). |

## AC7: Persistence in local SQLite; tri-state; client-only

All persistence cases use real WASM SQLite via `openLocalDb('did:test:*')`
with `try/finally` close.

| Sub-case | Type | Location / approach |
| --- | --- | --- |
| `029-feed-cache-settings.AC7.1` Success (`true`/`false`/`null` round-trip across reload) | Automated — unit | `test/feed-cache-policy.ts`. Upsert `content_enabled=1`, read back via `getFeedCachePolicy` → `1`; repeat for `0`; for inherit, upsert to all-null and assert the row is gone (`getFeedCachePolicy` returns `null`). |
| `029-feed-cache-settings.AC7.2` Success (`{content_enabled:0}` + null mode/size/age survives upsert) | Automated — unit | `test/feed-cache-policy.ts`. `upsertFeedCachePolicy(db, id, {cache_mode:null, max_size_bytes:null, max_age_seconds:null, content_enabled:0})` → `getFeedCachePolicy` returns a non-null row with `content_enabled === 0` (the DELETE rule must NOT fire). |
| `029-feed-cache-settings.AC7.3` Success (all-null row deleted → back to inherit) | Automated — unit | `test/feed-cache-policy.ts`. Upsert with every field null → row deleted (`getFeedCachePolicy` returns `null`). Also assert a row with `content_enabled` cleared to `null` but a non-null `cache_mode` still survives (DELETE only fires when all four are null). |
| `029-feed-cache-settings.AC7.4` Success (no server/network write for cache settings) | Automated — unit | `test/feed-cache-policy.ts`. Install a minimal `globalThis.fetch` spy that fails the test if called during `upsertFeedCachePolicy`; restore it in `finally`. Asserts the write is purely local. |

## AC8: Scope — /settings unchanged

| Sub-case | Type | Location / approach |
| --- | --- | --- |
| `029-feed-cache-settings.AC8.1` Success (`/settings` per-feed control still grays out when storage off) | Automated — regression (NO new test) | Guaranteed by NOT modifying `src/client/routes/settings.ts`. Regression-protected by the existing `test/settings-route.ts` suite, which continues to pass under `npm test`. Per the Phase 4 plan, do not add a duplicate assertion that couples this feature to settings internals. |
| `029-feed-cache-settings.AC8.2` Success (enabling a feed on the reader route does not change `/settings` global "Store article content locally") | Automated — component | `test/feed-reader-cache-disclosure.ts`. Same observable as AC5.5: after the reader-route enable path runs, assert `storeContent.value === false` (the signal that `/settings` binds the global "Store article content locally" toggle to is untouched). |

## AC9: Smart-checkbox & read-path consistency

AC9.1/AC9.2 have a storage-layer half (unit, the upsert honors the written
value) and a UI half (component, the smart checkbox decides which value to
write). AC9.3 spans three read paths; two are automated and the on-demand
fetch gate is partly human-verified.

| Sub-case | Type | Location / approach |
| --- | --- | --- |
| `029-feed-cache-settings.AC9.1` Success (toggle to value equal to global clears override → writes `null`) | Automated — component + unit | UI: `test/feed-reader-cache-disclosure.ts` — with `storeContent=true` and effective-on, toggle off then on; after the second toggle (chosen value equals global `true`) assert `feedPolicies.value[id].content_enabled === null`. Symmetric case with `storeContent=false`. Storage half: `test/feed-cache-policy.ts` — writing all-null removes the row (delete-to-inherit). |
| `029-feed-cache-settings.AC9.2` Success (toggle opposite the global writes explicit `0`/`1`) | Automated — component + unit | UI: `test/feed-reader-cache-disclosure.ts` — `storeContent=false`, `change` `checked=true` → `content_enabled === 1`; `storeContent=true`, `checked=false` → `=== 0`. Storage half: `test/feed-cache-policy.ts` — writing `0`/`1` persists an explicit override row. |
| `029-feed-cache-settings.AC9.3` Success (all read paths — pull-sync, on-demand fetch, cache-status — agree with the resolver) | Automated (2 of 3 paths) + HUMAN (on-demand fetch) | pull-sync path: `test/pull-sync.ts` (per-feed gating via `isContentCachedForPolicy`). cache-status path: `test/cache-status.ts` (`wantBody` computed per feed; override-on feed flags `missingBody:true` with global off, inherit feed does not; flip global on with `content_enabled=0` → that feed not flagged). On-demand `fetchFullArticle` gate in `state.ts` (`item.missingBody && isContentCachedForFeed(item.feed_id)`) is partly human-verified — see HV-2. |

---

## Human Verification Checklist

The following items are not reliably automatable in the current harness and
must be verified manually. Each lists why, plus concrete steps in the
reader route and the expected observable result.

Setup common to all items: run the app locally (dev server), sign in as an
entitled (paid-plan) account, and open the feed-reader route with at least
two subscribed feeds (call them Feed A and Feed B). Open the "Cache
Settings" disclosure on a feed's reader view.

### HV-1 — AC5.2: override persists after a real OPFS bootstrap

Why manual: a full OPFS-backed `bootstrapLocalDb` happy path is flaky to
drive inside the Preact render suite (real OPFS + WASM + network). If the
Phase 4 best-effort automated attempt is not stable, verify by hand.

Steps:
1. Start from a clean state: entitled account with device local storage OFF
   (the global "Store article content locally" toggle on `/settings` is off
   and no local DB exists yet).
2. On the reader route for Feed A, open "Cache Settings" and check the
   "Cache this feed" checkbox.
3. Wait for the bootstrap to finish (the checkbox is disabled while
   `bootstrapInProgress`, then re-enables).
4. Reload the page.

Expected: after reload, Feed A's "Cache this feed" checkbox is still checked
(its `content_enabled=1` override survived in the local SQLite
`feed_cache_policy` table), while Feed B (untouched, inherit) reflects the
still-off global. The `/settings` global "Store article content locally"
toggle remains OFF.

### HV-2 — AC9.3 (on-demand fetch half): `fetchFullArticle` honors the per-feed resolver

Why manual: the on-demand fetch gate wiring in `state.ts`
(`item.missingBody && isContentCachedForFeed(item.feed_id)`) is imperative
state-flow that the design designates as human-verified; an automated test
would require coupling to `state.ts` internals. The pull-sync and
cache-status read paths of AC9.3 are automated.

Steps:
1. Ensure device local storage is ON and the global "Store article content
   locally" is OFF.
2. On the reader route, set Feed A "Cache this feed" ON (override-on) and
   leave Feed B inheriting (effectively off).
3. Open an article in Feed A whose body is not yet cached (missing body) and
   let it fetch the full article on demand.
4. Open an article in Feed B in the same missing-body condition.

Expected: after viewing, Feed A's just-fetched article body is mirrored
into the local DB (it reads back as cached on a later visit / after
reload), while Feed B's article body is NOT written to the local DB (the
article still displays from in-memory state, but no body is persisted for
the non-caching feed). This confirms the on-demand fetch path agrees with
`pull-sync` and `cache-status`.

---

## Counts

- Automated sub-cases: 29 (AC1.1, AC1.2, AC2.1–AC2.5, AC3.1–AC3.3,
  AC4.1–AC4.4, AC5.1, AC5.3, AC5.4, AC5.5, AC6.1–AC6.3, AC7.1–AC7.4,
  AC8.1, AC8.2, AC9.1, AC9.2). AC8.1 is automated via regression
  protection (no new test); AC5.3 reuses the Phase 2 pull-sync tests.
- Human-verified sub-cases: 2 (AC5.2, AC9.3), both partial. AC5.2 is
  best-effort automated and falls back to HV-1 if the OPFS bootstrap
  proves flaky; AC9.3 is automated for the pull-sync and cache-status read
  paths and human-verified (HV-2) only for the on-demand
  `fetchFullArticle` gate.

Total AC sub-cases: 31 (AC1: 2, AC2: 5, AC3: 3, AC4: 4, AC5: 5, AC6: 3,
AC7: 4, AC8: 2, AC9: 3).
