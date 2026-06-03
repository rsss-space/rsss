# Implementation Plan: Fix Sentry Cross-Request Promise Warning on Blog Post Navigation

**Branch**: `025-fix-sentry-cross-request-warning` | **Date**: 2026-05-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/025-fix-sentry-cross-request-warning/spec.md`

## Summary

Navigating to a blog post item page emits a Cloudflare Workers runtime
warning that a promise settled in a different request context, sourced
from `@sentry/cloudflare` span completion. The fix is twofold and
complementary:

1. **Upgrade `@sentry/cloudflare` (and lockstep `@sentry/browser`) from
   `^10.53.1` to `^10.55.0`** — the upstream root-cause fix
   (`#21197` "Use original waitUntil to not create a deadlock", plus
   `#21156`/`#20889` in 10.54.0) keeps span-completion continuations
   inside the request that created them on the DSN-present (deployed)
   path.
2. **Only enable tracing when a DSN is configured** — assemble the
   Sentry options so `tracesSampleRate` is omitted entirely when there
   is no DSN (local dev). This removes span creation on the exact path
   that reproduces the warning, independent of the SDK version, and
   stops generating traces that can never be delivered.

Deployed telemetry is unchanged (staging `1.0`, production `0.2`, both
with a DSN), and blog post rendering is untouched. A unit test on the
extracted options builder locks the behavior matrix so the invariant
cannot silently regress.

## Technical Context

**Language/Version**: TypeScript (Cloudflare Workers runtime, ES2022 lib)
**Primary Dependencies**: `@sentry/cloudflare` (-> `^10.55.0`),
`@sentry/browser` (-> `^10.55.0`, lockstep), Hono (worker router),
`@cloudflare/workers-types`; dev via Vite 7 + `@cloudflare/vite-plugin`
**Storage**: N/A — no persistent storage change (no DO SQLite, no
`/api/sync`, no local OPFS SQLite, no KV change)
**Testing**: esbuild + tapout unit tests (`npm test`), `npm run lint`,
`npm run typecheck`; manual browser/terminal verification per
`quickstart.md`
**Target Platform**: Cloudflare Workers + per-user Durable Object
**Project Type**: Edge web service (Hono worker + Durable Object) with a
Preact SPA client
**Performance Goals**: No change; fix removes wasted span work in dev
**Constraints**: Deployed error/performance telemetry coverage MUST be
preserved; blog post rendering MUST be byte-identical; no continuation
may be silently cancelled
**Scale/Scope**: Two option-builder functions in `src/server/index.ts`
plus a `package.json`/lockfile dependency bump and one unit test

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1
design.*

- **I. Local-First Reads** — Not touched. No read paths,
  adapters, or schema change. PASS.
- **II. Idempotent, Outbox-Backed Sync** — Not touched. No mutations,
  no outbox, no `/api/sync` change. PASS.
- **III. Edge-Native Topology** — Preserved. Still a single Hono worker
  fronting per-user Durable Objects; only the Sentry wrapper *options*
  and the SDK version change. No cross-user state, no new transport,
  alarms unchanged. PASS.
- **IV. Capability-Gated Progressive Enhancement** — Not touched. No
  change to `getAdapter()` or local-first gating. PASS.
- **V. Bluesky-Anchored Identity** — Not touched. No auth/session
  change. PASS.
- **Tech Stack & Standards** — `@sentry/cloudflare` is part of the
  locked stack; a patch/minor bump is allowed. `nodejs_compat`
  unchanged; no new `compatibility_flags` (the
  `no_handle_cross_request_promise_resolution` silencer is explicitly
  rejected). No new secrets/env. `sendDefaultPii` stays `false`
  (logging/privacy). 80-col + no-space-before-type style applies to the
  edited TypeScript. PASS.

**Result**: No violations. Complexity Tracking is empty.

