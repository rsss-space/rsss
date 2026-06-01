# Tasks: Disable Cache Settings Link When Caching Off

**Input**: Design documents from `/specs/027-disable-cache-settings-link/`
**Prerequisites**: plan.md (required), spec.md (required), research.md,
data-model.md, contracts/, quickstart.md

**Tests**: Included. The feature's design (research.md Decision 4,
quickstart.md "Expected automated coverage") explicitly calls for
extending `test/settings-route.ts`. Tests assert structure / attributes /
behavior only — never rendered text content — per project test rules.

**Organization**: Tasks are grouped by user story (P1, P2, P3) so each
story is an independently testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different file, no dependency on
  incomplete tasks)
- **[Story]**: US1 / US2 / US3 — maps to the user stories in spec.md
- Each task names the exact file path

## Path Conventions

This feature is confined to the frontend client (plan.md "Structure
Decision"). All production changes live in:

- `src/client/routes/settings.ts` — `SettingsRoute`; per-feed
  `.feed-cache-controls` `<details>` disclosure (~lines 778-854);
  `cacheDisabled` computed already defined (~lines 132-134).
- `src/client/routes/settings.css` — `.feed-cache-controls` styles
  (~lines 352-361); global `.cache-section.is-disabled` (~276-278).

Verification lives in `test/settings-route.ts` (existing global-cache
disabled tests at ~lines 346-438 are the pattern to mirror). No
`backend/` or server-side files are touched.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Orientation only — confirm the existing gate and the target
markup are where the plan says they are. No code change.

- [ ] T001 Confirm the gating signal and target markup exist before
  editing: in `src/client/routes/settings.ts` verify the `cacheDisabled`
  computed (`useComputed(() => !isLocalFirstActive.value)`, ~lines
  132-134) and the per-feed `<details class="feed-cache-controls">` with
  its `<summary>Cache settings</summary>` (~lines 778-779). In
  `src/client/routes/settings.css` verify the global
  `.cache-section.is-disabled { opacity: 0.55 }` rule (~lines 276-278) to
  reuse its literal value. Note line drift if the anchors moved.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure required before user-story work.

No foundational code is required. The single device-level gate this
feature reuses — `cacheDisabled = !isLocalFirstActive` — already exists
in `src/client/routes/settings.ts` and already drives the page's global
cache controls (research.md Decision 1). All stories read this one
signal, which guarantees uniformity (FR-004) and reactivity (FR-005) for
free.

**Checkpoint**: Gate confirmed present — user story work can begin.

---

## Phase 3: User Story 1 - Per-feed cache settings reflect caching availability (Priority: P1) 🎯 MVP

**Goal**: When caching is OFF on the device, every subscribed feed's
"Cache settings" disclosure is grayed (reduced opacity, matching the
global controls) and cannot be opened by mouse or keyboard, and is
announced as unavailable to assistive tech.

**Independent Test**: With `isLocalFirstActive = false` and at least one
subscribed feed, render `SettingsRoute`; confirm `.feed-cache-controls`
has the `is-disabled` class, its `<summary>` has `aria-disabled="true"`
and `tabindex="-1"`, and the `<details>` is not `open`.

### Tests for User Story 1

> Write the test first and watch it FAIL before implementing T004.

- [ ] T002 [P] [US1] Add the disabled visual rule in
  `src/client/routes/settings.css`: a nested
  `.feed-cache-controls.is-disabled { opacity: 0.55; & summary { cursor:
  default; } }` block, mirroring `.cache-section.is-disabled` (~lines
  276-278). Reuse the literal `0.55` (no new color, no font-size change,
  no `_variables.css` edit, no unrelated CSS touched — plan.md
  Constraints; research.md Decision 3).
- [ ] T003 [US1] Add test "per-feed cache control is disabled when
  isLocalFirstActive is false" to `test/settings-route.ts`. Set
  `isLocalFirstActive.value = false`, set `state.feeds.value =
  [makeFeed()]` (and entitled billing if the list needs it, per existing
  tests) so a Subscribed Feeds row renders; assert `.feed-cache-controls`
  has class `is-disabled`, its `<summary>` has `aria-disabled === "true"`
  and `tabindex === "-1"`, and the `<details>` element's `open` is
  `false`. Structure/attribute assertions only — no text-content
  assertions. Mirror the pattern at ~lines 346-438. Run `npm test`; the
  test MUST fail before T004.

### Implementation for User Story 1

- [ ] T004 [US1] Implement the disabled-state rendering on the per-feed
  disclosure in `src/client/routes/settings.ts` (the `<details
  class="feed-cache-controls">` / `<summary>` at ~lines 778-779), driven
  by `cacheDisabled.value` (research.md Decision 2):
  1. Add `is-disabled` to the `.feed-cache-controls` class when
     `cacheDisabled.value`.
  2. Force collapse: `open=${cacheDisabled.value ? false : undefined}`
     (false closes an already-open panel — FR-007; undefined keeps the
     enabled disclosure uncontrolled/native).
  3. On `<summary>`, set `aria-disabled=${cacheDisabled.value ? 'true' :
     undefined}` and `tabindex=${cacheDisabled.value ? -1 : undefined}`.
  4. Guard the native toggle: an `onClick` on `<summary>` that calls
     `e.preventDefault()` when `cacheDisabled.value` (blocks pointer
     activation — FR-002; `tabindex="-1"` blocks keyboard reach).
  Keep lines <= 80 columns. Re-run `npm test`; T003 MUST now pass.

**Checkpoint**: With caching off, all per-feed controls are grayed,
collapsed, and non-interactive. MVP is independently demoable.

---

## Phase 4: User Story 2 - Cache settings remain usable when caching is enabled (Priority: P2)

**Goal**: When caching is ON, every per-feed "Cache settings" control is
full opacity, focusable, opens on click/Enter, and edits options exactly
as it does today (no regression).

**Independent Test**: With `isLocalFirstActive = true` and a subscribed
feed, render `SettingsRoute`; confirm `.feed-cache-controls` has NO
`is-disabled` class, its `<summary>` has no `aria-disabled` and no
`tabindex="-1"`, and the disclosure toggles open.

> Depends on the T004 edit (same `<details>` block in `settings.ts`).
> US2 verifies the `else` branch of that conditional is correct.

### Tests for User Story 2

- [ ] T005 [US2] Add test "per-feed cache control is enabled when
  isLocalFirstActive is true" to `test/settings-route.ts`. Set
  `isLocalFirstActive.value = true`, render a feed row; assert
  `.feed-cache-controls` does NOT contain `is-disabled`, its `<summary>`
  has no `aria-disabled` attribute and no `tabindex="-1"`, and toggling
  the `<details>` (e.g. set/read `open`) reveals the form. Attribute /
  behavior assertions only, no text content. Mirror ~lines 393-438.

### Implementation for User Story 2

- [ ] T006 [US2] Finalize the enabled branch in
  `src/client/routes/settings.ts`: confirm that when `!cacheDisabled.value`
  the `<details>` `open` resolves to `undefined` (native, uncontrolled),
  `<summary>` emits no `aria-disabled` and no `tabindex` override, and the
  `onClick` guard is a no-op so the disclosure opens as before. Adjust the
  T004 conditional if any of these regress. Re-run `npm test`; T005 MUST
  pass and all prior tests stay green.

**Checkpoint**: Caching-on behavior is unchanged from today; US1 and US2
both pass independently.

---

## Phase 5: User Story 3 - State updates immediately when caching is toggled (Priority: P3)

**Goal**: Toggling caching on/off updates every per-feed control's
appearance and interactivity in place — no reload, no re-mount.

**Independent Test**: Mount `SettingsRoute` with a feed; flip
`isLocalFirstActive.value` from true→false and false→true and confirm the
same `.feed-cache-controls` element's `is-disabled` class,
`aria-disabled`, `tabindex`, and `open` update without re-rendering a new
node.

> Depends on the T004 edit (same `settings.ts` block). Reactivity comes
> from reading the `cacheDisabled` signal inside render.

### Tests for User Story 3

- [ ] T007 [US3] Add test "per-feed cache control toggles disabled state
  when isLocalFirstActive flips" to `test/settings-route.ts`. Mount with a
  feed and `isLocalFirstActive.value = true`; capture the
  `.feed-cache-controls` element; set `isLocalFirstActive.value = false`,
  `await nextTick()`, assert it gained `is-disabled` and the summary
  gained `aria-disabled="true"` / `tabindex="-1"` and `open` is `false`;
  then set it back to `true`, `await nextTick()`, assert the disabled
  markers are removed. Assert it is the same element instance (in-place
  update, not re-mount). Reset `isLocalFirstActive.value = false` in
  `finally` and `unmount`, matching the existing tests.

### Implementation for User Story 3

- [ ] T008 [US3] Ensure reactive read in `src/client/routes/settings.ts`:
  the per-feed render must read `cacheDisabled.value` inline within the
  feeds `.map(...)` template (not capture a plain boolean before the map)
  so a change to `isLocalFirstActive` re-renders each row. This is
  typically already satisfied by T004; confirm and adjust if needed.
  Re-run `npm test`; T007 MUST pass.

**Checkpoint**: All three stories pass independently; toggling is
instantaneous.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across the whole feature.

- [ ] T009 Run `npm test` (`node test/run-all-tests.mjs`) and confirm the
  full `test/settings-route.ts` suite (including T003/T005/T007) passes
  with no regressions.
- [ ] T010 Run `npm run lint` and fix any issues in the changed files
  (`settings.ts`, `settings.css`, `settings-route.ts`); verify TS lines
  are <= 80 columns and CSS follows nested-selector style.
- [ ] T011 Browser manual verification per `quickstart.md` (constitution
  requires UI changes be exercised in a browser): `npm start`, sign in,
  and walk steps 1-6 — caching-off disabled appearance + non-interactive
  (FR-001/FR-002), siblings unaffected (FR-006), caching-on usable
  (FR-003), toggle reactivity with no reload (FR-005), and open-then-
  disable collapse (FR-007).
- [ ] T012 Confirm the contract and constitution gates hold: re-check the
  state table in `contracts/per-feed-cache-control.md` against the
  implementation, confirm no CSS unrelated to `.feed-cache-controls` was
  modified, no new color or `_variables.css` change, and the `.btn-delete`
  ("Unfollow") button and `.feed-info` siblings are untouched (FR-006,
  SC-005).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: None required (gate already exists).
- **User Stories (Phase 3-5)**: US1 is the MVP and lands the core edit to
  the `<details>` block. US2 and US3 build on that same `settings.ts`
  edit, so they follow US1 in priority order rather than running fully
  parallel to it.
- **Polish (Phase 6)**: After all desired stories are complete.

### User Story Dependencies

- **US1 (P1)**: Independent and demoable on its own (caching-off path).
- **US2 (P2)**: Verifies/finalizes the caching-on branch of the US1 edit;
  independently testable but shares `settings.ts`.
- **US3 (P3)**: Verifies reactivity of the US1 edit; independently
  testable but shares `settings.ts`.

### Within Each User Story

- Test task is written first and must FAIL before its implementation task.
- Tests in `test/settings-route.ts` and impl in `settings.ts` are in the
  same files across stories, so those tasks are sequential, not parallel.

### Parallel Opportunities

- **T002 (CSS)** is the only `[P]` task: it edits `settings.css`, a
  different file from the TS impl and the tests, and has no dependency on
  them. It can be done at any time during US1.
- All `settings.ts` tasks (T004, T006, T008) share one file → sequential.
- All `test/settings-route.ts` tasks (T003, T005, T007) share one file →
  sequential.

---

## Parallel Example

```bash
# Only the stylesheet edit is independent of the TS/test files:
Task T002: "Add .feed-cache-controls.is-disabled rule in
            src/client/routes/settings.css"
# Everything else touches settings.ts or settings-route.ts and must be
# done in order (test → implement) within each story.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 (confirm anchors).
2. T002 (CSS) + T003 (failing US1 test) + T004 (implement disabled state).
3. **STOP and VALIDATE**: caching-off path grays out and blocks the
   disclosure; T003 passes.
4. Demo the MVP.

### Incremental Delivery

1. US1 → disabled-when-off works → demo (MVP).
2. US2 → confirm caching-on unchanged → demo.
3. US3 → confirm toggle reactivity → demo.
4. Polish → lint, full test run, browser quickstart, contract recheck.

---

## Notes

- `[P]` = different file, no dependency. Here only T002 qualifies.
- `[Story]` label maps each task to its user story for traceability.
- Tests assert structure / attributes / behavior only — never rendered
  text content, no doc tests (project rule; research.md Decision 4).
- Reuse the existing `0.55` opacity literal; introduce no new color and
  no `_variables.css` change; touch no CSS outside `.feed-cache-controls`.
- Keep TypeScript lines <= 80 columns.
- Commit after each task or logical group.
