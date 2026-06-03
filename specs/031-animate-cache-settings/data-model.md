# Phase 1 Data Model: Animate Cache Settings Disclosure

**Feature**: 031-animate-cache-settings
**Date**: 2026-06-02

## Entities

**None.** This feature is presentation-only (spec "Key Entities":
introduces no new data entities). It changes the *manner* in which the
existing per-feed cache controls are revealed and hidden — nothing about
the data they read or write.

Confirmation against the constitution's schema/sync coupling gate
(Principle II): this change adds and modifies **no** rendered column, so
none of the coupled artifacts are touched:

| Coupled artifact (Principle II)        | Change required? |
|----------------------------------------|------------------|
| Durable Object SQLite schema           | No               |
| `/api/sync` payload                    | No               |
| `bootstrapLocalDb`                     | No               |
| Local SQLite schema (`local-schema.ts`)| No               |
| `pullSync` upsert logic                | No               |
| Outbox / mutation routes               | No               |
| localStorage (paint cache, settings)   | No               |

## Existing data this UI reads (unchanged)

The disclosure renders, but does not modify, these already-loaded client
signals:

- `feedPolicies` (`src/client/db/feed-cache-policy.ts`) — per-feed cache
  mode / max size / max age, used to populate the select and inputs.
- `feedStorageBytes` (`src/client/db/storage-usage.ts`) — bytes cached
  per feed, shown in the card.
- `isLocalFirstActive` (`src/client/db/sync-status.ts`) — drives the
  `cacheDisabled` computed that disables the disclosure.

The controls' existing change handlers (`handleFeedCacheModeChange`,
`handleFeedMaxSizeChange`, `handleFeedMaxAgeChange`,
`handleClearFeedCache`) are unchanged. The only new client state is
ephemeral, render-only UI state:

- `prefersReducedMotion:boolean` — local component state mirrored from
  `matchMedia('(prefers-reduced-motion: reduce)')`, used solely to choose
  the disclosure's animation `duration`. Not persisted anywhere.

## State transitions (disclosure, not data)

The only "state machine" here is the disclosure's open/closed visual
state, owned by the `@substrate-system/details-summary` web component:

```
collapsed ──(activate, animate height up)──▶ expanded
expanded  ──(activate, animate height down)─▶ collapsed
(reduced motion: same transitions, 0 ms duration → instant)
(disabled: activation is a no-op; stays collapsed, non-interactive)
(rapid re-activation: in-flight animation cancels and retargets to the
 state matching the most recent activation)
```

No data is created, updated, or deleted by these transitions.
