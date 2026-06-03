# UI Contract: Per-Feed "Cache settings" Control

The interface this feature exposes is a UI behavior contract for the
per-feed cache-settings disclosure on `/settings`. It defines the
control's rendered states, interaction outcomes, and accessibility
surface as a function of the device caching state. This is the
verifiable contract that tests and manual QA assert against.

## Element under contract

- The `.feed-cache-controls` native `<details>` disclosure in each
  Subscribed Feeds row of `SettingsRoute`, with its
  `<summary>Cache settings</summary>`.

## Input

- `cacheDisabled:boolean` — `= !isLocalFirstActive.value`. The single
  device-level caching condition; identical for every feed row.

## State contract

### When `cacheDisabled === true` (caching OFF)

| Property | Required value |
|----------|----------------|
| `.feed-cache-controls` class list | includes `is-disabled` |
| Visual | reduced opacity matching global controls (`opacity: 0.55`) |
| `<details>` `open` | `false` (collapsed; force-collapses if was open) |
| `<summary>` `aria-disabled` | `"true"` |
| `<summary>` `tabindex` | `"-1"` (not in tab order) |
| Pointer activation (click) | suppressed — disclosure does NOT open |
| Keyboard activation | not reachable (removed from tab order) |
| Per-feed cache options (mode/size/age, Clear cache) | not revealed |

### When `cacheDisabled === false` (caching ON)

| Property | Required value |
|----------|----------------|
| `.feed-cache-controls` class list | does NOT include `is-disabled` |
| Visual | full opacity |
| `<details>` `open` | uncontrolled (native toggle behavior) |
| `<summary>` `aria-disabled` | absent (or `"false"`) |
| `<summary>` `tabindex` | absent (default focusable) |
| Pointer/keyboard activation | opens the disclosure as today |
| Per-feed cache options | revealed and editable as today |

## Invariants (independent of caching state)

- **Uniformity**: every feed row reflects the same `cacheDisabled`
  value; no row may differ (FR-004).
- **Isolation**: the feed title, feed URL, cache-mode label, cached-size
  label, and the "Unfollow" (`.btn-delete`) button are unaffected in
  both states (FR-006).
- **Reactivity**: a change to `isLocalFirstActive` updates every row's
  state in place, with no page reload and no re-mount (FR-005).
- **Consistency**: the disabled visual treatment is the same one used by
  the page's global cache controls (FR-009, SC-006).

## Acceptance mapping

- FR-001 / SC-001 -> "caching OFF" row has `is-disabled` + reduced opacity.
- FR-002 / SC-002 -> "caching OFF" pointer + keyboard activation suppressed.
- FR-003 / SC-003 -> "caching ON" opens and edits as today.
- FR-004 -> Uniformity invariant.
- FR-005 / SC-004 -> Reactivity invariant.
- FR-006 / SC-005 -> Isolation invariant.
- FR-007 -> "caching OFF" forces `open=false` (collapse-if-open).
- FR-008 -> `aria-disabled="true"` + `tabindex="-1"` (not color-only).
- FR-009 / SC-006 -> Consistency invariant.
