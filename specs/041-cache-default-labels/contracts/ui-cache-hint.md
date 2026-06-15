# UI Contract: per-feed cache default hint

This feature exposes no network/API contract (no server change). The internal
contract that other client code depends on is the shared hint-formatting
helper and the rendered hint text. Documented here so `/speckit.tasks` and
tests have a concrete surface.

## Helper contract (`src/client/local-first-settings.ts`)

Add a pure, total formatting helper (final naming is an implementation
detail; the contract is the behavior). Suggested shape:

```ts
// bytes -> "default, <N> MB"; non-finite -> "default"
export function defaultCacheSizeHint (bytes:number):string

// seconds -> "default, <N> days"; non-finite -> "default"
export function defaultCacheAgeHint (seconds:number):string
```

Behavioral guarantees:

1. **Rounding parity** — size uses `Math.round(bytes / 1_000_000)`; retention
   uses `Math.round(seconds / 86400)`. These MUST be byte-for-byte the same
   expressions the account-level cache editor uses, so the per-feed hint and
   the account editor always show the same number (SC-003, FR-006).
2. **Names the default** — the returned string contains the literal word
   `default` and the concrete value with its unit (`MB` / `days`)
   (FR-001/FR-002/FR-005).
3. **Fixed unit, no pluralization** — unit is `MB` / `days` regardless of
   value (Assumption); `1` reads as `1 MB` / `1 day`-not-required.
4. **Safe degrade** — for a non-finite input the function returns the bare
   word `default` (no `NaN`/`undefined`), so the hint never renders broken
   text (edge case: default unavailable at render time).
5. **Pure** — no signal reads, no side effects; the caller passes
   `signal.value` in. (Reading the signal at the call site is what makes the
   hint reactive — FR-004.)

## Rendered hint contract (both call sites)

Affected call sites:

- `src/client/components/cache-settings.ts` — per-feed "Max size" / "Keep for"
  labels
- `src/client/routes/settings.ts` — per-feed list in the Subscriptions section

Each MUST:

1. Render the size field label as `Max size (<size hint>)` and the retention
   field label as `Keep for (<age hint>)`, where the hint comes from the
   helper above. Result: e.g. `Max size (default, 50 MB)`,
   `Keep for (default, 30 days)`.
2. NOT contain the substring `blank = default` after this change (SC-002).
3. Leave the input element, its `placeholder="default"`, the `onChange`
   handlers, and the override read/write logic untouched (FR-008).
4. Be identical wording across both call sites (FR-007).

## Out of scope (unchanged)

- The "Cache mode" `<select>` "Use default" option.
- The numeric input `placeholder="default"`.
- The account-level cache settings editor inputs.
