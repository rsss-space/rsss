# Blocked Feed Controls — Implementation Plan

**Goal:** Surface dead-lettered sync ops and failed-fetch feeds where they
are useful: a static yellow warning circle next to the affected feed in the
sidebar, and a Retry/Discard banner at the top of that feed's article page.

**Architecture:** Client-only. Promote the full dead-letter row list from a
route-local signal to an app-wide `@preact/signals` signal so the always-mounted
sidebar can read it. Derive a feed-id -> blocked-ops map (`blockedOpsByFeed`)
and classify each feed with a pure `feedRowState` helper that drives both the
sidebar indicator and the feed-page banner. A new low-level db helper
(`removeLocalFeedRow`) handles the special case of discarding a blocked
`add_feed` op (delete the local feed without enqueuing a server-bound
`delete_feed`).

**Tech Stack:** TypeScript (browser, ES2022 lib via Vite) + Preact,
`@preact/signals`, `htm/preact`. Tests: `@substrate-system/tapzero` bundled by
esbuild and run under `tapout` (browser). Local store is OPFS-SQLite via the
`@sqlite.org/sqlite-wasm` worker (real db in tests, not mocked).

**Scope:** 4 phases (full design).

**Codebase verified:** 2026-06-21 (direct read of the listed files on branch
`blocked-feed-controls`).

---

## Project conventions (apply to every phase)

These are house rules for this repo and this user. Honor them in all code and
tests:

- **Line length:** no line longer than 80 columns (TS and CSS).
- **Type annotations:** no space between the colon and the type, e.g.
  `deadLetterRows:Signal<DeadLetterRow[]>` (not `deadLetterRows: Signal<...>`).
- **Ternaries:** break long ternaries across lines with `?` / `:` leading the
  continuation lines (see existing `state.ts` for the house style).
- **Batched signal writes:** any time you set two or more signals in sequence,
  wrap them in `batch(() => { ... })` from `@preact/signals`.
- **Navigation is links, not buttons:** never use `<button onClick>` to change
  the route; use `<a href>` (a global `route-event` handler intercepts link
  clicks). Programmatic navigation uses `state._setRoute('/')`.
- **CSS:** use nested selectors (`& .child { ... }`) rather than many flat
  classes; use existing variables from `src/client/_variables.css` for every
  color (reuse `--color-warning`); never use a font size below `1rem`.
- **No emojis** in code or comments. No decorative glyphs.
- **Do NOT write brittle tests:** assert structure (roles, elements, classes,
  action calls), never specific rendered text content. Do not test types.

### How tests run (read before writing any test)

- `npm test` runs `node test/run-all-tests.mjs`. `npm run lint` runs eslint.
  The acceptance gate for every phase is `npm test && npm run lint` clean.
- Browser tests live in `test/*.ts` and use `@substrate-system/tapzero`'s
  `test(name, t => {...})`. They are bundled and registered, NOT auto-discovered.
- **To register a new browser test file:** add a single line
  `import './<name>.js'` to `test/browser-tests.ts` (the consolidated
  `npm run test:browser` bundle, which already supplies the `.wasm` loader).
  Do not add a new package.json script or edit `run-all-tests.mjs` unless a
  test must run isolated.
- **tapout gate:** a `console.error` emitted during a test fails the run even if
  every TAP assertion passes. Do not introduce code paths that `console.error`
  during the new flows.
- **Pure-function tests** (no db, no DOM): construct `DeadLetterRow` / `Feed` /
  `Item` object literals and assert with `t.ok` / `t.equal`. Model:
  `test/sync-status-format.ts`.
- **db-backed tests:** open a real db with
  `setTestMode(true, wasmUrl)` + `openLocalDb(did)` from
  `src/client/db/sqlite-init.js`; seed/read with `db.exec({ sql, bind,
  rowMode:'object', resultRows })`. Model: `test/retry-discard-dead-letter.ts`,
  `test/local-adapter.ts`.
- **component render tests:** `render(html\`<${Component} .../>\`, root)` using
  `preact`'s `render`; assert with `root.querySelector(...)`. Model:
  `test/feed-nav.ts`.

---

## Acceptance Criteria Coverage

This phase (Phase 1) implements and tests the op-to-feed mapping, the
feed-state precedence helper, and repoints `/sync-status` to the promoted
signal:

### blocked-feed-controls.AC1: Sidebar shows a warning circle for blocked/failed feeds
- **blocked-feed-controls.AC1.3 Success:** A genuinely-resolving feed
  (`last_fetched === null`, no error, no blocked op) still renders the blue
  spinner. *(Phase 1 covers the `feedRowState` -> `'resolving'` classification;
  the spinner render is Phase 2.)*
- **blocked-feed-controls.AC1.4 Success:** A resolved, clean feed with no
  blocked op renders no circle. *(Phase 1 covers `feedRowState` -> `'none'`.)*
- **blocked-feed-controls.AC1.5 Precedence:** A resolved feed that has a blocked
  op renders the warning circle (blocked beats none). *(Phase 1 covers
  `feedRowState` -> `'blocked'` precedence.)*

### blocked-feed-controls.AC2: Op-to-feed mapping is correct
- **blocked-feed-controls.AC2.1 Success:** `add_feed`, `delete_feed`, and
  per-feed `mark_all_read` dead-letters map to a feed by `target_id`.
- **blocked-feed-controls.AC2.2 Success:** An `update_item` dead-letter maps to
  a feed via the item's `feed_id` when the item is loaded.
- **blocked-feed-controls.AC2.3 Excluded:** A global `mark_all_read` (null
  `target_id`) maps to no feed and marks no feed blocked.
- **blocked-feed-controls.AC2.4 Excluded:** An `update_item` whose item is not
  loaded maps to no feed (no crash; stays in `/sync-status`).
- **blocked-feed-controls.AC2.5 Success:** A feed with multiple blocked ops
  collects all of them.

### blocked-feed-controls.AC6: Cross-cutting behaviors
- **blocked-feed-controls.AC6.1:** `/sync-status` reads the promoted global
  `deadLetterRows` signal and its Retry/Discard behavior is unchanged
  (discarding an `add_feed` there removes the op only, does not delete the feed).

---

## Verified codebase facts (Phase 1)

- `DeadLetterRow` is defined in `src/client/db/push-sync.ts:54-63`:
  `{ id:number; op:string; target_id:number|null; payload:string;
  client_op_id:string; client_updated_at:string; attempts:number;
  last_error:string|null }`. `op` is a plain `string`; the op literals
  (`add_feed`, `delete_feed`, `update_item`, `mark_all_read`) are compared as
  strings in `buildRequest` and `describeOp`.
- `target_id` semantics (verified in `src/client/db/local-adapter.ts`):
  `add_feed` enqueues `target_id = feed.id` (line 129); `delete_feed`
  `target_id = id` (line 150); per-feed `mark_all_read` `target_id = feedId`,
  global `mark_all_read` `target_id = null` (lines 350-356); `update_item`
  `target_id = item id` (line 69).
- `Feed` (`src/client/db/types.ts:9-25`) has `id:number`,
  `last_fetched:string|null`, `last_error:string|null`, `last_status:number|null`.
  `Item` (`types.ts:27-51`) has `id:number`, `feed_id:number`.
- `src/client/db/sync-status.ts` currently exports the COUNT signal
  `syncDeadLetters:Signal<number>` (line 14) plus `syncPending`, status
  setters `setSyncDone` (line 24), `setSyncError`, etc. It imports nothing from
  `push-sync.ts` today.
- `listDeadLetterOutbox(db)` (`push-sync.ts:88-97`) returns
  `Promise<DeadLetterRow[]>` ordered by id. `getDeadLetterOutboxCount(db)`
  (`push-sync.ts:78-86`) returns the count.
- `setSyncDone(pending, deadLetters)` is called in exactly two places:
  `src/client/db/sync.ts:156-160` (end of `runSyncCycle`, gated on
  `trackStatus`) and `src/client/db/push-sync.ts:686-690` (end of `pushSync`,
  gated on `trackStatus`). On app boot, `startLocalSync`
  (`state.ts:954-977`) calls `runSync(db)` which reaches `runSyncCycle`'s
  `setSyncDone` — this is the "initial load" refresh point.
- `refreshDeadLetterCounts(db)` (`state.ts:3088-3100`) refreshes
  `syncPending`/`syncDeadLetters` after retry/discard and carefully only
  downgrades a `warning` status (never clobbers `error`/`syncing`).
