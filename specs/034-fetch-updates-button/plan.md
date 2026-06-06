# Implementation Plan: Fetch Updates Button

**Branch**: `034-fetch-updates-button` | **Date**: 2026-06-05 | **Spec**:
[spec.md](./spec.md)
**Input**: Feature specification from
`/specs/034-fetch-updates-button/spec.md`

## Summary

When the header feed-status indicator shows "N updates", render a small
"fetch updates" button immediately to the right of that text. The button
is an additional entry point to the existing `State.refreshFeeds(state)`
action used by the sidebar "Refresh Feeds" control — it adds no new fetch
logic, no new network call, and no new state. It is shown only while
`displayedFeedSyncStatus === 'updates'`, so it disappears the moment a
fetch starts (indicator flips to "updating") or finishes ("up to date").
In-progress feedback and re-entrancy come for free by reusing the shared
`Button` component bound to `state.refreshInProgress`, exactly as the
sidebar control does.

## Technical Context

**Language/Version**: TypeScript (browser, ES2022 lib via Vite)
**Primary Dependencies**: Preact, `@preact/signals`, `htm/preact`
**Storage**: N/A — UI-only. No local SQLite, DO SQLite, or `/api/sync`
payload change.
**Testing**: `@substrate-system/tapzero` via `node test/run-all-tests.mjs`
(`npm test`); component tests render with `preact` `render()` into a JSDOM
`document` and assert behavior (existing `test/feed-status.ts`,
`test/sidebar-footer-refresh.ts`).
**Target Platform**: Modern browsers (desktop header surface)
**Project Type**: Web application (Cloudflare Worker server + Preact
client); this feature touches the client only.
**Performance Goals**: No new render-path cost; button mounts/unmounts
from an existing computed signal. No measurable impact.
**Constraints**: TypeScript ≤80 cols, no space after `:` in type
annotations, ternaries break per branch; colors from CSS variables; font
size ≥1rem; multi-signal writes via `batch()` (none added here). Reuse
existing colors/components before introducing new ones.
**Scale/Scope**: One component edit (`feed-status.ts`), one CSS edit
(`feed-status.css`), plus tests. No server, schema, or sync changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Local-First Reads** — PASS. No new read path. The button does not
  read data; the indicator state it keys off
  (`displayedFeedSyncStatus`, `feedUpdateCounts`) is already populated by
  existing local-first/remote flows.
- **II. Idempotent, Outbox-Backed Sync** — PASS. No new mutation. The
  button calls the existing `State.refreshFeeds`, which POSTs
  `feeds/refresh` (a refresh trigger, not an outbox mutation) — unchanged.
  No outbox, `/api/sync`, or schema coupling is introduced.
- **III. Edge-Native Topology** — PASS. No server, Worker, or Durable
  Object change.
- **IV. Capability-Gated Progressive Enhancement** — PASS. `refreshFeeds`
  already works identically under `localAdapter` and `remoteAdapter`; the
  new entry point inherits that. The feature is not local-first-only.
- **V. Bluesky-Anchored Identity** — PASS. No auth change. The component
  already short-circuits to `null` when `state.user` is unset.

No violations. Complexity Tracking is empty.

**Post-Design re-check**: Still PASS. The design adds only presentation
(a conditionally-rendered button + layout CSS) and reuses the existing
action and `Button` component; it introduces no new principle surface.

## Project Structure

### Documentation (this feature)

```text
specs/034-fetch-updates-button/
├── plan.md              # This file
├── spec.md              # Feature spec (input)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── fetch-updates-button.md   # Phase 1 UI contract
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/client/
├── components/
│   ├── feed-status.ts        # EDIT: render "fetch updates" button for
│   │                         #       the 'updates' status, wired to
│   │                         #       State.refreshFeeds + refreshInProgress
│   ├── feed-status.css       # EDIT: layout for indicator + button;
│   │                         #       responsive hide mirrors the legend
│   ├── button.ts             # REUSE (unchanged): shared Button with
│   │                         #       isSpinning -> disabled + aria-busy
│   ├── sidebar-footer.ts     # REFERENCE (unchanged): the existing
│   │                         #       "Refresh Feeds" entry point pattern
│   └── header.ts             # REFERENCE (unchanged): renders <FeedStatus>
└── state.ts                  # REFERENCE (unchanged): State.refreshFeeds,
                              #       refreshInProgress, feedUpdateCounts,
                              #       displayedFeedSyncStatus

test/
├── feed-status.ts            # EDIT: add presence/absence + a11y cases
└── fetch-updates-button.ts   # NEW (optional): click dispatches one
                              #       refreshFeeds; re-entrancy guard;
                              #       (mirrors sidebar-footer-refresh.ts)
```

**Structure Decision**: Existing web-app layout (`src/client`, `test/`).
The change is localized to the `FeedStatus` component and its stylesheet.
The button reuses `components/button.ts` and the `State.refreshFeeds`
action so the two entry points cannot diverge (FR-003, SC-003,
spec "Forbidden divergence" edge case).

## Design Decisions

1. **One action, two entry points.** The button's `onClick` is
   `() => State.refreshFeeds(state)` — byte-for-byte the same handler the
   sidebar "Refresh Feeds" button uses. No fetch logic is duplicated, so
   the outcomes are identical by construction (FR-003, SC-003).

2. **Gate on `displayedFeedSyncStatus === 'updates'`.** The button is
   rendered only in the existing `'updates'` branch of `FeedStatus`. This
   gives FR-001/FR-002/FR-004/FR-007/FR-009 for free: it shows for both
   "1 update" and "N updates", is absent for `synced`/`syncing`/`error`/
   `inactive`, and appears/disappears reactively because the gate is a
   computed signal. No manual reload (FR-009).

3. **Reuse `Button` bound to `state.refreshInProgress`** (`isSpinning`),
   identical to `SidebarFooter`. This yields the same in-progress feedback
   (`aria-busy`, `disabled`, spinner) and re-entrancy at the DOM level
   (FR-005, FR-006). `State.refreshFeeds` also guards on
   `state.refreshInProgress.value` at the top, so a click during any
   in-flight fetch (from either entry point) is a no-op (FR-006, SC-005).
   Note: because the indicator flips to `'syncing'` once
   `displayedRefreshInProgress` debounces true, the button normally
   unmounts during a fetch; the `isSpinning`/guard pair covers the
   ~300ms `SHOW_DELAY_MS` window before it does.

4. **Place the button outside the `role="status"` live region.** The
   indicator `<span class="feed-status" role="status" aria-live="polite">`
   announces the status text on change. To keep announcements clean ("6
   updates", not "6 updates fetch updates"), wrap the status span and the
   button in a container (`.feed-status-wrap`) and render the button as a
   sibling of the live region, preserving the existing `key=${status}`
   remount-to-reannounce behavior on the inner span.

5. **Accessible name = visible label "fetch updates".** A native
   `<button>` (rendered by `Button`) with the text "fetch updates"
   satisfies FR-008 (pointer + keyboard operable, accessible name conveys
   purpose). Label text is exactly "fetch updates" per the spec; no count
   is embedded.

6. **Responsive parity with the legend.** `feed-status.css` hides the
   legend text in the `680px ≤ width < 1000px` range for non-syncing
   states. Mirror that for the button (hide it in the same range) so the
   button never floats next to a hidden label. No unrelated CSS is
   touched; colors reuse existing `--color-primary` / button variables.

## Complexity Tracking

> No constitution violations. This section is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none)    | —          | —                                   |
