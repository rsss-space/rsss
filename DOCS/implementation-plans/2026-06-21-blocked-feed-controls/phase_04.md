# Phase 4: Feed-page blocked banner

**Goal:** On a feed's page, render a banner above the item list that surfaces
Retry/Discard for blocked ops (Case A) or Retry-only for a failed-fetch feed
(Case B), replacing the "No items" empty state when present.

**Dependencies:** Phase 1 (`state.blockedOpsForFeed`, `feedRowState`), Phase 3
(`State.discardBlockedFeedAdd`).

> Read the "Project conventions" and "How tests run" sections in
> `phase_01.md` before starting. They apply here too.

---

## Acceptance Criteria Coverage

### blocked-feed-controls.AC3: Feed-page banner for blocked-op feeds
- **blocked-feed-controls.AC3.1 Success:** On a feed with blocked ops, a banner
  renders above the item list listing each blocked op with its description,
  attempts, and error.
- **blocked-feed-controls.AC3.2 Success:** Retry on a banner op invokes
  `retryDeadLetter`.
- **blocked-feed-controls.AC3.3 Success:** Discard shows the "Are you sure?"
  confirm prompt before acting.
- **blocked-feed-controls.AC3.4 Success:** When blocked ops exist, the banner
  replaces the "No items" empty state.

### blocked-feed-controls.AC4: Feed-page banner for failed-fetch feeds
- **blocked-feed-controls.AC4.1 Success:** A failed-fetch feed (no blocked ops)
  shows a banner with the fetch error and a Retry control only (no Discard).
- **blocked-feed-controls.AC4.2 Success:** Retry invokes `retryResolveFeed`.
- **blocked-feed-controls.AC4.3 Precedence:** A feed with both a blocked op and
  `last_error` shows the blocked-op banner (Case A), not the failed-fetch banner.

### blocked-feed-controls.AC5
- **blocked-feed-controls.AC5.3 Success:** Discarding a non-`add_feed` op
  (`delete_feed` / `update_item` / `mark_all_read`) removes only that op; the
  feed and items remain and no navigation occurs. *(Banner branch selection:
  `add_feed` -> `discardBlockedFeedAdd`; else -> `discardDeadLetter`.)*

### blocked-feed-controls.AC6
- **blocked-feed-controls.AC6.2:** No `console.error` leaks during the new flows
  (tapout gate); `npm test && npm run lint` pass.

---

## Verified codebase facts (Phase 4)

- `src/client/routes/feed-reader.ts` is an `htm/preact` `FunctionComponent`
  (`{ state, splats }`). `selectedFeed` is the current `Feed|null`, resolved as
  `feeds.value.find(f => stripProtocol(f.url) === feedUrl)` (lines 41-44). The
  item list is a `<ul class="items-list">` (lines 161-185); the empty state is
  `<${EmptyState} ... />` rendered when
  `!itemsLoading.value && items.value.length === 0` (lines 177-184). `State`,
  `type AppState`, `stripProtocol` import from `../state.js`.
- `describeOp(row):string` (`src/client/routes/sync-status-format.ts:4-53`)
  produces a human description for any op type. Reuse it for Case A op rows.
- The inline confirm-prompt pattern on `/sync-status`
  (`routes/sync-status.ts:239-266` and 492-526) uses a "Are you sure? This
  cannot be undone." message with Cancel/commit buttons. The banner owns its
  confirm open/close state LOCALLY (Preact `useState`), per the design — no new
  global signal. NOTE: the `ActionButton` used there is defined LOCALLY in
  `sync-status.ts` (not exported), so the banner does NOT reuse it.
- Buttons: `ButtonPrimary` / `Button` are exported from
  `src/client/components/button.ts` (`{ onClick, class/className, disabled,
  btnRef, children }`; render `<button class="btn ...">`). Use `ButtonPrimary`
  for Retry; a plain `<button type="button" class="btn btn-small">` is fine for
  Discard/Cancel (matching the `article-notice` retry button styling).
