# Phase 1 Data Model: Show concrete default in per-feed cache labels

This feature introduces **no new persisted data and no schema change** (no
local SQLite, no DO SQLite, no `/api/sync` payload). It only *reads* existing
client state to render a label. The "entities" below are the existing
in-memory signals the hint consumes, documented for traceability.

## Read-only entities (existing — unchanged)

### Account-level cache default (`src/client/local-first-settings.ts`)

| Field                  | Signal                  | Type             | Stored unit | Displayed unit |
|------------------------|-------------------------|------------------|-------------|----------------|
| Default max size       | `defaultMaxSizeBytes`   | `Signal<number>` | bytes       | MB             |
| Default retention      | `defaultMaxAgeSeconds`  | `Signal<number>` | seconds     | days           |

- Built-in starting values: `50_000_000` bytes (50 MB), `30 * 86400` s
  (30 days).
- Invariant (existing): `loadLocalFirstSettings()` keeps each signal a finite
  `number`, falling back to the built-in constant on corrupt/missing storage.
- The hint reads `.value` at render time (no copy, no derived persisted
  state).

### Per-feed cache field (override) — behavior unchanged

| Field                | Source                                     | Meaning                              |
|----------------------|--------------------------------------------|--------------------------------------|
| Per-feed max size    | `policy.max_size_bytes` (nullable)         | blank/null → inherit account default |
| Per-feed retention   | `policy.max_age_seconds` (nullable)        | blank/null → inherit account default |

- This feature does not change how overrides are read, saved, or cleared
  (FR-008). It only changes the descriptive hint text beside each field.

## Derived value (render-time, not persisted)

| Derived string  | Source                                   | Formula                                   |
|-----------------|------------------------------------------|-------------------------------------------|
| Size hint       | `defaultMaxSizeBytes.value`              | `Math.round(bytes / 1_000_000)` → `N MB`  |
| Retention hint  | `defaultMaxAgeSeconds.value`             | `Math.round(seconds / 86400)` → `N days`  |

Degrade rule: if the source is not a finite number, the hint is the bare word
`default` (no number/unit).

## State transitions

None. No state is mutated by this feature.
