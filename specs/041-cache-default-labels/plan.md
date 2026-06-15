# Implementation Plan: Show concrete default in per-feed cache labels

**Branch**: `041-cache-default-labels` | **Date**: 2026-06-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/041-cache-default-labels/spec.md`

## Summary

Replace the vague per-feed cache field hint "blank = default" with a hint
that names the concrete account-level default the feed falls back to when the
field is left blank — e.g. `Max size (default, 50 MB)` and
`Keep for (default, 30 days)`. This is a presentation-only change: it reads
the existing account-default signals (`defaultMaxSizeBytes`,
`defaultMaxAgeSeconds`) and renders them with the same bytes→MB / seconds→days
rounding the account-level cache editor already uses, so the per-feed hint and
the account editor never disagree. No schema, sync, or behavior changes.

## Technical Context

**Language/Version**: TypeScript (browser, ES2022 lib via Vite)
**Primary Dependencies**: Preact, `@preact/signals`, `htm/preact`
**Storage**: N/A — reads existing per-DID client signals
(`local-first-settings.ts`, hydrated from `localStorage`). No local SQLite,
DO SQLite, or `/api/sync` change.
**Testing**: existing client test suite (tapout / browser tests)
**Target Platform**: Browser SPA (Cloudflare Workers worker is untouched)
**Project Type**: web (frontend + backend; this feature is frontend-only)
**Performance Goals**: N/A — render-time string formatting only
**Constraints**: TypeScript ≤80 cols; reuse existing color/CSS variables (no
CSS change expected); no network on the render path
**Scale/Scope**: 2 render call sites + 1 small shared formatting helper

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against RSSS Constitution v1.0.0 (principles I–V):

- **I. Local-First Reads** — PASS. The hint reads existing client signals
  (`defaultMaxSizeBytes`, `defaultMaxAgeSeconds`) at render time. No network
  call is added; these are settings signals, not adapter-backed reads, so the
  render path is unchanged online/offline.
- **II. Idempotent, Outbox-Backed Sync** — N/A. No mutation, no outbox entry,
  no `/api/sync` payload change. The "schema and sync changes are coupled"
  workflow gate does not apply: no rendered DO column is added or changed.
- **III. Edge-Native Topology** — N/A. No worker, Durable Object, alarm, or
  parser change.
- **IV. Capability-Gated Progressive Enhancement** — PASS. The signals read by
  the hint exist and resolve identically under both `localAdapter` and
  `remoteAdapter`; the hint renders the same in both modes. No feature is made
  local-first-only.
- **V. Bluesky-Anchored Identity** — N/A. No auth/session change.

**Result: PASS — no violations. Complexity Tracking not required.**

## Project Structure

### Documentation (this feature)

```text
specs/041-cache-default-labels/
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (UI hint + helper contract)
├── checklists/          # Pre-existing (requirements.md)
└── tasks.md             # Phase 2 output (/speckit.tasks - NOT created here)
```

### Source Code (repository root)

```text
src/client/
├── local-first-settings.ts      # account-default signals live here;
│                                 #   add shared hint-formatting helper(s)
├── components/
│   └── cache-settings.ts        # per-feed cache panel (call site 1)
└── routes/
    └── settings.ts              # per-feed list in Subscriptions (call site 2)
```

**Structure Decision**: Web app (existing `src/client` + `src/server`). This
feature is confined to `src/client`. The two render call sites that currently
print "blank = default" are
`src/client/components/cache-settings.ts:295,306` and
`src/client/routes/settings.ts:924,937`. A single shared formatting helper is
added to `src/client/local-first-settings.ts` (co-located with the
account-default signals it formats) so both call sites stay consistent and the
degrade case is handled in one place — satisfying FR-006 (same rounding) and
FR-007 (consistent everywhere).

## Complexity Tracking

> No constitutional violations. No entries required.
