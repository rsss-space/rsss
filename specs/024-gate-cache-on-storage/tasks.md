# Tasks: Gate Cache Section On Local Storage

**Input**: Design documents from `/specs/024-gate-cache-on-storage/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, quickstart.md

**Tests**: Tests included. The existing `test/settings-route.ts` already
exercises the `.cache-section` and the project uses Vitest + JSDOM as
the standard client test harness — we extend it rather than introduce
a new pattern.

**Organization**: One P1 user story. No US2/US3 in the spec. The
feature is a single-file UI surgery with one CSS rule, so the user-
story phase contains all the implementation work.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps the task to its user story (US1 here)
- Include exact file paths in descriptions

## Path Conventions

- Web application: `src/client/` (Preact SPA), `src/server/`
  (Cloudflare Worker). Tests live at the repo root under `test/`,
  not co-located with the source.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

No setup tasks are required for this feature. The existing Vite +
Preact client and Vitest harness are already installed and configured.
`npm install` has been run as part of normal development setup.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY
user story can be implemented

No foundational tasks are required. The gating signal
(`isLocalFirstActive`) is already exported from
`src/client/state.ts` and exercised elsewhere in the client. The
`<section class="settings-section cache-section">` block, the
`<fieldset class="cache-mode-group">` element, and the three numeric
inputs already exist in `src/client/routes/settings.ts` (see
spec.md §FR-002 for the exact control inventory).

**Checkpoint**: Foundation is already present in the repo — User
Story 1 can begin immediately.

---

## Phase 3: User Story 1 - Cache section is visibly inactive when local storage is off (Priority: P1) MVP

**Goal**: When `isLocalFirstActive.value === false`, the global Cache
section on `/settings` renders with reduced opacity, the cache-mode
fieldset and the three numeric inputs are in the native `disabled`
state, and assistive technologies perceive the controls as disabled.
When the signal flips true, the section returns to its normal
interactive state without flicker.

**Independent Test**: Run the four scenarios in `quickstart.md`
(A: disabled on first paint with sync off; B: clicks/keystrokes are
no-ops; C: turning sync on enables the section in the same render;
D: turning sync off re-disables it reactively). Plus the edge-case
checks (no mid-bootstrap flicker, free-plan still disabled, screen-
reader pass announces disabled state). All four scenarios pass with
no other section of the settings page changed.

### Tests for User Story 1

> Write these tests FIRST, ensure they FAIL before implementation.
> Tests use the existing Vitest + JSDOM harness used by
> `test/settings-route.ts`. Mock `isLocalFirstActive` via the
> existing `_setIsLocalFirstActiveSelectorForTest` injection seam
> in `src/client/state.ts` (line ~428).

- [ ] T001 [P] [US1] Add a test case to `test/settings-route.ts`
      that renders the settings route with the
      `isLocalFirstActive` selector forced to a signal of `false`,
      asserts the `.cache-section` element has the `is-disabled`
      class, asserts `<fieldset class="cache-mode-group">` has the
      `disabled` attribute, and asserts each of the three numeric
      inputs (`input[name="default-max-size-mb"]`,
      `input[name="account-max-size-mb"]`,
      `input[name="default-max-age-days"]`) has the `disabled`
      attribute. Do NOT assert on visible text content (per
      house-style: no brittle text assertions).

- [ ] T002 [P] [US1] Add a test case to `test/settings-route.ts`
      that renders the settings route with the
      `isLocalFirstActive` selector forced to a signal of `true`,
      asserts the `.cache-section` element does NOT have the
      `is-disabled` class, and asserts the fieldset + three inputs
      do NOT have the `disabled` attribute. Re-uses the harness
      setup from T001.

- [ ] T003 [P] [US1] Add a test case to `test/settings-route.ts`
      that mounts the settings route with
      `isLocalFirstActive.value = false`, then flips it to `true`
      inside a `batch()` (or directly — the signal is set inside
      `state.ts` itself in production), and asserts that the
      `is-disabled` class is removed and the `disabled` attributes
      are gone after the next microtask flush — i.e. no page
      reload is required. Then flip back to `false` and assert the
      reverse. This locks in FR-004 / FR-005 reactivity.

- [ ] T004 [US1] Run `npm test` and confirm T001–T003 FAIL with
      the current implementation (the `is-disabled` class and
      `disabled` attributes don't exist yet). Record the failure
      messages — they should match "expected class to contain
      is-disabled" / "expected element to have attribute disabled".
      Do NOT proceed until tests fail for the right reason.

### Implementation for User Story 1

- [ ] T005 [US1] In `src/client/routes/settings.ts`, add
      `isLocalFirstActive` to the existing import block from
      `../state.js`. The selector is the canonical
      "sync is fully bootstrapped" signal — research.md Decision 1
      explains why this is the correct signal (vs.
      `syncSubscriptions` or `pendingSyncSubscriptions`).

- [ ] T006 [US1] In the same Preact functional component in
      `src/client/routes/settings.ts`, derive a `cacheDisabled`
      computed:
      ```ts
      const cacheDisabled = useComputed(
          () => !isLocalFirstActive.value
      )
      ```
      Place it next to the other `useComputed` hooks in the
      component body. Read `cacheDisabled.value` (not the signal
      itself) in the JSX so the reactivity follows the existing
      pattern in this file.

- [ ] T007 [US1] In `src/client/routes/settings.ts`, modify the
      `<section class="settings-section cache-section">` opening
      tag (around line 643 in the file at HEAD as of 2026-05-27)
      to toggle the `is-disabled` class. Use the project's existing
      class-list-as-template pattern, e.g.:
      ```ts
      class=${`settings-section cache-section${
          cacheDisabled.value ? ' is-disabled' : ''
      }`}
      ```
      Do NOT change the order of existing classes; only append
      `is-disabled` conditionally.

- [ ] T008 [US1] In `src/client/routes/settings.ts`, add the
      `disabled` attribute (bound to `cacheDisabled.value`) to the
      existing `<fieldset class="cache-mode-group">` element
      (around line 652). Use the htm/preact boolean-attribute form
      `disabled=${cacheDisabled.value}`. Per HTML spec, this
      cascades to both `<RadioInput>` children automatically;
      do NOT change the radio inputs themselves.

- [ ] T009 [US1] In `src/client/routes/settings.ts`, add the
      `disabled` attribute (bound to `cacheDisabled.value`) to
      each of the three numeric `<input>` elements:
      - `input[name="default-max-size-mb"]` (max per feed)
      - `input[name="account-max-size-mb"]` (total cache size)
      - `input[name="default-max-age-days"]` (keep cached items
        for days)
      Use the htm/preact boolean-attribute form
      `disabled=${cacheDisabled.value}`. Do NOT add wrapping
      fieldsets or restructure the markup — minimum blast radius
      per research.md Decision 2.

- [ ] T010 [US1] In `src/client/routes/settings.css`, add ONE new
      rule scoped to `.cache-section.is-disabled`:
      ```css
      .cache-section.is-disabled {
          opacity: 0.55;
      }
      ```
      Place it immediately after the existing `.cache-section`
      rule block (around line 225 — check current line in HEAD).
      Do NOT modify any existing `.cache-section` declaration. Do
      NOT add `pointer-events: none` (native `:disabled` on the
      controls already handles input blocking, and `pointer-events`
      on the section root would defeat future links — see
      research.md Decision 3). Use a global opacity variable from
      `_variables.css` / `_vars.css` if one already exists for
      "disabled section opacity"; otherwise the literal `0.55` is
      acceptable for this single-use case (record the choice in
      the PR description so future audits can normalise).

- [ ] T011 [US1] Run `npm test` and confirm T001–T003 now PASS
      with the implementation in place. If any fail, fix the
      implementation — do NOT modify the tests to match the code.

- [ ] T012 [US1] Run `npm run lint` and fix any new lint findings
      introduced by T005–T010. Do NOT modify ESLint settings
      (per global CLAUDE.md: "NEVER change eslint settings").

- [ ] T013 [US1] Run the four scenarios in `quickstart.md`
      manually against `npm start` in a Chromium browser with
      DevTools open:
      - Scenario A: disabled on first paint (sync off)
      - Scenario B: clicks and keystrokes are no-ops
      - Scenario C: turning sync on enables in same render
      - Scenario D: turning sync off re-disables reactively
      Plus the edge cases: no mid-bootstrap flicker, free-plan
      still disabled (sign in as a free-plan account), screen-
      reader pass (each disabled control announces disabled
      state). Capture a before/after screenshot for the PR.

**Checkpoint**: User Story 1 is fully functional and testable
independently. The Cache section gates correctly on
`isLocalFirstActive`, with no regression to the existing
interactive behaviour when sync is on.

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect the broader codebase, not
this one story

- [ ] T014 Run the full `npm test && npm run lint` once at the
      end of the branch to confirm no unrelated regressions.

- [ ] T015 Update `specs/024-gate-cache-on-storage/quickstart.md`
      if any step in the manual scenarios diverges from the final
      implementation (e.g. the literal opacity value differs from
      the `0.55` example). Do NOT change `quickstart.md` if the
      implementation matches exactly.

- [ ] T016 Verify `CLAUDE.md` does NOT need an update for this
      branch — this feature introduces no new tech, no schema
      change, no new dependency, and no new convention. If
      `CLAUDE.md`'s "Active Technologies" or "Recent Changes"
      section needs the branch listed for traceability, add a
      one-line entry; otherwise leave it alone.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Empty — nothing to do.
- **Foundational (Phase 2)**: Empty — already present in the repo.
- **User Story 1 (Phase 3)**: Can start immediately. T001–T003 can
  run in parallel (they touch the same file, `test/settings-
  route.ts`, but are distinct `test('...')` blocks that don't
  conflict — they should be authored together in a single edit).
  T004 (verify failure) blocks T005–T010 (implementation). T011
  (verify pass) blocks T012 (lint). T013 (manual verification)
  blocks the Polish phase.
- **Polish (Phase N)**: Depends on Phase 3 completion.

### Within Phase 3

- Tests (T001–T003) MUST be written and FAIL (T004) before
  implementation (T005–T010) begins.
- T005 (import) → T006 (computed) → T007 (section class), T008
  (fieldset disabled), T009 (inputs disabled) can run in any
  order once T006 is done (they touch different lines of the
  same file).
- T010 (CSS) is independent of T005–T009 and can be written in
  parallel with them.
- T011 (test pass) → T012 (lint) → T013 (manual quickstart).

### Parallel Opportunities

- T001, T002, T003 are conceptually parallel (three separate test
  cases) but live in the same test file, so they're authored
  together in one edit pass rather than split across agents.
- T010 (CSS) and T005–T009 (TS) touch different files and can
  technically run in parallel; in practice a single engineer
  will do them in one sitting.

---

## Parallel Example: User Story 1

```bash
# Author the three test cases together (single edit to
# test/settings-route.ts):
Task: "Disabled state when isLocalFirstActive=false"
Task: "Enabled state when isLocalFirstActive=true"
Task: "Reactive transition between states"

