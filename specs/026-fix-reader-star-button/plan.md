# Implementation Plan: Fix Reader Star Button Appearance

**Branch**: `026-fix-reader-star-button` | **Date**: 2026-05-29 | **Spec**:
[spec.md](./spec.md)
**Input**: Feature specification from
`/specs/026-fix-reader-star-button/spec.md`

## Summary

The star control on the feed item route (the reader, `item-reader.ts`)
currently renders as a boxed, button-styled control that sits next to the
"Mark read" / "Mark unread" button and shares its boxed treatment. The home
feed list (`item-row.ts`) already renders its star as a plain, borderless
icon that changes to the accent color on hover and shows a filled + accent
glyph when starred. This feature makes the reader's star match the home-row
star: a borderless icon, accent color on hover, filled/accent when starred,
while remaining keyboard-focusable with a visible focus ring and an
accessible name.

Technical approach: appearance-only change. The home row renders its star as
`<button class="btn-star ...">`; `.btn-star` (in `item-row.css`) is
borderless (`border:none; background:none`), grey at rest
(`--color-text-secondary`), and turns `--color-accent` on `:hover` and when
`.starred`. The reader instead renders `<button class="btn btn-icon ...">`,
and `btn`/`btn-icon` supply the boxed button look; `item-reader.css` only
adds a `.starred` accent color (no hover change). The fix swaps the reader
star's classes from `btn btn-icon` to the shared `btn-star`, mirrors the
home row's accessible-name span (`<span class="visually-hidden">star</span>`)
to satisfy FR-006, and drops the now-redundant `& .starred` rule under
`.reader-actions` (superseded by `.btn-star.starred`). No change to starring
behavior, the `is_starred` column, the outbox mutation, `/api/sync`, or any
adapter. The adjacent read/unread button (`btn btn-small`) and the rest of
the reader header are left untouched (FR-007).

## Technical Context

**Language/Version**: TypeScript (browser, ES2022 lib via Vite)
**Primary Dependencies**: Preact, `@preact/signals`, `htm/preact`; Vite 7 +
lightningcss CSS pipeline
**Storage**: N/A for this feature. The `is_starred` state is already
persisted (per-user DO SQLite, mirrored to local OPFS-SQLite). This change
touches presentation only and adds/modifies no column, payload, or schema.
**Testing**: Existing project test runner (`npm test`) + `npm run lint`;
manual browser verification of the reader star (resting/hover/starred/focus)
side by side with the home-row star.
**Target Platform**: Modern evergreen browsers (the RSSS Preact client).
**Project Type**: Web application (Cloudflare Worker + Durable Object
backend, Preact client). This change is client-only.
**Performance Goals**: No measurable impact; CSS/markup-only tweak to one
control. Must not introduce layout shift in the reader header.
**Constraints**: CSS unrelated to the star control MUST NOT be modified
(global rule + constitution). Colors MUST come from existing CSS variables;
reuse the accent color already used by the home-row star rather than
introducing a new one. No font size below 1rem. Lines <= 80 columns; no
space between colon and type annotation.
**Scale/Scope**: Single control on a single route. Expected change surface:
`src/client/routes/item-reader.ts` (markup/class only, if needed),
`src/client/routes/item-reader.css` (remove boxed styling for the star,
adopt borderless/accent/hover treatment), and possibly a small shared CSS
reuse from `src/client/components/item-row.css`. No new files required.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against RSSS Constitution v1.0.0 (principles I-V).

- **I. Local-First Reads** — PASS. No read path changes. The starred state
  is already read locally; this feature only restyles how the existing state
  is displayed.
- **II. Idempotent, Outbox-Backed Sync** — PASS. No mutation, outbox, or
  sync change. The existing star toggle (already outbox-backed and
  idempotent as a value assignment on `is_starred`) is untouched.
- **III. Edge-Native Topology** — PASS. No server, worker, or Durable
  Object change.
- **IV. Capability-Gated Progressive Enhancement** — PASS. The star renders
  and toggles identically under both `localAdapter` and `remoteAdapter`;
  this is a presentation change with no capability gating and no
  local-first-only behavior. No service worker added.
- **V. Bluesky-Anchored Identity** — PASS. No auth/session/identity change.

Coding-standard gates (from "Technology Stack & Coding Standards"):
- CSS colors from variables, reuse existing accent — IN SCOPE, enforced.
- Do not modify unrelated CSS — enforced; only the reader star selectors
  change.
- Nested selectors preferred over new class proliferation — followed.
- TS style (80 cols, no colon space, ternary line breaks) — followed if any
  TS markup changes are needed.
- Local verification: UI exercised in a browser before claiming complete —
  required by the constitution and by this plan's verification step.

**Result (initial)**: No violations. Complexity Tracking is not required.

**Post-design re-check**: After Phase 1, the design is a class swap on one
button (`btn btn-icon` -> `btn-star`), a mirrored accessible-name span, and
removal of one redundant CSS rule — reusing the existing `--color-accent`
variable and the existing shared `.btn-star` definition. No read path,
mutation, sync payload, schema, server, DO, auth, or service-worker surface
is touched, and no new color or unrelated CSS is introduced. All five
principles still PASS; no new violations introduced by the design.

## Project Structure

### Documentation (this feature)

```text
specs/026-fix-reader-star-button/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── checklists/          # Pre-existing checklist(s) for this feature
└── spec.md              # Feature specification
```

No `contracts/` directory: this is a UI-only appearance change with no new
external interface, API endpoint, schema, or command surface.

### Source Code (repository root)

```text
src/
├── client/
│   ├── _variables.css          # Defines --color-accent (#f59e0b) and
│   │                           #   --color-text-secondary (reused, unchanged)
│   ├── routes/
│   │   ├── item-reader.ts      # PRIMARY: star button classes
│   │   │                       #   `btn btn-icon` -> `btn-star`; add
│   │   │                       #   visually-hidden "star" label span
│   │   └── item-reader.css     # Remove redundant `.reader-actions .starred`
│   │                           #   rule (superseded by `.btn-star.starred`)
│   └── components/
│       ├── item-row.ts         # REFERENCE (read-only): home-row star markup
│       └── item-row.css        # REFERENCE (read-only): defines `.btn-star`;
│                               #   already bundled app-wide, so the class is
│                               #   available on the reader route
└── shared/
    └── schema.ts               # Unchanged (is_starred already exists)
```

**Structure Decision**: Single client-side web app under `src/client`. The
change is localized to the reader route's star control. The `.btn-star`
treatment already exists in `item-row.css`; because Vite bundles all
module-imported CSS into one global stylesheet and the feed list (which
imports `item-row.css`) is always part of the app, `.btn-star` is available
app-wide without a new import. The implementation therefore reuses the
existing shared class rather than duplicating rules. `item-row.{ts,css}` is
read-only reference (the approved design). No backend, shared, or
service-worker code is touched. (If a future refactor wants the star style
to stop depending on a class physically defined in `item-row.css`, promoting
`.btn-star` into a small shared stylesheet is an optional cleanliness
follow-up, out of scope here.)

## Complexity Tracking

> No Constitution Check violations. This section intentionally left empty.
