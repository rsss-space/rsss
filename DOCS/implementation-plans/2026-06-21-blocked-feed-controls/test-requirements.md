# Blocked Feed Controls — Test Requirements

This document maps every acceptance criterion in the design
(`DOCS/design-plans/2026-06-21-blocked-feed-controls.md`,
`blocked-feed-controls.AC1` through `AC6`) to its verification. Each criterion
maps to exactly one row: an automated test (with its test type and the test
file the phase plans name) or human verification. The project tests with
`tapout` (browser) driving `@substrate-system/tapzero` suites in `test/*.ts`,
bundled by esbuild and registered via `import './<name>.js'` in
`test/browser-tests.ts`. The acceptance gate is `npm test && npm run lint`.

Test types used below:

- **unit** — pure-function tests: construct `DeadLetterRow` / `Feed` / `Item`
  literals and assert returned values (no DOM, no db). Model:
  `test/sync-status-format.ts`.
- **db-backed** — real OPFS-SQLite via `setTestMode(true, wasmUrl)` +
  `openLocalDb(did)`; seed/read with `db.exec(...)`. Model:
  `test/retry-discard-dead-letter.ts`, `test/local-adapter.ts`.
- **component-render** — `preact` `render(html\`<${Comp} .../>\`, root)` +
  `root.querySelector(...)`; structural and action-call assertions only.
  Model: `test/feed-nav.ts`.
- **route-render** — same as component-render but mounting a full route
  component (`FeedReader`) with `splats` / seeded signals.

Per the design and house rules, render tests assert STRUCTURE (roles,
elements, classes) and ACTION CALLS, never rendered text content.

## Automated test coverage

