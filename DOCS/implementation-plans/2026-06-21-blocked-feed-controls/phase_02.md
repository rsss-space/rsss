# Phase 2: Sidebar warning circle

**Goal:** Render a static yellow circle (no spin) next to a feed in the sidebar
when it has blocked ops or is in the failed-fetch state, accessibly, while
preserving the spinner for genuinely-resolving feeds.

**Dependencies:** Phase 1 (`feedRowState`, `state.blockedOpsForFeed`).

> Read the "Project conventions" and "How tests run" sections in
> `phase_01.md` before starting. They apply to this phase too.

---

## Acceptance Criteria Coverage

### blocked-feed-controls.AC1: Sidebar shows a warning circle for blocked/failed feeds
- **blocked-feed-controls.AC1.1 Success:** A feed with one or more mapped blocked
  ops renders a static yellow circle (no spin animation) in place of the spinner.
- **blocked-feed-controls.AC1.2 Success:** A failed-fetch feed
  (`last_fetched === null && last_error`) renders the same static yellow circle
  and keeps its existing "Failed to fetch" label and retry button.
- **blocked-feed-controls.AC1.3 Success:** A genuinely-resolving feed
  (`last_fetched === null`, no error, no blocked op) still renders the blue
  spinner.
- **blocked-feed-controls.AC1.6 Accessibility:** The circle is exposed to
  assistive tech via a non-color cue (`role="img"` + label / visually-hidden
  text), is not focusable, and does not use `role="status"`.

---

## Verified codebase facts (Phase 2)

- `src/client/components/feed-nav.ts` is an `htm/preact` `FunctionComponent`
  (`import { html } from 'htm/preact/index.js'`). It imports `type Feed`,
  `type AppState`, `State`, `stripProtocol` from `../state.js`.
- The resolving spinner is rendered at `feed-nav.ts:189-195`:
  ```ts
  ${isResolving && html`
      <span
          class="feed-spinner"
          aria-label="Resolving feed"
          role="status"
      ></span>
  `}
  ```
  with `isResolving = feed.last_fetched === null && !feed.last_error`
  (line 169-171) and `hasFailed = feed.last_fetched === null &&
  !!feed.last_error` (line 172-174). `stateClass` (line 175-177) adds
  `' failed'` / `' resolving'` to the row class.
- The "Failed to fetch" label is `<span class="feed-failed-label">` (line
  202-206) and the retry button is `<button class="btn-retry" onClick=${() =>
  State.retryResolveFeed(state, String(feed.id))}>` inside a `<tool-tip>` (line
  208-228), both gated on `hasFailed`.
- `src/client/components/sidebar.css` defines `.feed-spinner` nested under
  `.feeds-list .feed-item` (lines 55-64): `display:inline-block;
  width:0.875rem; height:0.875rem; flex-shrink:0; border:2px solid
  var(--color-border); border-top-color:var(--color-primary);
  border-radius:50%; animation:spin 0.8s linear infinite;`. The file uses
  nested `& .child { }` selectors.
- `--color-warning: #b45309` is defined in `src/client/_variables.css:14`.
- A global `.visually-hidden` utility already exists: it ships from
  `@substrate-system/a11y`, imported in `src/client/style.css:2`, and is already
  used (`components/item-row.ts`, `routes/item-reader.ts`). Reuse it; do not
  redefine it.
- Existing render test `test/feed-nav.ts` mounts `FeedNav` via
  `render(html\`<${FeedNav} state=${state} />\`, root)` with a `makeState(feeds)`
  fake. That fake does NOT currently provide `blockedOpsForFeed`; since `FeedNav`
  will call `state.blockedOpsForFeed(feed.id)` after this phase, the fake must be
  updated (Task 3) or `FeedNav` will throw in those tests.

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: `.feed-warning-dot` CSS

**Verifies:** blocked-feed-controls.AC1.1, AC1.2 (visual cue)

**Files:**
- Modify: `src/client/components/sidebar.css`

**Implementation:**

Add a `.feed-warning-dot` rule nested under `.feeds-list .feed-item`, as a
sibling of `.feed-spinner`. Same box metrics as the spinner so layout does not
shift, solid `--color-warning` fill, NO animation:

```css
& .feed-warning-dot {
    display: inline-block;
    width: 0.875rem;
    height: 0.875rem;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--color-warning);
}
```

Do not change the `.feed-spinner` rule or any unrelated CSS. Reuse the existing
`--color-warning` variable; do not add a new color.

