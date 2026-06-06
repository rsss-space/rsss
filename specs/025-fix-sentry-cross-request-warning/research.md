# Research: Fix Sentry Cross-Request Promise Warning

**Feature**: 025-fix-sentry-cross-request-warning
**Date**: 2026-05-29
**Phase**: 0 (Outline & Research)

## Problem restatement

Navigating to a blog post item page (e.g.
`http://127.0.0.1:5555/post/brittanyellich.com/web-dev-challenge`)
prints this Workers-runtime warning to the dev terminal:

> Warning: A promise was resolved or rejected from a different request
> context than the one it was created in. ... Continuations for that
> request are unlikely to run safely and have been canceled.

The stack trace points at `@sentry/cloudflare` internals
(`_CloudflareClient._resolveSpanCompletion`, `SentrySpan.end`).

## How Sentry is wired in this repo (verified)

- `src/server/index.ts` wraps the worker with
  `Sentry.withSentry(getSentryOptions, worker)` and the Durable Object
  with `Sentry.instrumentDurableObjectWithSentry(getDOSentryOptions,
  RsssUserDOBase)`. These are the **only** sources of server spans — a
  repo-wide grep found no manual `Sentry.startSpan` calls in `src/`.
- `getSentryOptions` / `getDOSentryOptions` set:
  - `dsn`: present only when `NODE_ENV` is `production` or `staging`
    (`isSentryEnv`); `undefined` in local dev.
  - `tracesSampleRate`: `NODE_ENV === 'production' ? 0.2 : 1.0`. In
    local dev `NODE_ENV` is undefined, so this evaluates to **`1.0`** —
    full tracing is on even though the DSN is empty.
- `src/client/instrument.ts` (browser SDK, `@sentry/browser`) only
  calls `Sentry.init` when `dsn && import.meta.env.PROD`. It is dormant
  in dev, confirming the warning is the **server** SDK, not the client.
- Local dev runs the real worker: Vite (`vite.config.js`, port 5555)
  loads `@cloudflare/vite-plugin`, so `withSentry` /
  `instrumentDurableObjectWithSentry` are active locally.
- Installed exact version: `@sentry/cloudflare` **10.53.1**
  (`@sentry/browser` also `^10.53.1`).

## Why a blog post navigation reproduces it

The `/post/<host>/<path>` route is served by the SPA fallback in the
worker. Each request opens a Sentry request span (sampled because
`tracesSampleRate` is `1.0`). The SDK at 10.53.1 schedules span
completion / flush work through a **wrapped `waitUntil`**, whose
continuation can settle after the originating request's I/O context has
ended. The Workers runtime detects that the settling promise belongs to
a different request context and cancels the continuation, printing the
warning. Because the DSN is empty in dev, nothing is ever transmitted —
the span lifecycle work is pure overhead that only exists to produce the
warning.

## Decision 1 — Upgrade `@sentry/cloudflare` (primary, root-cause)

**Decision**: Upgrade `@sentry/cloudflare` (and the lockstep
`@sentry/browser`) from `^10.53.1` to `^10.55.0`.

**Rationale**: The upstream changelog shows the exact fixes for this
class of bug land between 10.53.1 and 10.55.0:

- 10.54.0 — `fix(cloudflare): Avoid repeated flush lock wrapping
  (#21156)` and `fix(cloudflare, vercel-edge): Disable timer-based
  flush for serverless runtimes (#20889)`.
- 10.55.0 — `fix(cloudflare): Use original waitUntil to not create a
  deadlock (#21197)`.

`#21197` replaces the wrapped `waitUntil` with the runtime's original
`waitUntil`, which keeps span-completion continuations inside the
request that created them — a true lifecycle fix, not a silencer. This
satisfies FR-005 (eliminate the cross-request behavior) and FR-002
(request-scoped async work stays tied to the request) while preserving
deployed telemetry (FR-004), since tracing/transport behavior in
production is otherwise unchanged.

Latest published version is **10.55.0** (2026-05-28), verified via
`npm view @sentry/cloudflare`. The two runtime SDK packages
(`@sentry/cloudflare`, `@sentry/browser`) MUST move together so they
share one `@sentry/core` — Sentry requires all `@sentry/*` runtime
packages at the same version.