- Warning-notice CSS pattern to model the banner on: `.article-notice` and its
  `.article-notice-icon` / `-content` / `-title` / `-body` / `-actions`
  children, plus the `&.info` warning variant
  (`border-left-color: var(--color-warning); background: var(--color-warning-bg)`)
  live in `src/client/routes/item-reader.css:159-246`. The `WarningIcon` SVG is
  in `src/client/components/article-notice.ts:17-24`. The banner gets its OWN
  component + OWN CSS file (`.feed-blocked-banner` classes) modeled on this — do
  NOT reuse the `ArticleNotice` component (it is item-reader-specific:
  `ReaderNotice` type + publisher links).
- `--color-warning` (`#b45309`) and `--color-warning-bg` (`#fffbeb`) exist in
  `src/client/_variables.css` (lines 14-15). Reuse them; no new variable.
- `State` actions available to the banner: `State.retryDeadLetter(state, id)`,
  `State.discardDeadLetter(state, id)`, `State.discardBlockedFeedAdd(state,
  feedId, deadLetterId)` (Phase 3), `State.retryResolveFeed(state,
  String(feedId))`.
- Component render test pattern: `render(html\`<${Comp} .../>\`, root)` +
  `root.querySelector(...)`; for click handlers, call `.click()` on the queried
  button and assert a stubbed action method on the fake `state` was invoked.
  Model: `test/feed-nav.ts`. Action stubs: put plain functions on the fake
  `state` (e.g. `state.retryDeadLetter = (...) => { calls.push(...) }`).

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: `FeedBlockedBanner` component + CSS (failing test first)

**Verifies:** blocked-feed-controls.AC3.1, AC3.2, AC3.3, AC4.1, AC4.2, AC4.3,
AC5.3

**Files:**
- Create: `test/feed-blocked-banner.ts` (component render test)
- Create: `src/client/components/feed-blocked-banner.ts`
- Create: `src/client/components/feed-blocked-banner.css`
- Modify: `src/client/components/article-notice.ts` (export `WarningIcon`)

**Step 1: Write the failing test**

Create `test/feed-blocked-banner.ts`, modeled on `test/feed-nav.ts`. Mount the
banner with `render(html\`<${FeedBlockedBanner} state=${state} feed=${feed}
blockedOps=${ops} />\`, root)`. Build a fake `state` exposing stubbed action
methods that record calls:

```ts
const calls:{ name:string; args:unknown[] }[] = []
const state = {
    retryDeadLetter: (...a:unknown[]) => { calls.push({ name:'retryDeadLetter', args:a }) },
    discardDeadLetter: (...a:unknown[]) => { calls.push({ name:'discardDeadLetter', args:a }) },
    discardBlockedFeedAdd: (...a:unknown[]) => { calls.push({ name:'discardBlockedFeedAdd', args:a }) },
    retryResolveFeed: (...a:unknown[]) => { calls.push({ name:'retryResolveFeed', args:a }) },
} as unknown as AppState
```

Use a `feed(id, overrides)` factory (copy from `test/feed-nav.ts`) and a
`deadLetter(op, overrides)` factory producing a `DeadLetterRow`.

Assert STRUCTURE and ACTION CALLS only (never rendered copy):

Case A (blockedOps non-empty):
- AC3.1: `root.querySelector('.feed-blocked-banner')` present; one op row per
  blocked op (e.g. `root.querySelectorAll('.feed-blocked-op').length === ops.length`);
  each op row contains an attempts element and an error element (assert the
  container elements exist, e.g. `.feed-blocked-op-attempts`,
  `.feed-blocked-op-error`). Do NOT assert their text.
- AC3.2: clicking the Retry button (`.feed-blocked-retry`) for an op invokes
  `state.retryDeadLetter` with that op's `id` (check `calls`).
- AC3.3: clicking Discard (`.feed-blocked-discard`) does NOT immediately call a
  discard action; instead a confirm prompt appears
  (`.feed-blocked-confirm` becomes present). Only after clicking the confirm
  commit button does the discard action fire.
