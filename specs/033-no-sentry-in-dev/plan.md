# Implementation Plan: Sentry should not log things in dev mode

**Branch**: `033-no-sentry-in-dev` | **Date**: 2026-06-04 | **Spec**:
[spec.md](./spec.md)
**Input**: Feature specification from
`/specs/033-no-sentry-in-dev/spec.md`

## Summary

Dev-mode suppression already exists in production code. `buildSentryOptions()`
(`src/server/sentry-options.ts`) returns `dsn: undefined` and omits
`tracesSampleRate` for any non-deployed `NODE_ENV`, so the worker
(`Sentry.withSentry`) and the Durable Object
(`Sentry.instrumentDurableObjectWithSentry`) transmit nothing in local dev —
errors, traces, or replays — even when a live `SENTRY_DSN` is present in
`.dev.vars`. The browser client (`src/client/sentry.ts`) only calls
`Sentry.init()` under `import.meta.env.PROD`, so it never initializes in dev.
`reportError()` always writes to `console.error`, so local visibility is
retained.

The work in this feature is **regression tests only — no production code
change**. The pure builder (`buildSentryOptions`) is already unit-tested, but
nothing proves the worker and DO are *wired* to it: the test stub discards the
options callback, so a future edit to `getSentryOptions`/`getDOSentryOptions`
that re-enabled the DSN in dev would pass every existing test. This feature
captures those callbacks in the stub and asserts that, given a dev env, the
real wiring yields no DSN (and given production/staging, yields the DSN with
the correct sample rate). That turns the existing-but-implicit guarantee into
one that fails CI on regression, satisfying the spec's
"protected against future regressions" intent.

## Technical Context

**Language/Version**: TypeScript (Cloudflare Workers runtime, ES2022 lib) for
worker + DO; browser ES2022 via Vite for the client
**Primary Dependencies**: `@sentry/cloudflare` (worker + DO),
`@sentry/browser` (client), Hono; tests use `@substrate-system/tapzero` +
`tapout`, bundled with esbuild
**Storage**: N/A — no local SQLite or DO schema change
**Testing**: tapzero/tapout; worker/DO bundles alias
`@sentry/cloudflare` -> `./test/sentry-cloudflare-stub.ts`
**Target Platform**: Cloudflare Worker + per-user Durable Object; Preact
browser SPA
**Project Type**: web (backend worker/DO + frontend SPA)
**Performance Goals**: N/A
**Constraints**: No production code change (chosen approach, option 2);
TypeScript 80-col, no-space-before-type-annotation style; no brittle tests
(no DOM-text or docs assertions per project rules)
**Scale/Scope**: Test-only. `test/sentry-cloudflare-stub.ts` (additive
capture of option callbacks), one wiring test, one runner registration

## Constitution Check

*GATE: evaluated before Phase 0 and re-checked after Phase 1. Result: PASS.*

| Principle | Relevance | Verdict |
|-----------|-----------|---------|
| I. Local-First Reads | No read path touched | PASS (n/a) |
| II. Idempotent, Outbox-Backed Sync | No mutation/sync touched | PASS (n/a) |
| III. Edge-Native Topology | Sentry instruments the worker + DO; no topology change, tests only assert existing wiring | PASS |
| IV. Capability-Gated Progressive Enhancement | No client read/write added | PASS (n/a) |
| V. Bluesky-Anchored Identity | No auth change | PASS (n/a) |

Additional standards:

- **Logging & privacy**: Dev suppression keeps events off the shared
  dashboard; `console.error` keeps errors local. This feature changes no
  logging payloads, so it neither adds nor removes any PII exposure. (The
  pre-existing PII-in-`reportError`-context question from `AUDIT.md` is out
  of scope here.)
- **Schema/sync coupling**: No column or payload change — not applicable.
- **Idempotency review**: No new mutation route — not applicable.
- **Capability fallback review**: No new read/write path — not applicable.
- **Local verification**: The spec's Independent Tests (run dev, trigger an
  error, confirm nothing reaches the dashboard while console output remains)
  are captured in `quickstart.md`.

No violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/033-no-sentry-in-dev/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions (approach, wiring strategy)
├── data-model.md        # Phase 1 — N/A (no entities)
├── quickstart.md        # Phase 1 — how to run/verify
├── contracts/
│   └── sentry-env-gating.md   # env -> Sentry options behavior contract
└── checklists/
    └── requirements.md  # Spec quality checklist (already present)
```

### Source Code (repository root)

No `src/` changes. Touched files are test-only:

```text
src/server/
├── sentry-options.ts          # UNCHANGED — buildSentryOptions / isSentryEnv
├── index.ts                   # UNCHANGED — getSentryOptions wiring (lines
│                              #   ~2073-2086): withSentry +
│                              #   instrumentDurableObjectWithSentry
└── lib/report-error.ts        # UNCHANGED — captureException + console.error

src/client/
└── sentry.ts                  # UNCHANGED — init only under PROD

test/
├── sentry-cloudflare-stub.ts  # ADD: capture the option callbacks passed to
│                              #   withSentry / instrumentDurableObjectWith-
│                              #   Sentry, plus getters + reset (additive)
├── sentry-wiring.ts           # NEW: import the real worker + UserDO, invoke
│                              #   the captured callbacks across envs
├── sentry-options.ts          # UNCHANGED — existing buildSentryOptions tests
└── run-all-tests.mjs          # ADD: register the new wiring suite
```

**Structure Decision**: Web app (backend worker/DO + frontend SPA), matching
the existing `src/server` + `src/client` + `test` layout. This feature adds no
runtime modules; it extends the existing test harness only.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none)    | —          | —                                   |
