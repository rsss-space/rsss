# Phase 1 Data Model: Fix Reader Star Button Appearance

**Not applicable.** This feature is an appearance-only change to a single UI
control on the feed item (reader) route.

- No new entity, field, or relationship.
- No change to the existing `is_starred` column on `items` (per-user Durable
  Object SQLite, mirrored to local OPFS-SQLite). The starred state is read
  and written exactly as before.
- No change to the `/api/sync` payload, `bootstrapLocalDb`, the local SQLite
  schema, or `pullSync` upsert logic.
- No new state transitions. The existing starred <-> unstarred toggle is
  reused unchanged; only its visual representation on the reader changes.

Because no column the client renders is added or modified, the
constitution's "schema and sync changes are coupled" gate (Principle II)
does not apply to this feature.
