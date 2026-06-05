# UI Contract: Fetch Updates Button

This is a UI contract (the project exposes no new API for this feature).
It defines the observable behavior the implementation and tests must
satisfy. Each clause maps to spec requirements.

## Component surface

- Location: rendered by `FeedStatus`
  (`src/client/components/feed-status.ts`), inside the desktop header
  (`components/header.ts`), adjacent to the "N updates" indicator text.
- Element: a native `<button>` (via the shared `Button` component) with
  accessible name **"fetch updates"** (exact text; no embedded count).

## Visibility

| Indicator status (`displayedFeedSyncStatus`) | Button shown? | Req |
|----------------------------------------------|---------------|-----|
| `'updates'` (count ≥ 1, incl. "1 update")    | Yes           | FR-001, FR-004 |
| `'synced'` ("up to date")                     | No            | FR-002 |
| `'syncing'` ("updating")                      | No            | FR-002 |
| `'error'` ("sync failed")                     | No            | FR-002, edge case |
| `'inactive'`                                  | No            | FR-002 |

- Visibility reacts to signal changes with no page reload (FR-009): when
  status transitions into `'updates'`, the button appears; when it leaves
  `'updates'`, the button disappears.
- The button is positioned immediately to the right of the "N updates"
  text and outside the `role="status"` live region, so the status
  announcement is unchanged (Decision 4).

## Activation

- A pointer click or keyboard activation invokes
  `State.refreshFeeds(state)` — the same action as "Refresh Feeds"
  (FR-003, SC-003). The outcome (what is fetched) is identical.
- A single activation results in **exactly one** `feeds/refresh` POST
  (SC-003).

## In-progress feedback & re-entrancy

- While `state.refreshInProgress` is true, the button reflects the busy
  state the way `Button` does for "Refresh Feeds": `disabled` and
  `aria-busy="true"` (FR-005).
- An activation while a fetch is already in progress — started from
  either entry point — dispatches **no** additional fetch (FR-006,
  SC-005). Enforced twice: the `Button` `disabled` state and the
  `if (state.refreshInProgress.value) return` guard in
  `State.refreshFeeds`.
- Once a fetch completes and feeds are up to date, the count and the
  button are no longer shown (FR-007) — a consequence of the visibility
  table (status leaves `'updates'`).

## Accessibility

- Operable by pointer and keyboard; exposes an accessible name conveying
  purpose ("fetch updates") (FR-008).
- Responsive: hidden in the `680px ≤ width < 1000px` range, mirroring the
  legend text (Decision 5) so it never appears without its anchoring
  label.

## Non-goals / invariants

- The existing "Refresh Feeds" sidebar control is unchanged (Assumption).
- No new fetch behavior; results must always match "Refresh Feeds"
  (spec "Forbidden divergence" edge case).
- No server, schema, sync, or auth change.
