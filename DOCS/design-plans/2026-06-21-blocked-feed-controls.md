# Blocked Feed Controls Design

## Summary

This feature adds per-feed visual feedback for sync operations that have
permanently failed (dead-lettered) or for feeds that could not be fetched from
their source. Currently, blocked sync operations are only surfaced on the
dedicated `/sync-status` page, which means users must know to navigate there to
discover that a feed has a problem. The new work surfaces that information where
it is most useful: a static yellow warning circle appears next to the affected
feed in the sidebar, and a banner with Retry/Discard controls appears at the top
of that feed's article page.

The implementation is client-only. The central structural change is promoting the
full dead-letter row list from a route-local signal (loaded only when
`/sync-status` mounts) to an app-wide signal, so the always-visible sidebar can
read it. From that global list a computed derivation maps each blocked operation
to the feed it belongs to, powering both the sidebar indicator and the per-feed
banner. A new low-level helper, `removeLocalFeedRow`, handles the special case
where a blocked `add_feed` operation must be discarded: because the feed never
successfully synced to the server, the discard must delete the local feed row
without enqueuing a server-bound `delete_feed` operation — the opposite of the
normal feed-deletion path.

## Definition of Done

1. **Sidebar indicator.** A feed shows a static yellow circle (reusing the
   existing `--color-warning` variable) in place of the spinner whenever it has
   one or more blocked (dead-lettered) sync ops mapped to it, or it is in the
   "Failed to fetch" (`last_error`) state. Genuinely-resolving feeds still show
   the blue spinner; clean resolved feeds show no circle.

2. **Feed-page banner.** A blocked-op feed's page shows a banner above the item
   list listing each blocked op for that feed (op description, attempts, error)
   with Retry and Discard controls, wired to the existing `retryDeadLetter` /
   `discardDeadLetter` actions. A "Failed to fetch" feed's page shows the
   same-style banner with Retry only (wired to `retryResolveFeed`), since there
   is no op to discard.

3. **Op-type-aware discard.** Discarding a blocked `add_feed` op from the banner
   removes the op, deletes the local feed, and navigates away (this
   feed-deleting behavior lives on the feed page only). Discarding any other op
   type (`delete_feed`, `update_item`, `mark_all_read`) removes only that op;
   the feed and its items remain.

Out of scope: no `/sync-status` behavior changes; no new color variable
(reuse `--color-warning`); no server / Durable Object / SQLite schema changes
(client signals, render logic, and CSS only).

## Acceptance Criteria

### blocked-feed-controls.AC1: Sidebar shows a warning circle for blocked/failed feeds
- **blocked-feed-controls.AC1.1 Success:** A feed with one or more mapped blocked ops renders a static yellow circle (no spin animation) in place of the spinner.
- **blocked-feed-controls.AC1.2 Success:** A failed-fetch feed (`last_fetched === null && last_error`) renders the same static yellow circle and keeps its existing "Failed to fetch" label and retry button.
- **blocked-feed-controls.AC1.3 Success:** A genuinely-resolving feed (`last_fetched === null`, no error, no blocked op) still renders the blue spinner.
- **blocked-feed-controls.AC1.4 Success:** A resolved, clean feed with no blocked op renders no circle.
- **blocked-feed-controls.AC1.5 Precedence:** A resolved feed that has a blocked op renders the warning circle (blocked beats none).
- **blocked-feed-controls.AC1.6 Accessibility:** The circle is exposed to assistive tech via a non-color cue (`role="img"` + label / visually-hidden text), is not focusable, and does not use `role="status"`.

