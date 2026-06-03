---
description: "Task list for 031-animate-cache-settings"
---

# Tasks: Animate Cache Settings Disclosure

**Input**: Design documents from `/specs/031-animate-cache-settings/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/cache-settings-disclosure.md, quickstart.md

**Tests**: INCLUDED. The plan (Technical Context) and the UI contract
(`contracts/cache-settings-disclosure.md` "Test mapping") explicitly
require `test/settings-route.ts` updates, so test tasks are part of this
list. They are DOM-structure assertions (no HTML text-content tests), per
the project test rules.

**Organization**: Tasks are grouped by user story. Note the reality of
this feature: a single `@substrate-system/details-summary` web component
animates BOTH open and close directions, so the foundational structural
conversion (Phase 2) delivers US1 and US2 simultaneously. US1/US2 phases
are therefore independent verification + targeted tests; US3 (reduced
motion) is genuinely separable work layered on top.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All paths are relative to repository root

## Path Conventions

This feature is client-only. Files touched:

- `src/client/routes/settings.ts` — the "Subscribed Feeds" disclosure
- `src/client/routes/settings.css` — its scoped styles
- `test/settings-route.ts` — DOM-structure tests

Reference (do NOT modify): `src/client/components/cache-settings.ts`
(the working feed-reader pattern to mirror) and
`test/feed-reader-cache-disclosure.ts` (the test shape to mirror).

---

## Phase 1: Setup

**Purpose**: Make the already-present web component usable in the route.

- [ ] T001 Add `import { DetailsSummary } from '@substrate-system/details-summary'`
  to `src/client/routes/settings.ts` (near the existing
  `@substrate-system/check-box` import). Confirm no install is needed:
  the dependency already ships and its CSS is already imported globally
  via `src/client/style.css` (`@import url("@substrate-system/details-summary/css")`).
  Do NOT add a new dependency and do NOT modify `src/client/style.css`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The structural conversion every user story rides on. Once
this phase is complete the disclosure animates open and close; only the
reduced-motion accommodation (US3) remains.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 Convert the per-feed disclosure markup in
  `src/client/routes/settings.ts` (the "Subscribed Feeds" list, the
  `<details class="feed-cache-controls">` block ~lines 779–876) to the
  `@substrate-system/details-summary` web component, mirroring
  `src/client/components/cache-settings.ts` (lines 238–326):
  - Host: `<${DetailsSummary.TAG} class="feed-cache-controls"
    key=${feed.id} duration="200">` with the `is-disabled` class still
    appended when `cacheDisabled.value`.
  - Inner: a native `<details>` containing
    `<summary>Cache settings</summary>` and a new
    `<div class="details-content">` that wraps BOTH the existing
    `.feed-cache-form` and the `.btn-clear-cache` button (matching the
    contract DOM shape).
  - Preserve disabled semantics exactly: keep `is-disabled` on the host,
    keep `aria-disabled="true"` + `tabindex="-1"` on the `<summary>` and
    the click `preventDefault` when `cacheDisabled.value`, and force the
    inner `<details>` `open=false` when `cacheDisabled.value` (so an open
    panel collapses if caching is disabled).
  - Do NOT change which controls render, their `name`s, values, options
    (`""`, `text`, `text_images`), or their change handlers
    (`handleFeedCacheModeChange`, `handleFeedMaxSizeChange`,
    `handleFeedMaxAgeChange`, `handleClearFeedCache`) — FR-010.

- [ ] T003 Scope the disclosure's styles in
  `src/client/routes/settings.css` (the existing `.feed-cache-controls`
  rule ~lines 352–369), mirroring `src/client/routes/feed-reader.css`
  lines 60–69: add `--details-summary-padding: 0`,
  `--details-summary-font-weight: 400`, `--details-summary-font-size:
  1rem`, `--details-summary-content-color: var(--color-text)`, and
  `--details-summary-transition-speed: 0.2s`; set `border-bottom: none`
  on the host to neutralize the package's default border so the
  Subscribed-Feeds card appearance is unchanged (FR-010); and add
  `pointer-events: none` to the disabled summary (under
  `&.is-disabled & summary`) so neither click nor keyboard can toggle a
  disabled disclosure. Use existing color variables; change ONLY rules
  related to this disclosure.

- [ ] T004 Retarget the disabled-state regression tests in
  `test/settings-route.ts` to the web-component shape (contract C9/C10),
  mirroring `test/feed-reader-cache-disclosure.ts`: in the three "027"
  tests ("per-feed cache control is disabled…", "…is enabled…",
  "…toggles disabled state when isLocalFirstActive flips") replace the
  selector `.settings-feed-item details.feed-cache-controls` with the
  host `.settings-feed-item .feed-cache-controls` (now a
  `<details-summary>`) and reach the inner native details via
  `.feed-cache-controls details` for the `.open` assertions. Keep the
  `is-disabled` / `aria-disabled` / `tabindex` assertions (now host +
  inner summary) and keep the "updates in place (same element instance)"
  assertion against the host.

**Checkpoint**: `npm test` and `npm run lint` pass; the Subscribed-Feeds
disclosure now animates open and close in a browser, disabled semantics
preserved. US1 + US2 behavior is delivered.

---

## Phase 3: User Story 1 - Expanding animates smoothly (Priority: P1) 🎯 MVP

**Goal**: Opening a feed's "Cache settings" grows the panel open over a
short, smooth height transition instead of jumping.

**Independent Test**: On Settings, click "Cache settings" on a feed and
watch the panel grow open (~200 ms) with no single-frame jump or flicker;
controls fully visible and usable when it settles.

> Animation is delivered by the shared web component from Phase 2; this
> phase verifies the open behavior independently and locks the host shape
> + duration in a test.

- [ ] T005 [US1] Update the "Per-feed details element contains cache
  controls" test in `test/settings-route.ts` to the web-component shape
  (contract C1, C4), mirroring `test/feed-reader-cache-disclosure.ts`:
  assert the `.feed-cache-controls` host is a `<details-summary>`, that a
  single inner `<details>` exists via `.feed-cache-controls details`,
  that a `.details-content` wrapper is present, and that the cache-mode
  `select`, `feed-max-size-<id>` / `feed-max-age-<id>` inputs, and
  `.btn-clear-cache` button are present inside it (DOM presence, not text
  content). Add an assertion that the host's `duration` attribute is
  `"200"` (non-reduced default).

- [ ] T006 [US1] Manually verify in a real browser per `quickstart.md`
  §1: with a subscribed feed and caching active, click "Cache settings"
  and confirm the panel grows open over a smooth ~200 ms height
  transition (no jump, flicker, or overshoot) and all controls are
  visible and interactive at the end (FR-001, FR-003, FR-005; SC-001,
  SC-002, SC-003).

**Checkpoint**: Open animation verified and test-locked — MVP delivered.

---

## Phase 4: User Story 2 - Collapsing animates smoothly (Priority: P2)

**Goal**: Closing the disclosure shrinks the panel closed with the same
smooth motion.

**Independent Test**: With a feed's cache settings expanded, activate the
disclosure again and watch it shrink closed, mirroring the open motion;
only the summary remains and the card returns to collapsed height.

> The close direction is the same web component as open; this phase
> verifies it independently. Automated coverage is limited to the inner
> `<details>` collapse (the WAA motion itself is browser-verified).

- [ ] T007 [US2] Add a DOM-structure test in `test/settings-route.ts`
  (contract C2) that toggling the inner `<details>` (reached via
  `.feed-cache-controls details`) open then closed leaves
  `details.open === false`, and that re-rendering the list does not carry
  an `open` attribute over to a fresh disclosure (mirror the
  "no carry-over on feed switch" assertion in
  `test/feed-reader-cache-disclosure.ts`).

- [ ] T008 [US2] Manually verify in a real browser per `quickstart.md`
  §2: with the panel open, activate the disclosure and confirm it shrinks
  closed with the mirrored motion; only the summary row remains and the
  card returns to its collapsed height (FR-002).

**Checkpoint**: Open and close both animate smoothly and symmetrically.

---

## Phase 5: User Story 3 - Motion respects reduced-motion (Priority: P3)

**Goal**: Users who request reduced motion get an instant open/close with
no animation, controls identical to the animated end state.

**Independent Test**: With OS "reduce motion" (or DevTools
emulation) enabled, open/close a disclosure and confirm it toggles
instantly with no animation; controls fully usable.

- [ ] T009 [US3] In `src/client/routes/settings.ts`, add a
  `prefersReducedMotion` state + a `matchMedia('(prefers-reduced-motion:
  reduce)')` effect to the SettingsRoute component, copied from
  `src/client/components/cache-settings.ts` (the `useState` at line 38
  and the `useEffect` at lines 62–73), and change the host attribute from
  `duration="200"` to `duration=${prefersReducedMotion ? '0' : '200'}`
  (contract C5). Mind ≤80 columns and the no-space-before-colon type
  style.

