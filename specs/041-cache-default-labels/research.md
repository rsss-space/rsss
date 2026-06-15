# Phase 0 Research: Show concrete default in per-feed cache labels

The spec carried no `[NEEDS CLARIFICATION]` markers; the one judgment call
(exact hint wording) was resolved as a documented Assumption. Research here
grounds the implementation in the current code and records the design
decisions that the spec's requirements and edge cases imply.

## Findings (current code, verified 2026-06-15)

- **Two render call sites** print the literal `blank = default`:
  - `src/client/components/cache-settings.ts:295` — `Max size (MB, blank =
    default)`
  - `src/client/components/cache-settings.ts:306` — `Keep for (days, blank =
    default)`
  - `src/client/routes/settings.ts:924` — `Max size (MB, blank = default)`
  - `src/client/routes/settings.ts:937` — `Keep for (days, blank = default)`
- **Account-level defaults** are plain client signals in
  `src/client/local-first-settings.ts`:
  - `defaultMaxSizeBytes:Signal<number>` (built-in `50_000_000`)
  - `defaultMaxAgeSeconds:Signal<number>` (built-in `30 * 86400`)
  - hydrated by `loadLocalFirstSettings()`, which already guards each value
    with `typeof x === 'number' && isFinite(x)` and falls back to the built-in
    constant otherwise — so the signals always hold a finite number.
- **The account-level cache editor** (`src/client/routes/settings.ts`) renders
  the same settings with:
  - bytes→MB: `Math.round(defaultMaxSizeBytes.value / 1_000_000)`
  - seconds→days: `Math.round(defaultMaxAgeSeconds.value / 86400)`
- The per-feed override inputs already compute display values the same way
  (`cache-settings.ts:220-225`).
- `settings.ts` already imports `defaultMaxSizeBytes` /
  `defaultMaxAgeSeconds`; `cache-settings.ts` does **not** yet import them.

## Decisions

### D1 — Mirror the account editor's exact conversion/rounding

- **Decision**: Format the default with `Math.round(bytes / 1_000_000)` MB and
  `Math.round(seconds / 86400)` days — byte-for-byte the same expressions the
  account editor uses.
- **Rationale**: FR-006 and SC-003 require the per-feed hint to match the
  account editor's displayed value 100% of the time. Reusing the identical
  rounding guarantees they cannot drift.
- **Alternatives rejected**: `util.ts`'s `formatBytes` (uses `.toFixed(1)` and
  KB/MB thresholds) would show decimals like `50.0 MB` and disagree with the
  whole-number account editor. Rejected.

### D2 — One shared formatting helper, co-located with the signals

- **Decision**: Add a small pure helper (e.g.
  `defaultCacheSizeHint(bytes)` / `defaultCacheAgeHint(seconds)`, or one
  helper parameterized by unit) to `src/client/local-first-settings.ts` and
  call it from both render sites.
- **Rationale**: FR-007 requires the wording to be consistent everywhere; a
  single helper makes the two call sites impossible to skew and centralizes
  the degrade case (D4). Co-locating with the signals it formats keeps the
  conversion constants in one module.
- **Alternatives rejected**: Duplicating the inline expression at both call
  sites — invites future drift, the exact problem FR-007 guards against.

### D3 — Reactivity comes for free via signal reads

- **Decision**: Read `defaultMaxSizeBytes.value` / `defaultMaxAgeSeconds.value`
  inside each component's render body when building the hint string.
- **Rationale**: FR-004 / SC-003 require the hint to track account-default
  changes. Reading `.value` during render subscribes the component, so when
  the account editor writes the signal the per-feed hint re-renders with the
  new value automatically. No extra wiring needed.

### D4 — Safe degrade when the value is not a finite number

- **Decision**: The helper returns the bare word `default` (yielding e.g.
  `Max size (default)`) when the input is not a finite number, instead of
  rendering `NaN`/`undefined`.
- **Rationale**: Edge case "Default unavailable at render time" requires a
  safe, non-misleading fallback. In practice `loadLocalFirstSettings()`
  already keeps the signals finite, so this is defense-in-depth, but it keeps
  the helper total and the hint never broken.

### D5 — Wording and unit, no pluralization

- **Decision**: Hint reads `default, <n> <unit>` with a fixed unit string
  (`MB`, `days`), e.g. `Max size (default, 50 MB)`,
  `Keep for (default, 30 days)`. No singular/plural handling.
- **Rationale**: Matches the user's requested form and the spec Assumptions
  ("unit label is fixed, not pluralized"). Keeps the word "default" (FR-005)
  and names the concrete value + unit (FR-001/FR-002).

### D6 — Scope guards

- **Decision**: Leave the "Cache mode" select ("Use default"), the input
  `placeholder="default"`, and the account-level editor unchanged.
- **Rationale**: Spec Assumptions place these out of scope. Only the two
  numeric field hints that read "blank = default" change. The placeholder
  already reads "default" and stays consistent.

## Open questions

None. All edge cases in the spec map to a decision above.