Post-design re-check: design introduces a pure options builder plus a
dependency bump; no new architectural surface. Still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/025-fix-sentry-cross-request-warning/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (no persistent data change)
├── quickstart.md        # Phase 1 output (verification recipe)
├── contracts/
│   └── observability-config.md   # Phase 1 output (config contract)
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── server/
│   ├── index.ts                 # PRIMARY EDIT: getSentryOptions /
│   │                            #   getDOSentryOptions -> exported pure
│   │                            #   options builder; withSentry /
│   │                            #   instrumentDurableObjectWithSentry
│   │                            #   wiring (unchanged shape)
│   ├── durable-objects/index.ts # UserDOBase (no change; wrapped by
│   │                            #   instrumentDurableObjectWithSentry)
│   ├── lazy-html-handler.ts     # /post/* serving path (no change)
│   └── lib/report-error.ts      # Sentry.captureException (no change)
├── client/
│   └── instrument.ts            # @sentry/browser init (no change;
│                                #   dormant in dev)
test/
├── sentry-cloudflare-stub.ts    # existing stub for api-router test
└── <new>                        # unit test for the options builder

package.json                     # @sentry/cloudflare + @sentry/browser
                                 #   -> ^10.55.0
package-lock.json                # regenerated by npm install
```

**Structure Decision**: Existing edge-web-service layout
(`src/server` worker + `src/client` SPA, `test/` esbuild+tapout). No new
directories. The only production code edit is in `src/server/index.ts`
(extract + export the Sentry options builder and gate
`tracesSampleRate` on DSN presence); plus the dependency bump and one
new unit test under `test/`.

## Phase 0 — Outline & Research

See [research.md](./research.md). All NEEDS CLARIFICATION resolved:

- Root cause confirmed: wrapped `waitUntil` span-completion crossing the
  request context (fixed upstream by `#21197`, `#21156`, `#20889`).
- Target version confirmed via npm: `@sentry/cloudflare` `10.55.0`
  (latest, 2026-05-28); `@sentry/browser` matched.
- Mitigation confirmed: tracing is fully disabled only when
  `tracesSampleRate` is **omitted** (not `0`).
- Compatibility-flag silencer rejected against spec assumptions.

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md): no persistent data model change;
  in-memory Sentry option objects with invariants INV-1..INV-4.
- [contracts/observability-config.md](./contracts/observability-config.md):
  the options-builder behavior matrix and the unchanged-surface list.
- [quickstart.md](./quickstart.md): reproduce + verify recipe covering
  SC-001..SC-004.
- Agent context updated via
  `.specify/scripts/bash/update-agent-context.sh claude`.

### Design decisions

1. Extract the DSN/sample-rate decision from `getSentryOptions` and
   `getDOSentryOptions` into a shared, exported pure builder. Both the
   worker and the Durable Object consume it so they cannot drift
   (INV-4).
2. Omit `tracesSampleRate` when `isSentryEnv(NODE_ENV)` is false (no
   DSN) -> zero spans in dev (INV-1). Keep `0.2`/`1.0` when a DSN is
   present (INV-2). `sendDefaultPii` stays `false` (INV-3).
3. Bump `@sentry/cloudflare` and `@sentry/browser` together to
   `^10.55.0` so they share one `@sentry/core`.

## Complexity Tracking

> No constitution violations — section intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (none)    | —          | —                                    |

## Phase 2 — Next step

Run `/speckit.tasks` to generate `tasks.md`. Expected task groups:

1. Dependency bump: `@sentry/cloudflare` + `@sentry/browser` ->
   `^10.55.0`; `npm install`; confirm lockfile resolves `10.55.x`.
2. Refactor: extract + export the pure Sentry options builder; gate
   `tracesSampleRate` on DSN presence for both worker and DO.
3. Test: add the options-builder unit test (behavior matrix /
   INV-1..INV-4).
4. Verify: `npm test`, `npm run lint`, `npm run typecheck`; then the
   `quickstart.md` live terminal check (10+ blog post navigations,
   zero warnings).
