# Contract: environment-gated Sentry options

**Date**: 2026-06-04 | **Feature**: `033-no-sentry-in-dev`

This is the behavior contract the regression tests pin. It describes the
mapping from runtime environment to the Sentry options that the worker and
Durable Object hand to the SDK. The single source of truth is
`buildSentryOptions(env)` in `src/server/sentry-options.ts`; the worker and DO
MUST route through it (`getSentryOptions` / `getDOSentryOptions` in
`src/server/index.ts`).

## Inputs

`env: { NODE_ENV?:string; SENTRY_DSN?:string }`

## Output mapping

| `NODE_ENV`    | `dsn`         | `tracesSampleRate` | `environment` | `sendDefaultPii` |
|---------------|---------------|--------------------|---------------|------------------|
| `production`  | `SENTRY_DSN`  | `0.2`              | `production`  | `false`          |
| `staging`     | `SENTRY_DSN`  | `1.0`              | `staging`     | `false`          |
| `development` | `undefined`   | absent (key omitted) | `development` | `false`        |
| unset         | `undefined`   | absent (key omitted) | `undefined`  | `false`          |

Notes:

- `dsn: undefined` disables the SDK entirely: no captured exceptions, no
  traces/spans. The browser additionally never calls `Sentry.init()` outside
  `import.meta.env.PROD`, so session replays are off in dev as well.
- `tracesSampleRate` is **omitted** (not set to `0`) when disabled, which is
  what fully disables tracing per Sentry's docs.
- In `development`, `SENTRY_DSN` may be a real, valid DSN (as in a developer's
  `.dev.vars`) and MUST still produce `dsn: undefined` (FR-007).

## Wiring guarantees (what the regression test asserts)

1. The worker default export is `Sentry.withSentry(cb, worker)` and the
   captured `cb(devEnv).dsn === undefined`; `cb(prodEnv).dsn === SENTRY_DSN`
   with `tracesSampleRate === 0.2`; `cb(stagingEnv).tracesSampleRate === 1.0`.
2. The `UserDO` export is
   `Sentry.instrumentDurableObjectWithSentry(cb, UserDOBase)` and its captured
   `cb` produces the same mapping as the worker's (the two MUST NOT drift).
3. For both, `'tracesSampleRate' in cb(devEnv) === false`.

## Requirements traceability

| Requirement | Covered by |
|-------------|------------|
| FR-001 (no error events in dev) | dev row: `dsn === undefined` |
| FR-002 (every transmit path) | worker + DO wiring rows 1-2; explicit `reportError` path is silenced by the same no-DSN client |
| FR-003 (all surfaces) | worker + DO wiring; browser via `PROD` gate |
| FR-004 (no traces/spans/replays in dev) | `tracesSampleRate` omitted; browser replays off in dev |
| FR-005 (deployed still reports) | production/staging rows |
| FR-006 (console output retained) | `reportError` always `console.error` (covered by `test/report-error.ts`) |
| FR-007 (suppression holds with valid creds) | dev row with a real `SENTRY_DSN` -> `dsn === undefined` |
