# Implementation Plan: Disable Cache Settings Link When Caching Off

**Branch**: `027-disable-cache-settings-link` | **Date**: 2026-05-31 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/027-disable-cache-settings-link/spec.md`

## Summary

On the `/settings` page, each subscribed feed row exposes a per-feed
"Cache settings" control rendered as a native `<details>`/`<summary>`
disclosure. Today it is always interactive, even when device-level
caching is off — a misleading affordance. This feature gates that
control on the same device caching condition that already governs the
page's global cache controls: the existing
`cacheDisabled = !isLocalFirstActive` computed signal in
`src/client/routes/settings.ts`.

Technical approach: when `cacheDisabled` is true, render the per-feed
disclosure in a disabled state — add an `is-disabled` class (reusing
the global `opacity: 0.55` treatment), set `aria-disabled="true"` and
`tabindex="-1"` on the `<summary>`, suppress the native toggle via a
guarded `onClick`/`onKeyDown`, and force the disclosure collapsed
(`open=false`) so an already-open panel closes when caching is turned
off. The change is purely client-side UI; it reacts to
`isLocalFirstActive` through signals, so toggling caching updates every
feed row without a reload. No data model, sync, or server change.

## Technical Context

**Language/Version**: TypeScript (browser, ES2022 lib via Vite)
**Primary Dependencies**: Preact, `@preact/signals`, `htm/preact`
**Storage**: N/A — UI-only. Reuses the existing client signal
`isLocalFirstActive` from `src/client/db/sync-status.ts`; no local
SQLite, DO SQLite, or `/api/sync` payload change.
**Testing**: `@substrate-system/tapzero` browser tests via
`node test/run-all-tests.mjs` (`npm test`); existing coverage in
`test/settings-route.ts`. Lint via `eslint` (`npm run lint`).
**Target Platform**: Modern evergreen browsers (Cloudflare Workers app
frontend served by Vite/`@cloudflare/vite-plugin`).
**Project Type**: Web application — this feature touches the frontend
client only.
**Performance Goals**: No perceptible regression. Per-feed controls
update reactively from `isLocalFirstActive` with no page reload
(FR-005, SC-004).
**Constraints**: TypeScript lines <= 80 columns; CSS colors from
`_variables.css`; font sizes >= 1rem; reuse the existing disabled
treatment (`opacity: 0.55`) for visual consistency (FR-009, SC-006);
disabled state conveyed to assistive tech beyond color/opacity
(`aria-disabled`, removed from tab order) (FR-008); MUST NOT modify CSS
unrelated to this control.
**Scale/Scope**: One route component (`settings.ts`), its stylesheet
(`settings.css`), and one test file (`test/settings-route.ts`). The
affected element is the `.feed-cache-controls` disclosure inside each
row of the Subscribed Feeds list.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Local-First Reads** — Not affected. No read paths added or
  changed; no adapter calls. PASS.
- **II. Idempotent, Outbox-Backed Sync** — Not affected. No mutations,
  no outbox entries, no sync payload change. PASS.
- **III. Edge-Native Topology** — Not affected. No worker or Durable
  Object change; entirely client-render-time UI. PASS.
- **IV. Capability-Gated Progressive Enhancement** — Directly aligned.
  The feature reuses the existing capability gate (`isLocalFirstActive`,
  surfaced as `cacheDisabled`) that already drives the global cache
  controls. It does not introduce a new capability, and does not make
  any feature local-first-only — it only reflects the existing gate on
  one more control. PASS.
- **V. Bluesky-Anchored Identity** — Not affected. PASS.

**Coding-standard gates:** No new colors (opacity-only treatment, reuses
`0.55`); no font-size change; 80-col TS; nested CSS selectors under
`.feed-cache-controls`; no unrelated CSS touched. PASS.

**Result:** No violations. Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/027-disable-cache-settings-link/
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output (manual verification)
├── contracts/
│   └── per-feed-cache-control.md  # Phase 1 UI behavior contract
├── spec.md              # Feature specification
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/client/
├── routes/
│   ├── settings.ts      # SettingsRoute; per-feed `.feed-cache-controls`
│   │                    #   disclosure (lines ~778-854). `cacheDisabled`
│   │                    #   computed already defined (lines ~132-134).
│   └── settings.css     # `.feed-cache-controls` styles (lines ~352-361);
│                        #   global `.cache-section.is-disabled` (276-278).
└── db/
    └── sync-status.ts   # `isLocalFirstActive` signal (source of truth).

test/
└── settings-route.ts    # tapzero tests; existing global-cache disabled
                         #   tests at ~346-438 are the pattern to mirror.
```

**Structure Decision**: Web application, but this feature is confined to
the frontend client. All production changes live in
`src/client/routes/settings.ts` and `src/client/routes/settings.css`;
verification lives in `test/settings-route.ts`. No `backend/` or
server-side files are touched, consistent with Constitution Principle III
(no edge-topology change).

## Complexity Tracking

> No constitutional violations. Section intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none)    | —          | —                                   |