# Then implement TS and CSS in parallel:
Task: "Modify src/client/routes/settings.ts (T005-T009)"
Task: "Modify src/client/routes/settings.css (T010)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

This feature IS the MVP. There are no follow-on user stories in
the spec. The implementation strategy is therefore the entire
flow:

1. Phase 1: Setup — no-op.
2. Phase 2: Foundational — no-op.
3. Phase 3: User Story 1 — TDD: write tests, watch them fail,
   implement, watch them pass, lint, then manual quickstart.
4. STOP and VALIDATE — quickstart all four scenarios + edge
   cases.
5. Open the PR with before/after screenshots and a one-line
   summary referencing FR-001 through FR-007.

### Incremental Delivery

Not applicable — single P1 story. The whole branch lands together.

### Parallel Team Strategy

Not applicable — the change is ~25 lines across two files. One
engineer end-to-end.

---

## Notes

- [P] tasks = different files, no dependencies. Within this
  feature, the only meaningful parallelism is "tests in
  `test/settings-route.ts`" vs. "CSS in
  `src/client/routes/settings.css`" vs. "TS in
  `src/client/routes/settings.ts`" — and the TS file's edits are
  internally sequential because they share a single component
  body.
- The feature is scoped to the GLOBAL Cache section. The per-
  feed cache controls in the "Subscribed Feeds" list are
  explicitly out of scope (spec §Assumptions).
- Do NOT add `aria-disabled` — the native `disabled` attribute
  already exposes the disabled state to AT (research.md
  Decision 2).
- Do NOT add `pointer-events: none` on the section root —
  research.md Decision 3 explains why.
- Do NOT modify any CSS outside `.cache-section.is-disabled` (per
  global CLAUDE.md: "NEVER change CSS that is not related to the
  task you are working on").
- Verify tests fail BEFORE implementing (T004). This is the
  RED-GREEN-REFACTOR discipline — skipping the failing step
  means the tests might be vacuously passing.
- Commit after T004 (failing tests in place), then after T011
  (passing tests + implementation), then after T013 (manual
  verification recorded). Three small commits beat one giant
  one if review feedback comes in.
