# Data Model: Sentry should not log things in dev mode

**Date**: 2026-06-04 | **Feature**: `033-no-sentry-in-dev`

No data model. This feature introduces no entities, no persisted state, and
no schema changes:

- No local SQLite (OPFS) table or column changes.
- No Durable Object SQLite schema changes.
- No `/api/sync` payload changes.
- No KV key changes.

The only "shape" involved is the in-memory Sentry options object produced by
`buildSentryOptions(env)`, which is documented as a behavior contract in
[`contracts/sentry-env-gating.md`](./contracts/sentry-env-gating.md) rather
than as a data entity.
