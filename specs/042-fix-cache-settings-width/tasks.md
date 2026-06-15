---
description: "Task list for Stable Cache Settings Width"
---

# Tasks: Stable Cache Settings Width

**Input**: Design documents from `/specs/042-fix-cache-settings-width/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/ui-cache-width.md, quickstart.md

**Tests**: No automated test tasks are generated. Tests were not requested,
and the spec/plan/constitution specify manual in-browser verification as the
primary evidence (layout is not computed in jsdom). The "verify" tasks below
are manual browser checks, not automated test files. `npm test && npm run
lint` is run in Polish only as a regression guard.

**Organization**: Tasks are grouped by user story. Both user stories are P1
and are delivered by the SAME single CSS rule; US1 owns the implementation,
US2 constrains the rule's choice (`min-width` over fixed `width`) and its
value, and verifies usability at the reserved width.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)
- Exact file paths are included in each task

## Path Conventions

Web app (frontend + backend split under `src/server` and `src/client`). This
feature is frontend-only and edits exactly one file:
`src/client/routes/settings.css`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Stand up the browser environment needed to measure and verify.

- [ ] T001 Start the dev server (`npm start`), sign in with a paid /
  local-first-enabled account, and open the Settings page with at least two
  subscribed feeds so the cache form is interactive (per
  `specs/042-fix-cache-settings-width/quickstart.md` "Determine the width").

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the reserved-width value both stories depend on.

**⚠️ CRITICAL**: The `min-width` value chosen here is the prerequisite for
both user stories — neither can be implemented or verified without it.

- [ ] T002 Measure the open cache form's rendered max-content width on
  `.feed-controls` in DevTools (expand one feed's "Cache settings"; the open
  form with the 8rem inputs and the cache-mode `<select>` is the widest
  state), convert to `rem`, and record the reserved width — adding only enough
  headroom to cover bounded hint variations ("Max size (NN MB)", "Keep for
  (NN days)" / "weeks"). Do NOT pick a larger round number than the panel
  needs (spec assumption). Reference: `research.md` "Determining the reserved
  width value".

**Checkpoint**: Reserved width value is known — implementation can begin.

---

## Phase 3: User Story 1 - Closing cache settings does not shift the layout (Priority: P1) 🎯 MVP

**Goal**: Opening or closing a feed's cache settings never resizes the
`.feed-controls` column or moves the "Cache settings" label sideways.

**Independent Test**: On Settings, open a feed's "Cache settings", then close
it; confirm the column width stays constant and the "Cache settings" label
keeps the same horizontal position throughout — no shrink, grow, or snap.

### Implementation for User Story 1

- [ ] T003 [US1] Add a stable `min-width` (the value from T002) to
  `.feed-controls` in `src/client/routes/settings.css` (the right-hand
  controls column, region ~lines 351-419). Keep lines ≤80 cols, reuse
  existing CSS variables, add no new color, and do not modify any unrelated
  CSS. No TS/markup change.

### Verification for User Story 1

- [ ] T004 [US1] In the browser, toggle a feed's "Cache settings" open then
  closed and confirm via DevTools that `.feed-controls` width is identical in
  both states (0 px resize, FR-001/002/003, SC-001) and the "Cache settings"
  summary label's left edge does not move (0 px, FR-004, SC-002). Surface:
  Settings page rendered from `src/client/routes/settings.ts`.

**Checkpoint**: US1 is functional — the reported open/close jank is gone.

---

## Phase 4: User Story 2 - Cache settings remain fully usable at the stable width (Priority: P1)

**Goal**: At the reserved width, all cache controls stay fully visible and
interactive when expanded, and the collapsed card still reads cleanly.

**Independent Test**: With the stable width applied, expand a feed's cache
settings and exercise each control (cache mode, max size, keep-for, clear
cache, unfollow); then collapse and confirm the collapsed card reads cleanly.

### Verification for User Story 2

- [ ] T005 [US2] Expanded, exercise every control in `.feed-controls`
  (cache-mode `<select>`, max-size input, keep-for input, "Clear cache",
  "Unfollow") and confirm each is fully visible with no clipping or horizontal
  overflow across the bounded hint range (FR-005, SC-003). If any control
  clips, increase the `min-width` headroom in `src/client/routes/settings.css`
  (T003) — confirm the rule is `min-width`, not a fixed `width`, so dynamic
  hints can never clip (research decision).
- [ ] T006 [US2] Confirm the collapsed card content is legible and aligned
  within the reserved width (FR-006), that all rows share the same
  `.feed-controls` width so the column's right edge is straight with one feed
  open and others closed (FR-007), and that every control behaves exactly as
  before (FR-008). Surface: Settings page (`src/client/routes/settings.ts`).

**Checkpoint**: Both P1 stories pass — width is stable AND controls are fully
usable at that width.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Edge-case verification, regression guard, and cleanup.

- [ ] T007 [P] Run the quickstart edge cases on the Settings page: the
  open/close height animation (031) still plays with no horizontal motion
  during the tween (FR-008); a fresh reload shows the column already at the
  stable width so the first open causes no resize; and the page gains no
  horizontal scrollbar at supported viewport widths (spec assumption). Per
  `specs/042-fix-cache-settings-width/quickstart.md` "Verify (acceptance)".
- [ ] T008 [P] Run `npm test && npm run lint` from the repo root as a
  regression guard (no behavior/markup change expected).
- [ ] T009 Stop the dev server started in T001 (clean up the process).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (needs the running app to
  measure). BLOCKS both user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational (T002 value). Contains
  the only implementation task (T003).
- **User Story 2 (Phase 4)**: Depends on US1's implementation (T003) being in
  place, since both stories share the single `min-width` rule. T005 may feed a
  small adjustment back into T003 (headroom).
- **Polish (Phase 5)**: Depends on both stories passing.

### User Story Dependencies

- **US1 (P1)**: The minimum viable fix. Owns the implementation. No dependency
  on US2.
- **US2 (P1)**: Verifies usability at the width US1 reserves; shares US1's
  single CSS rule rather than adding its own implementation.

### Within Each User Story

- US1: implement the rule (T003) before verifying it (T004).
- US2: verify controls (T005) before confirming collapsed/straight-edge and
  no-regression (T006); T005 may adjust the T003 headroom.

### Parallel Opportunities

- Limited. The implementation is a single rule in one file, so US1 and US2
  implementation cannot be parallelized (same file, shared rule).
- In Polish, T007 (manual edge-case verification) and T008 (`npm test &&
  npm run lint`) are independent and marked `[P]`.

---

## Parallel Example: Polish Phase

```bash
# T007 and T008 touch different things (browser vs. test runner) and can run
# at the same time:
Task: "Run quickstart edge cases in the browser (animation, first-render,
       no H-scroll) on the Settings page"
Task: "Run npm test && npm run lint from the repo root"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup — running app on Settings with ≥2 feeds.
2. Phase 2: Foundational — measure and record the reserved `rem` width.
3. Phase 3: US1 — add `min-width` to `.feed-controls`; verify zero resize and
   zero label shift on toggle.
4. **STOP and VALIDATE**: US1 alone eliminates the reported jank (the entire
   request) and is shippable.

### Incremental Delivery

1. Setup + Foundational → reserved width known.
2. US1 → stable column width / no label shift → demo (MVP!).
3. US2 → confirm controls fully usable and collapsed card clean at that width.
4. Polish → edge cases, `npm test && npm run lint`, stop dev server.

---

## Notes

- [P] = different files / independent work, no dependencies.
- [Story] label maps each task to its user story for traceability.
- This is a presentation-only change: no SQLite (local or DO) schema, no
  `/api/sync` payload, no TS/markup change expected.
- Constitution gate: the UI MUST be exercised in a browser before completion;
  type-check/test pass alone is insufficient.
- Do NOT modify CSS unrelated to `.feed-controls`. Reuse existing variables;
  add no new color. Keep all lines ≤80 cols.
- Clean up the dev server when done (T009).