- [ ] T010 [US3] In `src/client/routes/settings.css`, add a
  `@media (prefers-reduced-motion: reduce)` rule scoped to
  `.feed-cache-controls .details-content` that sets `transition: none`
  and neutralizes the package's translate offset, so the content fade is
  also skipped (not just the height), fully meeting SC-004. Change ONLY
  rules related to this disclosure.

- [ ] T011 [US3] Add a test in `test/settings-route.ts` (contract C4/C5)
  that mocks `window.matchMedia` so
  `'(prefers-reduced-motion: reduce)'` matches, mounts the route, and
  asserts the `.feed-cache-controls` host `duration` attribute is `"0"`;
  and that with reduced motion NOT matching the attribute is `"200"`.
  Restore the original `window.matchMedia` in the test's `finally`.

- [ ] T012 [US3] Manually verify in a real browser per `quickstart.md`
  §3: with OS reduce-motion (or DevTools "Emulate CSS
  prefers-reduced-motion: reduce") enabled, open and close the disclosure
  and confirm it appears/disappears instantly with no animation, controls
  fully usable (FR-006, SC-004).

**Checkpoint**: All three user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T013 [P] Run `npm test` and confirm the full suite passes,
  including the updated `test/settings-route.ts` assertions.
- [ ] T014 [P] Run `npm run lint` and confirm no violations (≤80 cols,
  no space before type-annotation colon, CSS colors from variables, font
  sizes ≥ 1rem).
- [ ] T015 Browser regression pass per `quickstart.md` §4, §5, §7:
  rapid toggling resolves to the final action with no stuck/clipped state
  (FR-008, SC-005); opening one feed's disclosure does not animate or
  shift others (FR-009); a disabled/greyed disclosure does nothing on
  click and collapses if it was open (edge case); and the card
  appearance, controls, values, and behavior are unchanged from before
  (FR-010, SC-006).
- [ ] T016 Keyboard / a11y verification per `quickstart.md` §6: Tab to a
  feed's "Cache settings" summary, press Enter/Space, confirm the same
  smooth animation runs and the expand/collapse state is announced via
  the component's visually-hidden label (FR-007).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories.
  T002 (markup) before T003 (CSS scoping) and T004 (test retarget); T004
  passes only once T002 lands.
- **User Stories (Phase 3–5)**: All depend on Foundational completion.
  US1 and US2 are delivered by Phase 2 and only verify/test afterward;
  they can run in either order. US3 adds new code and is independent of
  US1/US2.
- **Polish (Phase 6)**: After all desired stories are complete.

### Within / across stories

- T009 and T002 both edit `src/client/routes/settings.ts` — sequential
  (T009 after T002).
- T003 and T010 both edit `src/client/routes/settings.css` — sequential
  (T010 after T003).
- T004, T005, T007, T011 all edit `test/settings-route.ts` — sequential
  among themselves (same file).

### Parallel Opportunities

- T013 and T014 (test vs lint) are independent — `[P]`.
- The manual verification tasks (T006, T008, T012, T015, T016) can be
  batched into a single browser session once the code lands.

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup (T001).
2. Phase 2: Foundational (T002–T004) — delivers open + close animation.
3. Phase 3: US1 (T005–T006) — verify and lock the open animation.
4. **STOP and VALIDATE**: open animates smoothly; suite green.

### Incremental Delivery

1. Setup + Foundational → disclosure animates, disabled semantics intact.
2. US1 → open verified + test-locked (MVP).
3. US2 → close verified + test-locked.
4. US3 → reduced-motion honored + test-locked.
5. Polish → full test/lint + browser regression + a11y.

---

## Notes

- The feature is presentation-only: no SQLite (local or DO) schema, no
  `/api/sync` payload, no localStorage, no new dependency (data-model.md).
- Reuse over reinvention: the same web component already animates the
  feed-reader cache disclosure (`components/cache-settings.ts`); this work
  brings the Settings disclosure onto that one mechanism.
- Do not modify `components/cache-settings.ts`, `src/client/style.css`, or
  any CSS unrelated to `.feed-cache-controls`.
- Commit after each task or logical group.
