# Phase 7: Remove the global render gate

**Goal:** Replace the `pageReady` render gate that produces blank
skeletons on the home and items routes with sub-tree-local rendering
rules. Every sub-tree renders from its own signals immediately.
First-time OPFS bootstrap (paid users only, no paint-cache hit)
surfaces an explicit one-shot card so the user understands the
delay.

**Architecture:** Two edits:

1. **`src/client/index.ts`** loses the `pageReady` `useComputed`
   (lines 46-49) and the conditional skeleton block (lines 65-76)
   that today returns `PageSkeleton` or `ItemSkeleton` while
   `pageReady` is false. The App component renders its match
   unconditionally. `ItemSkeleton` and `PageSkeleton` imports become
   dead and are removed.
2. **`src/client/routes/feed-reader.ts`** gains a small branch in
   `renderEmptyState` (lines 120-140) that returns the bootstrap
   card when `bootstrapInProgress.value === true` AND
   `paintCacheHydratedOnBootstrap.value === false`. The card reads
   `bootstrapFeedsCount` and `bootstrapItemsCount` for progress and
   already exists as signals in `src/client/db/bootstrap.ts:23-28`.

`paintCacheHydratedOnBootstrap` is a new module-scoped signal in
`src/client/state.ts` (alongside `hydratePaintCache`, the existing
imperative-shell signal cluster) — initial `false`, set to `true`
inside `hydratePaintCache` on a successful hit. Phase 7 adds it
and the one-line write inside the existing helper.
`paint-cache.ts` is kept as pure I/O (no signal imports) per the
FCIS boundary established in Phase 3.

`state.initialLoadComplete` remains set (Phase 8 deletes it after
auditing consumers). Today it is read by the `pageReady`
computation; once `pageReady` is gone, the only remaining
consumers — if any — are flagged for Phase 8.

**Tech Stack:** TypeScript (browser), Preact + `@preact/signals`,
`htm/preact`.