- AC5.3 + AC5.1 branch: after confirming Discard, an `add_feed` op invokes
  `state.discardBlockedFeedAdd(state, feed.id, op.id)`; a non-`add_feed` op
  (e.g. `update_item`) invokes `state.discardDeadLetter(state, op.id)`. Assert
  via `calls`.

Case B (blockedOps empty, failed feed — `last_fetched:null, last_error:'boom'`):
- AC4.1: banner present; a Retry control present
  (`.feed-blocked-retry`); NO discard control (`.feed-blocked-discard` is null).
- AC4.2: clicking Retry invokes `state.retryResolveFeed(state, String(feed.id))`.

AC4.3 precedence:
- a feed with `last_error:'boom'` AND a non-empty `blockedOps` renders Case A
  (a `.feed-blocked-discard` IS present — the Case A marker), proving the
  blocked-op banner wins over the failed-fetch banner.

Register: add `import './feed-blocked-banner.js'` to `test/browser-tests.ts`.

Run `npm run test:browser`; confirm FAIL (component not implemented).

**Step 2: Create CSS**

Create `src/client/components/feed-blocked-banner.css`, modeled on the
`.article-notice` warning variant (`item-reader.css:159-246`) but with the
banner's own class names. Use nested selectors and reuse `--color-warning` /
`--color-warning-bg`. Keep all font sizes >= 1rem. Sketch:

```css
.feed-blocked-banner {
    display: flex;
    gap: 0.875rem;
    align-items: flex-start;
    margin: 0 0 1.5rem;
    padding: 1rem 1.25rem;
    border-radius: 4px;
    border-left: 4px solid var(--color-warning);
    background: var(--color-warning-bg);
    font-size: 1rem;
    line-height: 1.5;

    & .feed-blocked-icon { flex: 0 0 auto; color: var(--color-warning); }
    & .feed-blocked-content { flex: 1; min-width: 0; }
    & .feed-blocked-op { /* spacing between ops */ }
    & .feed-blocked-actions {
        display: flex;
        gap: 0.875rem;
        margin-top: 0.875rem;
        flex-wrap: wrap;
    }
}
```

**Step 3: Create the component**

First, make the existing `WarningIcon` reusable: in
`src/client/components/article-notice.ts`, add the `export` keyword to the
module-private `const WarningIcon:FunctionComponent = function () {...}`
(line 17). This exports just the icon (not the `ArticleNotice` component), so the
banner can share it without duplicating the SVG or coupling to the
item-reader-specific component. Do not change the SVG markup or `ArticleNotice`.

Create `src/client/components/feed-blocked-banner.ts` (`htm/preact`
`FunctionComponent`). Import `html` from `htm/preact`, `useState` from
`preact/hooks`, `type AppState`, `type Feed`, `State` from `../state.js`,
`type DeadLetterRow` from `../db/push-sync.js`, `describeOp` from
`../routes/sync-status-format.js`, `WarningIcon` from `./article-notice.js`, and
`./feed-blocked-banner.css`.

Props: `{ state:AppState; feed:Feed; blockedOps:DeadLetterRow[] }`.

Local confirm state: `const [confirmId, setConfirmId] = useState<number|null>(
null)` (the dead-letter id awaiting confirmation; `null` = none).

Render two cases:

