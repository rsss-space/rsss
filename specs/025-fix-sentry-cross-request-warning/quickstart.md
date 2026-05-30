# Quickstart: Verify the Sentry Cross-Request Warning Fix

**Feature**: 025-fix-sentry-cross-request-warning
**Phase**: 1 (Design)

This is the manual + automated verification recipe. The Workers-runtime
warning is awkward to assert in an automated test, so the live terminal
check is the primary evidence (SC-001/SC-004), backed by a unit test on
the options builder.

## Reproduce (before the fix)

1. Start the dev server: `npm start` (Vite on `http://127.0.0.1:5555`).
2. Log in (dev login is available on loopback).
3. Navigate to a blog post item page, e.g.
   `http://127.0.0.1:5555/post/brittanyellich.com/web-dev-challenge`.
4. Watch the terminal running the dev server. Before the fix you see:
   `Warning: A promise was resolved or rejected from a different request
   context ... Continuations for that request ... have been canceled.`
   with a stack referencing `@sentry/cloudflare`
   (`_resolveSpanCompletion` / `SentrySpan.end`).

## Verify (after the fix)

### A. Live terminal check — SC-001, SC-004 (primary)

1. `npm start`.
2. Open at least 10 blog post item pages: a mix of first-visit
   (uncached) and revisited (cached) URLs, plus a few hard reloads.
   Include the originally reported URL.
3. Confirm the terminal shows **zero** "different request context" /
   "continuations ... have been canceled" warnings across all
   navigations and reloads.

### B. No rendering regression — SC-002 (FR-003)

1. Open the same blog post pages used before the change.
2. Confirm content, layout, images/thumbnails, and in-app navigation
   are unchanged.

### C. Deployed telemetry preserved — SC-003 (FR-004)

This is verified by the options-builder invariants (no live Sentry
account needed):

- Run the unit test (see D). It asserts production keeps
  `tracesSampleRate: 0.2` and staging keeps `1.0`, both with a DSN, so
  error + performance reporting coverage is unchanged in deployed
  environments.
- Optional live check: in a staging deploy, confirm errors/traces still
  arrive in Sentry as before.

### D. Automated test

Run the new options-builder unit test plus the existing suite:

```
npm test
npm run lint
npm run typecheck
```

The options-builder test asserts the behavior matrix from
`contracts/observability-config.md`:

- no DSN (dev) -> `tracesSampleRate` key is **absent** and `dsn` is
  `undefined`;
- `staging` -> `dsn` set, `tracesSampleRate: 1.0`;
- `production` -> `dsn` set, `tracesSampleRate: 0.2`;
- `sendDefaultPii` is always `false`;
- worker and Durable Object builders agree for the same env.

## Done criteria

- [ ] 10+ blog post navigations (cached + uncached + reloads) emit zero
      cross-request promise warnings.
- [ ] Blog post pages render identically to before.
- [ ] Options-builder test passes; deployed sample rates unchanged.
- [ ] `npm test`, `npm run lint`, `npm run typecheck` all pass.
- [ ] `@sentry/cloudflare` and `@sentry/browser` resolve to `10.55.x`.
