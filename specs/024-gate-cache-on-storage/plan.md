# Implementation Plan: Gate Cache Section On Local Storage

**Branch**: `024-gate-cache-on-storage` | **Date**: 2026-05-27 |
**Spec**: [spec.md](./spec.md)
**Input**: Feature specification from
`/specs/024-gate-cache-on-storage/spec.md`

## Summary

When local-storage sync is not active, the global Cache section on
`/settings` must render visibly inert (reduced opacity) and every
control inside it must be disabled — radios in the cache-mode
fieldset and the three numeric inputs (per-feed max size, total cache
size, retention days). Existing per-feed cache controls further down
the settings page are out of scope.

The technical approach is client-only. The settings route already
imports the `isLocalFirstActive` signal (the canonical
"sync is fully bootstrapped" state). We derive `cacheDisabled` from
that signal, apply the HTML `disabled` attribute to the
`<fieldset>` (which cascades to its radios) and to each numeric
`<input>`, and toggle a single `is-disabled` class on
`<section class="settings-section cache-section">`. CSS uses
`opacity` on that class and lets native `:disabled` styling handle
pointer-events, focus skipping, and AT exposure. No SQLite schema,
no Durable Object change, no sync protocol change, no new dependency.

## Technical Context

**Language/Version**: TypeScript (browser, ES2022 lib via Vite for
the client bundle)
**Primary Dependencies**: Preact, `@preact/signals`, `htm/preact`
(template literal JSX). No new dependencies.
**Storage**: N/A. The feature is UI-state lifecycle only — no SQLite
schema change, no Durable Object schema change, no local-storage
keys added.
**Testing**: Existing Vitest + JSDOM client harness used by the rest
of `src/client/routes/settings.ts` tests. Manual browser verification
per Principle "Local verification" — exercise the toggle in both
directions with `npm start` open.
**Target Platform**: Modern evergreen browsers (Chromium, Firefox,
Safari) that the rest of the app already supports.
**Project Type**: Web application (existing Cloudflare Worker + Preact
SPA). No new project surface.
**Performance Goals**: No measurable performance budget. The change
is a derived boolean and a class toggle; cost is negligible compared
to the existing signal-driven re-render on this page.
**Constraints**: Must not introduce flicker during the
`syncSubscriptions -> bootstrapping -> isLocalFirstActive=true`
transition (see Edge Cases in spec). Must keep section text legible
(reduced opacity, not hidden). Must not change the per-feed cache
controls (out of scope).
**Scale/Scope**: One settings page, one section, four controls (one
fieldset + three number inputs). One CSS class. ~25 lines of code
total.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-evaluated after Phase 1
design (see "Post-Design Constitution Check" below).*

Evaluated against the five principles in `.specify/memory/constitution.md`:

- **I. Local-First Reads.** N/A. This feature reads only existing
  client signals (`isLocalFirstActive`, the four `defaultCache*`
  signals already shown). It introduces no new read path, so no
  `localAdapter`/`remoteAdapter` change is needed.
- **II. Idempotent, Outbox-Backed Sync.** N/A. The feature adds no
  mutations. Disabling a control means it cannot be changed; nothing
  is written or queued.
- **III. Edge-Native Topology.** N/A. No server-side change. The
  Worker, the per-user Durable Object, and its SQLite schema are all
  untouched.
- **IV. Capability-Gated Progressive Enhancement.** **Directly
  applicable and in line.** The Cache section's effective behaviour
  is bound to a capability (local-first sync is active). Today the
  controls look interactive even when the capability is off, which
  silently breaks the principle's expectation that capability gates
  shape the UI. This change re-aligns the UI with the existing
  capability gate by surfacing it visually and behaviourally. The
  section is *not* hidden — it remains a visible placeholder that
  communicates what the user would get if they enabled local storage,
  consistent with "fallback as a peer" rather than "feature removed."
- **V. Bluesky-Anchored Identity.** N/A. No auth surface touched.

**Result**: Gate passes. No principle violation; no Complexity
Tracking entry required.

## Project Structure

### Documentation (this feature)

```text
specs/024-gate-cache-on-storage/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── quickstart.md        # Phase 1 output (manual verification recipe)
├── spec.md              # Feature specification (existing)
└── checklists/          # Existing checklists directory
```