| AC | Criterion | Test type | Test file | What it asserts |
| --- | --- | --- | --- | --- |
| `blocked-feed-controls.AC1.1` | A feed with one or more mapped blocked ops renders a static yellow circle (no spin) in place of the spinner. | component-render | `test/feed-nav.ts` (warning variant: `test/feed-nav-warning.ts`) | A feed with non-empty `blockedOpsForFeed(id)` renders `.feed-warning-dot` present and `.feed-spinner` null for that row. |
| `blocked-feed-controls.AC1.2` | A failed-fetch feed (`last_fetched === null && last_error`) renders the same circle and keeps its "Failed to fetch" label and retry button. | component-render | `test/feed-nav-warning.ts` | Failed feed (`last_fetched:null`, `last_error:'boom'`, no blocked ops) renders `.feed-warning-dot`, and still renders `.feed-failed-label` and `.btn-retry`. |
| `blocked-feed-controls.AC1.3` | A genuinely-resolving feed (`last_fetched === null`, no error, no blocked op) still renders the blue spinner. | unit + component-render | `test/blocked-ops.ts` (classification) and `test/feed-nav-warning.ts` (render) | `feedRowState` returns `'resolving'` for that input; the row renders `.feed-spinner` present and `.feed-warning-dot` null. |
| `blocked-feed-controls.AC1.4` | A resolved, clean feed with no blocked op renders no circle. | unit + component-render | `test/blocked-ops.ts` (classification) and `test/feed-nav-warning.ts` (render) | `feedRowState` returns `'none'`; the row renders neither `.feed-spinner` nor `.feed-warning-dot`. |
| `blocked-feed-controls.AC1.5` | A resolved feed that has a blocked op renders the warning circle (blocked beats none). | unit | `test/blocked-ops.ts` | `feedRowState(feed, blockedOps)` returns `'blocked'` even when `last_fetched` is set and `last_error` is null (precedence: blocked beats everything). |
| `blocked-feed-controls.AC1.6` | The circle is exposed via a non-color cue (`role="img"` + label / visually-hidden text), is not focusable, and does not use `role="status"`. | component-render | `test/feed-nav-warning.ts` | `.feed-warning-dot` has `role === 'img'`, a non-empty `aria-label`, no `role="status"`, `tabIndex === -1`, and contains a `.visually-hidden` child. |
| `blocked-feed-controls.AC2.1` | `add_feed`, `delete_feed`, and per-feed `mark_all_read` dead-letters map to a feed by `target_id`. | unit | `test/blocked-ops.ts` | `mapBlockedOpsByFeed` keys an `add_feed`, `delete_feed`, and per-feed `mark_all_read` row (all `target_id:7`) under map key `7`. |
| `blocked-feed-controls.AC2.2` | An `update_item` dead-letter maps to a feed via the item's `feed_id` when the item is loaded. | unit | `test/blocked-ops.ts` | An `update_item` row (`target_id:100`) maps under the `feed_id` of the seeded item `{ id:100, feed_id:7 }`. |
| `blocked-feed-controls.AC2.3` | A global `mark_all_read` (null `target_id`) maps to no feed and marks no feed blocked. | unit | `test/blocked-ops.ts` | A `mark_all_read` row with `target_id:null` is absent from the returned map (no key, no entry). |
| `blocked-feed-controls.AC2.4` | An `update_item` whose item is not loaded maps to no feed (no crash; stays in `/sync-status`). | unit | `test/blocked-ops.ts` | An `update_item` whose `target_id` matches no loaded item is absent from the map and the call does not throw. |
| `blocked-feed-controls.AC2.5` | A feed with multiple blocked ops collects all of them. | unit | `test/blocked-ops.ts` | Two blocked ops mapping to the same feed id appear together in that feed's array (`length === 2`). |
| `blocked-feed-controls.AC3.1` | On a feed with blocked ops, a banner renders above the item list listing each op with description, attempts, and error. | component-render + route-render | `test/feed-blocked-banner.ts` (component) and `test/feed-reader-blocked-banner.ts` (integrated) | `.feed-blocked-banner` present; one `.feed-blocked-op` per op (count === `ops.length`); each op row contains `.feed-blocked-op-attempts` and `.feed-blocked-op-error` (container existence, not text). In the route, the banner renders above `.items-list`. |
| `blocked-feed-controls.AC3.2` | Retry on a banner op invokes `retryDeadLetter`. | component-render | `test/feed-blocked-banner.ts` | Clicking `.feed-blocked-retry` for an op records a `retryDeadLetter` call with that op's `id` (asserted via the `calls` array on the fake state). |
| `blocked-feed-controls.AC3.3` | Discard shows the "Are you sure?" confirm prompt before acting. | component-render | `test/feed-blocked-banner.ts` | Clicking `.feed-blocked-discard` does NOT immediately fire a discard action; `.feed-blocked-confirm` becomes present; the discard action fires only after clicking the confirm commit button. |
| `blocked-feed-controls.AC3.4` | When blocked ops exist, the banner replaces the "No items" empty state. | route-render | `test/feed-reader-blocked-banner.ts` | With a selected feed that has blocked ops and zero items, `.feed-blocked-banner` is present and `.empty-state` is null. |
| `blocked-feed-controls.AC4.1` | A failed-fetch feed (no blocked ops) shows a banner with the fetch error and a Retry control only (no Discard). | component-render + route-render | `test/feed-blocked-banner.ts` (component) and `test/feed-reader-blocked-banner.ts` (integrated) | Case B (blockedOps empty, `last_fetched:null`, `last_error:'boom'`): banner present, `.feed-blocked-retry` present, `.feed-blocked-discard` null. |
| `blocked-feed-controls.AC4.2` | Retry invokes `retryResolveFeed`. | component-render | `test/feed-blocked-banner.ts` | Clicking `.feed-blocked-retry` in Case B invokes `State.retryResolveFeed(state, String(feed.id))` (the `State` static is stubbed/restored in the test). |
| `blocked-feed-controls.AC4.3` | A feed with both a blocked op and `last_error` shows the blocked-op banner (Case A), not the failed-fetch banner. | component-render | `test/feed-blocked-banner.ts` | A feed with `last_error:'boom'` AND non-empty `blockedOps` renders Case A: `.feed-blocked-discard` IS present (the Case A marker), proving blocked-op wins. |
| `blocked-feed-controls.AC5.1` | Discarding a blocked `add_feed` removes the dead-letter op, deletes the local feed row and its items, and navigates away. | db-backed | `test/remove-local-feed-row.ts` (local delete) and `test/discard-blocked-feed-add.ts` (full action) | `removeLocalFeedRow` deletes the feed and items (counts 0). `discardBlockedFeedAdd` removes the dead-letter row, leaves 0 feeds/items, and sets `lastRoute === '/'`. |
| `blocked-feed-controls.AC5.2` | Discarding a blocked `add_feed` does NOT enqueue a `delete_feed` outbox op. | db-backed | `test/remove-local-feed-row.ts` | After `removeLocalFeedRow`, `COUNT(*) FROM outbox WHERE op = 'delete_feed'` is 0 and a pre-seeded unrelated outbox row still exists (outbox untouched). |
| `blocked-feed-controls.AC5.3` | Discarding a non-`add_feed` op removes only that op; the feed and items remain and no navigation occurs. | component-render | `test/feed-blocked-banner.ts` | After confirming Discard, a non-`add_feed` op (e.g. `update_item`) invokes `state.discardDeadLetter(state, op.id)` (not `discardBlockedFeedAdd`); an `add_feed` op invokes `discardBlockedFeedAdd(state, feed.id, op.id)`. The branch selection is the unit of behavior. |
| `blocked-feed-controls.AC5.4` | After any retry/discard, dead-letter counts and the global `deadLetterRows` signal refresh so the sidebar circle and banner update. | db-backed | `test/discard-blocked-feed-add.ts` | After `discardBlockedFeedAdd`, `syncDeadLetters.value === 0` (the `refreshDeadLetterCounts` path that also refreshes `deadLetterRows` ran; the count is the stable, non-brittle signal). |
| `blocked-feed-controls.AC6.1` | `/sync-status` reads the promoted global `deadLetterRows` signal and its Retry/Discard behavior is unchanged. | component-render (repointed) | `test/sync-status-route.ts` and `test/sync-status-feeds.ts` | The existing `/sync-status` suites drive the list by assigning `deadLetterRows.value = [...]` (now the global signal the route reads); blocked-changes list still renders and Retry/Discard still call the unchanged actions, so an `add_feed` discard there removes the op only. |
| `blocked-feed-controls.AC6.2` | No `console.error` leaks during the new flows; `npm test && npm run lint` pass. | gate (all suites) | tapout gate across all `test/*` + Phase 4 Task 3 full-suite run | The tapout runner fails any suite that emits `console.error`; Phase 4 Task 3 runs the full `npm test && npm run lint` gate and confirms zero failures / zero leaked errors. |

