# Quickstart: verifying dev-mode Sentry suppression

**Date**: 2026-06-04 | **Feature**: `033-no-sentry-in-dev`

## Automated tests

Run the full suite (lint + tests), per project convention:

```sh
npm test && npm run lint
```

The behavior is pinned by:

- `test/sentry-options.ts` — pure `buildSentryOptions` / `isSentryEnv` cases
  (runs inside the consolidated `npm run test:browser` bundle).
- `test/sentry-wiring.ts` — NEW. Imports the real worker default export and
  `UserDO` from `src/server/index.ts` and asserts the captured option
  callbacks match the contract in
  [`contracts/sentry-env-gating.md`](./contracts/sentry-env-gating.md):
  no DSN in `development` / unset, DSN + correct `tracesSampleRate` in
  `production` / `staging`, and worker/DO agreement.
- `test/report-error.ts` — confirms `reportError` still logs to
  `console.error` (FR-006).

Run just the wiring suite during development:

```sh
npm run test:sentry-wiring
```

## Manual verification (spec Independent Tests)

These mirror the spec's per-story Independent Tests.

1. **US1 — local errors never reach the dashboard.** With a real `SENTRY_DSN`
   in `.dev.vars`, run `npm start`, trigger an error (e.g. hit an endpoint
   that throws, or force a failing request), and confirm no corresponding
   event appears in the Sentry dashboard for the development environment.
2. **US3 — developer still sees the error.** Confirm the same error is printed
   to the local console/`wrangler` output via `reportError`'s `console.error`.
3. **US2 — deployed still reports (guardrail).** This is not exercised
   locally. Confirm via the env mapping (production/staging keep the DSN) and,
   if validating end-to-end, trigger an error in a staging deploy and confirm
   it appears tagged `staging`. Do not weaken `buildSentryOptions` to test
   this locally.

## What MUST NOT change

No production source changes are part of this feature. If a future edit
touches `src/server/sentry-options.ts` or the `withSentry` /
`instrumentDurableObjectWithSentry` wiring in `src/server/index.ts`,
`test/sentry-wiring.ts` MUST still pass — that is the regression guard.