### blocked-feed-controls.AC2: Op-to-feed mapping is correct
- **blocked-feed-controls.AC2.1 Success:** `add_feed`, `delete_feed`, and per-feed `mark_all_read` dead-letters map to a feed by `target_id`.
- **blocked-feed-controls.AC2.2 Success:** An `update_item` dead-letter maps to a feed via the item's `feed_id` when the item is loaded.
- **blocked-feed-controls.AC2.3 Excluded:** A global `mark_all_read` (null `target_id`) maps to no feed and marks no feed blocked.
- **blocked-feed-controls.AC2.4 Excluded:** An `update_item` whose item is not loaded maps to no feed (no crash; stays in `/sync-status`).
- **blocked-feed-controls.AC2.5 Success:** A feed with multiple blocked ops collects all of them.

### blocked-feed-controls.AC3: Feed-page banner for blocked-op feeds
- **blocked-feed-controls.AC3.1 Success:** On a feed with blocked ops, a banner renders above the item list listing each blocked op with its description, attempts, and error.
- **blocked-feed-controls.AC3.2 Success:** Retry on a banner op invokes `retryDeadLetter`.
- **blocked-feed-controls.AC3.3 Success:** Discard shows the "Are you sure?" confirm prompt before acting.
- **blocked-feed-controls.AC3.4 Success:** When blocked ops exist, the banner replaces the "No items" empty state.

### blocked-feed-controls.AC4: Feed-page banner for failed-fetch feeds
- **blocked-feed-controls.AC4.1 Success:** A failed-fetch feed (no blocked ops) shows a banner with the fetch error and a Retry control only (no Discard).
- **blocked-feed-controls.AC4.2 Success:** Retry invokes `retryResolveFeed`.
- **blocked-feed-controls.AC4.3 Precedence:** A feed with both a blocked op and `last_error` shows the blocked-op banner (Case A), not the failed-fetch banner.

### blocked-feed-controls.AC5: Op-type-aware discard
- **blocked-feed-controls.AC5.1 Success:** Discarding a blocked `add_feed` removes the dead-letter op, deletes the local feed row and its items, and navigates away from the feed page.
- **blocked-feed-controls.AC5.2 Regression:** Discarding a blocked `add_feed` does NOT enqueue a `delete_feed` outbox op (`removeLocalFeedRow` leaves the outbox untouched).
- **blocked-feed-controls.AC5.3 Success:** Discarding a non-`add_feed` op (`delete_feed` / `update_item` / `mark_all_read`) removes only that op; the feed and items remain and no navigation occurs.
- **blocked-feed-controls.AC5.4 Success:** After any retry/discard, dead-letter counts and the global `deadLetterRows` signal refresh so the sidebar circle and banner update.

### blocked-feed-controls.AC6: Cross-cutting behaviors
- **blocked-feed-controls.AC6.1:** `/sync-status` reads the promoted global `deadLetterRows` signal and its Retry/Discard behavior is unchanged (discarding an `add_feed` there removes the op only, does not delete the feed).
- **blocked-feed-controls.AC6.2:** No `console.error` leaks during the new flows (tapout gate); `npm test && npm run lint` pass.

## Glossary

- **Dead-letter / dead-lettered op**: A sync operation that has failed enough
  times (at or above `DEAD_LETTER_ATTEMPT_LIMIT`, currently 10) to be moved out
  of the `outbox` table and into `dead_letter_outbox`. It will not be retried
  automatically; the user must act on it.
- **Outbox**: A client-side SQLite table (`outbox`) that queues sync operations
  to be pushed to the server. Each row represents a pending mutation (add feed,
  delete feed, update item, mark all read).
- **`add_feed` / `delete_feed` / `update_item` / `mark_all_read`**: The four
  operation types that can appear in the outbox/dead-letter table. They
  correspond to mutations the user has made locally that need to be mirrored to
  the server-side Durable Object.
- **`target_id`**: A column on outbox/dead-letter rows that identifies the
  primary subject of the operation — a feed id for `add_feed`/`delete_feed`/
  per-feed `mark_all_read`, an item id for `update_item`, and `null` for a global
  `mark_all_read`.
- **Durable Object (DO)**: A Cloudflare Workers primitive used here as the
  server-authoritative per-user data store. It holds the canonical feed and item
  records in SQLite. Client mutations that reach the server are applied here.