No `data-model.md` is produced — the feature introduces no entities,
columns, or persisted state.

No `contracts/` directory is produced — the feature changes neither
HTTP routes, the `/api/sync` payload, nor any client/server contract.

### Source Code (repository root)

The feature touches exactly two existing files in the client. All
other paths are listed for orientation only.

```text
src/
├── client/
│   ├── routes/
│   │   ├── settings.ts   # MODIFIED: derive `cacheDisabled` from
│   │   │                 #   `isLocalFirstActive`; pass `disabled`
│   │   │                 #   to the cache-mode <fieldset> and the
│   │   │                 #   three numeric <input>s; toggle the
│   │   │                 #   `is-disabled` class on
│   │   │                 #   <section class="cache-section">.
│   │   └── settings.css  # MODIFIED: add a single rule
│   │                     #   `.cache-section.is-disabled { opacity:
│   │                     #   ...; }`. No other CSS touched
│   │                     #   (per Principle "CSS unrelated to the
│   │                     #   current task MUST NOT be modified").
│   ├── state.ts          # READ-ONLY in this feature; exports
│   │                     #   `isLocalFirstActive`.
│   └── local-first-settings.ts
│                         # READ-ONLY; exports `syncSubscriptions`
│                         #   etc. (not the gating signal, but
│                         #   relevant for cross-reference).
└── server/               # UNCHANGED.

tests/
└── client/               # New Vitest spec(s) live alongside other
                          #   settings tests (named in Phase 2).
```

**Structure Decision**: This is a single-file UI surgery inside the
existing Preact client. The "web application" layout already in use
is unchanged; no new directories or modules are introduced.

## Phase 0: Research

See [research.md](./research.md). Two questions were resolved:

1. **Which signal gates the Cache section?** `isLocalFirstActive`
   from `src/client/state.ts`, not the raw `syncSubscriptions`
   setting. Rationale: `isLocalFirstActive` flips true only after
   the OPFS bootstrap finishes, which automatically satisfies the
   "no flicker during bootstrap" edge case (spec §Edge Cases). If we
   gated on `syncSubscriptions` directly, the section would briefly
   enable mid-bootstrap, then re-disable if the bootstrap failed.

2. **How to disable the cache-mode radios as a group.** Use the
   `disabled` attribute on the existing
   `<fieldset class="cache-mode-group">`. The HTML spec cascades
   `:disabled` from a disabled fieldset to all its form controls,
   AT exposes them as disabled, and Tab navigation skips them —
   meeting FR-006 and the keyboard-skip edge case with zero JS.
   Numeric inputs are not inside that fieldset, so each gets its own
   `disabled` attribute.

No NEEDS CLARIFICATION markers remained after research.

## Phase 1: Design & Contracts

**Prerequisites:** `research.md` complete (yes).

### Data model

No entities, no schema changes, no persistence. `data-model.md` is
intentionally omitted.

### Contracts

No external interface changes (no HTTP routes, no payload shapes, no
component public API additions). `contracts/` is intentionally
omitted. The internal-only "contract" is one sentence: the
`CacheSection` block in `settings.ts` now reads
`isLocalFirstActive.value` and propagates a `cacheDisabled` boolean
to its child controls and a class on its root `<section>`.

### Quickstart

See [quickstart.md](./quickstart.md). The recipe covers four
scenarios mapped to the spec's acceptance scenarios: free-plan
free-render, toggle-on transition, toggle-off transition, and
mid-bootstrap (no-flicker) verification.

### Agent context update

Ran `.specify/scripts/bash/update-agent-context.sh claude` from the
plan workflow — see "Stop and report" below.

## Post-Design Constitution Check

Re-evaluated after Phase 1 design with the chosen approach
(`isLocalFirstActive`-gated `disabled` attributes + single CSS class):

- All five principles still N/A or in-line as in the pre-design pass.
  The chosen design is the *least* invasive option that meets every
  FR and edge case; it does not introduce any new read, write, or
  contract. Gate still passes; no Complexity Tracking entry needed.

## Complexity Tracking

> Filled ONLY if Constitution Check has violations to justify.

None. No principle is overridden by this feature.
