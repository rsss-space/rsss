# Phase 1 Data Model: Disable Cache Settings Link When Caching Off

This feature introduces **no new persisted data** and **no schema
changes** — not in the local SQLite store, the Durable Object SQLite
store, or the `/api/sync` payload. It is render-time UI state derived
from existing client signals. The "entities" below are conceptual,
re-stated from the spec, and map to state that already exists.

## Conceptual entities (existing — no changes)

### Device caching state

- **Backing state**: `isLocalFirstActive:Signal<boolean>` in
  `src/client/db/sync-status.ts:15`.
- **Derived form used here**: `cacheDisabled = useComputed(() =>
  !isLocalFirstActive.value)` in `src/client/routes/settings.ts:132-134`.
- **Cardinality**: exactly one per device/session. There is no per-feed
  caching state; this single value drives every feed row (FR-004).
- **Transitions**: toggled on/off by the page's existing global cache
  controls. Any transition re-evaluates `cacheDisabled` reactively and,
  through it, every per-feed control's disabled state (FR-005). No new
  transition logic is added.

### Subscribed feed (in Settings) — render projection

- **Backing state**: the existing feed list rendered in the Subscribed
  Feeds section of `SettingsRoute` (`settings.ts:736-876`); each row maps
  to a `.feed-cache-controls` disclosure.
- **Derived UI fields added by this feature** (computed at render, not
  stored):
  - `isCacheControlDisabled` — equals `cacheDisabled.value`. Governs the
    `is-disabled` class, `aria-disabled`, `tabindex`, and forced-collapse
    of that row's disclosure.
- **Validation / invariants**:
  - The disabled projection MUST be identical for every feed row in a
    given render (single source: `cacheDisabled`) — no mixed states
    (FR-004, edge case "Multiple subscribed feeds").
  - The disabled projection MUST NOT affect any sibling element in
    `.feed-info` or the `.btn-delete` ("Unfollow") button (FR-006).
  - When no feeds are subscribed there are no projections to compute
    (edge case "No subscribed feeds").

## Out of scope (explicitly unchanged)

- Per-feed cache policy values (`cache_mode`, max size, max age) and the
  controls that edit them — only their *reachability* changes, gated by
  the disclosure being openable.
- `bootstrapLocalDb`, `pullSync`, the DO schema, and the `/api/sync`
  payload — untouched (Constitution Principle II coupling rule does not
  trigger because no rendered column is added or modified).