Case A — `blockedOps.length > 0`: a `.feed-blocked-banner` with the warning
icon and a `.feed-blocked-content` listing each op in a `.feed-blocked-op`:
- description: `describeOp(op)`
- attempts in a `.feed-blocked-op-attempts` element (value `op.attempts`)
- error in a `.feed-blocked-op-error` element (value `op.last_error ?? ...`)
- actions `.feed-blocked-actions`:
  - Retry: `<${ButtonPrimary} class="feed-blocked-retry" onClick=${() =>
    State.retryDeadLetter(state, op.id)}>Retry<//>`
  - Discard: when `confirmId !== op.id`, a `<button type="button"
    class="feed-blocked-discard" onClick=${() => setConfirmId(op.id)}>Discard
    </button>`. When `confirmId === op.id`, render a `.feed-blocked-confirm`
    block with the "Are you sure? This cannot be undone." message, a Cancel
    button (`onClick=${() => setConfirmId(null)}`), and a commit button
    (`.feed-blocked-confirm-commit`) whose `onClick` runs the op-type branch
    then clears confirm:

    ```ts
    onClick=${() => {
        if (op.op === 'add_feed') {
            State.discardBlockedFeedAdd(state, feed.id, op.id)
        } else {
            State.discardDeadLetter(state, op.id)
        }
        setConfirmId(null)
    }}
    ```

Case B — `blockedOps.length === 0` (failed-fetch): a single
`.feed-blocked-banner` with the warning icon, the fetch error
(`feed.last_error`), and Retry ONLY:
`<${ButtonPrimary} class="feed-blocked-retry" onClick=${() =>
State.retryResolveFeed(state, String(feed.id))}>Retry<//>`. No Discard control.

(The route, Task 4, only mounts the banner when Case A or Case B applies, so the
component can assume one of the two holds; still, guard defensively: if
`blockedOps.length === 0` and the feed is not failed, render `null`.)

Note: call the action via `state.retryDeadLetter(...)` etc. so the fake-state
stubs in the test are exercised. (`State.foo` and `state.foo` refer to the same
function on the singleton in production; in tests the fake provides its own
`state.foo`, so prefer `state.foo(...)` for the actions that exist on `AppState`
— `retryDeadLetter`, `discardDeadLetter`, `discardBlockedFeedAdd`. For
`retryResolveFeed`, which is a `State.` static not on the `AppState` type, call
`State.retryResolveFeed(state, ...)` and have the test stub
`State.retryResolveFeed`.)

> IMPORTANT consistency check: the banner's actions must match how the test
> stubs them. Decide ONE convention and keep test + component in sync:
> - `retryDeadLetter`, `discardDeadLetter`, `discardBlockedFeedAdd`: these ARE
>   on `AppState` — call as `state.retryDeadLetter(state, id)` and stub on the
>   fake `state`.
> - `retryResolveFeed`: NOT on `AppState` — call as
>   `State.retryResolveFeed(state, String(feed.id))` and, in the test, stub the
>   real `State.retryResolveFeed` (save/restore it) rather than putting it on the
>   fake state.

**Step 4: Run + commit**

Run `npm run test:browser` — `feed-blocked-banner` passes.
Run `npm run lint` — clean.

```bash
git add test/feed-blocked-banner.ts \
    src/client/components/feed-blocked-banner.ts \
    src/client/components/feed-blocked-banner.css \
    src/client/components/article-notice.ts test/browser-tests.ts
git commit -m "feat: FeedBlockedBanner with Retry/Discard and failed-fetch Retry"
```
<!-- END_TASK_1 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 2-3) -->

<!-- START_TASK_2 -->
### Task 2: Render the banner in `feed-reader.ts` (failing test first)

**Verifies:** blocked-feed-controls.AC3.4, AC3.1 (integrated), AC4.1
(integrated)

**Files:**
- Create: `test/feed-reader-blocked-banner.ts` (route render test)
- Modify: `src/client/routes/feed-reader.ts`

**Step 1: Write the failing test**

