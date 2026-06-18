# Sync Status Detail (`/sync-status`) — Phase 4

**Goal:** Render the "Blocked local changes" list (dead-lettered ops) with a
Retry action that fires immediately and a Discard action gated by an inline
confirmation, plus focus restoration and a single batched live-region
announcement on each action.

**Codebase verified:** 2026-06-18 (via codebase-investigator).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### sync-status-detail.AC2: Blocked local changes are listed (rendering)
- **sync-status-detail.AC2.1 Success:** Each `dead_letter_outbox` row appears as
  a row in the "Blocked local changes" section.
- **sync-status-detail.AC2.2 Success:** A row shows the op description, attempt
  count, and last error.
- **sync-status-detail.AC2.3 Edge:** With no dead-letter rows, the section is
  omitted.

### sync-status-detail.AC4: Blocked changes can be retried or discarded (view)
- **sync-status-detail.AC4.2 Success:** Retry removes the row from view and
  decrements the dead-letter count signal.
  *(The DB/signal half of AC4 is Phase 2; this phase wires the buttons to the
  Phase 2 methods and confirms the row clears from view.)*

### sync-status-detail.AC8: Inline confirmation for destructive actions
- **sync-status-detail.AC8.1 Success:** Clicking Discard reveals an inline
  confirm; the row is not removed yet.
- **sync-status-detail.AC8.2 Success:** Confirming commits the discard;
  cancelling restores the row.
- **sync-status-detail.AC8.4 Success:** Non-destructive actions (Retry) act
  immediately with no confirm step.
  *(AC8.3, Unsubscribe inline confirm, is Phase 5 — it reuses this machine.)*

### sync-status-detail.AC9: Accessibility of live updates
- **sync-status-detail.AC9.1 Success:** A persistent `role="status"`
  `aria-live="polite"` region exists and is present before content is injected.
- **sync-status-detail.AC9.2 Success:** Action outcomes announce via a single
  batched message, not per row.
- **sync-status-detail.AC9.3 Success:** When a row is removed, focus moves to the
  next actionable element (or the section heading if the list is now empty).

---

## Verified codebase facts (read before implementing)

- Phase 1 `describeOp(row:DeadLetterRow):string` lives in
  `src/client/routes/sync-status-format.ts` (pure, payload-derived).
- Phase 2 methods: `State.retryDeadLetter(state, id:number)` (immediate; kicks
  `runSync`; decrements `syncDeadLetters`) and
  `State.discardDeadLetter(state, id:number)` (local-only; decrements count).
- The route already (Phase 3): reloads via `loadSyncStatus` on a
  `[syncDeadLetters.value]` `useEffect`, so a successful Retry/Discard makes the
  row leave the list reactively (no manual list splice needed for the data).
- Page signals (`sync-status-state.ts`): `deadLetters`, `failedFeeds`,
  `loading`. Phase 4 adds the confirm + announcement state here.
- Buttons vs links: the project rule "links not buttons" applies to
  **navigation** only. Retry / Discard / Confirm / Cancel are actions, so they
  are `<button>` elements (correct). (The re-auth affordance in Phase 5 is
  navigation → `<a href>`.)
- Component test conventions: `@substrate-system/tapzero`, `preact` `render` +
  `htm/preact`, `mountRoot()`/`waitFor()`/`nextTask()`, seed via `batch()`, stub
  `State.method`s by reassigning them on `State`, assert roles/classes/structure
  and dynamic data (never static copy), clean up in `finally`. Browser tests
  imported in `test/browser-tests.ts`.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Confirm + announcement state

**Verifies:** (supporting infra for AC8 / AC9; asserted in Tasks 2-3)

**Files:**
- Modify: `src/client/routes/sync-status-state.ts`

**Implementation:**
Add page-local signals (the confirm machine is shared with Phase 5's
Unsubscribe, so key it generically):
- `confirmingKey = signal<string|null>(null)` — the key of the row whose
  destructive action is awaiting confirmation. Use a namespaced key so the
  dead-letter id space and the feed id space never collide, e.g.
  `'dl:<id>'` (Phase 4) and `'feed:<id>'` (Phase 5).
- `announcement = signal<string>('')` — the text rendered in the persistent live
  region; written once per action (in a `batch()` with any other signal writes)
  to satisfy AC9.2 (single message, not per row).

Keep lines <= 80 cols.

**Testing:** none standalone (exercised in Tasks 2-3).

**Verification:** `npm run lint`; type-checks.

**Commit:** `feat: add inline-confirm + announcement state for sync-status`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Blocked-changes list rendering

**Verifies:** sync-status-detail.AC2.1, sync-status-detail.AC2.2,
sync-status-detail.AC2.3

**Files:**
- Modify: `src/client/routes/sync-status.ts` (render the section)
- Modify: `src/client/routes/sync-status.css` (section + row styles)
- Test: `test/sync-status-route.ts` (extend) or a new `test/sync-status-blocked.ts`
  wired into `test/browser-tests.ts`

**Implementation:**
- Render a "Blocked local changes" section ONLY when
  `deadLetters.value.length > 0` (AC2.3 omits it otherwise). Give the section a
  stable hook (e.g. `class="sync-status-section blocked-changes"`) and a heading
  (`<h2>`) that can receive focus (`tabindex="-1"`) for AC9.3.
