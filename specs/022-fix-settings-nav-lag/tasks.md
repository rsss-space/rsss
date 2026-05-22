# Tasks: Instant Render When Navigating from Settings to Home

**Input**: Design documents from `/specs/022-fix-settings-nav-lag/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/settings-nav-contract.md, quickstart.md

**Tests**: Test tasks are included. The plan calls for three new
`test/` specs (`settings-nav-instant.ts`,
`settings-stale-async-writes.ts`, `cache-status-coalesce.ts`) plus a
verification that the existing 021 suite still passes.

**Organization**: Tasks are grouped by user story (US1, US2, US3) so
each story is independently implementable and verifiable. The fix is
small (≈ +120 / -10 source lines across three production files), so
many tasks are surgical.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on
  incomplete tasks).
- **[Story]**: User story label (US1, US2, US3). Setup / Foundational
  / Polish tasks have no story label.
- Every task includes the exact file path that will be touched.

## Path Conventions

This is a single project with `src/client`, `src/server`,
`src/shared`, and `test/` at the repo root, per `plan.md` §Project
Structure. All work in this feature is client-side.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Make the new `util/` location exist and add the only new
file every later task imports.

- [ ] T001 [P] Create the directory `src/client/util/` if it does not
      already exist (no other file lives here yet).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The deferred-recompute mechanism and the stale-write
mechanism both depend on the `scheduleIdle` / `cancelIdle` helper.
Build it once, with its tests, before any user-story work.

**Why blocking**: Every other production change in this feature
imports from `src/client/util/schedule-idle.ts`.

- [ ] T002 Author the `scheduleIdle` / `cancelIdle` helper in
      `src/client/util/schedule-idle.ts`. Export `IdleHandle =
      { kind:'idle'|'timeout'; id:number }`, `ScheduleIdleOptions =
      { timeout?:number }` (default 200), `scheduleIdle(fn, opts?):
      IdleHandle`, and `cancelIdle(handle:IdleHandle|null):void`. Use
      `window.requestIdleCallback` / `cancelIdleCallback` when present,
      fall back to `setTimeout(fn, 0)` / `clearTimeout` (Safari). Per
      `contracts/settings-nav-contract.md` §1: `fn` must run **after**
      paint, at most once per handle; `cancelIdle(null)` is a no-op;
      `timeout` is ignored on the `setTimeout` fallback. Keep the
      module side-effect-free so test stubs can patch
      `window.requestIdleCallback` before import.
- [ ] T003 [P] Add `test/schedule-idle.ts` covering: (a)
      `scheduleIdle` returns a `{ kind, id }` token; (b) on a
      simulated `requestIdleCallback` environment, `fn` is called via
      the rIC path with the configured `timeout`; (c) on an
      environment with no `requestIdleCallback`, `fn` is called via
      `setTimeout`; (d) `cancelIdle` before fire prevents the call;
      (e) `cancelIdle(null)` is a no-op; (f) double-cancel is a no-op.
      Follow the `test/` style of bundling with esbuild and piping
      into `tapout`.

**Checkpoint**: `npm test -- test/schedule-idle.ts` passes (or the
equivalent invocation through the existing `test/run-all-tests.mjs`
runner). The helper is now safe to import from US1, US2, and US3 work.

---

## Phase 3: User Story 1 — Leaving Settings for Home updates the view as soon as the URL changes (Priority: P1) MVP

**Goal**: Replace the synchronous `recomputeCacheStatus` call inside
the `effect()` at `src/client/state.ts:654-667` with a coalesced
`scheduleIdle(...)` call so the cache-status recompute runs after
paint instead of blocking it. This is the change that satisfies
SC-001 (<100 ms click-to-paint), SC-002 (URL and view never disagree),
and the primary user-visible behaviour the spec calls out.

**Independent Test**: Per `quickstart.md` §"Primary scenario —
`/settings` → `/`": render `/`, navigate to `/settings`, wait for its
mount-time loads, then click "< Back to Feeds". The view must flip on
the same frame the URL flips. Automated equivalent: stub
`scheduleIdle`, set `state.route.value = '/'`, assert
`recomputeCacheStatus` was **not** called synchronously and that one
scheduled callback is queued (INV-1).

### Tests for User Story 1 (write first, must FAIL before T006)

- [ ] T004 [P] [US1] Add `test/settings-nav-instant.ts`. Construct an
      `AppState` in a test environment that stubs the `schedule-idle`
      module so `scheduleIdle` records its `fn` instead of running it.
      Assert: (1) writing each of `feedPolicies`,
      `defaultCacheMode`, `storeContent`, `billingStatus`,
      `selectedFeedId` does **not** synchronously call
      `recomputeCacheStatus`; (2) exactly one idle callback is queued
      after rapid writes; (3) running the captured `fn` once calls
      `recomputeCacheStatus` once. Covers INV-1 and the FR-001 /
      SC-001 / SC-002 contract from the spec.
- [ ] T005 [P] [US1] Add `test/cache-status-coalesce.ts`. With the
      same stub from T004, write `feedPolicies.value` three times in
      a row (`batch` or sequential). Assert: only one
      `IdleHandle` is outstanding at any moment (i.e. each new write
      cancels the previous one), and after the captured callback
      fires `recomputeCacheStatus` was called exactly once. Covers
      INV-2.

### Implementation for User Story 1

- [ ] T006 [US1] Rewrite the effect at `src/client/state.ts:654-667`
      per `contracts/settings-nav-contract.md` §2. Import
      `scheduleIdle` and `cancelIdle` (plus the `IdleHandle` type)
      from `../util/schedule-idle`. Add a closure-local
      `let pendingHandle:IdleHandle|null = null` immediately before
      the `effect(...)` (or factor into a local
      `scheduleIdleRecompute(state)` helper as shown in
      `data-model.md` §`scheduleIdleRecompute`). Inside the effect:
      keep the existing seven-signal `_deps` read and `_deps.length`
      early-return, then call `cancelIdle(pendingHandle)` and
      reassign `pendingHandle = scheduleIdle(() => { pendingHandle =
      null; recomputeCacheStatus(state).catch(() => {}) }, { timeout:
      200 })`. Do not modify `recomputeCacheStatus` or
      `computeCacheStatus`. Lines ≤ 80 cols. Keep TypeScript style
      from the user's global instructions (no space between colon and
      type, etc.).
- [ ] T007 [US1] Run `npm test -- test/settings-nav-instant.ts
      test/cache-status-coalesce.ts` and confirm both pass. Then run
      `npm test && npm run lint` to confirm no regressions in any
      other suite (e.g. `cache-status-state.ts` tests still pass — the
      `recomputeToken` apply-time guard is unchanged, so they must).

**Checkpoint**: US1 is done. Manually run `quickstart.md` §"Primary
scenario — `/settings` → `/`" in Chrome to confirm the view flips on
the same frame as the URL (FR-001, FR-002, SC-001, SC-002). The
header health indicator may update ≤ 200 ms later — this is the
deferred recompute and is expected.

---

## Phase 4: User Story 2 — The fix does not introduce a content flash (Priority: P1)

**Goal**: Confirm that the existing `viewItemsCache` from feature 021
(in `src/client/state.ts`, populated on first paint of `/`, cleared
only in `loadInitialView` and `reconcileAfterRefresh`) already
prevents the "flash to empty / Loading items… placeholder" failure
mode during settings → home, **and** add the stale-write guard on the
four Settings mount-time loaders so a late Settings response cannot
overwrite signals the new view is reading (FR-006).

**Independent Test**: Per `quickstart.md` §"Settings async writes
don't bleed into the new view": throttle to Slow 3G, mount
`/settings`, immediately click "Back to Feeds" before the panels
finish loading. The per-feed `<CacheSettings>` row in
`<FeedReader>` must not flicker or change when the late Settings
responses resolve. Automated equivalent: schedule a `loadFeedPolicies`
that resolves **after** `state.route.value` is flipped off
`/settings`, assert `feedPolicies.value` is unchanged (INV-3).

### Tests for User Story 2 (write first, must FAIL before T012)

- [ ] T008 [P] [US2] Add `test/settings-stale-async-writes.ts`.
      Cover four loaders in one file (one describe-block each):
      `State.loadBillingStatus`, `State.loadPaymentMethods`,
      `loadFeedPolicies` (from `src/client/db/feed-cache-policy.ts`),
      `loadStorageUsage` (from `src/client/db/storage-usage.ts`).
      For each: invoke with a `shouldApply` predicate that captures a
      `myGeneration` number and compares against a module-level
      `currentGeneration` that you bump between scheduling the
      promise and resolving it. Assert: the corresponding signal
      (`billingStatus`, `paymentMethods`, `feedPolicies`,
      `feedStorageBytes`) is **not** mutated when `shouldApply()`
      returns `false`, and **is** mutated when it returns `true`.

### Implementation for User Story 2

- [ ] T009 [P] [US2] Extend the signature of `loadFeedPolicies` in
      `src/client/db/feed-cache-policy.ts:105` to accept an optional
      fourth (or trailing) parameter `opts?:{ shouldApply?:() =>
      boolean }`. Default behaviour when `shouldApply` is omitted or
      returns `true`: write to `feedPolicies.value` exactly as today.
      When the predicate returns `false` at apply time, skip the
      write but otherwise complete normally (no thrown error). Per
      the user's batch rule (global CLAUDE.md): if you set multiple
      signals here, wrap them in `batch`.
- [ ] T010 [P] [US2] Extend the signature of `loadStorageUsage` in
      `src/client/db/storage-usage.ts:42` the same way. The loader
      writes `feedStorageBytes` and `totalStorageBytes`; both writes
      must go through the `shouldApply` gate together (use `batch`
      so a `false` predicate suppresses both, not one). Default
      behaviour preserved for non-Settings callers.
- [ ] T011 [P] [US2] Extend `State.loadBillingStatus`
      (`src/client/state.ts:1270`) and `State.loadPaymentMethods`
      (`src/client/state.ts:1293`) with the same optional
      `{ shouldApply?:() => boolean }` parameter. For
      `loadPaymentMethods`, gate **all** of `paymentMethods`,
      `defaultMethodId`, `paymentMethodsLoading`, and
      `paymentMethodsError` together via `batch`. For
      `loadBillingStatus`, gate `billingStatus`. Every other caller
      (e.g. the seven existing call sites at lines 544, 567, 624,
      1368, 1400, 1471, 1515, 1583, 1603, 1652, 1678) must continue
      to work with no argument — the default predicate is `() =>
      true`.
- [ ] T012 [US2] In `src/client/routes/settings.ts`, add a
      module-level `let globalRouteGeneration = 0`. Inside the
      component, capture `const myGen = useRef(0)` and inside the
      mount-time `useEffect` set `myGen.current =
      ++globalRouteGeneration` once at the top, then call the four
      loaders identified in `data-model.md` §`shouldApply` —
      `State.loadBillingStatus`, `State.loadPaymentMethods`,
      `loadFeedPolicies`, `loadStorageUsage` (lines 67-94 today) —
      each receiving `{ shouldApply: () => myGen.current ===
      globalRouteGeneration }`. Do **not** add an
      `if (state.route.value === '/settings')` check inside the
      loaders themselves; the predicate carries the contract.
      Preserve the existing call ordering and the `isAuthenticated`
      gate for the billing/payment loaders.
- [ ] T013 [US2] Run `npm test -- test/settings-stale-async-writes.ts`
      and confirm it passes. Run `npm test && npm run lint` to
      confirm no regressions. Manually run `quickstart.md` §"Settings
      async writes don't bleed into the new view" under DevTools Slow
      3G in Chrome.

**Checkpoint**: US2 is done. Combined with US1, FR-001–FR-006 and
SC-001–SC-003 are satisfied. The home view paints instantly on
arrival from `/settings`, with no flash to empty, no Loading
placeholder, and no signal write from a late Settings response.

---

## Phase 5: User Story 3 — Other route changes are not made slower by the fix (Priority: P2)

**Goal**: Verify FR-008 — Starred ⇄ All Items (the contract feature
021 established), `/` → feed-view, `/` → item-detail, and
Back/Forward parity still render on the same interaction as the URL
change. This phase adds **no new mechanism**; it adds a regression
check and a smoke pass to prove US1 and US2 did not move the goalposts
elsewhere.

**Independent Test**: Per `quickstart.md` §"021 regression check" and
§"Browser Back/Forward". Walk Starred ⇄ All Items five round-trips;
walk Back/Forward five round-trips between `/settings` and `/`. Each
transition must be visually instant (≤1 frame).

### Implementation for User Story 3

- [ ] T014 [US3] Run the existing 021 test files (`grep -l
      "viewItemsCache\|showStarred\|showAll" test/*.ts` to locate
      them, e.g. `test/view-switch-*.ts` and any test referencing
      `viewItemsCache`) and confirm they all pass unchanged.
      Document any failure as a blocker (it would mean US1/US2 did
      regress the 021 contract). Per Decision 6 in `research.md`, no
      new automated test is required for this story — the 021 suite
      is the canonical contract.
- [ ] T015 [US3] Manually run `quickstart.md` §"Browser Back/Forward"
      in both Chrome and Safari. Five round-trips between
      `/settings` and `/` via the browser's Back/Forward buttons —
      each must produce the same instant transition as a link click.
      Record any deviation as a defect against FR-007.
- [ ] T016 [US3] Manually run `quickstart.md` §"021 regression check"
      in Chrome — five Starred ⇄ All Items round-trips with no
      Loading placeholder and no perceptible pause. Confirms FR-008.

**Checkpoint**: All three user stories complete. FR-001–FR-008 and
SC-001–SC-005 all satisfied. No new dependency, no schema change, no
wire-format change.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final sweep before declaring the feature done. Catches
the things easy to forget after surgical fixes: docs, Safari sanity,
and the cold-load path.

- [ ] T017 [P] Manually run `quickstart.md` §"Primary scenario" in
      Safari to verify the `setTimeout(fn, 0)` fallback in
      `scheduleIdle` produces the same instant transition (Safari
      lacks `requestIdleCallback`).
- [ ] T018 [P] Manually run `quickstart.md` §"Cold-load exception":
      hard reload directly on `/settings`, then navigate to `/`.
      Confirm the items list still shows its first-load skeleton —
      this path is deliberately unchanged and verifies the fix did
      not mask a regression in the genuinely cold case.
- [ ] T019 [P] Manually run `quickstart.md` §"DevTools sanity check"
      in Chrome: record Performance across `/settings` → `/`,
      confirm the long `computeCacheStatus` task appears **after**
      the paint that draws `<FeedReader>`, inside an Idle callback.
      If it appears before, the fix did not take effect.
- [ ] T020 [P] Code review pass on the three production files
      touched: `src/client/state.ts` (effect rewrite at 654-667 plus
      the four loaders extended with `shouldApply`),
      `src/client/routes/settings.ts` (route-generation token +
      `shouldApply` wiring), `src/client/util/schedule-idle.ts`
      (new). Check: lines ≤ 80 cols, no space between colon and
      type, `batch()` wraps every multi-signal write, no CSS
      changes, no eslint-config changes, no emoji in source or
      comments. Per the global CLAUDE.md constraints.
- [ ] T021 Tick the `quickstart.md` §"Sign-off" checklist: every
      box ticked before claiming the feature complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2 — `schedule-idle.ts` + its test)**: Depends
  on Setup. **Blocks all user-story implementation tasks** because
  T006, T009–T012 all import from `src/client/util/schedule-idle.ts`
  or rely on its existence in the source tree.
- **User Stories (Phase 3+)**: Depend on Foundational. Once Phase 2
  passes, US1 and US2 are independent of each other and can proceed in
  parallel (different files; US1 touches the `effect()` block and
  state's loader signatures, US2 touches `routes/settings.ts` plus the
  db loaders). US3 is purely verification and runs after both.
- **Polish (Phase 6)**: After all user stories are complete.

### User Story Dependencies

- **US1 (P1, MVP)**: Independent. Only blocker is Phase 2.
- **US2 (P1)**: Independent of US1 at the code level (different
  files). Can be developed in parallel by a different person. Both
  are required for the spec to ship cleanly (US1 alone satisfies
  SC-001/SC-002; US2 adds FR-006).
- **US3 (P2)**: Verification only. Must run **after** US1 and US2 are
  merged because it confirms they didn't regress 021 or break
  Back/Forward.

### Within Each User Story

- Tests are written first (T004, T005, T008) and must fail before
  their implementation tasks (T006, T009-T012).
- Within US2, T009/T010/T011 (extending the four loaders' signatures)
  can run in parallel — different files. T012 (wiring the
  `shouldApply` calls in `<SettingsRoute>`) depends on T009–T011.
- Per-task verification (T007, T013) follows the implementation
  within its story.

### Parallel Opportunities

- T003 (helper test) can be written in parallel with T002 (helper
  implementation), TDD-style.
- T004 and T005 (US1 tests) are in separate files — parallel.
- T009, T010, T011 (extending three sets of loader signatures) are in
  three separate files — parallel.
- T017, T018, T019, T020 (polish tasks) are independent — parallel.

---

## Parallel Example: User Story 2 implementation

```bash
# After T008 is failing (predicate-gated writes are not yet wired up):
# Launch the three loader-signature extensions in parallel:
Task: "T009 Extend loadFeedPolicies with shouldApply in src/client/db/feed-cache-policy.ts"
Task: "T010 Extend loadStorageUsage with shouldApply in src/client/db/storage-usage.ts"
Task: "T011 Extend State.loadBillingStatus / loadPaymentMethods with shouldApply in src/client/state.ts"

# Then sequentially:
Task: "T012 Wire shouldApply calls into <SettingsRoute> mount effect in src/client/routes/settings.ts"
Task: "T013 npm test && npm run lint + manual Slow-3G verification"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1: Setup (T001).
2. Phase 2: Foundational (T002, T003) — write `scheduleIdle` and its
   test.
3. Phase 3: User Story 1 (T004–T007) — rewrite the effect; ship.
4. **STOP and VALIDATE**: manually run `quickstart.md` §"Primary
   scenario" in Chrome. The reporter's bug is now fixed. SC-001,
   SC-002, SC-003 hold for the primary path.

US1 alone resolves the user's reported bug. It is shippable on its
own. US2 closes the FR-006 invariant (no Settings work writes into
the new view) — required for full spec compliance but not for the
visible behaviour the report describes.

### Incremental Delivery

1. Setup + Foundational → mechanism ready.
2. US1 → user-visible fix; demo to reporter.
3. US2 → defence-in-depth; closes FR-006; demo Slow-3G case.
4. US3 → regression sweep; confirm 021 and Back/Forward intact.
5. Polish → Safari, cold-load, DevTools sanity, code-style audit.

### Parallel Team Strategy

With two developers:

1. Both pair on T002 (helper) so they agree on the contract.
2. After T002 lands:
   - Developer A: US1 (T004–T007) — `state.ts` effect rewrite.
   - Developer B: US2 (T008–T013) — settings route + loader
     signatures.
3. Either developer takes US3 + Polish.

---

## Notes

- This feature touches three production files plus one new helper and
  three new test files. Roughly +120 / -10 LoC.
- No schema change (DO SQLite, local OPFS, or `/api/sync`).
- No new runtime dependency.
- No CSS change (constitution).
- All multi-signal writes wrapped in `batch()` per user's global
  CLAUDE.md.
- Lines ≤ 80 cols.
- The Settings "Back to Feeds" link is already an `<a href="/">`
  (per `memory/feedback_links_not_buttons.md`); no button-to-link
  conversion needed.
- Commit after each task or logical group; the `before_tasks` /
  `after_tasks` git auto-commit hooks in `.specify/extensions.yml` are
  optional and not required by this feature.