Create `test/feed-reader-blocked-banner.ts`, modeled on `test/feed-nav.ts` but
mounting `FeedReader` with `splats`. Build a fuller fake `state` providing the
signals `FeedReader` reads (`feeds`, `items`, `counts`, `itemsLoading`,
`showUnreadOnly`, `pageSize`, `selectedFeedId`, `feedUpdateCounts`, `route`,
`_setRoute`) plus `blockedOpsForFeed: (id) => blockedByFeed[id] ?? []` and the
action stubs the banner needs. Pass `splats` so `selectedFeed` resolves to a
seeded feed (splats join to the feed's `stripProtocol(url)`).

Assert structure:
- AC3.4: with a selected feed that has blocked ops AND zero items, the banner
  (`root.querySelector('.feed-blocked-banner')`) is present and the empty state
  is NOT. Assert `root.querySelector('.empty-state')` is null. (`EmptyState`
  renders `<div class="empty-state">` in its normal branches; its only other
  root is `<div class="bootstrap-card">` during first-device bootstrap, which is
  not reachable in these seeded, already-bootstrapped scenarios — so
  `.empty-state` absence is the correct, stable assertion here.) The banner
  renders above the `.items-list`.
- AC4.1 (integrated): with a selected feed that is failed-fetch (no blocked ops,
  `last_fetched:null, last_error` set) and zero items, the banner is present
  with a Retry control and no `.feed-blocked-discard`.
- clean feed (no blocked ops, resolved): no `.feed-blocked-banner`; the normal
  empty state / items render as before.

Register: add `import './feed-reader-blocked-banner.js'` to
`test/browser-tests.ts`.

Run `npm run test:browser`; confirm FAIL (banner not wired into the route).

**Step 2: Wire the banner into `feed-reader.ts`**

- Imports: `import { FeedBlockedBanner } from
  '../components/feed-blocked-banner.js'` and `import { feedRowState } from
  '../blocked-ops.js'`.
- Compute, after `selectedFeed` is resolved:

  ```ts
  const blockedOps = selectedFeed ?
      state.blockedOpsForFeed(selectedFeed.id) :
      []
  const rowState = selectedFeed ?
      feedRowState(selectedFeed, blockedOps) :
      'none'
  const showBanner = selectedFeed !== null &&
      (rowState === 'blocked' || rowState === 'failed')
  ```

- Render the banner above the `<ul class="items-list">` (e.g. immediately before
  the `<ul>`), only when `showBanner`:

  ```ts
  ${showBanner && html`
      <${FeedBlockedBanner}
          state=${state}
          feed=${selectedFeed}
          blockedOps=${blockedOps}
      />
  `}
  ```

- Suppress the empty state when the banner shows: change the empty-state
  condition (lines 177-184) from
  `!itemsLoading.value && items.value.length === 0` to
  `!itemsLoading.value && items.value.length === 0 && !showBanner`.

**Step 3: Run + commit**

Run `npm run test:browser` — `feed-reader-blocked-banner` passes; existing
`feed-reader-render-state` / `feed-reader-pending-updates` still pass.
Run `npm run lint` — clean.

```bash
git add test/feed-reader-blocked-banner.ts src/client/routes/feed-reader.ts \
    test/browser-tests.ts
git commit -m "feat: render the blocked banner above the feed item list"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Full-suite verification (AC6.2)

**Verifies:** blocked-feed-controls.AC6.2

**Files:** none (verification only)

**Implementation / verification:**

Run the full gate and confirm zero failures and zero `console.error`-induced
tapout failures across the new flows:

Run: `npm test`
Expected: all suites pass; no suite fails due to a leaked `console.error`.
Run: `npm run lint`
Expected: clean.

If anything fails, fix it in the relevant phase's files before declaring the
phase done (do not leave a red suite). No commit unless a fix was needed.

**Commit (only if fixes were made):** `fix: <describe>`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_B -->

## Phase 4 done when

- `npm test && npm run lint` pass clean (no `console.error` in the new flows).
- Case A banner renders per-op rows (description/attempts/error) with Retry
  (`retryDeadLetter`) and a confirm-gated Discard that branches `add_feed` ->
  `discardBlockedFeedAdd` else `discardDeadLetter` — AC3.1, AC3.2, AC3.3, AC5.3.
- Case B banner renders for a failed-fetch feed with Retry only
  (`retryResolveFeed`) — AC4.1, AC4.2.
- A feed with both a blocked op and `last_error` shows Case A — AC4.3.
- The banner replaces the "No items" empty state when present — AC3.4.
