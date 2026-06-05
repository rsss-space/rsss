# Phase 0 Research: Fetch Updates Button

All "NEEDS CLARIFICATION" items in Technical Context were resolved by
reading the existing client code. No external research was required —
this feature reuses established in-repo patterns.

## Decision 1: Reuse `State.refreshFeeds`, do not add fetch logic

- **Decision**: The button's handler is `() => State.refreshFeeds(state)`,
  the same handler `SidebarFooter` uses for "Refresh Feeds".
- **Rationale**: `State.refreshFeeds` (`src/client/state.ts:2433`) already
  owns: the re-entrancy guard (`if (state.refreshInProgress.value)
  return`), the refresh refcount (`acquireRefresh`/`releaseRefresh`), the
  SSE-driven busy lifecycle, the safety timeout, and error/restore
  handling. Calling it from a second site guarantees identical outcomes
  (FR-003, SC-003) and keeps the two controls from diverging.
- **Alternatives considered**: A dedicated "fetch updates" action —
  rejected; it would duplicate the lifecycle and risk divergence, which
  the spec explicitly forbids.

## Decision 2: Gate visibility on `displayedFeedSyncStatus === 'updates'`

- **Decision**: Render the button only inside the existing `'updates'`
  branch of `FeedStatus` (`src/client/components/feed-status.ts`).
- **Rationale**: `displayedFeedSyncStatus` is a computed signal
  (`state.ts:807`) = `'syncing'` when `displayedRefreshInProgress`, else
  `feedSyncStatus`. Keying off it makes the button appear/disappear
  reactively (FR-009) and absent for `synced`/`syncing`/`error`/
  `inactive` (FR-002). The `'updates'` branch already renders both "1
  update" and "N updates" via `legendFor`, covering FR-004.
- **Alternatives considered**: A separate boolean signal for "button
  visible" — rejected as redundant; the indicator state already encodes
  exactly the condition.

## Decision 3: Reuse `Button` with `isSpinning=state.refreshInProgress`

- **Decision**: Use `components/button.ts` with
  `isSpinning=${state.refreshInProgress}`, matching `SidebarFooter`.
- **Rationale**: `Button` (`src/client/components/button.ts`) sets
  `disabled` and `aria-busy` from `isSpinning.value` and swallows
  `onClick` rejections when controlled (parent owns error state). This
  delivers FR-005 (same in-progress feedback) and FR-006 (re-entrancy)
  with zero new code. `state.refreshInProgress` is a
  `ReadonlySignal<boolean>` and `SidebarFooter` already passes it to
  `isSpinning`, so there is no new type concern.
- **Alternatives considered**: A bare `<button>` — rejected; it would
  re-implement the busy/disabled/aria-busy behavior `Button` provides.

## Decision 4: Render the button outside the `role="status"` live region

- **Decision**: Wrap the existing `<span class="feed-status"
  role="status" aria-live="polite">` and the new button in a container
  (`.feed-status-wrap`); the button is a sibling of the live region, not
  a child. Keep `key=${status}` on the inner status span.
- **Rationale**: The live region re-announces its text content on status
  change (the `key` forces a remount). Keeping the static "fetch updates"
  text out of the region avoids polluting the announcement while
  preserving the existing remount-to-reannounce behavior.
- **Alternatives considered**: Button inside the live region — rejected;
  it would make assistive tech read "6 updates fetch updates".

## Decision 5: Responsive behavior mirrors the legend

- **Decision**: In `feed-status.css`, hide the button in the
  `680px ≤ width < 1000px` range, matching the existing rule that hides
  `.feed-status-legend` for non-syncing states in that range.
- **Rationale**: The button anchors to the "N updates" text; when that
  text is hidden, a lone button reads as orphaned. Mirroring the legend's
  breakpoint keeps the header coherent. Only task-related CSS is changed.
- **Alternatives considered**: Always show the button — rejected; it
  contradicts the "right of the N updates text" anchoring when the text
  is hidden.

## Testing approach (resolved)

- Use the existing `@substrate-system/tapzero` + `preact` `render()`
  harness (see `test/feed-status.ts`, `test/sidebar-footer-refresh.ts`).
- Assert **behavior**, not brittle HTML text: button present when status
  is `'updates'`, absent for `synced`/`syncing`/`error`/`inactive`; a
  click invokes `State.refreshFeeds` exactly once; a click while
  `refreshInProgress` is true dispatches no second fetch. A single
  accessible-name check is justified because the exact label "fetch
  updates" is a hard requirement (FR-008), but avoid asserting other DOM
  text strings.
- Reuse the `withStubbedFetch` / `withStubbedWebSocket` / stub-SSE helpers
  from `test/sidebar-footer-refresh.ts` for the click-dispatch case.