**Alternatives considered**:

- *Stay on 10.53.1 and only change config*: rejected — the deployed
  (DSN-present) code path would still rely on the buggy wrapped
  `waitUntil`; the lifecycle defect would persist where tracing is
  actually on.
- *Compatibility flag `no_handle_cross_request_promise_resolution`*:
  rejected — it reverts the runtime to silently scheduling
  continuations in the wrong context. It hides the warning without
  guaranteeing continuations run safely, directly contradicting the
  spec assumption that a flag is acceptable only if it *provably* keeps
  continuations running safely. It is a silencer, not a fix.

## Decision 2 — Only enable tracing when a DSN is present (hardening)

**Decision**: Build the Sentry options so `tracesSampleRate` is
included **only** when a DSN is configured (i.e. when `isSentryEnv` is
true). When there is no DSN (local dev), omit `tracesSampleRate`
entirely so no request spans are created.

**Rationale**: Defense-in-depth that makes the fix independent of the
third-party patch on the exact path that reproduces the bug. Sentry
docs state that to fully disable tracing **neither `tracesSampleRate`
nor `tracesSampler`** may be defined — setting `tracesSampleRate: 0`
still stands up the tracing infrastructure and completes spans. By
omitting the key when there is no destination, the no-DSN/dev path
creates zero spans, so there is no cross-request continuation to cancel
regardless of SDK version. It also removes pointless work: we never
sampled-and-discarded traces we could not deliver.

Deployed behavior is unchanged: staging keeps `1.0`, production keeps
`0.2`, both with a DSN — so FR-003/FR-004 (no rendering or telemetry
regression) hold.

**Alternatives considered**:

- *`tracesSampleRate: 0` in dev*: rejected — still initializes tracing
  and runs span completion, so it would not reliably remove the
  warning (and would not satisfy FR-005's "eliminate" requirement on
  the dev path).
- *Skip Decision 2 entirely (upgrade only)*: viable and is the minimal
  root-cause fix. We include Decision 2 because the spec explicitly
  demands eliminating the underlying behavior rather than relying on a
  single dependency patch, and because it has independent value
  (no traces are generated when none can be sent). The two changes are
  complementary, not redundant: Decision 1 fixes the DSN-present path,
  Decision 2 removes the DSN-absent path's spans.

## Decision 3 — Make the options builder unit-testable

**Decision**: Extract the sample-rate / DSN decision into a small pure
helper (e.g. `buildSentryOptions(env)` or `resolveTracesSampleRate`)
and export it so a unit test can assert: DSN present in
production -> `tracesSampleRate: 0.2`; staging -> `1.0`; no DSN ->
`tracesSampleRate` omitted; `dsn` resolves to `undefined` off-DSN
environments.

**Rationale**: The warning itself is a runtime emission that is awkward
to assert in an automated test, but the configuration *invariant* that
prevents it (no tracing without a DSN; deployed rates unchanged) is a
pure function and cheap to lock down. Testing the options builder is
behavioral and non-brittle (no HTML/text assertions), consistent with
project testing guidance.

**Alternatives considered**:

- *No new test, rely on manual verification only*: rejected — leaves
  the invariant unguarded against regression (e.g. someone later
  re-adds an unconditional `tracesSampleRate`).

## Open questions

None. All NEEDS CLARIFICATION items are resolved:

- Root cause: confirmed (wrapped `waitUntil` span-completion crossing
  request context; fixed by #21197 / #21156 / #20889).
- Target version: `@sentry/cloudflare` + `@sentry/browser` `^10.55.0`.
- Deployed telemetry impact: none (DSN-present rates unchanged).

## Sources

- npm: `@sentry/cloudflare` latest `10.55.0` (published 2026-05-28),
  `10.54.0` (2026-05-26); verified via `npm view`.
- getsentry/sentry-javascript CHANGELOG (master): 10.54.0 entries
  (#21156, #20889) and 10.55.0 entry (#21197).
- Sentry Cloudflare tracing docs: tracing is disabled only when both
  `tracesSampleRate` and `tracesSampler` are undefined.
- Cloudflare Workers docs: cross-request promise resolution warning
  semantics; `no_handle_cross_request_promise_resolution` reverts to
  the silent (unsafe) legacy behavior.
