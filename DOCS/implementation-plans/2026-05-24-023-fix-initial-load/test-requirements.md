# 023 Fix Initial Load — Test Requirements

This document maps every acceptance criterion in the
`2026-05-24-023-fix-initial-load` design plan to either an automated
test or a documented human-verification procedure. Each AC is
classified as `AUTOMATED`, `HUMAN`, or `HYBRID`, with the test file
path, phase task ownership, and verification approach noted.

Project testing conventions (from `CLAUDE.md` and Phase 3):
- Tests use `@substrate-system/tapzero`.
- Each test module gets a `test:<name>` entry in `package.json` of
  the form `esbuild ./test/<file>.ts --bundle | tapout` plus an
  identical entry in `test/run-all-tests.mjs`.
- TypeScript style: 80-column lines, no space after colon in type
  annotations.
- No real network or DOM in tests; stub via the patterns established
  in `test/local-first-settings.ts` and `test/sync.ts`.

The browser environment is the `esbuild --bundle | tapout` pipeline,
which executes the bundle in a tapzero-driven browser-like host. UI
behavior that depends on real layout, real network throttling,
DevTools inspection, or live Stripe SDK loading falls outside that
host and is classified as HUMAN.

---

## AC1: Render gate is removed; shell paints unconditionally

Phase 7 owns the `pageReady` removal and the sub-tree render rules.
Render-rule branches in `renderEmptyState` are unit-testable at the
signal level; everything that depends on real network throttling or
real DOM paint timing is verified manually.

### AC1.1 Success

> With a populated paint cache and `syncSubscriptions=true`, the
> sidebar feed list is in the DOM with real data before any
> `/api/feeds` request resolves (verified with a slow-stub fetch).

- **Category:** HUMAN
- **Justification:** Verifies real DOM presence before a real (or
  throttled) network response, which requires DevTools network
  throttling on the dev server. The `esbuild | tapout` host has no
  layout engine and no DevTools throttling primitive.
- **Approach:**
  1. Prime the paint cache by logging in fresh and using the app
     until `rsss.paintCache.v1.<did>` is populated.
  2. Reload with `/api/feeds` throttled (DevTools "Slow 3G" or a
     local stub returning after ≥3 s).
  3. Observe that sidebar feed titles are rendered before the
     `/api/feeds` row in the Network panel reaches `200`.
  4. Capture a screenshot of the rendered sidebar with the pending
     `/api/feeds` request visible.