- Render a list; each row (stable hook e.g. `class="blocked-change"`,
  `key=${row.client_op_id}`) shows:
  - the op description via `describeOp(row)` in a description element,
  - the attempt count (`row.attempts`) in its own element,
  - the last error (`row.last_error`) in its own element,
  - an actions area (buttons wired in Task 3).
- CSS: nest under `.route.sync-status { & .blocked-changes { ... } & .blocked-change
  { ... } }`. Hard-code spacing per `updates.css`; reuse `--color-warning` /
  `--color-border` / `--color-surface`. No new colors.

**Testing (browser):**
- sync-status-detail.AC2.1: seed `deadLetters` with N rows → exactly N
  `.blocked-change` elements render.
- sync-status-detail.AC2.2: a row contains a description element (non-empty,
  from `describeOp`), an attempt-count element reflecting `row.attempts`, and a
  last-error element reflecting `row.last_error` (assert the dynamic values are
  present — not static copy).
- sync-status-detail.AC2.3: `deadLetters=[]` → no `.blocked-changes` section.

**Verification:** `npm run test:browser`; `npm run lint`.

**Commit:** `feat: render blocked local changes list on /sync-status`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Retry/Discard actions, inline confirm, focus + announcements

**Verifies:** sync-status-detail.AC4.2, sync-status-detail.AC8.1,
sync-status-detail.AC8.2, sync-status-detail.AC8.4, sync-status-detail.AC9.1,
sync-status-detail.AC9.2, sync-status-detail.AC9.3

**Files:**
- Modify: `src/client/routes/sync-status.ts`
- Modify: `src/client/routes/sync-status.css`
- Test: same blocked-changes browser test file

**Implementation:**
- **Retry** (`<button>`): on click, immediately call
  `State.retryDeadLetter(state, row.id)` (no confirm — AC8.4). After it resolves,
  set `announcement.value` once (in a `batch()` if writing other signals) and
  move focus (see focus rule below). The row leaves the list reactively via the
  Phase 3 `[syncDeadLetters.value]` reload (AC4.2).
- **Discard** (`<button>`): on click, set
  `confirmingKey.value = 'dl:' + row.id` — this only reveals the inline confirm;
  it does NOT call `discardDeadLetter` yet (AC8.1).
- **Inline confirm** (rendered in the row when
  `confirmingKey.value === 'dl:' + row.id`): replace the row's action buttons
  with an "are you sure?" prompt containing:
  - a **Cancel** `<button>` that is focused on reveal (default focus) — on click
    sets `confirmingKey.value = null`, restoring the row's normal actions
    (AC8.2, cancel path). Focus it via an element ref + `useEffect`/callback ref.
  - a danger-styled **commit** `<button>` (`--color-error`) — on click calls
    `State.discardDeadLetter(state, row.id)`, then sets `confirmingKey.value =
    null`, announces once, and moves focus (AC8.2, confirm path).
- **Focus rule (AC9.3):** after a Retry or a committed Discard removes a row,
  move focus to the next actionable element — the next remaining row's first
  action button — or, if the list is now empty, the section heading
  (`<h2 tabindex="-1">`). Implement with element refs keyed by row, computing the
  successor after the post-action render (e.g. a `useEffect` keyed on the row
  count, or `requestAnimationFrame`). Do not leave focus on a detached node.
- **Announcement (AC9.2):** write `announcement.value` exactly once per action
  (a single batched message such as "Change retried." / "Change discarded."),
  rendered by the persistent `role="status" aria-live="polite"` region from the
  Phase 3 shell — never one announcement element per row.

**Testing (browser):**
Stub `State.retryDeadLetter` / `State.discardDeadLetter` (reassign on `State`)
to record calls and simulate the resulting signal change (decrement
`syncDeadLetters`, update `deadLetters`) so the reactive reload + focus path
runs. Verify:
- sync-status-detail.AC8.4: clicking Retry calls `State.retryDeadLetter` with the
  row id immediately; no inline-confirm element appears.
- sync-status-detail.AC8.1: clicking Discard renders the inline-confirm element
  in that row; `State.discardDeadLetter` is NOT called; the row is still
  present.
- sync-status-detail.AC8.2: from the confirm, clicking Cancel removes the confirm
  element and restores the normal actions without calling
  `discardDeadLetter`; clicking the danger commit calls
  `State.discardDeadLetter(state, row.id)`.
- sync-status-detail.AC4.2: after a stubbed Retry resolves (count decremented,
  list updated), the row is gone from the rendered list.
- sync-status-detail.AC9.1: the `role="status" aria-live="polite"` region is
  present on first render, before any action (no rows needed).
- sync-status-detail.AC9.2: after an action, the live region's text is set once
  (a single announcement node updates; there is not one announcement per row).
- sync-status-detail.AC9.3: with 2 seeded rows, committing the first row's
  action moves `document.activeElement` to the next row's first action button;
  with 1 row, the same action moves focus to the section heading.

Use `waitFor`/`nextTask` for renders; clean up + reset signals + restore stubbed
`State` methods in `finally`.

**Verification:** `npm run test:browser`; `npm run lint`.

**Commit:** `feat: wire retry/discard + inline confirm + a11y on /sync-status`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

---

**Done when:** dead-lettered ops render with op description / attempt count /
last error; Retry fires immediately and clears the row; Discard requires an
inline confirm (Cancel default-focused, danger commit); focus restores on row
removal; a single batched announcement fires per action via the persistent live
region. Covers sync-status-detail.AC2 (rendering), AC4.2, AC8.1/8.2/8.4, AC9.
Tests pass; `npm run lint` clean.