## Human verification

Every acceptance criterion above maps to an automated test; there are no
criteria that genuinely require human-only verification. The accessibility
contract (`AC1.6`) is automatable structurally (role, label, tabindex,
visually-hidden child) and is covered there.

The following manual smoke check is **optional and supplementary** — it is not
a coverage gap. The automated render tests assert structure (classes, roles,
elements), not pixels or copy, so a quick visual pass confirms the rendering is
visually correct end to end:

1. In the running app, add a feed whose URL fails to resolve and another whose
   sync op dead-letters. Confirm the sidebar shows a solid amber circle (the
   `--color-warning` color, not a spinner) next to each affected feed, and that
   a genuinely-resolving feed still shows the blue spinner.
2. Open a blocked-op feed's page; confirm the amber banner renders above the
   item list with per-op description, attempts, and error, plus Retry and
   Discard controls. Click Discard and confirm the "Are you sure?" prompt
   appears before anything is removed.
3. Open a failed-fetch feed's page; confirm the banner shows the fetch error
   and a Retry control with no Discard control.
4. With a screen reader (e.g. VoiceOver), confirm the sidebar circle announces
   "Blocked" / "Failed to fetch" (the non-color cue) and is not focusable.

## Notes

- **tapout console.error gate.** A single `console.error` emitted during any
  test fails the run even when every TAP assertion passes. This is the
  enforcement mechanism for `blocked-feed-controls.AC6.2`: the new flows must
  not introduce a code path that logs an error. Phase 4 Task 3 runs the full
  `npm test && npm run lint` gate as the final confirmation.
- **Structural, not text, assertions.** Per the house rules and the phase
  plans, all render tests (`feed-nav-warning`, `feed-blocked-banner`,
  `feed-reader-blocked-banner`, and the repointed `sync-status-*` suites) assert
  on roles, elements, classes, and recorded action calls — never on specific
  rendered text content. The op description, attempts value, and error string
  are verified by the presence of their container elements
  (`.feed-blocked-op-attempts`, `.feed-blocked-op-error`), not by reading the
  text inside them.
- **Pure seam under the render layer.** `mapBlockedOpsByFeed` and `feedRowState`
  (`test/blocked-ops.ts`) are the pure testable seam: the mapping rules
  (`AC2.*`) and the state precedence (`AC1.3`–`AC1.5`) are proven there with
  literal inputs, so the render tests only need to confirm the right structure
  is emitted for each state, not re-derive the classification.
- **`/sync-status` is a read-source repoint only.** `AC6.1` is covered by the
  existing `sync-status-route` / `sync-status-feeds` suites with no behavior
  change — they now assign to the global `deadLetterRows` signal instead of the
  former route-local `deadLetters`. The rename is whole-word `deadLetters` only
  and must not touch the singular `deadLetterRow` local variable.