- **`@preact/signals` / `Signal` / `computed`**: The reactive state library used
  throughout the client. A `Signal` is a reactive value; a `computed` is a
  derived value that automatically recalculates when its dependencies change.
  `batch` groups multiple signal writes into one notification.
- **`deadLetterRows`**: The app-wide `Signal<DeadLetterRow[]>` being introduced in
  this feature. Previously, the equivalent list lived only inside the
  `/sync-status` route module; promoting it to a global module makes it readable
  by the always-mounted sidebar.
- **`blockedOpsByFeed`**: A `computed` signal that groups dead-letter rows by
  their associated feed id, derived from `deadLetterRows`, `feeds`, and `items`.
- **`feedRowState`**: A pure (no DOM, no signals) helper function that classifies
  a feed as `'blocked'`, `'failed'`, `'resolving'`, or `'none'`, given the feed
  record and its mapped blocked ops. It is the single source of truth for
  sidebar-indicator and banner-case selection.
- **`last_fetched` / `last_error`**: Columns on the local feed row tracking the
  most recent successful fetch timestamp and any fetch error string. A feed with
  `last_fetched === null && last_error` set is in the "Failed to fetch" state.
- **`retryResolveFeed`**: An existing client action that re-triggers resolution of
  a feed that is stuck in the "Failed to fetch" state (i.e., re-attempts the feed
  URL lookup and first fetch).
- **`retryDeadLetter` / `discardDeadLetter`**: Existing client actions used by
  `/sync-status`. `retryDeadLetter` moves a dead-letter row back to the outbox
  and triggers push-sync. `discardDeadLetter` permanently removes the op without
  touching the feed or items.
- **`removeLocalFeedRow`**: A new low-level db helper introduced by this feature.
  It deletes a feed row and its items inside a single transaction but, unlike
  `local-adapter.deleteFeed`, does not enqueue a `delete_feed` outbox operation.
  Used when discarding a dead-lettered `add_feed` that never reached the server.
- **`describeOp(row)`**: An existing formatting helper (in
  `routes/sync-status-format.ts`) that produces a human-readable description of an
  outbox/dead-letter row. The banner reuses it.
- **`ArticleNotice` warning-variant**: An existing CSS pattern (`.article-notice`
  with a warning modifier) used for in-page notices with an icon, title/body
  text, and action buttons. The feed-page banner is built on this pattern.
- **`--color-warning`**: A CSS custom property defined in `_variables.css` (amber,
  `#b45309`). Already used for the "Sync warning" header text; the new sidebar
  circle and banner reuse it without adding a new variable.
- **WCAG 1.4.1**: The Web Content Accessibility Guidelines success criterion
  requiring that color is not the sole means of conveying information. The sidebar
  circle satisfies it by also including `role="img"`, `aria-label`, and
  visually-hidden text.
- **`tapout`**: The project's browser test runner. A `console.error` call during a
  test causes the run to fail even if all TAP assertions pass ("tapout gate" in
  the ACs).
- **YAGNI**: "You Aren't Gonna Need It" — the justification for not adding a
  database-backed resolver for unmapped `update_item` dead-letters (AC2.4
  Excluded).

## Architecture

Client-only. No server, Durable Object, or SQLite schema changes. The work is
new client signals/derivations, render logic in two existing components, one new
presentational component, two new db/state helpers, and CSS.

### Data layer (single source of truth)

The full dead-letter list currently lives in `routes/sync-status-state.ts`
(`deadLetters`) and only loads when `/sync-status` mounts. It is promoted to an
app-wide signal so the always-mounted sidebar can read it:

```ts
// global module (db/sync-status.ts, beside the existing syncDeadLetters count)
deadLetterRows:Signal<DeadLetterRow[]>          // full list, app-wide

// derived in state.ts (where the feeds + items signals live)
blockedOpsByFeed:ReadonlySignal<Map<number, DeadLetterRow[]>>
blockedOpsForFeed(feedId:number):DeadLetterRow[] // reads the map

// pure presentation helper (testable seam; no DOM, no signals)
feedRowState(
  feed:Feed,
  blockedOps:DeadLetterRow[]
):'blocked' | 'failed' | 'resolving' | 'none'
```

`deadLetterRows` is refreshed at exactly the points the `syncDeadLetters` count
is already refreshed — initial load, after each push-sync (`setSyncDone`), and
after retry/discard (`refreshDeadLetterCounts`). `/sync-status` reads this same
signal (a read-source change only; its behavior is unchanged).

`blockedOpsByFeed` is a pure `computed` over `deadLetterRows` + `feeds` +
`items`. Each row maps to a feed id as follows:

1. `add_feed`, `delete_feed`, per-feed `mark_all_read` — `target_id` is the feed
   id directly (`local-adapter.addFeed` enqueues with `target_id = feed.id`).
2. `update_item` — find the item in `items.value` by `id === target_id`, use its
   `feed_id`.
3. Unmappable rows — a global `mark_all_read` (null `target_id`), or an
   `update_item` whose item is not in the loaded set — are excluded; they remain
   visible in `/sync-status` only.

### Sidebar indicator (`components/feed-nav.ts`)

The circle's meaning broadens from "resolving" to "in-flight or needs
attention," resolved by `feedRowState` (precedence high to low):

1. `blocked` — feed has one or more mapped blocked ops -> static yellow circle.
2. `failed` — `last_fetched === null && last_error` -> static yellow circle;
   the existing "Failed to fetch" label + retry button stay.
3. `resolving` — `last_fetched === null && !last_error` -> blue spinner
   (unchanged).
4. `none` — resolved and clean -> no circle (unchanged).

The new indicator is a CSS sibling of `.feed-spinner` (e.g. `.feed-warning-dot`):
same box size, `border-radius: 50%`, solid `var(--color-warning)` fill, no
`animation`. Honors the "keep it a circle" request rather than switching to a
triangle. Accessibility (per WCAG 1.4.1 — color cannot be the only signal): the
indicator uses `role="img"` with an `aria-label` plus visually-hidden text
("Blocked" / "Failed to fetch"), NOT the spinner's `role="status"` (which is a
live region for loading, not a persistent state). It is non-focusable; the
actionable controls live on the feed's page.

### Feed-page banner (`routes/feed-reader.ts` + new component)

A banner renders above the item list, replacing the "No items" empty state when
present. Built feed-page-local (reusing existing actions + warning-notice CSS),
leaving `/sync-status` untouched.

```ts
FeedBlockedBanner({
  state:AppState;
  feed:Feed;
  blockedOps:DeadLetterRow[];   // [] for the failed-fetch case
}):VNode
```

Case A — blocked-op feed (`blockedOps` non-empty): lists each op (description via
the existing `describeOp(row)`, `Attempts: N`, `Error: <last_error>`) with
**Retry** (`State.retryDeadLetter`) and **Discard** (the existing inline confirm
prompt, then the op-type-aware path below). Owns its confirm open/close state
locally — no new global signal.

Case B — failed-fetch feed (`feedRowState === 'failed'`): a single banner with
the fetch error and **Retry only** (`State.retryResolveFeed`). No Discard — there
is no op to discard.

If a feed has both a blocked op and `last_error`, Case A wins (consistent with
the sidebar precedence).

### Op-type-aware discard (`db` + `state.ts`)

`local-adapter.deleteFeed` deletes the row but also enqueues a `delete_feed`
outbox op — wrong for an add that never reached the server. So a new low-level
helper removes the local row only:

