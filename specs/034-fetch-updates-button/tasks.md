---
description: "Task list for Fetch Updates Button"
---

# Tasks: Fetch Updates Button

**Input**: Design documents from `/specs/034-fetch-updates-button/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/fetch-updates-button.md, quickstart.md

**Tests**: INCLUDED. The spec's success criteria are behavioral
(SC-001..SC-005) and research.md + quickstart.md explicitly define a
component-test approach using the existing `@substrate-system/tapzero` +
`preact` `render()` harness. Tests assert behavior (presence/absence,
one POST per click, re-entrancy) — not brittle HTML text — with a single
accessible-name check justified by FR-008's exact-label requirement.

**Organization**: Tasks are grouped by user story. US1 is the MVP (the
button appears and fetching works); US2 refines it (busy feedback +
DOM-level re-entrancy).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete deps)
- **[Story]**: US1 or US2 (Setup/Foundational/Polish carry no story label)
- Exact file paths are included in every task

## Path Conventions

This is a web app (Cloudflare Worker server + Preact client). The change
is client-only, under `src/client/` with tests under `test/` at the
repository root, per plan.md "Project Structure".

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Orient against the existing reuse surface. No project
initialization is needed — the build, lint, and test infra already exist
(`npm test && npm run lint`).

- [X] T001 Confirm the reuse surface this feature binds to, without
  changing code: the shared `Button` (`src/client/components/button.ts`)
  exposes `onClick`, `className`, and `isSpinning:Signal<boolean>`
  (sets `disabled` + `aria-busy`); `State.refreshFeeds(state)` and the
  `refreshInProgress` / `displayedFeedSyncStatus` signals exist on
  `AppState` (`src/client/state.ts`); and `SidebarFooter`
  (`src/client/components/sidebar-footer.ts`) is the existing
  `onClick=${() => State.refreshFeeds(state)}` +
  `isSpinning=${refreshInProgress}` pattern to mirror.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Introduce the layout container both stories build on, so the
button has a slot that sits outside the `role="status"` live region
(Decision 4). No button is rendered yet.

**⚠️ CRITICAL**: Both user stories depend on this phase.

- [X] T002 In `src/client/components/feed-status.ts`, refactor the
  non-error `return` so the existing `role="status"` `aria-live="polite"`
  span (keep its `key=${status}` and `aria-label`) is wrapped in a new
  `<span class="feed-status-wrap">` container, with an empty sibling slot
  after the status span for the button. Add the imports the later tasks
  need: `import { Button } from './button.js'` and
  `import { State } from '../state.js'` (extend the existing
  `type { AppState }` import). Do not change the `status === 'error'`
  branch or the live-region markup. Keep lines ≤80 cols.
- [X] T003 [P] In `src/client/components/feed-status.css`, add a
  `.feed-status-wrap` rule with `display: inline-flex; align-items:
  center; gap: 0.5rem;`. Do not modify the existing `.feed-status` rule
  or the existing `@media (680px <= width < 1000px)` block. Lines ≤80
  cols.

**Checkpoint**: `.feed-status-wrap` exists and wraps the live region; no
visible change yet. `npm run lint` is clean.

---

## Phase 3: User Story 1 - Fetch updates from the header indicator (Priority: P1) 🎯 MVP

**Goal**: Render a "fetch updates" button immediately to the right of the
"N updates" text whenever updates are available; clicking it triggers the
same `State.refreshFeeds` action as the sidebar "Refresh Feeds" control.

**Independent Test**: Put the app in the `'updates'` state (indicator
shows "N updates"). A button labeled exactly "fetch updates" is visible to
the right of the text; it is absent for `synced`/`syncing`/`error`/
`inactive`; clicking it dispatches exactly one `POST /api/feeds/refresh`.

### Tests for User Story 1 (write first; expect FAIL before T006/T007)

- [X] T004 [P] [US1] In `test/feed-status.ts`, add presence/absence +
  accessible-name cases via the existing `feedStatusState` /
  `renderFeedStatus` helpers: the button (queried as
  `root.querySelector('.fetch-updates-btn')` or by accessible name) is
  present when `feedSyncStatus='updates'` with `feedUpdateCounts={1:1}`
  (singular, FR-004) and with a multi-feed count (plural, FR-001); is
  absent for `synced`, `error`, and `inactive`; and is absent when
  `refreshInProgress=true` makes `displayedFeedSyncStatus` resolve to
  `'syncing'` (FR-002). Assert the button's accessible name equals
  exactly `"fetch updates"` (FR-008) — the only DOM-text assertion this
  feature adds.
- [X] T005 [P] [US1] Create `test/fetch-updates-button.ts` mirroring
  `test/sidebar-footer-refresh.ts` (local `withStubbedFetch` +
  `jsonResponse`, `withStubbedWebSocket` / `StubWebSocket` from
  `./helpers/stub-live-socket.js`, and `_registerRefreshSignalForTest`).
  Mount `<FeedStatus state=${state}/>` with `feedSyncStatus='updates'`
  and `feedUpdateCounts={1:4}`; find the button via `.fetch-updates-btn`;
  dispatch one `MouseEvent('click')`; assert exactly one
  `POST /api/feeds/refresh` is dispatched (SC-003). Stub
  `State.reconcileAfterRefresh` and restore originals in `finally`, as the
  sibling test does.

### Implementation for User Story 1

- [X] T006 [US1] In `src/client/components/feed-status.ts`, render the
  button in the previously-added slot, gated on `status === 'updates'`:
  `${status === 'updates' ? html\`<${Button}
  className="fetch-updates-btn" onClick=${() => State.refreshFeeds(state)}
  >fetch updates<//>\` : ''}`. Label text is exactly "fetch updates" (no
  embedded count). The gate keys off `displayedFeedSyncStatus` (already
  read into `status`), so the button appears/disappears reactively with no
  reload (FR-001, FR-002, FR-004, FR-007, FR-009). Lines ≤80 cols.
  (Depends on T002.)
- [X] T007 [P] [US1] In `src/client/components/feed-status.css`, style
  `.fetch-updates-btn` reusing existing button/`--color-*` variables
  (reuse `--color-primary`; introduce no new color) and add the button
  to the existing responsive rule so it is hidden in the
  `680px <= width < 1000px` range, mirroring `.feed-status-legend`
  (Decision 5). Do not touch unrelated CSS. Lines ≤80 cols.

**Checkpoint**: US1 is independently functional — the button shows only in
`'updates'`, reads "fetch updates", and a click fetches like "Refresh
Feeds". T004 and T005 pass.

---

## Phase 4: User Story 2 - Clear feedback without duplicate fetches (Priority: P2)

**Goal**: A fetch started from "fetch updates" gives the same in-progress
feedback as "Refresh Feeds", and a stray click while any fetch is already
running starts no second fetch.

**Independent Test**: With `refreshInProgress=true`, the button is
`disabled` with `aria-busy="true"`; clicking the button while a fetch
(from either entry point) is in flight dispatches no additional
`POST /api/feeds/refresh`.

### Tests for User Story 2 (write first; expect FAIL before T009)

- [X] T008 [P] [US2] In `test/fetch-updates-button.ts`, add re-entrancy +
  feedback cases: (a) mount in `'updates'` with `refreshInProgress=true`
  and assert the button is `disabled` and `aria-busy="true"` (FR-005);
  (b) with a fetch already in progress (set `refreshInProgress=true`
  before clicking, simulating an in-flight refresh from either entry
  point), dispatch a click and assert zero additional
  `POST /api/feeds/refresh` calls (FR-006, SC-005). Reuse the helpers and
  `finally` restoration established in T005.

### Implementation for User Story 2

- [X] T009 [US2] In `src/client/components/feed-status.ts`, add
  `isSpinning=${state.refreshInProgress}` to the `Button` rendered in
  T006, matching `SidebarFooter`. This gives `disabled` + `aria-busy`
  while a fetch is in flight (FR-005) and DOM-level re-entrancy on top of
  the existing `if (state.refreshInProgress.value) return` guard inside
  `State.refreshFeeds` (FR-006). Lines ≤80 cols. (Depends on T006.)

**Checkpoint**: Both US1 and US2 work; the button reflects busy state and
ignores clicks while a fetch is in progress. T004, T005, and T008 pass.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Verify the feature end-to-end against the spec and the
constitution's browser-verification requirement.

- [X] T010 Run `npm test && npm run lint` and confirm both are clean,
  including the new `test/feed-status.ts` cases and
  `test/fetch-updates-button.ts`.
- [X] T011 Run `npm start` and perform the quickstart.md browser checks:
  drive a feed into the `'updates'` state and confirm the button shows to
  the right of the "N updates" text; click it and confirm it fetches like
  "Refresh Feeds" and the indicator transitions to "updating" then to
  "up to date" / a new count; confirm the button is absent in
  `synced`/`syncing`/`error`; confirm keyboard activation works (SC-004,
  FR-008).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — orientation only.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS both user stories
  (introduces `.feed-status-wrap` + imports).
- **User Story 1 (Phase 3)**: Depends on Foundational. No dependency on
  US2. Delivers the MVP.
- **User Story 2 (Phase 4)**: Depends on Foundational; its implementation
  (T009) augments the `Button` element added in US1's T006, so US2
  implementation follows US1 implementation.
- **Polish (Phase 5)**: Depends on the desired stories being complete.

### Within Each User Story

- Tests are written before implementation and should FAIL first.
- `feed-status.ts` edits (T002 → T006 → T009) touch the same file and are
  strictly sequential.
- `feed-status.css` edits (T003 → T007) touch the same file and are
  sequential.

### Parallel Opportunities

- T003 (CSS) is `[P]` against T002 (component) — different files.
- T004 (`test/feed-status.ts`) and T005 (new `test/fetch-updates-button.ts`)
  are `[P]` — different files, no shared state.
- T007 (CSS) is `[P]` against T006 (component) — different files.
- T008 (US2 test) is `[P]` — isolated to the new test file and
  independent of the US2 implementation it precedes.

---

## Parallel Example: User Story 1

```bash
# US1 tests can be authored in parallel (different files):
Task: "T004 presence/absence + a11y-name cases in test/feed-status.ts"
Task: "T005 click-dispatches-one-POST in test/fetch-updates-button.ts"

# US1 implementation across two files in parallel:
Task: "T006 render gated Button in src/client/components/feed-status.ts"
Task: "T007 .fetch-updates-btn styles + responsive hide in feed-status.css"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup (T001 orientation).
2. Phase 2: Foundational (T002–T003) — container + layout.
3. Phase 3: User Story 1 (T004–T007) — button appears and fetches.
4. STOP and VALIDATE: button shows only in `'updates'`, reads "fetch
   updates", and a click fetches identically to "Refresh Feeds".
5. This is a shippable increment on its own.

### Incremental Delivery

1. Foundational → container ready.
2. US1 → the button appears and works (MVP).
3. US2 → busy feedback + DOM re-entrancy refinement.
4. Polish → full `npm test && npm run lint` + browser verification.

---

## Notes

- `[P]` = different files, no incomplete dependency.
- Reuse only: no new fetch logic, no new state, no server/schema/sync
  change (data-model.md is N/A by design).
- Tests assert behavior, not brittle HTML text; the single
  accessible-name check exists because FR-008 fixes the exact label.
- Do not modify the existing "Refresh Feeds" sidebar control or unrelated
  CSS.
- Constitution: verify UI changes in a browser (T011) before considering
  the feature done.
- Commit after each task or logical group.
