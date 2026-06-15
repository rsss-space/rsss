---
description: "Task list for 041-cache-default-labels"
---

# Tasks: Show concrete default in per-feed cache labels

**Input**: Design documents from `/specs/041-cache-default-labels/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/ui-cache-hint.md, quickstart.md

**Tests**: Included. The quickstart explicitly requests a unit test of the
pure formatting helper (rounding parity + non-finite degrade). Per project
rules, test the pure helper's behavior only — do NOT assert rendered
HTML/label strings (brittle).

**Organization**: Tasks are grouped by user story. US1 (P1) is the MVP and
delivers the entire user-visible change; US2 (P2) is the reactivity guarantee.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)
- Exact file paths are included in each task

## Path Conventions

Web app. This feature is confined to `src/client/`. Helper + signals live in
`src/client/local-first-settings.ts`; the two render call sites are
`src/client/components/cache-settings.ts` and `src/client/routes/settings.ts`;
helper unit tests go in `test/local-first-settings.ts`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

No setup tasks. This is a presentation-only change inside the existing Vite +
Preact client — no new dependencies, no new modules, no schema/sync/worker
change. Proceed directly to Foundational.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared pure formatting helper both render call sites depend
on. Building it once (rather than inlining at each site) is what guarantees
FR-007 consistency and centralizes the FR/edge-case degrade rule.

**⚠️ CRITICAL**: Both user stories consume this helper — neither US1 nor US2
can be completed until this phase is done.

- [X] T001 Write a failing unit test for the hint helper(s) in `test/local-first-settings.ts`: assert rounding parity with the account editor (`Math.round(bytes / 1_000_000)` → `default, <N> MB`; `Math.round(seconds / 86400)` → `default, <N> days`), that the returned string contains the literal word `default` and the value+unit, and that a non-finite input (`NaN`, `Infinity`) degrades to the bare word `default` (no `NaN`/`undefined`). Test the pure function only — no rendered-HTML assertions.
- [X] T002 Implement the pure, total helper(s) in `src/client/local-first-settings.ts` per `contracts/ui-cache-hint.md`: `defaultCacheSizeHint(bytes:number):string` and `defaultCacheAgeHint(seconds:number):string` (or one unit-parameterized helper). Use the byte-for-byte same conversions as the account editor (`Math.round(bytes / 1_000_000)`, `Math.round(seconds / 86400)`), return `default, <N> MB` / `default, <N> days` with a fixed (non-pluralized) unit, and return bare `default` for non-finite input. No signal reads inside the helper (caller passes `.value` in). Run T001 to green.

**Checkpoint**: Helper exists, is unit-tested, and is importable by both call
sites. User-story work can begin.

---

## Phase 3: User Story 1 - See the actual default I'll get if I leave a field blank (Priority: P1) 🎯 MVP

**Goal**: Replace the vague `blank = default` hint on the per-feed "Max size"
and "Keep for" fields with a hint that names the concrete current account
default (e.g. `Max size (default, 50 MB)`, `Keep for (default, 30 days)`),
everywhere those fields are shown.

**Independent Test**: Open a feed's Cache Settings while the per-feed fields
are blank and confirm the two field hints state the concrete default value +
unit (`default, 50 MB` / `default, 30 days`, or the current account defaults)
rather than `blank = default`. Confirm the override read/save/clear behavior is
unchanged (US1 scenario 3, FR-008).

### Implementation for User Story 1

- [X] T003 [P] [US1] In `src/client/components/cache-settings.ts`, import `defaultMaxSizeBytes`, `defaultMaxAgeSeconds`, and the helper(s) from `local-first-settings.ts` (this file does not import them yet). Replace the `Max size (MB, blank = default)` label (~line 295) and the `Keep for (days, blank = default)` label (~line 306) with helper-built hints (`Max size (${defaultCacheSizeHint(defaultMaxSizeBytes.value)})` / `Keep for (${defaultCacheAgeHint(defaultMaxAgeSeconds.value)})`), reading the signals' `.value` inside the render body. Leave the `<input>`, its `placeholder="default"`, the `onChange` handlers, and the override read/write logic untouched (FR-008, D6).
- [X] T004 [P] [US1] In `src/client/routes/settings.ts`, replace the `Max size (MB, blank = default)` label (~line 924) and the `Keep for (days, blank = default)` label (~line 937) in the per-feed Subscriptions list with the same helper-built hints (the `defaultMaxSizeBytes` / `defaultMaxAgeSeconds` signals are already imported here). Wording MUST be identical to T003 (FR-007). Leave the input, `placeholder`, and `onChange` handlers untouched.

**Checkpoint**: Both per-feed call sites show the concrete account default and
`blank = default` is gone from the cache size/retention hints (SC-002). MVP is
demonstrable.

---

## Phase 4: User Story 2 - The shown default reflects my account-level setting (Priority: P2)

**Goal**: The default shown in the per-feed hint tracks the reader's current
account-level default — if they change the account default, a subsequently
rendered per-feed hint shows the updated value and matches the account editor.

**Independent Test**: Change the account-level cache default (e.g. retention
30 → 14 days, max size → 200 MB) in Settings, reopen a feed's cache settings,
and confirm the per-feed hint shows the updated value and matches the number
shown in the account-level editor (SC-003).

### Implementation for User Story 2

- [X] T005 [US2] Verify the reactivity contract (D3) at both call sites: confirm `src/client/components/cache-settings.ts` and `src/client/routes/settings.ts` read `defaultMaxSizeBytes.value` / `defaultMaxAgeSeconds.value` inside the component render body (not a value hoisted/cached outside render or captured before the signal read), so writing the account-default signal re-renders the hint. If a cached/hoisted copy is found, move the `.value` read into the render path. (Achieved for free if T003/T004 read `.value` inline — this task confirms it.)

**Checkpoint**: Per-feed hints update live when account defaults change and
never disagree with the account editor.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Verify scope guards, no regressions, and the success criteria.

- [X] T006 [P] Grep the client for the substring `blank = default` (`src/client/`) and confirm it no longer appears in the per-feed cache size/retention hints (SC-002).
- [ ] T007 Run the full `quickstart.md` manual verification in a browser (`npm start`): (1) blank-field hints read the concrete default (US1); (2) change the account default and confirm per-feed hints update and match the account editor (US2, SC-003); (3) enter/clear a per-feed override and confirm save/clear still works and the hint still describes the fallback (US1 scenario 3, FR-008, SC-004); (4) confirm the Subscriptions-list fields use identical wording (FR-007). Clean up the dev server afterward.
- [ ] T008 Run `npm test && npm run lint` and confirm both pass (includes the T001 helper test and existing settings/cache-policy suites).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: None (no tasks).
- **Foundational (Phase 2)**: Blocks all user stories. T001 → T002.
- **User Stories (Phase 3–4)**: Depend on T002 (the helper).
  - US1 (P1) and US2 (P2) both consume the helper; US2's verification
    (T005) depends on US1's call-site edits (T003/T004) being in place.
- **Polish (Phase 5)**: Depends on US1 + US2 being complete.

### User Story Dependencies

- **US1 (P1)**: Starts after T002. No dependency on US2.
- **US2 (P2)**: Reactivity is a property of the US1 call-site edits; T005
  verifies/guards it, so US2 depends on T003 + T004.

### Within Each User Story

- T001 (test) is written and fails before T002 (implementation).
- T003 and T004 are independent files and can run in parallel.

### Parallel Opportunities

- T003 ∥ T004 — different files (`cache-settings.ts` vs `settings.ts`), both
  depend only on T002.
- T006 can run independently of T007/T008 (read-only grep).

---

## Parallel Example: User Story 1

```bash
# After Foundational (T002) is done, launch both call-site edits together:
Task: "Replace per-feed cache labels in src/client/components/cache-settings.ts"
Task: "Replace per-feed cache labels in src/client/routes/settings.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 2 Foundational: T001 (failing helper test) → T002 (helper, green).
2. Phase 3 US1: T003 + T004 (in parallel) — wire the helper into both call
   sites.
3. **STOP and VALIDATE**: open a feed's cache settings, confirm the concrete
   default shows and `blank = default` is gone. Ship if ready.

### Incremental Delivery

1. Foundational → helper ready.
2. US1 → concrete default visible at both sites (MVP).
3. US2 → confirm/guard reactivity vs. account default changes.
4. Polish → grep guard, quickstart browser pass, `npm test && npm run lint`.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] labels map tasks to US1 / US2 for traceability.
- Helper is pure (no signal reads) — reactivity comes from reading `.value`
  at the call site (D3). Keep tests on the pure helper, not rendered HTML.
- Out of scope (leave untouched): the "Cache mode" `<select>` "Use default"
  option, the input `placeholder="default"`, and the account-level cache
  editor inputs (D6, spec Assumptions).
- Commit after Foundational and after each user story.