```ts
// db layer — local row removal ONLY, no outbox enqueue
removeLocalFeedRow(db, feedId):Promise<void>
//   BEGIN; DELETE FROM items WHERE feed_id=?; DELETE FROM feeds WHERE id=?; COMMIT

// feed-page action composing the steps in sequence
State.discardBlockedFeedAdd(state, feedId, deadLetterId):Promise<void>
//   removeDeadLetter(db, deadLetterId)
//   removeLocalFeedRow(db, feedId)
//   reload feeds + items + counts; refreshDeadLetterCounts
//   state._setRoute('/')
```

The banner's Discard branches on the row's op: `add_feed` ->
`discardBlockedFeedAdd`; anything else -> the existing `discardDeadLetter`
(op removed only; feed and items remain). Ordering removes the op first, then the
row, then navigates; a failed row-delete leaves a benign blocked-op-free feed,
never a both-tables phantom.

## Existing Patterns

This design follows established codebase patterns rather than introducing new
ones:

- **Computed signal derivation:** `blockedOpsByFeed` mirrors existing
  `computed()` derivations in `state.ts` (e.g. `feedsWithUpdates`,
  `displayedFeedSyncStatus`).
- **Dead-letter actions:** Retry/Discard reuse `State.retryDeadLetter`,
  `State.discardDeadLetter`, `requeueDeadLetter`/`removeDeadLetter`
  (`db/push-sync.ts`), and `refreshDeadLetterCounts` (`state.ts`) — the same
  actions `/sync-status` uses.
- **Op description:** `describeOp(row)` (`routes/sync-status-format.ts`).
- **Warning-notice UI:** the banner reuses the `ArticleNotice` warning-variant
  CSS pattern (`components/article-notice.{ts,css}`) — flex notice with icon +
  title/body + actions, colored via `--color-warning`.
- **Confirm prompt:** the inline "Are you sure? This cannot be undone." pattern
  from `routes/sync-status.ts`.
- **Buttons:** `ButtonPrimary` / `ActionButton` components already used by
  `/sync-status`.
- **Transactional local delete:** `removeLocalFeedRow` mirrors
  `local-adapter.deleteFeed`'s two-DELETE transaction, omitting only the
  `insertOutbox(...)` line.
- **Programmatic navigation:** `state._setRoute('/')` (bound `route-event`),
  as used after OAuth callback and `clearSelectedItem`.
- **Tooltip:** the `@substrate-system/tool-tip` web component (as used for the
  existing retry button) is available for an optional hover/focus hint.
- **Color:** reuses `--color-warning` (`#b45309`) from `_variables.css` — the
  same amber as the "Sync warning - N blocked" header text. No new variable.

Divergence: `deadLetterRows` moves from a route-local signal
(`routes/sync-status-state.ts`) to a global module. Justified — the sidebar is
always mounted and needs blocked-op data app-wide; a single global source
prevents two loaders from diverging.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Blocked-ops data layer and derivation
**Goal:** App-wide blocked-op state and the pure helpers that drive rendering.

**Components:**
- `deadLetterRows:Signal<DeadLetterRow[]>` promoted to a global module
  (`db/sync-status.ts`), refreshed at the existing count-refresh points
  (initial load, `setSyncDone`, `refreshDeadLetterCounts`).
- `blockedOpsByFeed` computed + `blockedOpsForFeed(feedId)` helper in `state.ts`
  (maps ops to feeds per the rules in Architecture).
- `feedRowState(feed, blockedOps)` pure helper (the testable seam).
- `/sync-status` repointed to read the global `deadLetterRows` (behavior
  unchanged).

**Dependencies:** None.

**Done when:** Unit tests pass for the mapping (`blockedOpsByFeed`) and the
precedence (`feedRowState`); `/sync-status` still lists blocked changes.

**Covers:** blocked-feed-controls.AC2.1–AC2.5, AC1.3–AC1.5 (precedence logic),
AC6.1.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Sidebar warning circle
**Goal:** Render the static yellow circle for blocked/failed feeds, accessibly.

