# Quickstart — Manual Verification of Instant Settings → Home

**Branch**: `022-fix-settings-nav-lag` | **Date**: 2026-05-21

The constitution requires "UI changes MUST be exercised in a browser
before being claimed complete". This file is the script. It is the
canonical answer to "did the fix actually work?" — automated tests
verify the mechanism, this script verifies the visible behaviour the
spec requires.

## Setup

1. Have an account with **a lot** of synced items locally. The
   reporter's report is reproducible on accounts of any size, but
   the symptom is most visible at ≥2000 items because the existing
   `computeCacheStatus` iteration scales with item count. If you do
   not have such an account, follow ten high-traffic feeds and let
   the alarm-driven refresh fill the local DB for a day.
2. Make sure the **Local-first** plan is on and `syncSubscriptions`
   is enabled (Settings → Local Storage → "Sync subscriptions and
   read state to this device").
3. Open the app in a Chromium-based browser (DevTools has the
   richest Performance tooling). Repeat the spec-critical steps in
   Safari as well to confirm the `setTimeout` fallback path.
4. Hard reload (`Cmd-Shift-R` / `Ctrl-Shift-R`) so the bootstrap
   completes once before you start measuring. Subsequent navigations
   are the mid-session case the spec covers.

## Primary scenario — `/settings` → `/`

This is the report. Reproduces the original bug on `staging` and
must be instant after the fix.

1. Navigate to `/`. Confirm the items list paints (this populates
   `viewItemsCache` for filter key `'all'`).
2. Click the cog wheel in the sidebar to navigate to `/settings`.
   Wait ~2 seconds for the Settings page to finish its mount-time
   loads (subscription info, payment methods, per-feed policies,
   storage usage).
3. Click **"< Back to Feeds"** at the top of the Settings page.

**Expected (post-fix)**:

- The URL flips to `/` and the page contents flip to the items list
  on the same visible frame. No human-perceptible pause.
- The items list is the same set you saw before clicking the cog
  (no flash to empty, no "Loading items…" placeholder, no jump to
  the top of the list).
- The header health indicator may briefly stay at its previous value
  and update within ~200 ms — this is the deferred
  `recomputeCacheStatus` running after paint. That brief lag in the
  *indicator* is acceptable; the lag in *the page itself* is not.

**Failure modes to watch for**:

- Settings content still visible after the URL says `/`. (FR-002,
  SC-002.)
- Items list flashes empty or shows "Loading items…". (FR-003,
  FR-004, SC-003.)
- The whole page locks for >100 ms. Open DevTools Performance
  panel, record across the click, and look for a long task in the
  main thread immediately after the click. If you see one, the
  `effect()` rewrite did not take effect or `requestIdleCallback`
  is not being used.

## Browser Back/Forward

Same expectations as the link click. Tests FR-007.

1. From `/`, navigate to `/settings`.
2. Press the browser's **Back** button.

Expected: identical to clicking "Back to Feeds" — instant
transition, no pause, no flash.

3. Press the browser's **Forward** button (returns to `/settings`).
4. Press **Back** again.

Each transition must be the same. Repeat five times to confirm
SC-004 (every round-trip behaves the same).

## Settings async writes don't bleed into the new view

This is FR-006. The reproduction needs network throttling so a slow
Settings load can land **after** the user navigates away.

1. DevTools → Network → Throttling → "Slow 3G".
2. Navigate to `/settings`. (Confirm the page mounts; the
   subscription/payment-method/storage panels will show their
   loading states.)
3. **Immediately** click "Back to Feeds" before any of those panels
   have finished loading.
4. Watch the home view for any visible change in the next 30
   seconds.

Expected:

- The home view paints instantly (per the primary scenario).
- The per-feed `<CacheSettings>` controls in the FeedReader (visible
  when a single feed is selected) do not flicker or change as the
  late Settings loads resolve. The page is stable.
- The header health indicator may update once the deferred recompute
  runs, but no visible content in `<FeedReader>` should be replaced
  or re-mounted by a late-arriving Settings response.

Failure mode: the per-feed cache mode toggle in FeedReader updates
visibly mid-screen because a late `loadFeedPolicies` overwrote
`feedPolicies.value`. If you see this, the stale-write guard
(`shouldApply`) is not wired up correctly.

## 021 regression check

This is FR-008. The Starred ⇄ All Items behaviour must still be
instant.

1. Click **Starred** in the sidebar. List paints instantly.
2. Click **All Items**. List paints instantly.
3. Toggle back and forth five times. No pauses, no Loading…
   placeholder.

This is the contract 021 introduced; we are confirming we did not
regress it.

## Cold-load exception

The spec calls this out as out-of-scope (the bug is mid-session).
Verify that the cold-load behaviour is **unchanged** so the fix
isn't masking a regression there.

1. Hard reload directly on `/settings` (paste the URL into a fresh
   tab).
2. Wait for the page to render. (The header skeleton may show
   briefly.)
3. Click "Back to Feeds".

Expected: the items list still goes through its first-load skeleton
because the local data isn't in `viewItemsCache` yet. This is the
correct behaviour; it is the cold path the spec preserves.

## DevTools sanity check

Optional — useful when investigating regressions.

1. DevTools → Performance → Record.
2. Navigate `/settings` → `/`.
3. Stop recording.
4. In the Main track, locate the task that runs immediately after
   the click. It should be brief (the route-event listener + Preact
   reconcile + `<FeedReader>` mount). The long `computeCacheStatus`
   task should appear **after** the paint that draws `<FeedReader>`,
   inside an "Idle" callback. If it appears **before** the paint,
   the fix did not take effect.

## Tear-down

No tear-down needed. The fix introduces no persisted state and no
new feature flag.

## Sign-off

Before marking the feature done, confirm:

- [ ] Primary scenario passes in Chrome.
- [ ] Primary scenario passes in Safari (verifies `setTimeout`
      fallback).
- [ ] Back/Forward parity verified in both browsers.
- [ ] Settings-async-bleed scenario passes under "Slow 3G".
- [ ] 021 Starred ⇄ All Items still instant.
- [ ] Cold-load `/settings` → `/` still shows the first-load
      skeleton (no spurious regression there).
- [ ] DevTools Performance panel shows `computeCacheStatus`
      running after paint, not before.
