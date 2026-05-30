# Data Model: Fix Sentry Cross-Request Promise Warning

**Feature**: 025-fix-sentry-cross-request-warning
**Date**: 2026-05-29
**Phase**: 1 (Design)

## Persistent data

**No persistent data model changes.** This feature touches only
observability configuration in the Cloudflare Worker. There are no
changes to:

- the per-user Durable Object SQLite schema,
- the `/api/sync` payload, `bootstrapLocalDb`, or `pullSync` upsert
  logic,
- the local (OPFS) SQLite schema,
- KV namespaces or the paint cache.

Per the constitution's "schema and sync changes are coupled" rule,
because no client-rendered column changes, none of the coupled
artifacts are touched.

## Configuration entities (in-memory only)

The only "entities" are the Sentry option objects assembled per
worker / Durable Object invocation. They are derived purely from `env`;
nothing is stored.

### SentryOptions (worker)

Produced by the options builder from `Env`.

| Field | Type | Rule |
|-------|------|------|
| `dsn` | `string \| undefined` | Set only when `NODE_ENV` is `production` or `staging` (`isSentryEnv`); otherwise `undefined`. |
| `environment` | `string` | `env.NODE_ENV`. |
| `tracesSampleRate` | `number` *(key omitted when absent)* | `0.2` in production; `1.0` in staging; **key omitted entirely** when no DSN (local dev), so tracing is fully disabled. |
| `sendDefaultPii` | `false` | Constant; PII collection stays off. |

### DOSentryOptions (Durable Object)

Same shape and same rules as `SentryOptions`, derived from the DO's
narrower `Env` (`UserDOEnv`). The worker and DO option builders MUST
stay in lockstep.

## State transitions

None. The options are recomputed from `env` on each instantiation; there
is no lifecycle or stored state.

## Validation rules / invariants

- **INV-1**: When `dsn` is `undefined`, the options object MUST NOT
  contain a `tracesSampleRate` (or `tracesSampler`) key — this is what
  fully disables tracing and removes span creation on the no-DSN path.
- **INV-2**: When `dsn` is defined, `tracesSampleRate` MUST be `0.2`
  for production and `1.0` for staging (unchanged from current
  deployed behavior).
- **INV-3**: `sendDefaultPii` MUST remain `false`.
- **INV-4**: The worker and Durable Object option builders MUST produce
  the same field rules for the same `NODE_ENV` / DSN state.
