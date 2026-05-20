# Tasks: Instant Switch Between Starred and All Items Views

**Input**: Design documents from `/specs/021-fix-view-switch-lag/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/view-switch-contract.md, quickstart.md

**Tests**: Test tasks are included because plan.md lists three new test specs
(`test/view-switch-instant.ts`, `test/view-switch-stale-refresh.ts`,
`test/view-switch-cache-invalidate.ts`) plus an extension to
`test/sidebar-item.ts`. The project rule (`CLAUDE.md`) forbids brittle tests
on HTML text content — these specs exercise the signal-level contract.

**Organization**: Tasks are grouped by user story so each story can be
implemented and validated independently. US1 (synchronous switch) is the
MVP; US2 and US3 layer on without blocking US1's value.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User-story label (US1, US2, US3) — omitted for setup,
  foundational, and polish phases
- Paths are absolute from repo root (`/Users/nick/code/rsss`)

## Path Conventions

- Client source: `src/client/`
- Shared types: `src/client/db/types.ts` (already exists; no new file)
- Tests: `test/` (esbuild-bundled per `test/run-all-tests.mjs`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new project scaffolding needed — this is an in-place fix
to existing files. Confirm baseline tooling works.

- [ ] T001 Run `npm test && npm run lint && npm run typecheck` from the
      repo root to capture a green baseline before making any changes.
      Record the current pass count in the PR description so the
      additional specs are visible as a delta after Phase 6.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Introduce the cache type, the `AppState` field, and the
helper functions that every user story depends on. Nothing here changes
user-visible behavior yet; this is the substrate the stories sit on top of.

**CRITICAL**: All foundational tasks must land before any US task runs.
Each user story imports `FilterKey`, `currentFilterKey`, and either reads
`state.viewItemsCache` or calls `applyItemsResult`.

- [ ] T002 Add the `FilterKey`, `ViewItemsCacheEntry`, and
      `ViewItemsCache` type aliases inside `src/client/state.ts`
      (top-level, near the existing `AppState` type). Shape matches
      `data-model.md` exactly:
      `type FilterKey = 'all' | 'starred'`,
      `type ViewItemsCacheEntry = { items:Item[]; total:number;
      limit:number; offset:number }`,
      `type ViewItemsCache = Map<FilterKey, ViewItemsCacheEntry>`.
      Do not export from `src/client/db/types.ts` — the cache is purely
      a `state.ts`-internal concern.

- [ ] T003 Add `viewItemsCache:ViewItemsCache` to the `AppState`
      shape in `src/client/state.ts`, and initialize it to
      `new Map()` inside the `State()` factory alongside the other
      signals. The field is **not** a signal (per `data-model.md`
      relationships diagram) — readers consume it imperatively.

- [ ] T004 Add a `currentFilterKey(state:AppState):FilterKey | null`
      helper in `src/client/state.ts`. Returns `null` when
      `state.selectedFeedId.value !== null` (per-feed routes are
      out of scope per `contracts/view-switch-contract.md` §
      "Pagination passthrough"). Otherwise returns
      `state.showStarredOnly.value ? 'starred' : 'all'`. Keep the
      function near other small `state.ts` helpers so it can be
      reused by all callers without cycles.

- [ ] T005 Add the `applyItemsResult(state, requestKey, result)`
      helper in `src/client/state.ts` exactly as defined in
      `contracts/view-switch-contract.md` § "Apply-time guard":
      no-op when `currentFilterKey(state) !== requestKey`; on a
      `null` result set `itemsLoading=false` and return; otherwise
      `batch()` the three signal writes
      (`items`, `itemsTotal`, `itemsLoading=false`) and then
      `state.viewItemsCache.set(requestKey, …)`. Cache writes only
      happen when `requestKey !== null` (i.e. not a per-feed route).

- [ ] T006 Rewrite `State.loadItems` in `src/client/state.ts` to
      capture `const requestKey = currentFilterKey(state)` BEFORE
      calling `await adapter.getItems(buildItemOptions(state))`,
      then route the result through `applyItemsResult(state,
      requestKey, result)`. Replace the existing direct signal writes
      to `state.items` / `state.itemsTotal` / `state.itemsLoading`
      with the helper call. Preserve every existing error path —
      `applyItemsResult` is also called with `null` from the catch
      branch so `itemsLoading` is still cleared. Do **not** change
      `buildItemOptions` or the adapter contract.

- [ ] T007 Gate the `itemsLoading=true` write inside
      `State.loadItems` per `contracts/view-switch-contract.md` §
      "`itemsLoading` policy": only set `true` when both
      `state.viewItemsCache.get(currentFilterKey(state)) ===
      undefined` AND `state.items.value.length === 0`. Replace the
      existing unconditional `itemsLoading.value = true` at the top
      of `loadItems` with this guarded assignment.

**Checkpoint**: Cache substrate is in place. No behavior change should
be visible yet — `showAll` / `showStarred` still `await loadItems`. Run
`npm test && npm run lint && npm run typecheck`; everything that
passed at T001 must still pass.

---

## Phase 3: User Story 1 — Switching from Starred back to All Items feels instant (Priority: P1) 🎯 MVP

**Goal**: A click on the All Items or Starred sidebar entry paints the
destination view on the same frame as the click, using the
`viewItemsCache` populated by the previous render of that view.

**Independent Test** (from spec.md):
With the app loaded and at least one item visible in both views,
navigate from Starred to All Items and observe that the All Items list
renders without any visible loading state and without the previous list
disappearing first. Repeated A→B→A toggles all feel instant.

### Tests for User Story 1

> Write these tests FIRST. They MUST fail before T010–T012 are written.

- [ ] T008 [P] [US1] Create `test/view-switch-instant.ts` that
      stubs `getAdapter` (or constructs a `State` with a fake
      adapter via the existing pattern in `test/state.ts`) so
      `getItems` returns a controllable deferred promise. Assert:
      (a) calling `State.showAll(state)` with a populated `'all'`
      cache entry sets `state.items.value` / `state.itemsTotal.value`
      synchronously (within the same microtask) and does NOT await;
      (b) `state.itemsLoading.value` is `false` after the
      synchronous return when the cache has an entry;
      (c) `state.showStarredOnly.value` is flipped inside the same
      batch as the items write (subscribe to both signals and assert
      only one effect tick fires). Follow the existing
      signal-only style; no DOM mount. The spec MUST fail until
      `showAll`/`showStarred` are rewritten in T010.

- [ ] T009 [P] [US1] Extend `test/sidebar-item.ts` to mount the
      component (it already mounts Preact today) and assert the
      rendered element's `tagName` is `'A'`, that the `href`
      attribute equals `'/'`, and that the `data-active` (or whichever
      attribute the implementation uses) reflects
      `showStarredOnly.value`. Do NOT assert on the link's text
      content (per `CLAUDE.md`: no brittle tests on specific HTML
      text). The spec MUST fail until T011 lands.

### Implementation for User Story 1

- [ ] T010 [US1] Rewrite `State.showAll` and `State.showStarred` in
      `src/client/state.ts` per
      `contracts/view-switch-contract.md` § "Synchronous contract"
      points 1–7. Concretely:
      1. Read `cached = state.viewItemsCache.get(destKey)` where
         `destKey` is `'all'` or `'starred'`.
      2. Open a single `batch(() => { … })` (per global CLAUDE.md
         rule "Any time that you sequentially set multiple signals,
         use the `batch` function"):
         - `showStarredOnly.value = (destKey === 'starred')`
         - `itemsOffset.value = cached?.offset ?? 0`
         - If `cached`: `items.value = cached.items`,
           `itemsTotal.value = cached.total`,
           `itemsLoading.value = false`.
         - Else if `state.items.value.length === 0`:
           `itemsLoading.value = true`.
         - Else: leave `items` and `itemsLoading` alone (no-cache
           fallback — see contract point 5).
      3. After the `batch` returns, call `State.loadItems(state)`
         **without** `await` and **without** `.catch(…)` (errors are
         handled inside `loadItems`).
      4. Remove the previous `await State.loadItems(state)` line.
      The functions remain `async` only if the existing type
      signature requires it; otherwise drop the `async` keyword to
      make the synchronous contract obvious.

- [ ] T011 [US1] Rewrite `src/client/components/sidebar-item.ts` so
      the rendered element is `<a href="/" data-view="all" |
      data-view="starred">` (links per
      `memory/feedback_links_not_buttons.md` and
      `contracts/view-switch-contract.md` § "Element semantics").
      Keep the click handler — it invokes `State.showAll(state)` or
      `State.showStarred(state)` based on the `starred` prop. Do
      NOT call `preventDefault()` on the click (route-event handles
      navigation; the synchronous view-state flip happens before
      the next paint). Move active-state computation into a
      `useComputed` against `state.route.value` and
      `state.showStarredOnly.value` (FR-008, contract § "Active-
      state computation"). Apply existing CSS classes by toggling
      them off the computed; do **not** add new classes or modify
      `src/client/components/sidebar-item.css` (constitution: "no
      CSS that is not related to the task").

- [ ] T012 [US1] Verify the route-event integration: when the user
      is already on `/`, clicking the link must still invoke
      `State.showAll`/`showStarred` via the component's `onClick`
      handler (the global `route-event` listener will see the
      `href="/"` href, but `setRoute('/')` is a no-op when
      `route.value === '/'`). If the handler order causes a missed
      invocation in dev, document the workaround inline (one short
      comment, per CLAUDE.md "only when the WHY is non-obvious") and
      leave the click listener as the source of truth for the
      view-state toggle. No new file.

**Checkpoint**: US1 is independently testable.

- Manual: open the app, click between Starred and All Items rapidly;
  the destination list appears on the same frame as the click and the
  sidebar highlight tracks it.
- Automated: `test/view-switch-instant.ts` and the extended
  `test/sidebar-item.ts` both pass.

US1 alone — without US2's stale-refresh guard and US3's cache
invalidation — already meets FR-001, FR-002, FR-007 (empty cache
entries flow through the same path), and FR-008. This is the MVP.

---

## Phase 4: User Story 2 — Switching views does not block on the network (Priority: P1)

**Goal**: A slow background refresh does not delay the switch and does
not flash the visible list. A stale refresh that resolves after a
subsequent switch is silently discarded.

**Independent Test** (from spec.md):
With the network throttled or temporarily offline, switch from Starred
to All Items. The view still appears instantly. When the network
responds (or is restored), any updates to the list are applied in
place without the list being cleared or replaced wholesale. A Starred
refresh that lands after the user has already moved to All Items must
not flash Starred items into the All Items view.

### Tests for User Story 2

- [ ] T013 [P] [US2] Create `test/view-switch-stale-refresh.ts`.
      Stub the adapter so `getItems` for `'starred'` returns a
      controllable deferred promise and `getItems` for `'all'`
      resolves immediately. Sequence:
      1. Seed `state.viewItemsCache` with an `'all'` entry.
      2. Call `State.showStarred(state)` — kicks off a slow
         starred fetch.
      3. Before the starred promise resolves, call
         `State.showAll(state)` — fast path, paints All Items.
      4. Resolve the starred promise with Starred items.
      5. Assert `state.items.value` still equals the All Items
         array (apply-time guard rejected the stale write).
      6. Assert `state.viewItemsCache.get('starred')` is still
         `undefined` (the stale apply also short-circuits before
         the cache set, per `applyItemsResult` implementation in
         T005). Spec follows existing `test/state.ts` style.

### Implementation for User Story 2

The apply-time guard already lives in `applyItemsResult` (T005). US2's
test is what proves it works end-to-end; no new implementation tasks
are needed beyond the test, provided T005–T006 are in place.

- [ ] T014 [US2] Verify, by reading the call sites, that every
      consumer of the adapter's `getItems` result inside
      `src/client/state.ts` now goes through `applyItemsResult`
      (T006 covered `loadItems`; this task is a sweep to catch any
      other path — e.g. a future `loadItemsForRoute` or per-page
      fetch — that writes to `state.items` directly with adapter
      data). If any direct write remains, route it through
      `applyItemsResult` with the captured `requestKey`. If no
      additional call sites exist, this task closes with a one-line
      note in the PR description ("no additional adapter-result
      write sites found").

- [ ] T015 [US2] Confirm in-place update behavior (FR-005, SC-003):
      `state.items` is a signal, and the render in
      `src/client/routes/feed-reader.ts:187-201` reads it directly
      under Preact's keyed reconciliation. Read the render code,
      confirm that item rows are keyed by stable IDs (existing
      behavior), and add a one-line comment in
      `src/client/state.ts` above `applyItemsResult` documenting
      that "the items array is replaced wholesale, but Preact's
      keyed reconciliation reuses existing row nodes — required for
      FR-005". Only the comment is added; no code change.

**Checkpoint**: US2 is independently testable.

- Manual: Network → Slow 3G with remote adapter, switch rapidly
  between Starred and All Items, observe instant paints + no flashes
  per `quickstart.md` Test 4 and Test 5.
- Automated: `test/view-switch-stale-refresh.ts` passes.

---

## Phase 5: User Story 3 — Loading indicators only appear when there is genuinely no local data (Priority: P2)

**Goal**: The "Loading items…" placeholder appears only on the very
first render of a view in a session. Once a view has cached items,
neither switching away and back nor a mutation should re-trigger the
placeholder.

**Independent Test** (from spec.md):
Sign in fresh, observe the loading state on first render of the items
list. Switch to Starred, then back to All Items; verify that the
loading state does not appear on either switch. After marking an item
read, the next switch is still instant on the second round trip.

### Tests for User Story 3

- [ ] T016 [P] [US3] Create `test/view-switch-cache-invalidate.ts`.
      For each of these mutation handlers — `toggleItemRead`,
      `toggleItemStarred`, `markAllRead` — assert:
      1. Pre-populate `state.viewItemsCache` with both `'all'` and
         `'starred'` entries.
      2. Invoke the mutation (with a stubbed adapter that resolves
         immediately).
      3. After `await`-ing the mutation, assert
         `state.viewItemsCache.size === 0`.
      Spec MUST fail until T017 lands.

### Implementation for User Story 3

- [ ] T017 [US3] In `src/client/state.ts`, add
      `state.viewItemsCache.clear()` inside the mutation handlers
      listed in `contracts/view-switch-contract.md` § "Cache
      invalidation hooks":
      - `State.toggleItemRead` — clear before the function returns.
      - `State.toggleItemStarred` — clear before the function
        returns.
      - `State.markAllRead` — clear before the function returns.
      The clear MUST run even when the wrapped operation throws —
      wrap the existing body in `try { … } finally {
      state.viewItemsCache.clear() }` if necessary.

- [ ] T018 [US3] In the same file, add
      `state.viewItemsCache.clear()` at the **top** of
      `State.loadInitialView` and `State.reconcileAfterRefresh`,
      before the parallel loads / refresh are awaited. Per
      `data-model.md` § "Cache invalidation" the bulk-refresh
      entry points clear the cache so the subsequent `loadItems`
      writes populate from a clean slate.

- [ ] T019 [US3] Verify pull-sync invalidation: open
      `src/client/db/pull-sync.ts` and the `runSync` /
      `reconcileAfterRefresh` callers in `src/client/state.ts`.
      Per Decision 4 in `research.md`, no per-item granularity is
      required. Confirm that every pull-sync code path that updates
      items either (a) flows through `reconcileAfterRefresh`
      already (covered by T018), or (b) terminates in a call site
      that clears the cache. If (b) holds for a path not covered
      by T018, add a single `state.viewItemsCache.clear()` call at
      that site. If no additional call sites exist, this task
      closes with a one-line note in the PR description.

- [ ] T020 [US3] Confirm the `itemsLoading` gate from T007 in
      practice: write a focused assertion inside the existing
      `test/view-switch-cache-invalidate.ts` (created in T016) or
      `test/view-switch-instant.ts` that, when the cache holds an
      entry for `'all'`, calling `State.showAll(state)` leaves
      `state.itemsLoading.value === false` even when the
      background `loadItems` is still pending. (This catches a
      regression where a future refactor unconditionally sets
      `itemsLoading=true` at the top of `loadItems`.)

**Checkpoint**: US3 is independently testable.

- Manual: `quickstart.md` Tests 1, 2, 6, 7, 8 all pass.
- Automated: `test/view-switch-cache-invalidate.ts` passes and the
  new assertion in T020 passes.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification against all functional requirements
and success criteria. No new behavior.

- [ ] T021 Run the full quickstart in
      `specs/021-fix-view-switch-lag/quickstart.md` Tests 1–10
      manually in a browser. Record observations against each
      "Expected" block in the PR description. Per the constitution
      ("UI changes MUST be exercised in a browser before being
      claimed complete"), this step is mandatory before merge.

- [ ] T022 [P] Run `npm test` and confirm the three new specs
      (`view-switch-instant.ts`, `view-switch-stale-refresh.ts`,
      `view-switch-cache-invalidate.ts`) plus the extended
      `sidebar-item.ts` are picked up by `test/run-all-tests.mjs`.
      No registration is required if the runner auto-discovers
      `test/*.ts`; if it uses an explicit list, append the new
      files.

- [ ] T023 [P] Run `npm run lint` and `npm run typecheck`. Fix any
      `state.ts` line-length violations introduced by the
      `applyItemsResult` rewrite (≤ 80 cols per global CLAUDE.md).

- [ ] T024 [P] Read the final `src/client/state.ts` and
      `src/client/components/sidebar-item.ts` once more and remove
      any of the following accidentally introduced by the rewrite:
      - Comments that describe WHAT the code does rather than WHY.
      - Backwards-compatibility shims for the old async
        `showAll`/`showStarred` signatures.
      - `// removed` markers left from the loadItems split.
      Per CLAUDE.md: "Don't add features, refactor, or introduce
      abstractions beyond what the task requires."

- [ ] T025 Update `specs/021-fix-view-switch-lag/plan.md`'s
      "Progress Tracking" section (if present) to mark Phases 0,
      1, and 2 complete. If the plan template does not include a
      progress tracker, skip this task.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)**: T001 first, no dependencies. Provides the
  green baseline.
- **Phase 2 (Foundational)**: T002 → T003 → (T004, T005, T006, T007).
  T002 introduces the types; T003 wires them onto `AppState`. T004
  (`currentFilterKey`) must precede T005 (`applyItemsResult`).
  T006 (`loadItems` rewrite) depends on T005. T007 (`itemsLoading`
  gate) depends on T006.
- **Phase 3 (US1)**: Depends on the entire Foundational phase. T008,
  T009 can be authored in parallel (different files). T010 depends
  on T002–T005 (types + cache + helper) but not on T006–T007 strictly;
  authoring sequence: T008 → T009 → T010 → T011 → T012.
- **Phase 4 (US2)**: Depends on Foundational. T013 (test) depends on
  T005–T006. T014, T015 are sweeps that may run after T013 passes.
- **Phase 5 (US3)**: Depends on Foundational. T016 → T017 → T018 →
  T019 → T020.
- **Phase 6 (Polish)**: Depends on US1, US2, US3 all complete. T021
  is the human verification; T022, T023, T024 may run in parallel.

### Story dependencies (independence)

- US1 stands alone: with T010 + T011 in place, the synchronous switch
  works against whatever cache state exists (cold or warm). The
  stale-refresh guard (US2) and cache invalidation (US3) improve
  correctness under specific scenarios but do not block US1's value.
- US2's correctness relies on the apply-time guard inside
  `applyItemsResult`, which is foundational (T005). US2's tasks add
  the test that proves the guard works (T013) and sweep for any
  bypass call sites (T014).
- US3 is the cache-invalidation discipline. Without US3, the cache
  could go stale after a mutation, but the user-visible switch is
  still instant — only the data freshness suffers. US3 is therefore
  P2 in the spec.

### Parallel opportunities

- **Foundational**: T004, T005, T006, T007 touch the same file
  (`state.ts`) and are sequential; they cannot be parallelized.
- **US1**: T008 (test) and T009 (sidebar-item test) touch different
  files — [P] together.
- **US2**: T013 is solo. T014, T015 are sweep tasks and can run
  alongside the US3 work above if the team splits.
- **US3**: T016 (test) is solo. T017, T018 touch `state.ts`
  sequentially. T019 may touch `pull-sync.ts` in parallel with T017
  or T018 only if `pull-sync.ts` ends up needing edits.
- **Polish**: T022, T023, T024 [P]; T021 is solo and human.

---

## Parallel Example: User Story 1

```bash
# Author the two US1 specs together (different files):
Task: "Create test/view-switch-instant.ts"
Task: "Extend test/sidebar-item.ts"

# Then implement sequentially (both touch state.ts or sidebar-item.ts):
Task: "Rewrite State.showAll / State.showStarred in src/client/state.ts"
Task: "Rewrite src/client/components/sidebar-item.ts as <a href>"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (T001).
2. Complete Phase 2 (T002–T007) — the cache substrate.
3. Complete Phase 3 (T008–T012) — synchronous switch + link semantics.
4. **STOP and VALIDATE**: run `quickstart.md` Tests 1, 2, 9 and the
   automated `test/view-switch-instant.ts`. If they pass, the
   reported bug is fixed.
5. Ship the MVP. US2 and US3 are correctness improvements that can
   land in a follow-up commit on the same branch.

### Incremental Delivery

1. Setup + Foundational → ready.
2. US1 → switch is instant in the happy path → ship (MVP).
3. US2 → stale-refresh guard is proven by `view-switch-stale-refresh.ts`.
4. US3 → cache invalidation discipline closes the staleness gap.
5. Polish → quickstart manual verification + lint/typecheck pass.

### Parallel Team Strategy

With one developer (the expected case for this fix):
- Run T001 → Foundational → US1 → US2 → US3 → Polish in order.

With two developers:
- After Foundational completes, dev A takes US1 (T008–T012), dev B
  takes US3 tests + impl (T016–T020). US2 is small enough to fall to
  whoever finishes first.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps task to a specific user story for traceability;
  setup/foundational/polish tasks intentionally have no story label.
- Each user story is independently testable per the "Independent
  Test" block in `spec.md`.
- Tests must be written before the implementation they verify
  (T008, T009 before T010, T011; T013 before T014; T016 before T017).
  This follows the existing repo pattern under `test/`.
- Per `CLAUDE.md`: do not write brittle tests that assert specific
  HTML text content. All four new/extended specs exercise the
  signal-level contract.
- Per global CLAUDE.md: any sequential signal write must be wrapped
  in `batch()`. This applies in `showAll`/`showStarred` (T010) and
  `applyItemsResult` (T005).
- Per global CLAUDE.md: TypeScript style — no space between colon
  and type annotation; lines ≤ 80 cols.
- Per constitution and CLAUDE.md: no CSS changes unrelated to the
  task. Active-state styling on `<SidebarItem>` reuses existing
  classes; no edits to `sidebar-item.css`.
- Commit after each task or logical group (e.g. T002+T003+T004+T005
  as one "foundational cache substrate" commit; T010+T011 as one
  "synchronous view switch" commit; T013 alone; T016+T017+T018 as
  one "cache invalidation" commit).
- Stop at any checkpoint to validate the story independently.
- Avoid: vague tasks, same-file conflicts that block parallelism,
  cross-story dependencies that break the independence promise.
