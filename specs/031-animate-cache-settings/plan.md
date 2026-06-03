# Implementation Plan: Animate Cache Settings Disclosure

**Branch**: `031-animate-cache-settings` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/031-animate-cache-settings/spec.md`

## Summary

The per-feed "Cache settings" disclosure in the Settings page "Subscribed
Feeds" list (`src/client/routes/settings.ts`, the native
`<details class="feed-cache-controls">`) toggles instantly, so the feed
card height jumps abruptly. The fix reuses the already-proven
`@substrate-system/details-summary` web component — the same one the
feed-reader's `CacheSettings` component uses — to animate the panel's
height open and close with the Web Animations API, honoring
`prefers-reduced-motion` via the `duration` attribute. No cache controls,
values, or behavior change; only the reveal/hide motion does.

## Technical Context

**Language/Version**: TypeScript (browser, ES2022 lib via Vite)
**Primary Dependencies**: Preact, `@preact/signals`, `htm/preact`,
`@substrate-system/details-summary` (already a dependency, already
imported via `src/client/style.css`)
**Storage**: N/A — presentation-only. No SQLite (local or DO) schema
change, no `/api/sync` payload change, no localStorage change.
**Testing**: `tapout` browser-DOM tests bundled with esbuild
(`test/settings-route.ts`), run via `npm test`
(`node test/run-all-tests.mjs`); plus manual browser verification.
**Target Platform**: Modern evergreen browsers (cross-origin-isolated
client app). The chosen approach animates identically on
Chromium/Firefox/WebKit.
**Project Type**: Web application (Cloudflare Worker + per-user Durable
Object backend; Preact client). This feature touches the **client only**.
**Performance Goals**: Continuous height transition at ~60 fps, no
single-frame jump (SC-001, SC-003); open/close each within ~150–300 ms
(SC-002).
**Constraints**: Reduced-motion preference toggles instantly with no
animation (SC-004); rapid toggles resolve to the user's final action with
no stuck/clipped state (SC-005); no functional regression to controls
(SC-006); CSS unrelated to this disclosure MUST NOT be modified.
**Scale/Scope**: One disclosure instance per subscribed feed in the
Settings "Subscribed Feeds" list. Single route file + its CSS + one test
file updated.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Local-First Reads** — Not engaged. No read paths added or changed;
  the disclosure renders already-loaded `feedPolicies` /
  `feedStorageBytes` signals. PASS.
- **II. Idempotent, Outbox-Backed Sync** — Not engaged. No mutations, no
  outbox entries, no new sync routes. PASS.
- **III. Edge-Native Topology** — Not engaged. Client-render-only change;
  no worker or Durable Object code touched. PASS.
- **IV. Capability-Gated Progressive Enhancement** — Engaged and
  preserved. The disclosure's disabled state stays gated on
  `isLocalFirstActive` (`cacheDisabled`); both `localAdapter` and
  `remoteAdapter` render paths reach this same UI unchanged. The
  animation is a pure visual enhancement that degrades to an instant
  toggle under reduced motion. No new capability gate, no service worker.
  PASS.
- **V. Bluesky-Anchored Identity** — Not engaged. PASS.
- **Schema/sync coupling gate** — Not engaged (no rendered column added
  or changed). PASS.
- **Idempotency review** — N/A (no new mutation route). PASS.
- **Capability fallback review** — UI works identically on local-first
  and remote adapters; no local-first-only behavior introduced. PASS.
- **Coding standards** — TypeScript ≤ 80 cols, no space before type
  annotation colon, ternaries broken per branch, multi-signal writes in
  `batch()`, CSS colors from variables, font sizes ≥ 1rem, nested
  selectors, no unrelated CSS. Enforced during implementation and by
  `npm run lint`. PASS.

**Result: PASS — no violations, no Complexity Tracking entries required.**

## Project Structure

### Documentation (this feature)

```text
specs/031-animate-cache-settings/
├── plan.md              # This file
├── spec.md              # Feature specification (input)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (no entities; rationale recorded)
├── quickstart.md        # Phase 1 output (manual verification steps)
├── contracts/
│   └── cache-settings-disclosure.md   # UI/behavior contract
└── checklists/          # Pre-existing
```

### Source Code (repository root)

```text
src/client/
├── routes/
│   ├── settings.ts      # CHANGE: wrap the per-feed Subscribed-Feeds
│   │                    #   cache <details> in the details-summary web
│   │                    #   component; add prefers-reduced-motion state;
│   │                    #   add .details-content wrapper; keep disabled
│   │                    #   semantics
│   └── settings.css     # CHANGE: scope --details-summary-* vars to the
│                        #   feed disclosure to preserve current look;
│                        #   add prefers-reduced-motion rule; disabled
│                        #   summary pointer-events
├── components/
│   └── cache-settings.ts  # REFERENCE ONLY — the existing, working
│                          #   pattern to mirror (feed-reader instance)
└── style.css            # NO CHANGE — already imports
                         #   "@substrate-system/details-summary/css"

test/
└── settings-route.ts    # CHANGE: update ~5 assertions from the native
                         #   `details.feed-cache-controls` shape to the
                         #   web-component shape (host
                         #   `.feed-cache-controls` is <details-summary>,
                         #   inner <details> via `.feed-cache-controls
                         #   details`), mirroring
                         #   test/feed-reader-cache-disclosure.ts; add
                         #   reduced-motion duration coverage
```

**Structure Decision**: Web-application layout with a `src/client`
Preact app. This feature is confined to the client Settings route
(`settings.ts` + `settings.css`) and its DOM test (`settings-route.ts`).
It reuses the existing `@substrate-system/details-summary` dependency and
mirrors the established `components/cache-settings.ts` usage rather than
introducing a new mechanism, so the two "Cache settings" disclosures
share one animation implementation.

## Complexity Tracking

> No Constitution Check violations. No entries required.
