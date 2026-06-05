# Research: Sentry should not log things in dev mode

**Date**: 2026-06-04 | **Feature**: `033-no-sentry-in-dev`

This feature has no NEEDS CLARIFICATION markers. Research here records the
findings about current behavior and the design decisions that flow from them.

## Finding: dev suppression already exists across all surfaces

Investigated the three integration surfaces named in the spec (FR-003).

- **Worker** — `src/server/index.ts` exports
  `Sentry.withSentry(getSentryOptions, worker)` where
  `getSentryOptions = (env) => buildSentryOptions(env)`.
- **Durable Object** — same file exports
  `Sentry.instrumentDurableObjectWithSentry(getDOSentryOptions, UserDOBase)`
  with `getDOSentryOptions = (env) => buildSentryOptions(env)`.
- **Browser** — `src/client/sentry.ts` calls `Sentry.init(...)` only inside
  `if (dsn && import.meta.env.PROD)`.

`buildSentryOptions` (`src/server/sentry-options.ts`):

```ts
export const isSentryEnv = (nodeEnv) =>
    nodeEnv === 'production' || nodeEnv === 'staging'

export function buildSentryOptions (env) {
    const enabled = isSentryEnv(env.NODE_ENV)
    const options = {
        dsn: enabled ? env.SENTRY_DSN : undefined,
        environment: env.NODE_ENV,
        sendDefaultPii: false,
    }
    if (enabled) {
        options.tracesSampleRate = env.NODE_ENV === 'production' ? 0.2 : 1.0
    }
    return options
}
```

In local dev `NODE_ENV` is `development` (`.dev.vars`), so `enabled` is
`false`, `dsn` is `undefined`, and `tracesSampleRate` is omitted. A Sentry
SDK initialized with no DSN transmits nothing — neither captured exceptions
nor traces/spans, and replays are browser-only and never initialized in dev.
This holds even though the developer's real `.dev.vars` contains a live
`SENTRY_DSN` (it is simply ignored), which is exactly FR-007.

Maps to requirements: FR-001, FR-003, FR-004, FR-005, FR-007 are satisfied by
the automatic instrumentation paths; FR-006 by `reportError`'s unconditional
`console.error`.

## Finding: the explicit `reportError` path is suppressed only implicitly

`src/server/lib/report-error.ts` calls `Sentry.captureException()`
unconditionally and then `console.error`. In dev it is silent only as a side
effect of the active SDK client having no DSN (FR-002 is met today, but by
accident). The test stub `test/sentry-cloudflare-stub.ts` records every
`captureException` regardless of DSN, so this path cannot be unit-tested for
dev suppression without a production change.

## Finding: the wiring is untested

`test/sentry-options.ts` thoroughly tests the *pure* `buildSentryOptions`
builder, including `buildSentryOptions({NODE_ENV:'development', SENTRY_DSN})`
=> `dsn === undefined`. But nothing asserts that the worker/DO are actually
*wired* to that builder. The stub's `withSentry` /
`instrumentDurableObjectWithSentry` discard the options callback, so an edit
like `getSentryOptions = (env) => ({ dsn: env.SENTRY_DSN })` would re-enable
dev transmission while every existing test stays green. This is the concrete
regression risk the spec's "protected against future regressions" language
targets.

## Decision: regression tests only, no production code change (option 2)

- **Decision**: Do not modify `report-error.ts`, `sentry-options.ts`,
  `client/sentry.ts`, or the `index.ts` wiring. Add tests that pin the
  env -> options behavior and prove the worker/DO route through
  `buildSentryOptions`.
- **Rationale**: The production code already meets the spec. The remaining
  exposure is a *test gap*, not a behavior gap. Closing it with tests is the
  lowest-risk way to lock in current behavior without touching ~24
  `reportError` call sites or coupling `reportError` to SDK internals.
- **Alternatives considered**:
  - *Active-client guard in `reportError`* (check `Sentry.getClient()?.getDsn()`
    before capturing): makes the explicit path testable, but adds production
    code and couples to SDK internals for a path that is already silent in
    dev. Rejected as unnecessary for the stated goal.
  - *Thread `NODE_ENV` into `reportError`* and gate on `isSentryEnv`: most
    explicit and pure, but edits ~24 call sites for no behavior change.
    Rejected as disproportionate churn.

## Decision: prove wiring by capturing the option callbacks in the stub

- **Decision**: Extend `test/sentry-cloudflare-stub.ts` so `withSentry` and
  `instrumentDurableObjectWithSentry` record the options callback they are
  given (plus getters and a reset). Add `test/sentry-wiring.ts` that imports
  the real worker default export and `UserDO` from `src/server/index.ts`
  (which triggers the wrappers at module load), retrieves the captured
  callbacks, and asserts their output across `development`, `production`,
  `staging`, and unset `NODE_ENV`.
- **Rationale**: This exercises the *real* `getSentryOptions` /
  `getDOSentryOptions` without exporting internals from `index.ts` (which
  would itself be a production change). The stub change is additive and safe
  for every existing consumer (`api-router`, `report-error`, the browser
  bundle).
- **Alternatives considered**:
  - *Export `getSentryOptions`/`getDOSentryOptions` from `index.ts`*:
    simplest test, but adds a production export purely for testing. Rejected
    to honor "no production change."
  - *Fold assertions into `test/api-router.ts`*: viable (it already imports
    the worker under the stub alias), but mixes unrelated concerns. A small
    dedicated suite is clearer; folding remains an acceptable fallback.

## Decision: do not add a brittle client-side test

- **Decision**: Treat the browser client as covered-by-construction (init is
  gated on the build-time-constant `import.meta.env.PROD`); do not assert on
  `client/sentry.ts` source text or rendered output.
- **Rationale**: Project rules forbid brittle tests. A source-text assertion
  on the `PROD` guard would test implementation detail, and the dev bundle
  genuinely never initializes Sentry. An optional structural static check
  could be added later if desired, but it is not required for this feature.