- `state.ts` builds an `AppState` object inside `State()` (line 777+). Existing
  `computed` derivations on that object include
  `feedsWithUpdates: computed<string[]>(() => Object.keys(...))` (line 830) and
  `displayedFeedSyncStatus` (line 833) — these read `state.*` inside the
  computed body. `feeds:Signal<Feed[]>` (line 812) and `items:Signal<Item[]>`
  (line 840) live on this object. The `AppState` type is at line 663.
- `state.ts` already imports `getOutboxCount, getDeadLetterOutboxCount, ...`
  from `./db/push-sync.js` (lines 43-51) and `syncStatus, syncPending,
  syncDeadLetters, ...` from `./db/sync-status.js` (lines 53-60). It re-exports
  `Feed` and `Item` types (lines 638-643).
- `routes/sync-status-state.ts` currently defines the route-local
  `export const deadLetters:Signal<DeadLetterRow[]> = signal([])` (line 10) and
  `loadSyncStatus(state)` (line 16) loads it via `listDeadLetterOutbox(db)`
  (lines 34-43), alongside route-local `failedFeeds`.
- `routes/sync-status.ts` imports `deadLetters` from `./sync-status-state.js`
  (line 9) and reads `deadLetters.value` as `dl` (line 119); the focus effect
  depends on `deadLetters.value.length` (line 112). `describeOp` is imported
  from `./sync-status-format.js`.
- **Existing tests reference the route-local signal by name:**
  `test/sync-status-route.ts` and `test/sync-status-feeds.ts` both
  `import { deadLetters } from '../src/client/routes/sync-status-state.js'`
  and assign `deadLetters.value = [...]` in ~35 places to drive the route
  render. These must be repointed (see Task 6). NOTE: a `deadLetterRow`
  (singular) local variable also appears in `sync-status-feeds.ts`; the rename
  is whole-word `deadLetters` only and must not touch `deadLetterRow`.

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Pure blocked-ops helpers (`blocked-ops.ts`) — failing test first

**Verifies:** blocked-feed-controls.AC2.1, AC2.2, AC2.3, AC2.4, AC2.5,
AC1.3, AC1.4, AC1.5

**Files:**
- Create: `test/blocked-ops.ts` (unit)
- Create: `src/client/blocked-ops.ts` (implementation — stub in this task)

**Step 1: Write the failing test**

Create `test/blocked-ops.ts`. Import `test` from `@substrate-system/tapzero`,
`mapBlockedOpsByFeed` and `feedRowState` from
`../src/client/blocked-ops.js`, `DeadLetterRow` from
`../src/client/db/push-sync.js`, and `Feed` / `Item` from
`../src/client/db/types.js`. Follow the literal-construction style of
`test/sync-status-format.ts`.

Write tests asserting BEHAVIOR (structure/values, not copy):

`mapBlockedOpsByFeed(rows, feeds, items)` returns a `Map<number,
DeadLetterRow[]>`:
- AC2.1: an `add_feed` row (`target_id: 7`), a `delete_feed` row
  (`target_id: 7`), and a per-feed `mark_all_read` row (`target_id: 7`) all map
  under key `7`.
- AC2.2: an `update_item` row (`target_id: 100`) maps under the `feed_id` of the
  item whose `id === 100` (seed an item `{ id:100, feed_id:7 }`).
- AC2.3: a global `mark_all_read` (`target_id: null`) is absent from the map
  (no key, no entry).
- AC2.4: an `update_item` whose `target_id` matches no loaded item is absent
  from the map (and the call does not throw).
- AC2.5: two blocked ops with the same mapped feed id appear together in that
  feed's array (length 2).

`feedRowState(feed, blockedOps)` returns one of
`'blocked' | 'failed' | 'resolving' | 'none'`:
- AC1.5: `blockedOps.length > 0` returns `'blocked'` even when the feed is fully
  resolved (`last_fetched` set, `last_error` null) — blocked beats everything.
- failed: `last_fetched === null && last_error` set, `blockedOps` empty ->
  `'failed'`.
- AC1.3: `last_fetched === null`, `last_error` null, `blockedOps` empty ->
  `'resolving'`.