- **Owning task:** Phase 7 Task 2 (manual check #1) and Phase 8
  Task 4 (logged in `manual-verification.md`, row AC1.1).

### AC1.2 Success

> The app shell (header, sidebar chrome, top-level layout) is in
> the DOM on every load regardless of `authLoading` state.

- **Category:** HUMAN
- **Justification:** Verifies the live shell is present during a
  brief, real-network `authLoading` window. Unit-testable rendering
  of `<Header>` independently does not prove the shell is in the
  DOM during the load. Requires live observation.
- **Approach:** Cold-load the app, observe via DevTools Elements
  panel that `<header>` is in the DOM continuously from first
  paint, including during `state.authLoading.value === true`.
- **Owning task:** Phase 7 Task 2 (manual check #2) and Phase 8
  Task 4 (`manual-verification.md`, row AC1.2).

### AC1.3 Success

> Sub-trees with empty signals and no fetch in flight show their
> empty-state UI (not a skeleton).

- **Category:** AUTOMATED
- **Test type:** Unit (render-state).
- **Test file:** `test/feed-reader-render-state.ts`
- **Description:** Set `itemsLoading.value = false`,
  `items.value = []`, `feeds.value = [someFeed]`,
  `selectedFeed = null`, `bootstrapInProgress.value = false`. Assert
  the rendered output contains the empty-state copy (e.g., "No
  items to show.") and does NOT contain skeleton markup. Avoid
  asserting exact prose; assert on the absence of a `skeleton-*`
  class or the presence of the empty-state container, not on the
  literal string.
- **Owning task:** Phase 7 Task 3.

### AC1.4 Failure

> Sub-trees with empty signals AND a fetch in flight show a
> contextual loading placeholder (e.g., 1-2 skeleton rows), not a
> full-page block.

- **Category:** AUTOMATED
- **Test type:** Unit (render-state).
- **Test file:** `test/feed-reader-render-state.ts`
- **Description:** Set `itemsLoading.value = true`,
  `items.value = []`. Assert the rendered output contains the
  contextual loading placeholder and NOT a full-page block (no
  `PageSkeleton` markup). Assert on the loading-placeholder
  container class, not on the literal "Loading items..." string.
- **Owning task:** Phase 7 Task 3.

### AC1.5 Edge

> Removing `pageReady` does not regress the unauthenticated landing
> view (login form still renders correctly).

- **Category:** HUMAN
- **Justification:** Requires opening `/login` in a real browser to
  confirm the form renders with no skeleton flash. The
  unauthenticated landing view's correctness is layout-sensitive
  and traditionally checked manually.
- **Approach:** Open the `/login` route in an incognito tab.
  Confirm the login form renders immediately, no skeleton flash
  precedes it.
- **Owning task:** Phase 7 Task 2 (manual check #3) and Phase 8
  Task 4 (`manual-verification.md`, row AC1.5).

---

## AC2: Paint cache module persists and reads correctly

Phase 3 owns the paint-cache primitives. Every behavior is
testable at the module level because the module is pure I/O
against `localStorage`. Phase 5 covers the write-trigger AC2.4 via
its load-action wiring.

### AC2.1 Success

> `writePaintCache(did, snap)` followed by `readPaintCache(did)`
> round-trips an equivalent snapshot when the snapshot is under all
> caps.

- **Category:** AUTOMATED
- **Test type:** Unit (property/round-trip).
- **Test file:** `test/paint-cache.ts`
- **Description:** Build a snapshot with a handful of feeds, items,
  a counts object, and a `selectedFeedId`. Write for
  `did:plc:alice`; read back; deep-equal feeds/items/counts/
  `selectedFeedId` against inputs; assert `schemaVersion === 1`
  and `writtenAt` is a recent timestamp.
- **Owning task:** Phase 3 Task 3.

### AC2.2 Success

> A snapshot with 300 items is written with exactly 200 items
> after truncation (newest-first preserved).

- **Category:** AUTOMATED
- **Test type:** Unit (cap/truncation).
- **Test file:** `test/paint-cache.ts`
- **Description:** Construct 300 small `ItemSummary` items (each
  under the byte cap so item-count cap drives truncation). Write,
  read back, assert `items.length === 200`, assert the first item
  read equals the first item written (newest-first preservation).
- **Owning task:** Phase 3 Task 3.

### AC2.3 Success

> A snapshot whose serialized JSON would exceed 1 MB has
> additional items dropped from the tail until under the cap.

- **Category:** AUTOMATED
- **Test type:** Unit (byte cap).
- **Test file:** `test/paint-cache.ts`
- **Description:** Construct 200 items where each item's title is
  a ~10 KB string so the serialized snapshot exceeds 1 MB. Write,
  read back, assert `items.length < 200` and the serialized length
  of the read snapshot is `≤ 1_000_000`.
- **Owning task:** Phase 3 Task 3.

### AC2.4 Success

> Successful loads in `state.ts` schedule a debounced paint-cache
> write via `scheduleIdle`.

- **Category:** AUTOMATED
- **Test type:** Unit (write-trigger wiring).
- **Test file:** `test/paint-cache-cleanup.ts` (or a fresh
  `test/paint-cache-bootstrap.ts` companion — task-implementor
  chooses based on stub availability; Phase 5 Task 2 lists it as
  "no new tests required for this task — coverage is in Task 4").
- **Description:** Invoke the success path of `loadFeeds` (or
  call `schedulePaintCacheWrite(state)` directly with a populated
  signal state and a logged-in `state.user.value.did`), drain the
  idle queue, assert
  `localStorage.getItem('rsss.paintCache.v1.<did>')` is present
  and parseable as `PaintCacheV1`.
- **Owning task:** Phase 5 Task 2 (helper + call sites); coverage
  asserted alongside the AC6 logout tests.

### AC2.5 Failure

> `readPaintCache(did)` returns `null` (does not throw) when the
> localStorage key is missing.

- **Category:** AUTOMATED
- **Test type:** Unit (negative path).
- **Test file:** `test/paint-cache.ts`
- **Description:** Call `clearPaintCache()`, then
  `readPaintCache('did:plc:bob')`, assert the return value is
  `null` and no exception is thrown.
- **Owning task:** Phase 3 Task 3.

### AC2.6 Failure

> `readPaintCache(did)` returns `null` when the stored JSON is
> malformed.

- **Category:** AUTOMATED
- **Test type:** Unit (negative path).
- **Test file:** `test/paint-cache.ts`
- **Description:** Directly set
  `localStorage.setItem('rsss.paintCache.v1.did:plc:carol', '{not json')`.
  Assert `readPaintCache('did:plc:carol') === null` and no
  exception escapes.
- **Owning task:** Phase 3 Task 3.

### AC2.7 Failure

> `readPaintCache(did)` returns `null` when `schemaVersion` does
> not match the current version constant.

- **Category:** AUTOMATED
- **Test type:** Unit (negative path).
- **Test file:** `test/paint-cache.ts`
- **Description:** Manually serialize a valid JSON object whose
  `schemaVersion === 2`. Assert `readPaintCache(...) === null`.
- **Owning task:** Phase 3 Task 3.

---

## AC3: Bootstrap hydrates synchronously from the cache

Phase 4 wires `hydratePaintCache` into bootstrap. Each AC is
exercisable at the helper level without spinning Preact.

### AC3.1 Success

> `readPaintCache` is called before Preact `render()` in
> `src/client/index.ts`.

- **Category:** AUTOMATED
- **Test type:** Unit (ordering / signal-side-effect).
- **Test file:** `test/paint-cache-bootstrap.ts`
- **Description:** With a pre-populated paint cache for
  `did:plc:alice`, instantiate an `AppState`-shaped object, call
  `hydratePaintCache(state, 'did:plc:alice')`. Assert
  `state.feeds.value`, `state.items.value`, `state.counts.value`,
  and `state.selectedFeedId.value` reflect the cached snapshot.
  (Asserting "before `render()`" is structural — verified by the
  helper's synchronous return signature plus the bootstrap call
  site living above the `render()` call in `index.ts`.)
- **Owning task:** Phase 4 Task 3.

### AC3.2 Success

> Signal hydration uses `batch()` so consumers observe one update,
> not four.

- **Category:** AUTOMATED
- **Test type:** Unit (batching).
- **Test file:** `test/paint-cache-bootstrap.ts`
- **Description:** Subscribe an `effect` (`@preact/signals`) that
  reads all four signals and increments a counter. Call
  `hydratePaintCache(state, 'did:plc:alice')` with a populated
  cache. Assert the counter increments by the single-batch amount
  expected by `@preact/signals` (one combined notification per
  batch).
- **Owning task:** Phase 4 Task 3.

### AC3.3 Failure

> When `rsss.lastSessionDid` is DID-B but a paint cache exists only
> for DID-A, no hydration occurs (DID-A's data is not rendered for
> DID-B).

- **Category:** AUTOMATED
- **Test type:** Unit (per-DID isolation at hydration).
- **Test file:** `test/paint-cache-bootstrap.ts`
- **Description:** Pre-populate paint cache for `did:plc:alice`
  only; call `setStoredDid('did:plc:bob')`; call
  `hydratePaintCache(state, getStoredDid())`. Assert the state
  signals remain at their initial empty values.
- **Owning task:** Phase 4 Task 3.

### AC3.4 Edge

> When `rsss.lastSessionDid` is missing (first-ever load on this
> device), bootstrap proceeds without hydration and does not crash.

- **Category:** AUTOMATED
- **Test type:** Unit (null-safety).
- **Test file:** `test/paint-cache-bootstrap.ts`
- **Description:** With no `rsss.lastSessionDid` key in
  localStorage, call `hydratePaintCache(state, getStoredDid())`.
  Assert it returns `false` and does not throw.
- **Owning task:** Phase 4 Task 3.

---

## AC4: `getAdapter` no longer reads `billingStatus`

Phase 6 owns the predicate change. The existing `test/adapter-factory.ts`
already stubs `billingStatus`, `syncSubscriptions`, and
`isLocalFirstSupported`, so AC4.1 and AC4.2 land there. AC4.3 is
covered by extending existing sync coverage.

### AC4.1 Success

> With `syncSubscriptions=true`, OPFS supported, `did` set,
> `bootstrapInProgress=false`, and `billingStatus.value === null`,
> `getAdapter(did)` returns the local adapter. (Today's code
> returns the remote adapter in this state.)

- **Category:** AUTOMATED
- **Test type:** Unit (predicate behavior).
- **Test file:** `test/adapter-factory.ts` (existing)
- **Description:** Set `syncSubscriptions.value = true`,
  `bootstrapInProgress.value = false`,
  `billingStatus.value = null`, stub `isLocalFirstSupported()` to
  resolve `true`. Call `getAdapter('did:plc:alice')`. Assert the
  returned adapter is the local adapter (reference identity or the
  existing marker used by neighboring tests).
- **Owning task:** Phase 6 Task 1.

### AC4.2 Success

> With `syncSubscriptions=false`, `getAdapter` returns the remote
> adapter regardless of `billingStatus`.

- **Category:** AUTOMATED
- **Test type:** Unit (predicate behavior).
- **Test file:** `test/adapter-factory.ts` (existing)
- **Description:** Set `syncSubscriptions.value = false`,
  `billingStatus.value = { entitled: true, ... }`. Call
  `getAdapter('did:plc:alice')`. Assert the returned adapter is
  the remote adapter.
- **Owning task:** Phase 6 Task 1.

### AC4.3 Failure

> A lapsed-billing user receiving `SyncBillingError` on the first
> background sync still triggers `loadBillingStatus()` and the
> existing downgrade flow.

- **Category:** AUTOMATED
- **Test type:** Unit / integration (existing sync coverage).
- **Test file:** `test/sync.ts` (existing) — extended if existing
  coverage does not already exercise the recovery path; Phase 6
  Task 1 directs the implementer to survey and decide.
- **Description:** Have `runSync` throw `SyncBillingError` inside
  the `startLocalSync` effect; assert `State.loadBillingStatus` is
  called as a side effect (and, optionally, that the UI downgrade
  signals fire).
- **Owning task:** Phase 6 Task 1 (test extension if needed).

---

## AC5: First-ever bootstrap UI

Phase 7 owns the bootstrap card. The render branch is exercisable
at the signal level via `test/feed-reader-render-state.ts`; the
end-to-end "card appears on a real fresh device" flow is HUMAN.

### AC5.1 Success

> When `bootstrapInProgress` is `true` AND `readPaintCache`
> returned `null`, the items pane renders a card with the text
> "Setting up your local cache. This only happens once on this
> device."

- **Category:** HYBRID
- **Automated portion:** Verify the bootstrap-card branch is
  selected by `renderEmptyState` when the gating signals match.
  - **Test type:** Unit (render-state branching).
  - **Test file:** `test/feed-reader-render-state.ts`
  - **Description:** Set `bootstrapInProgress.value = true`,
    `paintCacheHydratedOnBootstrap.value = false`,
    `feeds.value = []`, `items.value = []`. Assert the rendered
    output's root element has the `bootstrap-card` class. Per
    CLAUDE.md, do NOT assert the literal copy text — assert on the
    `bootstrap-card` class and the presence of the
    `bootstrap-card-title` / `bootstrap-card-body` containers.
- **Human portion:** Verify the actual copy ("Setting up your
  local cache. This only happens once on this device.") in the
  rendered UI on a real fresh paid-user device profile.
  - **Approach:** Phase 8 Task 4 manual check #3.
  - **Why human:** AC5.1 names the literal text; CLAUDE.md
    forbids brittle text assertions in tests. The copy is verified
    by visual inspection during manual verification.
- **Owning tasks:** Phase 7 Task 3 (automated branch test); Phase
  8 Task 4 (`manual-verification.md`, row AC5.1).

### AC5.2 Success

> The bootstrap card surfaces `bootstrapFeedsCount` and
> `bootstrapItemsCount` progress values.

- **Category:** AUTOMATED
- **Test type:** Unit (render-state).
- **Test file:** `test/feed-reader-render-state.ts`
- **Description:** Set the gating signals as in AC5.1 plus
  `bootstrapFeedsCount.value = 12`,
  `bootstrapItemsCount.value = 240`. Assert the rendered output
  contains the literal numerics `12` and `240` (the test owns the
  numeric values; this is not brittle prose-matching).
- **Owning task:** Phase 7 Task 3.

### AC5.3 Failure

> When `bootstrapInProgress` becomes `false`, the card is removed
> from the DOM in the same render and replaced by real content
> (no orphan card).

- **Category:** AUTOMATED
- **Test type:** Unit (signal-driven re-render).
- **Test file:** `test/feed-reader-render-state.ts`
- **Description:** Render once with `bootstrapInProgress.value = true`
  and assert the `bootstrap-card` element is present. Set
  `bootstrapInProgress.value = false` and
  `items.value = [someItem]`. Re-render. Assert the
  `bootstrap-card` element is NOT in the rendered output AND that
  the item-row container IS.
- **Owning task:** Phase 7 Task 3.

### AC5.4 Edge

> On a returning load (paint cache hit), the card is never shown.

- **Category:** AUTOMATED
- **Test type:** Unit (suppression by hydration signal).
- **Test file:** `test/feed-reader-render-state.ts`
- **Description:** Set `paintCacheHydratedOnBootstrap.value = true`
  AND `bootstrapInProgress.value = true` (the "paid user with
  cached snapshot whose background bootstrap is still firing"
  case). Assert the `bootstrap-card` element is NOT rendered.
- **Owning task:** Phase 7 Task 3.

---

## AC6: Logout and account-switch cleanup

Phase 5 wires the logout cleanup. Phase 3 already covers the
per-DID isolation primitive (AC6.4) at the module level.

### AC6.1 Success

> Logging out removes `rsss.paintCache.v1.<did>` for the current
> user from localStorage.

- **Category:** AUTOMATED
- **Test type:** Unit / integration (`State.logout` cleanup).
- **Test file:** `test/paint-cache-cleanup.ts`
- **Description:** Pre-populate `rsss.paintCache.v1.<did>` for the
  test user. Stub `api.post('auth/logout')` to succeed. Set
  `state.user.value` to a user with that DID. Call
  `State.logout(state)`. Assert
  `localStorage.getItem('rsss.paintCache.v1.<did>') === null`. If
  the `api` stub pattern is impractical, fall back to the unit-of-
  cleanup test described in Phase 5 Task 3 (invoke
  `clearPaintCache(did)` + `clearStoredDid()` directly).
- **Owning task:** Phase 5 Task 3.

### AC6.2 Success

> Logging out removes `rsss.lastSessionDid` from localStorage.

- **Category:** AUTOMATED
- **Test type:** Unit / integration.
- **Test file:** `test/paint-cache-cleanup.ts`
- **Description:** After the same `State.logout` invocation as
  AC6.1, assert
  `localStorage.getItem('rsss.lastSessionDid') === null`.
- **Owning task:** Phase 5 Task 3.

### AC6.3 Success

> Disabling local-first sync via `disableLocalFirst` also clears
> that DID's paint cache.

- **Category:** AUTOMATED
- **Test type:** Unit / integration.
- **Test file:** `test/paint-cache-cleanup.ts` (same file)
- **Description:** Pre-populate `rsss.paintCache.v1.<did>`. Call
  `disableLocalFirst(did, fetchFn)` with the project's standard
  fetchFn stub. Assert
  `localStorage.getItem('rsss.paintCache.v1.<did>') === null`
  after the call resolves.
- **Owning task:** Phase 5 Task 4.

### AC6.4 Failure

> Logout of DID-A does not remove a paint-cache entry for DID-B.

- **Category:** AUTOMATED
- **Test type:** Unit (per-DID isolation).
- **Test file:** `test/paint-cache.ts` (module-level isolation) +
  `test/paint-cache-cleanup.ts` (integration through logout).
- **Description:**
  - At the module level (Phase 3 Task 3): write snapshots for
    `did:plc:alice` and `did:plc:bob`; call
    `clearPaintCache('did:plc:alice')`; assert
    `readPaintCache('did:plc:alice') === null` AND
    `readPaintCache('did:plc:bob')` still returns Bob's snapshot.
  - At the logout level (Phase 5 Task 3): pre-populate caches for
    two DIDs; set `state.user.value` to DID-A; call
    `State.logout(state)`; assert DID-A's key is gone and DID-B's
    key is intact.
- **Owning tasks:** Phase 3 Task 3 (module level); Phase 5 Task 3
  (logout level).

---

## AC7: Third-party latency does not block paint

Phase 6 Task 2 confirms AC7.2 by static audit. Phase 8 Task 1
lands the slow-billing test and covers AC7.1 + AC7.3.

### AC7.1 Success

> With `/api/billing/status` artificially delayed (5s stub), first
> paint of the home route still occurs within 1s of JS bundle
> execution (cached-data render path).

- **Category:** HYBRID
- **Automated portion:** Structurally verify that no code path
  awaits the billing-status load.
  - **Test type:** Unit (structural / static-grep assertion).
  - **Test file:** `test/paint-cache-slow-billing.ts`
  - **Description:** Per Phase 8 Task 1 Option B — assert (via a
    test that runs `node`-side checks or a bundle-time
    introspection) that
    `await State.loadBillingStatus`,
    `await loadBillingStatus`, and
    `await … billing/status` return zero grep matches across
    `src/`.
- **Human portion:** Verify the live timing claim ("first paint
  within 1s") via DevTools Performance / Lighthouse with the
  billing endpoint throttled to 5 s.
  - **Approach:** Phase 8 Task 4 manual check (`manual-verification.md`,
    row AC7.1). Use DevTools' "Network" tab to add a 5 s delay to
    `/api/billing/status` (via local stub or service-worker), reload
    the home route, observe the items pane reaches its painted
    state within 1 s of bundle execution.
  - **Why human:** Real time-to-first-paint measurement requires a
    real browser and Performance-panel timing — the tapout host
    cannot measure layout/paint times.
- **Owning tasks:** Phase 8 Task 1 (automated structural) + Phase
  8 Task 4 (manual timing).

### AC7.2 Success

> `loadBillingStatus()` is not awaited anywhere on the render
> critical path (`src/client/state.ts:572` remains fire-and-forget;
> no other awaiter exists).

- **Category:** AUTOMATED
- **Test type:** Static audit (grep-based assertion) + manual
  audit recorded in `phase_06_findings.md`.
- **Test file:** `test/paint-cache-slow-billing.ts` (same
  structural assertions as AC7.1) — the grep pattern documented
  in Phase 6 Task 2 also runs at PR time.
- **Description:** Assert (via test or CI grep) that
  `rg -n "await\s+State\.loadBillingStatus|await\s+loadBillingStatus" src/`
  returns zero matches. Phase 6 Task 2 also commits the audit
  finding to `phase_06_findings.md`.
- **Owning tasks:** Phase 6 Task 2 (audit); Phase 8 Task 1
  (structural test).

### AC7.3 Failure

> Failure of `/api/billing/status` (503 response) does not prevent
> the shell from rendering or items from appearing.

- **Category:** HYBRID
- **Automated portion:** Same structural assertion as AC7.1 — if
  no code awaits the response, neither a slow response nor a 503
  can block rendering.
  - **Test file:** `test/paint-cache-slow-billing.ts`.
- **Human portion:** Verify by stubbing `/api/billing/status` to
  return `503` on a real dev server and confirming the shell +
  items render.
  - **Approach:** Phase 8 Task 4 manual check
    (`manual-verification.md`, row AC7.3).
- **Owning tasks:** Phase 8 Task 1 (automated structural); Phase
  8 Task 4 (manual 503 stub).

---

## AC8: Stripe SDK is not on the home critical path

Phase 1 handles the investigation + (defensive) `/pure` import
switch. Phase 2 adds the preconnect tag. All three success
criteria require live browser observation.

### AC8.1 Success

> Loading the home route in a fresh tab (no DOM leftovers) does
> not result in a network request to `https://js.stripe.com/v3`
> or any `https://js.stripe.com/*` resource.

- **Category:** HUMAN
- **Justification:** Requires DevTools Network panel inspection in
  a fresh browser tab. The tapout host has no real network stack
  and cannot observe absence of third-party SDK fetches.
- **Approach:** Fresh browser tab with "Disable cache" on,
  navigate to `/`. Filter Network panel by `stripe`. Confirm
  zero `https://js.stripe.com/*` rows. Capture a screenshot.
- **Owning tasks:** Phase 1 Task 3 (verification step #1); Phase
  8 Task 4 (`manual-verification.md`, row AC8.1).

### AC8.2 Success

> The served HTML includes
> `<link rel="preconnect" crossorigin href="https://js.stripe.com">`
> in `<head>`.

- **Category:** AUTOMATED
- **Test type:** Build artifact assertion.
- **Test file:** None — this is a build-output check via shell
  command. Could be wired into `test/run-all-tests.mjs` as an
  additional `node`-driven shell step that greps the built HTML.
- **Description:** Run `npm run build` then assert
  `grep -F '<link rel="preconnect" crossorigin href="https://js.stripe.com">' public/client/index.html`
  exits 0. Per Phase 2 Task 1, the verification block already
  documents this `grep` check.
- **Owning task:** Phase 2 Task 1 (build verification). The
  shell-grep assertion can also be folded into Phase 8 Task 4 as
  a manual-verification row if no automated wrapping is added.

### AC8.3 Success

> Opening the payment-method modal on the settings route still
> successfully loads Stripe.js and initializes Elements.

- **Category:** HUMAN
- **Justification:** Verifies the full live Stripe.js load +
  Elements rendering path, which requires a real browser DOM,
  real network, and real Stripe SDK code execution.
- **Approach:** Navigate to `/settings` in a real browser, click
  "Add a card", confirm the Stripe Elements card input renders
  (the card input iframe loads and accepts input). Confirm
  Network panel shows `https://js.stripe.com/v3*` succeeding at
  this point (not earlier).
- **Owning tasks:** Phase 1 Task 3 (manual check #3); Phase 8
  Task 4 (`manual-verification.md`, row AC8.3).

---

## AC9: Investigation deliverable

### AC9.1 Success

> Phase 1's investigation produces a written finding (in the PR
> description or a committed note) identifying why
> `js.stripe.com/v3` was pending on the home page in the original
> report. The finding either documents that no code change is
> needed (DOM leftover) or names the specific code change made.

- **Category:** HUMAN
- **Justification:** The deliverable is a written investigation
  finding, not behavior. It cannot be automated; its existence and
  content are verified by reviewing the committed file.
- **Approach:** Inspect
  `DOCS/implementation-plans/2026-05-24-023-fix-initial-load/phase_01_findings.md`
  for three sections: Reproduction, Root cause, Resolution. The
  finding must be derived from observed reproduction (Phase 1
  Tasks 1-2), not speculation. The PR description re-summarises
  the conclusion.
- **Owning task:** Phase 1 Task 4 (commits the finding); Phase 8
  Task 4 (`manual-verification.md`, row AC9.1) confirms the file
  is present with the required sections.

---

## Summary

| Metric | Count |
|---|---|
| Total ACs | 32 |
| Fully AUTOMATED | 19 |
| Fully HUMAN | 8 |
| HYBRID (automated + human) | 5 |

### Automated (19)

AC1.3, AC1.4, AC2.1, AC2.2, AC2.3, AC2.4, AC2.5, AC2.6, AC2.7,
AC3.1, AC3.2, AC3.3, AC3.4, AC4.1, AC4.2, AC4.3, AC5.2, AC5.3,
AC5.4, AC6.1, AC6.2, AC6.3, AC6.4, AC7.2, AC8.2.

*(Note: 25 ACs land at least one automated check; AC5.1, AC7.1,
AC7.3 also have automated structural/branch coverage in addition
to required human verification — counted in the HYBRID total
below, not double-counted here.)*

### Human (8)

AC1.1, AC1.2, AC1.5, AC8.1, AC8.3, AC9.1 — plus the human portion
of the three HYBRID criteria below.

### Hybrid (5)

AC5.1 (branch automated, copy text human), AC7.1 (structural test
automated, paint-time measurement human), AC7.3 (structural test
automated, 503 stub human), AC8.2 (build-output `grep`
automatable, optional manual eyeball).

### Test file map

| File | ACs covered |
|---|---|
| `test/paint-cache.ts` (new) | AC2.1, AC2.2, AC2.3, AC2.5, AC2.6, AC2.7, AC6.4 (module-level) |
| `test/paint-cache-bootstrap.ts` (new) | AC3.1, AC3.2, AC3.3, AC3.4 |
| `test/paint-cache-cleanup.ts` (new) | AC2.4, AC6.1, AC6.2, AC6.3, AC6.4 (integration-level) |
| `test/paint-cache-slow-billing.ts` (new) | AC7.1 (structural), AC7.2, AC7.3 (structural) |
| `test/adapter-factory.ts` (existing, extended) | AC4.1, AC4.2 |
| `test/sync.ts` (existing, possibly extended) | AC4.3 |
| `test/feed-reader-render-state.ts` (new) | AC1.3, AC1.4, AC5.1 (branch), AC5.2, AC5.3, AC5.4 |
| Build-time `grep` check on `public/client/index.html` | AC8.2 |
| `DOCS/implementation-plans/2026-05-24-023-fix-initial-load/manual-verification.md` | Every HUMAN and HYBRID AC's human portion |
| `DOCS/implementation-plans/2026-05-24-023-fix-initial-load/phase_01_findings.md` | AC9.1 |

### Phase ownership map

| Phase | ACs primarily landed |
|---|---|
| Phase 1 | AC8.1, AC8.3, AC9.1 |
| Phase 2 | AC8.2 |
| Phase 3 | AC2.1, AC2.2, AC2.3, AC2.5, AC2.6, AC2.7, AC6.4 (module) |
| Phase 4 | AC3.1, AC3.2, AC3.3, AC3.4 |
| Phase 5 | AC2.4, AC6.1, AC6.2, AC6.3, AC6.4 (logout integration) |
| Phase 6 | AC4.1, AC4.2, AC4.3, AC7.2 |
| Phase 7 | AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC5.1, AC5.2, AC5.3, AC5.4 |
| Phase 8 | AC7.1, AC7.3; manual verification log for every HUMAN AC |

Every acceptance criterion is mapped to at least one automated
test or one human-verification row. No AC is left unverifiable.
