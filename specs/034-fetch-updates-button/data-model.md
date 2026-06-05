# Phase 1 Data Model: Fetch Updates Button

**Status**: N/A — no persistent data model change.

This feature is presentation-only. It adds no column to the local SQLite
schema, the Durable Object SQLite schema, the `/api/sync` payload,
`bootstrapLocalDb`, or `pullSync`. No new mutation or outbox entry is
introduced. Per the constitution's "schema and sync changes are coupled"
rule, there is nothing to couple here because no rendered column changes.

## Reused client state (no shape change)

The button is driven entirely by existing signals on `AppState`
(`src/client/state.ts`):

| Signal | Type | Role in this feature |
|--------|------|----------------------|
| `displayedFeedSyncStatus` | `ReadonlySignal<'inactive'\|'updates'\|'syncing'\|'error'\|'synced'>` | Gate: button renders only when value is `'updates'`. |
| `feedUpdateCounts` | `Signal<Record<string, number>>` | Already summed by `FeedStatus` to label "N updates"; unaffected by the button. |
| `refreshInProgress` | `ReadonlySignal<boolean>` | Passed to `Button` `isSpinning` for in-progress feedback + DOM-level re-entrancy. |

## Reused action (no signature change)

| Action | Signature | Role |
|--------|-----------|------|
| `State.refreshFeeds` | `(state:AppState) => Promise<void>` | The button's `onClick`. Owns the re-entrancy guard, refresh refcount, SSE lifecycle, safety timeout, and error/restore. Identical to the sidebar entry point. |

## State transitions (observed, not new)

The button does not introduce transitions; it reads the existing ones:

```
status === 'updates'  -> button shown
click -> State.refreshFeeds -> refreshInProgress=true
  -> (after SHOW_DELAY_MS) displayedFeedSyncStatus='syncing' -> button unmounts
  -> SSE refresh-complete -> status -> 'updates' (new items) | 'synced'
     (none) | 'error' (failure); button re-mounts iff status==='updates'
```