**Scope:** Phase 7 of 8. Depends on Phases 3-6 (paint-cache reads
populate signals so returning users don't see "empty + bootstrap
card" flashing).

**Codebase verified:** 2026-05-25

**Key facts from investigation:**
- `src/client/index.ts:46-49` defines:
  ```typescript
  const pageReady = useComputed(() => (
      !state.authLoading.value &&
      (state.user.value === null || state.initialLoadComplete.value)
  ))
  ```
- `index.ts:65-76` returns skeletons while `!pageReady.value`:
  ```typescript
  if (!pageReady.value) {
      debug('not readyyyyyyyyyyyyyy')
      if (isItemRoute(route.value)) {
          return html`<${ItemSkeleton} state=${state} />`
      }
      if (route.value === '/' || route.value.startsWith('/feed/')) {
          return html`<${PageSkeleton} state=${state} />`
      }
      // Other routes (login, about, settings, etc.) don't depend on
      // feeds/items; render them normally even before pageReady.
  }
  ```
- `ItemSkeleton` and `PageSkeleton` are imported at lines 12-13 of
  `index.ts`. After removing the block, run
  `rg -n "PageSkeleton|ItemSkeleton" src/` — if no other consumers,
  remove the imports. If the component files
  (`src/client/components/page-skeleton.ts` and
  `src/client/components/item-skeleton.ts`) become wholly unused,
  Phase 8 deletes them.
- `feed-reader.ts:120-140` is `renderEmptyState`:
  ```typescript
  const renderEmptyState = ():unknown => {
      if (feeds.value.length === 0) {
          return html`<div class="empty-state">
              Maybe add some feeds to start reading.
          </div>`
      }
      if (pendingCount > 0) {
          return html`<${PendingUpdateEmptyState}
              count=${pendingCount}
              onRefresh=${handleRefreshPending}
          />`
      }
      // ...
  }
  ```
- The bootstrap card branch needs to render BEFORE the
  `feeds.value.length === 0` check (because during first-ever
  bootstrap, both feeds and items are empty — we want the card,
  not the "Maybe add some feeds" empty state).
- `bootstrapInProgress`, `bootstrapFeedsCount`, `bootstrapItemsCount`
  exported from `src/client/db/bootstrap.ts:23-25`.
- `feed-reader.ts` items render at lines 186-202. The empty-state
  call is conditional on `!itemsLoading.value && items.value.length === 0`
  (line 200-201) — the bootstrap card slots cleanly into the
  empty-state branch.
- Sidebar: `<${Sidebar} state=${state} />` at line 156. The sidebar
  reads `feeds.value` directly and renders feeds the moment paint
  cache hydration lands. No edits needed here.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 023-fix-initial-load.AC1: Render gate is removed; shell paints unconditionally
- **023-fix-initial-load.AC1.1 Success:** With a populated paint cache
  and `syncSubscriptions=true`, the sidebar feed list is in the DOM
  with real data before any `/api/feeds` request resolves (verified
  with a slow-stub fetch).
- **023-fix-initial-load.AC1.2 Success:** The app shell (header,
  sidebar chrome, top-level layout) is in the DOM on every load
  regardless of `authLoading` state.
- **023-fix-initial-load.AC1.3 Success:** Sub-trees with empty
  signals and no fetch in flight show their empty-state UI (not a
  skeleton).
- **023-fix-initial-load.AC1.4 Failure:** Sub-trees with empty
  signals AND a fetch in flight show a contextual loading
  placeholder (e.g., 1-2 skeleton rows), not a full-page block.
- **023-fix-initial-load.AC1.5 Edge:** Removing `pageReady` does
  not regress the unauthenticated landing view (login form still
  renders correctly).

### 023-fix-initial-load.AC5: First-ever bootstrap UI
- **023-fix-initial-load.AC5.1 Success:** When `bootstrapInProgress`
  is `true` AND `readPaintCache` returned `null`, the items pane
  renders a card with the text "Setting up your local cache. This
  only happens once on this device."
- **023-fix-initial-load.AC5.2 Success:** The bootstrap card surfaces
  `bootstrapFeedsCount` and `bootstrapItemsCount` progress values.
- **023-fix-initial-load.AC5.3 Failure:** When `bootstrapInProgress`
  becomes `false`, the card is removed from the DOM in the same
  render and replaced by real content (no orphan card).
- **023-fix-initial-load.AC5.4 Edge:** On a returning load (paint
  cache hit), the card is never shown.

---

<!-- START_TASK_1 -->
### Task 1: Add `paintCacheHydratedOnBootstrap` signal

**Verifies:** AC5.4 (the card is suppressed on returning loads)

**Files:**
- Modify: `src/client/state.ts` (declare signal and set it inside
  `hydratePaintCache`)

**Implementation:**

The signal lives in `state.ts` (the imperative shell) — *not* in
`paint-cache.ts`, which Phase 3 establishes as a pure I/O module
with no signals imports. Place the export near the other top-level
state signals — for consistency with the existing pattern of
exporting standalone signals from `state.ts` (e.g.,
`cache-status-state.ts` does the same for `cacheStatus`).

Add the declaration near the top of `state.ts` (after the imports,
before `State()`):

```typescript
/**
 * Set to `true` exactly once, by `hydratePaintCache`, when a
 * snapshot was found and applied during the initial bootstrap.
 * Read by UI to decide whether to show the first-time-bootstrap
 * card during the OPFS first-pull.
 */
export const paintCacheHydratedOnBootstrap:Signal<boolean> =
    signal(false)
```

Update `hydratePaintCache` (from Phase 4) to set the signal on a
successful hit. The signal is in the same file, so no extra import
is needed:

```typescript
export function hydratePaintCache (
    state:AppState,
    did:string|null
):boolean {
    if (did === null) return false
    const snap:PaintCacheV1|null = readPaintCache(did)
    if (snap === null) return false
    batch(() => {
        state.feeds.value = snap.feeds
        state.items.value = snap.items
        state.counts.value = snap.counts
        state.selectedFeedId.value = snap.selectedFeedId
        paintCacheHydratedOnBootstrap.value = true       // NEW
    })
    return true
}
```

**Verification:**

Run: `npm run typecheck && npm run lint`
Expected: Clean.

**Commit:** Combine with Task 2.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Remove the `pageReady` gate from `index.ts`

**Verifies:** AC1.1, AC1.2, AC1.5

**Files:**
- Modify: `src/client/index.ts`

**Implementation:**

Edit `src/client/index.ts`. Final shape of the `App` component:

```typescript
export const App:FunctionComponent<{
    state:AppState
}> = function App ({ state }) {
    const route = useComputed(() => state.route.value)

    const match = useComputed(() => {
        return router.match(route.value)
    })

    if (!match.value || !match.value.action) {
        return html`<${NotFound} />`
    }

    if (state.oauthInFlight.value) {
        return html`<${OAuthCallbackLoader} />`
    }

    const ChildNode = match.value.action(match.value, route.value)
    const { params, splats } = match.value
    if (!ChildNode) return html`<${NotFound} />`

    return html`
        <${Header} state=${state} />
        <${ChildNode} state=${state} params=${params} splats=${splats} />
        <footer>
            <nav class="footer-links" aria-label="Footer">
                <a href="/terms">Terms</a>
                <a href="/privacy">Privacy</a>
            </nav>
        </footer>
    `
}
```

Concrete edits:
- Delete lines 46-49 (the `pageReady` `useComputed`).
- Delete lines 65-76 (the `if (!pageReady.value) { ... }` block and
  its closing comment).
- Delete the `useComputed` import if no other use remains
  (the `route` and `match` computeds still need it — leave it).
- Delete the `ItemSkeleton` / `PageSkeleton` imports (lines 12-13)
  *only after* confirming no other file imports them. Run:

  ```bash
  rg -n "PageSkeleton|ItemSkeleton" src/
  ```

  If only `index.ts` references them, remove both imports. The
  component files themselves stay for Phase 8's cleanup task.
- Delete the `isItemRoute` import (line 8) only if it has no other
  use. Run `rg -n "isItemRoute" src/client/`. If used elsewhere,
  leave the import.
- Delete the `debug` import (`@substrate-system/debug`) and the
  `debug = Debug(...)` line if the `debug('not readyyyyyy')` call
  removed in the conditional block was the only use. (It likely
  was — `index.ts` is small.)

**Verification:**

Run: `npm run typecheck && npm run lint`
Expected: Clean. Any error here likely means a removed import had
other uses — restore that specific import.

Manual check (per the `run` skill):
1. **AC1.1:** With a populated paint cache, throttle `/api/feeds` to
   10s (DevTools "Slow 3G" or a stub). Reload the home route.
   Confirm sidebar feed titles appear before the request resolves.
2. **AC1.2:** Reload while `authLoading` is true (briefly, on cold
   load). Confirm the header is in the DOM throughout — not a blank
   page.
3. **AC1.5:** Open the `/login` route in an incognito tab. Confirm
   the login form renders (and that no skeleton flash precedes it).

**Commit:** Combine with Task 3.

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add the bootstrap card to the items pane

**Verifies:** AC1.3, AC1.4, AC5.1, AC5.2, AC5.3, AC5.4

**Files:**
- Modify: `src/client/routes/feed-reader.ts` (`renderEmptyState`,
  lines 120-140, plus imports)
- Modify: `src/client/routes/feed-reader.css` (if a sibling CSS file
  exists; otherwise add to the existing `style.css` per project
  convention)

**Implementation:**

Add the imports to `feed-reader.ts`:

```typescript
import {
    bootstrapInProgress,
    bootstrapFeedsCount,
    bootstrapItemsCount
} from '../db/bootstrap.js'
import { paintCacheHydratedOnBootstrap } from '../state.js'
```

Update `renderEmptyState` to add the bootstrap card as the **first**
branch (before the empty-feeds branch):

```typescript
const renderEmptyState = ():unknown => {
    // First-ever device bootstrap: show explicit progress card
    // instead of "Maybe add some feeds" while OPFS pulls the
    // initial dataset.
    if (
        bootstrapInProgress.value &&
        !paintCacheHydratedOnBootstrap.value
    ) {
        return html`
            <div class="bootstrap-card" role="status" aria-live="polite">
                <h3 class="bootstrap-card-title">
                    Setting up your local cache
                </h3>
                <p class="bootstrap-card-body">
                    This only happens once on this device.
                </p>
                <p class="bootstrap-card-progress">
                    ${bootstrapFeedsCount.value} feeds &middot;
                    ${bootstrapItemsCount.value} items
                </p>
            </div>
        `
    }

    if (feeds.value.length === 0) {
        return html`<div class="empty-state">
            Maybe add some feeds to start reading.
        </div>`
    }

    if (pendingCount > 0) {
        return html`<${PendingUpdateEmptyState}
            count=${pendingCount}
            onRefresh=${handleRefreshPending}
        />`
    }

    if (selectedFeed) {
        return html`<div class="empty-state">
            No items in ${selectedFeed.title || selectedFeed.url}
        </div>`
    }

    return html`<div class="empty-state">
        No items to show.
    </div>`
}
```

Also update the items-list block at lines 186-202 to surface an
inline loading row when items are empty AND a fetch is in flight,
satisfying AC1.4. The current code already does this:

```typescript
${itemsLoading.value && items.value.length === 0 && html`
    <div class="loading-text">Loading items...</div>
`}
```

The existing "Loading items..." text is the contextual placeholder
required by AC1.4. No change needed; verify it renders by Manual
check #2 below.

For the card styling, add a CSS block. Check whether
`src/client/routes/feed-reader.css` exists (run
`ls src/client/routes/feed-reader.css`). If yes, append there.
Otherwise, append to `src/client/style.css` in a section commented
`/* feed-reader bootstrap card */`. Use existing CSS variables for
colors / spacing per the project's house-style.css rules. Concrete
suggestion (adapt to existing tokens):

```css
.bootstrap-card {
    margin: var(--space-lg, 1.5rem) auto;
    padding: var(--space-lg, 1.5rem);
    max-width: 32rem;
    border: 1px solid var(--color-border, #d0d0d0);
    border-radius: var(--radius-md, 0.5rem);
    background: var(--color-surface, #f7f7fa);
    text-align: center;
}

.bootstrap-card-title {
    margin: 0 0 var(--space-sm, 0.5rem);
    font-size: 1.125rem;
}

.bootstrap-card-body {
    margin: 0 0 var(--space-sm, 0.5rem);
    color: var(--color-text-secondary, #555);
}

.bootstrap-card-progress {
    margin: 0;
    color: var(--color-text-tertiary, #777);
    font-feature-settings: 'tnum' 1;
}
```

(Check `src/client/_variables.css` or `src/client/style.css` for
the actual variable names in use; the global CLAUDE.md says
"Always use variables defined in a file `_variables.css` or
`_vars.css`. Use variables for all colors. Prefer to re-use
existing colors before creating a new one." Don't invent new
tokens — task-implementor should grep the existing vars and pick
matches.)

**Testing:**

Add a test at `test/feed-reader-render-state.ts` (file name follows
project convention — there is already an `item-reader-render-state.ts`
test, mirror that pattern). The test exercises `renderEmptyState`
behavior at the signal level (without spinning Preact), or — if the
existing test pattern is to render and assert DOM — does that.

Tests must verify each AC listed:
- **AC5.1:** Set `bootstrapInProgress.value = true`,
  `paintCacheHydratedOnBootstrap.value = false`,
  `feeds.value = []`, `items.value = []`. Assert the rendered output
  contains the literal phrase "Setting up your local cache".
- **AC5.2:** Set `bootstrapFeedsCount.value = 12`,
  `bootstrapItemsCount.value = 240`. Assert the rendered output
  contains both numbers (string-matching the literal `12` and `240`
  is acceptable here — the test owns the values).
- **AC5.3:** Render with `bootstrapInProgress.value = true`, then
  set it to `false` and call `loadInitialView` (or directly assign
  `items.value = [someItem]`). Assert the bootstrap card is no
  longer in the rendered output AND the item rows are.
- **AC5.4:** Set `paintCacheHydratedOnBootstrap.value = true`,
  `bootstrapInProgress.value = true` (paid user with cached
  snapshot still firing background bootstrap). Assert the card is
  NOT rendered.
- **AC1.3:** Set `itemsLoading.value = false`, `items.value = []`,
  `feeds.value = [someFeed]`, `selectedFeed = null`,
  `bootstrapInProgress.value = false`. Assert the rendered output
  contains "No items to show." (the empty state from line 137-139)
  and NOT a skeleton.
- **AC1.4:** Set `itemsLoading.value = true`, `items.value = []`.
  Assert the rendered output contains the "Loading items..." text
  AND NOT a full-page skeleton.

Wire the test file into `package.json` and `test/run-all-tests.mjs`
following the established pattern.

For AC1.1, AC1.2, AC1.5 — these are integration-level concerns best
verified by manual check (below). If the project has an existing
shell-level / smoke test that exercises bootstrap, ensure it still
passes.

**Verification:**

Run: `npm run typecheck && npm run lint && npm test`
Expected: All clean and tests pass.

Run: `npm run stylelint`
Expected: Clean (new CSS conforms to existing rules).

Manual check (per the `run` skill):
1. **AC1.3:** Log in as a free user with no feeds. Confirm the home
   route shows "Maybe add some feeds" (empty state) immediately, no
   skeleton flash.
2. **AC1.4:** Log in as a user with feeds. Throttle the
   items-fetch endpoint. Confirm the "Loading items..." text shows
   for the items pane while feeds list (sidebar) is already
   populated.
3. **AC5.1, AC5.2, AC5.3:** As a paid user, fresh browser profile
   (so paint cache is empty and OPFS has no DB). Reload. Observe
   the "Setting up your local cache" card with live feed/item
   progress counts. When bootstrap finishes, the card is replaced
   by the item rows — no orphan card.
4. **AC5.4:** Same paid user on a *returning* device (paint cache
   populated). Reload. The card is NOT shown — the cached items
   render immediately and `loadInitialView` updates them in place.

**Commit:**

```bash
git add src/client/index.ts src/client/routes/feed-reader.ts \
        src/client/state.ts \
        src/client/style.css test/feed-reader-render-state.ts \
        package.json test/run-all-tests.mjs
git commit -m "feat: remove pageReady gate; add first-time bootstrap card

Removes the global pageReady useComputed and the skeleton-conditional
block from src/client/index.ts. Sub-trees now render from their own
signals, so the shell and sidebar paint immediately on every load.
Adds a 'Setting up your local cache' card in the items pane,
suppressed on returning loads (paint cache hit). Tests cover the
render matrix for AC1.3, AC1.4, AC5.1-AC5.4.

Part of 023-fix-initial-load."
```

<!-- END_TASK_3 -->
