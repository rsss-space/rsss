# Sync Status Detail (`/sync-status`) — Phase 6

**Goal:** Make the header sync indicator a link to `/sync-status` in the
`'warning'` and `'error'` states only, preserving the existing tooltip and
`role="status"` / `aria-label` semantics, and leaving the other states as
non-links.

**Codebase verified:** 2026-06-18 (via codebase-investigator).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### sync-status-detail.AC1: Header entry point & route reachability
- **sync-status-detail.AC1.1 Success:** In the `warning` state, the sync
  indicator renders a link to `/sync-status`.
- **sync-status-detail.AC1.2 Success:** In the `error` state, the sync indicator
  renders a link to `/sync-status`.
- **sync-status-detail.AC1.3 Success:** In the `idle`, `syncing`, and `offline`
  states, the indicator is not a link (no `href`).

---

## Verified codebase facts (read before implementing)

- `src/client/components/sync-status.ts` (the header indicator):
  - Builds per-state `label`, `cls` (`sync-status syncing|offline|error|
    warning|idle`), `title`, `a11yLabel`.
  - The inner element is a span:
    `<span class=${cls} role="status" aria-live="polite"
    aria-label=${a11yLabel}>${label}</span>` (~80-87).
  - It then wraps with a tooltip when `title` is set (true for `error` and
    `warning`): `return title ? html\`<tool-tip content=${title}
    placement="bottom" delay="500">${statusSpan}</tool-tip>\` : statusSpan`
    (~92-98).
  - There is an UNRELATED `<a href="/signup">` in the free-plan branch (~28-39)
    and an early `if (!active) return null` (~41). Do NOT touch those.
  - Imports `@substrate-system/tool-tip` and `import './sync-status.css'`.
  - The component reads global signals (`syncStatus`, `syncError`,
    `syncDeadLetters`, etc.) plus `billingStatus` and the local-first active
    signal — seed these in tests so the main status branch renders.
- `src/client/components/sync-status.css` (component-scoped) has
  `.sync-status { ... &.warning { color: var(--color-warning); } &.error
  { color: var(--color-error); cursor: help; } ... }`.
- Navigation: `<a href>` is intercepted globally by `route-event`; no `onClick`
  needed. The `/sync-status` route exists (Phase 3).
- Tests assert by role/href, not copy.

---

<!-- START_TASK_1 -->
### Task 1: Wrap the warning/error label in a `/sync-status` link

**Verifies:** sync-status-detail.AC1.1, sync-status-detail.AC1.2,
sync-status-detail.AC1.3

**Files:**
- Modify: `src/client/components/sync-status.ts`
- Modify: `src/client/components/sync-status.css`
- Test: the existing header `SyncStatus` component test (extend) or a new
  `test/sync-status-header.ts` wired into `test/browser-tests.ts`

**Implementation:**
- Keep the inner status span EXACTLY as today (its `class`, `role="status"`,
  `aria-live="polite"`, `aria-label` are unchanged).
- Compute `const isLinked = status === 'warning' || status === 'error'`.
- When `isLinked`, wrap the span in `<a href="/sync-status">` (a stable hook
  class such as `sync-status-link` is fine); otherwise render the span alone.
  The existing tooltip wrapping (`title ? <tool-tip>…</tool-tip> : …`) stays the
  OUTERMOST wrapper so error/warning keep their tooltip — i.e. wrap order is
  `<tool-tip><a href="/sync-status"><span …/></a></tool-tip>`.
- The `idle`, `syncing`, and `offline` branches must NOT be wrapped (no
  `/sync-status` href) — AC1.3.
- `sync-status.css`: add a scoped rule so the link matches the existing
  appearance:
  ```css
  .sync-status-link {
      text-decoration: none;
      color: inherit;
  }
  ```
  Do NOT change any unrelated CSS (the `.warning`/`.error` color rules already
  apply to the inner span). No new colors.

**Testing (browser):**
Mount `SyncStatus`, seeding the gating signals (`billingStatus` entitled +
local-first active) so the main status branch renders; seed `syncStatus` (and
`syncDeadLetters`/`syncError` as needed) per case. Assert by href/role, not
copy:
- sync-status-detail.AC1.1: `syncStatus='warning'` (with `syncDeadLetters > 0`) →
  an `a[href="/sync-status"]` exists and contains the `role="status"` span.
- sync-status-detail.AC1.2: `syncStatus='error'` (with `syncError` set) →
  `a[href="/sync-status"]` exists.
- sync-status-detail.AC1.3: for each of `syncStatus='idle'`, `'syncing'`,
  `'offline'` → NO `a[href="/sync-status"]` is rendered (the indicator is a
  plain span). Confirm the `role="status"` span is still present.
- Confirm the `<tool-tip>` wrapper is still present in the `warning`/`error`
  cases (tooltip semantics preserved).

Clean up (unmount + reset signals) in `finally`. Wire any new test file into
`test/browser-tests.ts`.

**Verification:** `npm run test:browser`; `npm run lint`.

**Commit:** `feat: link header sync indicator to /sync-status in warning/error`
<!-- END_TASK_1 -->

---

**Done when:** the header indicator is a link to `/sync-status` in the `warning`
and `error` states and a non-link in `idle`/`syncing`/`offline` (asserted by
role/href), with tooltip and `role="status"`/`aria-label` semantics preserved.
Covers sync-status-detail.AC1.1-AC1.3. Tests pass; `npm run lint` clean.
