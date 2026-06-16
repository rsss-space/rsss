# Implementation Plan: Stable Cache Settings Width

**Branch**: `042-fix-cache-settings-width` | **Date**: 2026-06-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/042-fix-cache-settings-width/spec.md`

## Summary

On the Settings page, each subscribed feed renders a right-hand controls
column (`.feed-controls`) holding the "Cache settings" disclosure and the
"Unfollow" button. The disclosure is a native `<details>` wrapped by
`@substrate-system/details-summary`; when collapsed, the browser removes the
cache form (`.details-content`) from layout, so the content-sized,
`flex-shrink:0` column shrinks to fit only "Cache settings" + "Unfollow".
Because the row is `justify-content: space-between` with `.feed-info` taking
`flex:1`, the narrower collapsed column moves its left edge rightward and the
left-aligned "Cache settings" label snaps sideways — the reported jank.

The fix is presentation-only: reserve the expanded width on `.feed-controls`
(via `min-width`) so the column is always wide enough for the open form. The
column width then never changes on open/close, the label stays put, and all
rows share one straight column edge. The disclosure component animates only
`height` (it never sets `width`), so the existing 031 open/close animation is
unaffected. Change is confined to `src/client/routes/settings.css`.

## Technical Context

**Language/Version**: TypeScript (browser, ES2022 lib via Vite); the change
itself is CSS only.
**Primary Dependencies**: Preact, `@preact/signals`, `htm/preact`,
`@substrate-system/details-summary` (disclosure; height-only animation).
**Storage**: N/A — presentation-only. No local SQLite, DO SQLite, or
`/api/sync` payload change.
**Testing**: existing client test suite (tapout / browser); primary
verification is manual in-browser per the constitution (layout is not
computed in jsdom).
**Target Platform**: Browser SPA (Settings route). Cloudflare Workers worker
and Durable Object are untouched.
**Project Type**: web (frontend + backend; this feature is frontend-only).
**Performance Goals**: N/A — static CSS layout; no new render or network work.
**Constraints**: TypeScript/CSS ≤80 cols; reuse existing CSS variables, add no
new color; do NOT touch CSS unrelated to the task; reserved width must not
clip controls (FR-005) or force page horizontal scroll at supported widths.
**Scale/Scope**: one CSS rule on `.feed-controls` in `settings.css` (plus, if
needed, a width-bound on the cache form). No TS/markup change expected.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against RSSS Constitution v1.0.0 (principles I–V):

- **I. Local-First Reads** — N/A. No read path, adapter, or network call is
  added or changed. Pure CSS layout.
- **II. Idempotent, Outbox-Backed Sync** — N/A. No mutation, outbox entry, or
  `/api/sync` payload change. The "schema and sync changes are coupled"
  workflow gate does not apply: no rendered DO column is added or changed.
- **III. Edge-Native Topology** — N/A. No worker, Durable Object, alarm, or
  parser change.
- **IV. Capability-Gated Progressive Enhancement** — PASS. The Settings
  feeds list renders identically under `localAdapter` and `remoteAdapter`;
  reserving the column width changes nothing about capability gating and the
  layout is the same in both modes.
- **V. Bluesky-Anchored Identity** — N/A. No auth/session change.

**Constitution-derived coding gates that DO apply:**

- CSS: reuse variables from `_variables.css`/`_vars.css`; introduce no new
  color (this change adds only a width dimension — no color involved).
- CSS unrelated to the task MUST NOT be modified (global rule).
- Local verification: UI MUST be exercised in a browser before completion;
  type-check/test pass alone is insufficient (see quickstart.md).

**Result: PASS — no violations. Complexity Tracking not required.**

## Project Structure

### Documentation (this feature)

```text
specs/042-fix-cache-settings-width/
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (N/A — presentation-only)
├── quickstart.md        # Phase 1 output (manual verification steps)
├── contracts/           # Phase 1 output (UI layout contract)
├── checklists/          # Pre-existing (requirements.md)
└── tasks.md             # Phase 2 output (/speckit.tasks - NOT created here)
```

### Source Code (repository root)

```text
src/client/
├── routes/
│   ├── settings.ts      # Renders .settings-feed-item > .feed-info +
│   │                    #   .feed-controls (cache disclosure + Unfollow).
│   │                    #   No change expected; markup already correct.
│   └── settings.css     # THE change: reserve stable width on
│                        #   .feed-controls (min-width) so open/close does
│                        #   not resize the column. (lines ~351-419 region)
└── components/
    └── cache-settings.ts  # Separate disclosure used by the reader surface,
                           #   NOT the Settings feeds list. Out of scope.
```

**Structure Decision**: Existing web app (`backend/`, `frontend/`-style split
under `src/server` and `src/client`). This feature edits exactly one client
stylesheet, `src/client/routes/settings.css`, scoped to the `.feed-controls`
column on the Settings page. The Settings page renders the cache form inline
in `settings.ts` (lines ~861-986), not via `components/cache-settings.ts`, so
that component is out of scope.

## Complexity Tracking

> No constitution violations. No entries required.