**Components:**
- `.feed-warning-dot` in `components/sidebar.css` (solid `--color-warning`, no
  animation).
- `components/feed-nav.ts` selects the indicator via `feedRowState`; warning
  rows get `role="img"` + `aria-label` + visually-hidden text; spinner and
  "Failed to fetch" label/retry preserved.

**Dependencies:** Phase 1 (`feedRowState`, `blockedOpsForFeed`).

**Done when:** Build passes; structural tests confirm the warning indicator is
present (and the spinner absent) for `blocked`/`failed` states and vice-versa,
driven by `feedRowState`; assertions are structural (role/element), not copy.

**Covers:** blocked-feed-controls.AC1.1, AC1.2, AC1.3, AC1.6.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Op-type-aware discard infrastructure
**Goal:** Remove a phantom add-feed without enqueuing a server-bound delete.

**Components:**
- `removeLocalFeedRow(db, feedId)` in the db layer (local row + items delete,
  one transaction, no outbox insert).
- `State.discardBlockedFeedAdd(state, feedId, deadLetterId)` composing
  `removeDeadLetter` + `removeLocalFeedRow` + reloads + `refreshDeadLetterCounts`
  + `_setRoute('/')`.

**Dependencies:** None (uses existing db helpers); pairs with Phase 4.

**Done when:** Unit tests prove `removeLocalFeedRow` deletes the feed/items and
leaves the outbox untouched (no `delete_feed` op); `discardBlockedFeedAdd`
removes the dead-letter, deletes the feed, refreshes counts, and navigates;
non-add_feed discard leaves the feed intact and does not navigate.

**Covers:** blocked-feed-controls.AC5.1, AC5.2, AC5.3, AC5.4.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Feed-page blocked banner
**Goal:** Surface Retry/Discard (and failed-fetch Retry) on the feed's page.

**Components:**
- `FeedBlockedBanner` component (+ CSS) reusing the warning-notice pattern and
  the confirm-prompt pattern; renders Case A (blocked ops, per-op Retry/Discard)
  and Case B (failed-fetch, Retry only).
- `routes/feed-reader.ts` renders the banner above the items list (replacing the
  empty state when present), choosing the case via `blockedOpsForFeed` /
  `feedRowState`.
- Discard wiring: `add_feed` -> `discardBlockedFeedAdd`; else
  `discardDeadLetter`. Retry wiring: Case A -> `retryDeadLetter`; Case B ->
  `retryResolveFeed`.

**Dependencies:** Phase 1 (`blockedOpsForFeed`, `feedRowState`), Phase 3
(`discardBlockedFeedAdd`).

**Done when:** Tests confirm the banner renders for blocked-op and failed-fetch
feeds, that Case A wins when both conditions hold, and that Retry/Discard invoke
the correct actions (asserted via action calls, not copy); confirm prompt gates
Discard; `npm test && npm run lint` pass clean (no `console.error`).

**Covers:** blocked-feed-controls.AC3.1–AC3.4, AC4.1–AC4.3, AC6.2.
<!-- END_PHASE_4 -->

## Additional Considerations

**Update-item mapping gap (intentional):** an `update_item` dead-letter whose
item is not in the loaded `items` set cannot be mapped to a feed without an async
DB query, so it does not paint a feed circle and remains only in `/sync-status`.
Accepted as YAGNI — such dead-letters are rare and low-stakes. A DB-backed
resolver could close the gap later without changing any contract here.

**Scope boundary — `/sync-status` discard:** the feed-deleting discard
(`discardBlockedFeedAdd`) is feed-page-only. `/sync-status` keeps its current
behavior (op removed, feed row remains). The latent phantom-feed case there is
explicitly out of scope.

**Refresh propagation:** because the sidebar circle and banner derive from
`deadLetterRows` + `feeds`, a successful Retry clears state through the existing
sync + SSE round-trip (feed resolves, op leaves the dead-letter table), and the
indicators update on the next refresh of those signals.
