# Contract: Observability Configuration

**Feature**: 025-fix-sentry-cross-request-warning
**Phase**: 1 (Design)

This feature exposes no new external HTTP API. The only contract that
changes is the **internal observability configuration contract** for the
Cloudflare Worker and its Durable Object. It is captured here so a
reviewer can verify deployed telemetry is preserved and the dev path
emits no spans.

## Sentry options builder

A pure function derives Sentry options from the environment. It MUST be
exported so it can be unit-tested.

```ts
// Conceptual signature (names may differ in implementation):
function buildSentryOptions (env:{ NODE_ENV?:string; SENTRY_DSN?:string }):{
    dsn?:string;
    environment?:string;
    sendDefaultPii:false;
    tracesSampleRate?:number;  // key OMITTED when no DSN
}
```

### Behavior matrix (the contract)

| NODE_ENV      | DSN configured | `dsn` field | `tracesSampleRate` field      |
|---------------|----------------|-------------|-------------------------------|
| `production`  | yes            | the DSN     | `0.2`                         |
| `staging`     | yes            | the DSN     | `1.0`                         |
| unset / dev   | no             | `undefined` | **absent (key not present)**  |

Notes:

- "DSN configured" follows the existing `isSentryEnv(NODE_ENV)` gate
  (`production` or `staging`).
- The Durable Object options builder MUST follow the same matrix using
  its own narrower `Env`.
- `sendDefaultPii` is always `false`.

## Invariants verified by tests

- `tracesSampleRate` is **omitted** (not `0`) when there is no DSN, so
  tracing is fully disabled and no request spans are created in dev.
- Deployed sample rates are unchanged: `0.2` (production), `1.0`
  (staging).
- `dsn` is `undefined` outside `production`/`staging`.

## Non-contract (unchanged) surfaces

- All `/api/*`, `/oauth/*`, `/admin/*`, and SPA-fallback routes:
  request/response shapes unchanged.
- `/post/<host>/<path>` rendering: byte-for-byte unchanged (cached and
  freshly-rendered paths alike).
- Durable Object RPC / `internalRequest` endpoints: unchanged.
- Client browser SDK (`@sentry/browser`) init gate
  (`dsn && import.meta.env.PROD`): unchanged.

## Dependency change

- `@sentry/cloudflare`: `^10.53.1` -> `^10.55.0`.
- `@sentry/browser`: `^10.53.1` -> `^10.55.0` (kept in lockstep so both
  runtime SDKs share one `@sentry/core`).
- `@sentry/vite-plugin` (build-time only): unchanged.