**Verification:**
Run: `npm run lint` — clean.
(The visual/structural assertion lands in Task 2's test.)

**Commit:** `style: add static feed-warning-dot to the sidebar`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Render the indicator via `feedRowState` (failing test first)

**Verifies:** blocked-feed-controls.AC1.1, AC1.2, AC1.3, AC1.6

**Files:**
- Create: `test/feed-nav-warning.ts` (component render test)
- Modify: `src/client/components/feed-nav.ts`

**Step 1: Write the failing test**

Create `test/feed-nav-warning.ts`, modeled on `test/feed-nav.ts`
(`render(html\`<${FeedNav} state=${state} />\`, root)` + `querySelector`). Build
a `makeState(feeds, blockedByFeed)` helper whose fake `AppState` includes
`blockedOpsForFeed: (id) => blockedByFeed[id] ?? []` plus the signals `FeedNav`
reads (`feeds`, `feedsLoading`, `feedsError`, `route`, `counts`,
`feedUpdateCounts`, `_setRoute`). Provide a `feed(id, overrides)` factory like
`test/feed-nav.ts`.

Assert STRUCTURE only (roles/elements/classes — never rendered text):
- AC1.1 (blocked): a feed with a non-empty `blockedOpsForFeed(id)` renders
  `root.querySelector('.feed-warning-dot')` present and
  `root.querySelector('.feed-spinner')` null for that row.
- AC1.2 (failed): a feed with `last_fetched: null`, `last_error: 'boom'`, no
  blocked ops renders `.feed-warning-dot` present, AND still renders
  `.feed-failed-label` and `.btn-retry` (existing label + retry preserved).
- AC1.3 (resolving): a feed with `last_fetched: null`, `last_error: null`, no
  blocked ops renders `.feed-spinner` present and `.feed-warning-dot` null.
- clean: a feed with `last_fetched` set, no error, no blocked ops renders
  neither `.feed-spinner` nor `.feed-warning-dot`.
- AC1.6 (a11y): the `.feed-warning-dot` element has `getAttribute('role') ===
  'img'`, a non-empty `aria-label`, does NOT have `role="status"`, and is not
  focusable (no `tabindex`, and `el.tabIndex === -1` for a `<span>`). Assert it
  contains a `.visually-hidden` child.

Register: add `import './feed-nav-warning.js'` to `test/browser-tests.ts`.

Run `npm run test:browser`; confirm the new assertions FAIL (the dot is not
rendered yet). Note: existing `test/feed-nav.ts` will ALSO start failing once
Task 2's component edit lands if its `makeState` lacks `blockedOpsForFeed` — fix
that in Task 3.

**Step 2: Implement the indicator selection in `feed-nav.ts`**

- Add `import { feedRowState } from '../blocked-ops.js'`.
- Inside the `feeds.value.map(feed => { ... })` body, replace the current
  `isResolving` / `hasFailed` derivations with `feedRowState`:

  ```ts
  const blockedOps = state.blockedOpsForFeed(feed.id)
  const rowState = feedRowState(feed, blockedOps)
  const isResolving = rowState === 'resolving'
  const hasFailed = rowState === 'failed'
  const isBlocked = rowState === 'blocked'
  ```

  Keep `stateClass` deriving `' failed'`/`' resolving'` from `hasFailed`/
  `isResolving` as before (a blocked row needs no extra row class; the dot is
  the cue).
- Keep the existing spinner block gated on `isResolving` (unchanged).
- Add the warning dot, rendered when `isBlocked || hasFailed`, as a sibling of
  the spinner. Use `role="img"`, an `aria-label`, and a `.visually-hidden`
  child; do NOT use `role="status"`:

  ```ts
  ${(isBlocked || hasFailed) && html`
      <span
          class="feed-warning-dot"
          role="img"
          aria-label=${isBlocked ? 'Blocked' : 'Failed to fetch'}
      >
          <span class="visually-hidden">
              ${isBlocked ? 'Blocked' : 'Failed to fetch'}
          </span>
      </span>
  `}
  ```

- Leave the "Failed to fetch" label + retry button gated on `hasFailed`
  unchanged. Because `feedRowState` returns `'blocked'` (not `'failed'`) when a
  feed is both blocked and failed, a blocked+failed feed shows the dot labeled
  "Blocked" and no sidebar retry — its controls live on the feed page (Phase 4),
  consistent with the design's precedence.

**Step 3: Run the test; confirm Task 2 assertions PASS**

Run: `npm run test:browser` — the `feed-nav-warning` assertions pass.
(`test/feed-nav.ts` may still fail until Task 3.)

**Step 4: Commit**

```bash
git add test/feed-nav-warning.ts src/client/components/feed-nav.ts \
    test/browser-tests.ts
git commit -m "feat: sidebar warning circle for blocked and failed feeds"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Keep the existing feed-nav test green

**Verifies:** regression safety for AC1.3 and existing sidebar behavior

**Files:**
- Modify: `test/feed-nav.ts`

**Implementation:**

`FeedNav` now calls `state.blockedOpsForFeed(feed.id)`. Update `makeState` in
`test/feed-nav.ts` so its fake `AppState` provides
`blockedOpsForFeed: () => []` (no blocked ops by default). This is the only
change needed; the existing assertions are unaffected.

**Verification:**
Run: `npm run test:browser`
Expected: `test/feed-nav.ts` and `test/feed-nav-warning.ts` both pass.
Run: `npm run lint` — clean.

**Commit:** `test: feed-nav fake state provides blockedOpsForFeed`
<!-- END_TASK_3 -->

## Phase 2 done when

- `npm test && npm run lint` pass clean (no `console.error`).
- Structural tests confirm: blocked/failed feeds render `.feed-warning-dot`
  (and not `.feed-spinner`); resolving feeds render `.feed-spinner` (and not the
  dot); clean feeds render neither; the dot exposes `role="img"` + `aria-label`
  + `.visually-hidden` text and is not a `role="status"` live region.
- The failed-fetch row keeps its "Failed to fetch" label and retry button.