- AC1.4: `last_fetched` set, `last_error` null, `blockedOps` empty -> `'none'`.

**Step 2: Create the implementation stub so the import resolves**

Create `src/client/blocked-ops.ts` with the signatures but a deliberately wrong
body so tests FAIL (e.g. `mapBlockedOpsByFeed` returns an empty `Map`,
`feedRowState` returns `'none'`):

```ts
import type { DeadLetterRow } from './db/push-sync.js'
import type { Feed, Item } from './db/types.js'

export type FeedRowState = 'blocked'|'failed'|'resolving'|'none'

export function mapBlockedOpsByFeed (
    _rows:DeadLetterRow[],
    _feeds:Feed[],
    _items:Item[]
):Map<number, DeadLetterRow[]> {
    return new Map()
}

export function feedRowState (
    _feed:Feed,
    _blockedOps:DeadLetterRow[]
):FeedRowState {
    return 'none'
}
```

**Step 3: Register and run the test; confirm it FAILS**

Add `import './blocked-ops.js'` to `test/browser-tests.ts` (in the client-test
import group, e.g. near `import './sync-status-format.js'`).

Run: `npm run test:browser`
Expected: the new assertions fail (the stub returns wrong values).

**Step 4: Commit**

```bash
git add test/blocked-ops.ts src/client/blocked-ops.ts test/browser-tests.ts
git commit -m "test: failing tests for blocked-ops mapping and feed-row state"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement the pure blocked-ops helpers

**Verifies:** blocked-feed-controls.AC2.1, AC2.2, AC2.3, AC2.4, AC2.5,
AC1.3, AC1.4, AC1.5

**Files:**
- Modify: `src/client/blocked-ops.ts`

**Implementation:**

Replace the stub bodies. `mapBlockedOpsByFeed` resolves each row to a feed id
per the rules below and groups rows into a `Map`. Build an item-id -> feed-id
lookup once (from `items`) for the `update_item` case. The `feeds` parameter is
accepted for signature stability and future use; mapping keys are derived from
`target_id` / item `feed_id`, so it is acceptable for the body not to read
`feeds` (do not add unused-variable lint errors — keep the param named with a
leading underscore if eslint flags it, matching the stub).

Row -> feed-id rules:
1. `op === 'add_feed' | 'delete_feed' | 'mark_all_read'`: feed id is
   `row.target_id` when it is a non-null number; a null `target_id` (global
   `mark_all_read`) is unmappable -> skip.
2. `op === 'update_item'`: look up `row.target_id` in the item-id->feed-id map;
   if found use that `feed_id`; if not found -> skip.
3. anything else -> skip.

`feedRowState(feed, blockedOps)` precedence (high to low):
1. `blockedOps.length > 0` -> `'blocked'`
2. `feed.last_fetched === null && feed.last_error` (truthy) -> `'failed'`
3. `feed.last_fetched === null && !feed.last_error` -> `'resolving'`
4. otherwise -> `'none'`

Match the existing sidebar's failed/resolving definitions exactly
(`feed-nav.ts:169-174`): use `!!feed.last_error`, do not consider `last_status`
here (that broader predicate, `isFetchFailed`, is `/sync-status`-only).

**Testing:**
The Task 1 tests now pass. They verify:
- AC2.1/AC2.5: `target_id`-keyed grouping and multi-op collection.
- AC2.2: `update_item` via item `feed_id`.
- AC2.3/AC2.4: unmappable rows excluded, no throw.
- AC1.3/AC1.4/AC1.5: precedence ordering.

**Verification:**
Run: `npm run test:browser`
Expected: all `blocked-ops` assertions pass.
Run: `npm run lint`
Expected: clean.

**Commit:** `feat: pure blocked-ops mapping and feed-row-state helpers`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: Promote `deadLetterRows` to a global signal + refresh helper

**Verifies:** (infrastructure for AC1.x/AC3.x/AC6.1; refresh wiring)

**Files:**
- Modify: `src/client/db/sync-status.ts`
- Modify: `src/client/db/push-sync.ts`
- Modify: `src/client/db/sync.ts`

**Implementation:**

1. `src/client/db/sync-status.ts` — add the app-wide signal beside the existing
   count. Add a type-only import (no runtime cycle — `push-sync.ts` imports
   values from this module, but a `import type` is erased at build time):

   ```ts
   import type { DeadLetterRow } from './push-sync.js'
   // ...beside syncDeadLetters:
   export const deadLetterRows:Signal<DeadLetterRow[]> = signal([])
   ```

2. `src/client/db/push-sync.ts` — add `deadLetterRows` to the existing
   `from './sync-status.js'` import, and add an exported refresher that loads
   the full list with the existing query helper:

   ```ts
   export async function refreshDeadLetterRows (
       db:Sqlite3Db
   ):Promise<void> {
       deadLetterRows.value = await listDeadLetterOutbox(db)
   }
   ```

   In `pushSync`, inside the existing `if (trackStatus) { ... }` block at the
   end (currently lines 686-690, right after `setSyncDone(pending, deadLetters)`),
   add `await refreshDeadLetterRows(db)`.

3. `src/client/db/sync.ts` — in `runSyncCycle`, inside the final
   `if (trackStatus) { setSyncDone(...) }` block (currently lines 155-160),
   after `setSyncDone(...)`, add `await refreshDeadLetterRows(db)`. Import
   `refreshDeadLetterRows` from `./push-sync.js` (add to the existing import
   block from that module). This is the "initial load" + every-cycle refresh
   point (`startLocalSync` -> `runSync` -> `runSyncCycle`).

**Testing:**
No new dedicated test in this task (signal plumbing). The end-to-end refresh is
exercised by the existing sync tests (still green) and by the Task 6 repoint
(`/sync-status` reads `deadLetterRows`). Do not add a brittle test here.

**Verification:**
Run: `npm run lint` — clean.
Run: `npm run test:browser` — existing suites still pass (no regressions).

**Commit:** `feat: promote dead-letter row list to an app-wide signal`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: `blockedOpsByFeed` computed + `blockedOpsForFeed` on `AppState`

**Verifies:** blocked-feed-controls.AC2.* (wired into app state), AC1.5

**Files:**
- Modify: `src/client/state.ts`

**Implementation:**

1. Imports: add `deadLetterRows` to the existing import from
   `./db/sync-status.js`; add `refreshDeadLetterRows` to the existing import
   from `./db/push-sync.js`; add a new import
   `import { mapBlockedOpsByFeed } from './blocked-ops.js'`; add
   `import type { DeadLetterRow } from './db/push-sync.js'` if not already
   present (it is not — add it). `ReadonlySignal` is needed for the type — it is
   imported from `@preact/signals` (confirm it is in the existing
   `@preact/signals` import; add it if missing).

2. `AppState` type (line 663 block): add two members:

   ```ts
   blockedOpsByFeed:ReadonlySignal<Map<number, DeadLetterRow[]>>,
   blockedOpsForFeed:(feedId:number) => DeadLetterRow[],
   ```

3. State object literal (inside `State()`, beside `feedsWithUpdates` /
   `displayedFeedSyncStatus`, ~line 830): add the computed and the reader.
   Mirror the existing computed style (reads `state.*` inside the body):

   ```ts
   blockedOpsByFeed: computed(() => (
       mapBlockedOpsByFeed(
           deadLetterRows.value,
           state.feeds.value,
           state.items.value
       )
   )),
   blockedOpsForFeed: (feedId:number) => (
       state.blockedOpsByFeed.value.get(feedId) ?? []
   ),
   ```

4. `refreshDeadLetterCounts(db)` (line 3088): after the existing `batch(...)`
   that updates the counts, add `await refreshDeadLetterRows(db)` so retry and
   discard refresh the full list too (drives AC5.4 in later phases). Keep the
   function `async` (it already is).

**Testing:**
No new dedicated unit test for the computed in this task — `mapBlockedOpsByFeed`
is already unit-tested (Task 2), and components consume `blockedOpsForFeed` in
Phases 2/4 (tested there with fake states). Adding a State-construction test
here would be redundant and brittle. The TypeScript compiler verifies the type
wiring; `npm run lint` and the existing State tests verify no regression.

**Verification:**
Run: `npm run lint` — clean (no unused imports, no type errors surfaced by
eslint's TS rules).
Run: `npm run test:browser` — existing State/route suites still pass.

**Commit:** `feat: blockedOpsByFeed computed and blockedOpsForFeed reader`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->

<!-- START_TASK_5 -->
### Task 5: Repoint `loadSyncStatus` to write the global signal

**Verifies:** blocked-feed-controls.AC6.1

**Files:**
- Modify: `src/client/routes/sync-status-state.ts`

**Implementation:**

The route-local `deadLetters` signal is promoted; `sync-status-state.ts` should
no longer own it. Re-export the global and write it from the loader:

1. Remove the local `export const deadLetters:Signal<DeadLetterRow[]> =
   signal([])` (line 10).
2. Add `import { deadLetterRows } from '../db/sync-status.js'` and re-export it:
   `export { deadLetterRows } from '../db/sync-status.js'` (so importers of this
   module keep one source). Keep the `DeadLetterRow` type import if still
   referenced; otherwise drop it to satisfy lint.
3. In `loadSyncStatus`, change the two writes of `deadLetters.value` (the
   no-db reset path ~line 23 and the success path ~line 40) to
   `deadLetterRows.value`. Keep `failedFeeds` exactly as-is (out of scope).

**Testing:**
Covered by the Task 6 repoint of the existing `/sync-status` suites; no new test
here.

**Verification:**
Run: `npm run lint` — clean.

**Commit:** `refactor: loadSyncStatus writes the global deadLetterRows signal`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Repoint `/sync-status` route + its tests to `deadLetterRows`

**Verifies:** blocked-feed-controls.AC6.1

**Files:**
- Modify: `src/client/routes/sync-status.ts`
- Modify: `test/sync-status-route.ts`
- Modify: `test/sync-status-feeds.ts`

**Implementation:**

This is a whole-word rename of the imported signal identifier `deadLetters` ->
`deadLetterRows`. Behavior is unchanged — only the read source moves to the
global signal.

1. `src/client/routes/sync-status.ts`: change the import on line 9 from
   `deadLetters` (out of `./sync-status-state.js`) to `deadLetterRows`. (It may
   be imported from `./sync-status-state.js` since Task 5 re-exports it there,
   or directly from `../db/sync-status.js` — either is fine; prefer
   `../db/sync-status.js` as the canonical source and drop the name from the
   `./sync-status-state.js` import.) Then rename every whole-word use of
   `deadLetters` in this file to `deadLetterRows` (the `dl = deadLetters.value`
   read at line 119 and the effect dependency `deadLetters.value.length` at
   line 112). Leave `failedFeeds`, `confirmingKey`, `announcement` untouched.

2. `test/sync-status-route.ts` and `test/sync-status-feeds.ts`: change the
   `deadLetters` import to `deadLetterRows` and rename every whole-word
   `deadLetters` reference to `deadLetterRows`.
   **CAUTION:** the rename is whole-word `deadLetters` ONLY. Do NOT rename the
   singular local variable `deadLetterRow` (e.g. in `sync-status-feeds.ts` near
   line 1068). Use a word-boundary search (`\bdeadLetters\b`) to avoid touching
   `deadLetterRow`.

**Testing:**
The existing `/sync-status` suites are the regression coverage for AC6.1:
discarding an `add_feed` from `/sync-status` still removes only the op (it calls
`State.discardDeadLetter`, unchanged), the blocked-changes list still renders,
and Retry/Discard still work. They drive the list by assigning
`deadLetterRows.value = [...]`, which is now the global signal the route reads —
behavior is identical.

**Verification:**
Run: `npm run test:browser`
Expected: `sync-status-route`, `sync-status-feeds`, `sync-status-header` all
pass.
Run: `npm run lint` — clean.

**Commit:** `refactor: /sync-status reads the promoted deadLetterRows signal`
<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_C -->

## Phase 1 done when

- `npm test && npm run lint` pass clean.
- `test/blocked-ops.ts` passes: `mapBlockedOpsByFeed` (AC2.1-2.5) and
  `feedRowState` precedence (AC1.3-1.5) are correct.
- `/sync-status` still lists blocked changes and its Retry/Discard behavior is
  unchanged, now reading the global `deadLetterRows` signal (AC6.1).
- `deadLetterRows` refreshes on initial load, after each sync cycle, after
  standalone push-sync, and after retry/discard.
