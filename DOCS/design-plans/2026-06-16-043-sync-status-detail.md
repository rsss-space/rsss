# Sync Status Detail (`/sync-status`) Design

## Summary
<!-- TO BE GENERATED after body is written -->

## Definition of Done

A new authenticated route, `/sync-status`, that turns the header's vague
"Sync warning" / "Sync error" indicator into a detailed, actionable view of
everything currently wrong with sync — covering both the *push* direction
(local changes that won't reach the server) and the *pull* direction (feeds
that won't fetch or publish).

Concretely, this is done when:

- **The header indicator links to the page.** In the `'warning'` and `'error'`
  states only, the sync-status indicator text
  (`src/client/components/sync-status.ts`) is a link to `/sync-status`,
  implemented as an `<a href>` (project rule: links, not buttons, for
  navigation). The `idle`, `syncing`, and `offline` states are unchanged.

- **The page renders up to four sections, each shown only when it has
  content:**
  1. **Current sync error** — the transient `syncError` message, shown when
     `syncStatus === 'error'`. Read-only.
  2. **Blocked local changes** — the dead-lettered outbox operations (the
     source of the header's "N blocked" count). Each entry shows the operation
     type, its target, the attempt count, and the last error. Per-item actions:
     **Retry** (re-queue the op to the outbox with a fresh attempt budget) and
     **Discard** (drop the dead-letter row, abandoning that change).
  3. **Feeds that couldn't fetch** — feeds carrying `last_error` /
     `last_status`. Per-feed actions: **Retry fetch** (non-destructive
     re-attempt) and **Unsubscribe** (destructive).
  4. **Feeds that couldn't share to Bluesky** — feeds carrying `publish_error`.
     Per-feed actions: **Retry share** (re-attempt the publish) and
     **Unsubscribe** (destructive). When `publish_error === 'reauth_required'`,
     the row prompts re-authentication instead of a plain retry.

  Sections 3 and 4 are the two labeled halves of "failed feeds" — fetch and
  publish are separate subsystems with separate remediation.

- **Destructive actions use inline row confirmation.** Discard and Unsubscribe
  do not fire on first click; the row reveals an inline "are you sure?" confirm
  (Cancel default-focused, danger-styled commit). Non-destructive actions
  (Retry) act immediately.

- **Empty state.** Because the route is directly reachable by URL, when nothing
  is wrong the page shows a friendly "everything's syncing" state rather than a
  blank page or an error.

### Out of scope / deferred to planning

- No server-side schema or endpoint changes. Investigation confirmed the
  remediation endpoints already exist (`POST /api/feeds/:id/refresh`,
  `POST /api/feeds/:id/publish`, `delete_feed` outbox op); the page reuses them.
- No toast system, no undo affordance, no bulk "retry all" in this version.

## Acceptance Criteria
<!-- TO BE GENERATED and validated before glossary -->

## Glossary
<!-- TO BE GENERATED after body is written -->

## Architecture

A new client-only route. No server or schema changes — the page reads the
local SQLite mirror and reuses existing remediation endpoints.

**Surface:**
- `src/client/routes/sync-status.ts` (`SyncStatusRoute`) + co-located
  `sync-status.css` — the view. Auth-gated, registered in
  `src/client/routes/index.ts` following the `/updates` pattern.
- `src/client/routes/sync-status-state.ts` — page-local signals
  (`deadLetters`, `failedFeeds`, `loading`) and a `loadSyncStatus()` loader.
  Deliberately *not* global app state: the header already has the only signal
  it needs (`syncDeadLetters`).
- Header change in `src/client/components/sync-status.ts`: the `'warning'` and
  `'error'` branches wrap their label in `<a href="/sync-status">` (the
  `idle`/`syncing`/`offline`/free branches are untouched).

**Reads** (via the existing `queryDb<T>` helper in `src/client/db/local-db.ts`):
- Dead-letter rows: net-new `listDeadLetterOutbox(db)` beside the existing
  `getDeadLetterOutboxCount` in `src/client/db/push-sync.ts`.
- Failed feeds: net-new `listFailedFeeds(db)` beside `getFeeds` in
  `src/client/db/local-adapter.ts` (same shape, error-filtered `WHERE`).

**Writes / actions** (on the `State` object in `src/client/state.ts`):
- Net-new `State.retryDeadLetter` and `State.discardDeadLetter`.
- Reused: `State.refreshFeed` (`POST /api/feeds/:id/refresh`),
  `State.toggleFeedPublished` (`POST /api/feeds/:id/publish`),
  `State.deleteFeed` (enqueues a `delete_feed` outbox op).

**Data flow:** On mount, `loadSyncStatus()` populates the page signals in a
`batch()`. The page subscribes to the existing `syncDeadLetters` count signal;
when a background sync changes it, the loader re-runs (no polling). Retry of a
feed fetch/share is a server round-trip — the local `last_error`/`publish_error`
clears only after the updated feed row syncs back, so a successful retry
triggers a follow-up sync/reload before the row disappears. Dead-letter
retry/discard are local-DB writes that immediately refresh the count and lists.

### Contracts (net-new)

```typescript
// src/client/db/push-sync.ts
interface DeadLetterRow {
    id:number
    op:string                 // 'subscribe' | 'delete_feed' | 'mark_read' | ...
    target_id:number|null
    payload:string            // JSON; parsed for the human description
    client_op_id:string
    client_updated_at:string
    attempts:number
    last_error:string|null
}
function listDeadLetterOutbox (db:Sqlite3Db):Promise<DeadLetterRow[]>

// src/client/db/local-adapter.ts — Feed already typed in db/types.ts
function listFailedFeeds (db:Sqlite3Db):Promise<Feed[]>
// WHERE last_error IS NOT NULL OR last_status >= 400 OR publish_error IS NOT NULL

// src/client/state.ts
// Requeue: copy the dead_letter_outbox row back into `outbox` with attempts
// reset to 0 and last_error cleared, delete the dead-letter row (one
// transaction), then kick push-sync and refresh signals.
State.retryDeadLetter = async function (
    state:AppState, id:number
):Promise<void>
// Drop the dead-letter row, then refresh the count + page signals.
State.discardDeadLetter = async function (
    state:AppState, id:number
):Promise<void>
```

## Existing Patterns

This design follows established codebase patterns; the only net-new logic is the
dead-letter read/requeue/discard.

- **Route registration** mirrors `/updates` in `src/client/routes/index.ts`
  (auth gate → `_setRoute('/login')`, else return the component).
- **Route view** mirrors `UpdatesRoute` (`src/client/routes/updates.ts`):
  `FunctionComponent<{ state:AppState }>`, `useEffect` auth guard + on-mount
  load, signal reads via `.value`, co-located CSS import.
- **State methods** follow the `State.method = async function(state, …)`
  convention in `src/client/state.ts` (e.g. `deleteFeed`, `refreshFeed`,
  `toggleFeedPublished`, `retryResolveFeed`). Multi-signal writes use `batch()`
  (project rule).
- **Local DB access** uses `queryDb`/`execDb` (`src/client/db/local-db.ts`); the
  requeue transaction mirrors `moveOutboxRowToDeadLetters`
  (`src/client/db/push-sync.ts:101`) in reverse, reusing the `outbox` insert
  shape from `insertOutbox` (`src/client/db/local-adapter.ts`).
- **Navigation** uses `<a href>` (route-event handles clicks globally) — never
  `<button onClick>` for navigation.
- **Styling** reuses `--color-warning` and spacing variables from the existing
  vars file; CSS uses the `.route.sync-status { & … }` nesting convention. No
  new colors.

**Divergence:** the project ships `<modal-window>` (`@substrate-system/dialog`)
for confirmations, but this design uses **inline row confirmation** instead (per
product decision) — lighter weight, keeps the user on the page. No modal
dependency is added.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Read layer
**Goal:** Query the local DB for the two problem lists.

**Components:**
- `listDeadLetterOutbox(db)` + `DeadLetterRow` type in
  `src/client/db/push-sync.ts`.
- `listFailedFeeds(db)` in `src/client/db/local-adapter.ts` (error-filtered
  feed query).
- A pure `describeOp(row)` helper mapping `op` + parsed `payload` to a
  human-readable label (e.g. "Unsubscribed from NPR Politics"), with a safe
  fallback for unknown ops.

**Dependencies:** None.

**Done when:** Tests pass for list/partition/description logic.
Covers `sync-status-detail.AC2`, `sync-status-detail.AC3` (listing/partition),
`sync-status-detail.AC6` (op description).
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Dead-letter remediation primitives
**Goal:** Retry (requeue) and discard a dead-lettered op.

**Components:**
- `State.retryDeadLetter(state, id)` — transactional copy back into `outbox`
  with `attempts = 0`, `last_error` cleared; delete the dead-letter row; kick
  push-sync; refresh `syncDeadLetters` (via `getDeadLetterOutboxCount` +
  `setSyncDone`).
- `State.discardDeadLetter(state, id)` — delete the dead-letter row; refresh
  count.

**Dependencies:** Phase 1 (row shape/read).

**Done when:** Tests verify requeue moves the row atomically with a reset
attempt budget, discard removes it, and the count signal updates. Covers
`sync-status-detail.AC4`.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Route, page scaffold, loader, empty state
**Goal:** A reachable `/sync-status` page that loads and renders the
current-sync-error section and the empty state.

**Components:**
- Route registration in `src/client/routes/index.ts` (auth-gated).
- `src/client/routes/sync-status-state.ts` — `deadLetters`, `failedFeeds`,
  `loading` signals + `loadSyncStatus(state)`.
- `src/client/routes/sync-status.ts` + `sync-status.css` — the shell:
  on-mount load, reactivity to `syncDeadLetters`, the "Current sync error"
  section (from `syncError`), and the empty state.

**Dependencies:** Phase 1 (loader uses the read layer).

**Done when:** Visiting `/sync-status` while unauthenticated redirects to
`/login`; the empty state renders when there are no problems; the current-error
section renders when `syncStatus === 'error'`. Covers `sync-status-detail.AC1`
(reachability/auth), `sync-status-detail.AC5` (empty state),
`sync-status-detail.AC7` (current sync error).
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Blocked-changes section + inline confirm
**Goal:** Render dead-lettered ops with working Retry/Discard.

**Components:**
- The "Blocked local changes" list in `SyncStatusRoute` (rows from
  `deadLetters`, described via `describeOp`).
- Inline-confirm state machine (page-local `confirmingId`) gating Discard;
  Retry acts immediately.
- Focus restoration on row removal; one persistent `role="status"` live region
  for batched action announcements.

**Dependencies:** Phase 2 (primitives), Phase 3 (scaffold).

**Done when:** Retry/Discard dispatch the right `State` methods, the confirm
machine commits/cancels correctly, and rows clear on success. Covers
`sync-status-detail.AC4`, `sync-status-detail.AC8` (inline confirm),
`sync-status-detail.AC9` (a11y/announcements).
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Failed-feeds sections (fetch + publish)
**Goal:** The two labeled feed-failure sections with reused remediation.

**Components:**
- "Feeds that couldn't fetch" — Retry fetch (`State.refreshFeed`) + Unsubscribe
  (`State.deleteFeed`, inline confirm).
- "Feeds that couldn't share to Bluesky" — Retry share
  (`State.toggleFeedPublished(…, true)`) + Unsubscribe; `reauth_required` shows
  a re-authentication affordance instead of a plain retry.
- Server-dependent actions disabled while offline (reads the existing offline
  signal); successful retry triggers a follow-up load so the row clears.

**Dependencies:** Phase 3 (scaffold); reuses existing feed actions.

**Done when:** Each section renders its feeds, the correct action fires per
sub-type, the `reauth_required` path shows re-auth, and offline disables
server actions. Covers `sync-status-detail.AC3`,
`sync-status-detail.AC10` (publish/reauth), `sync-status-detail.AC11`
(offline behavior).
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Header link
**Goal:** Make the header indicator navigate to the page.

**Components:**
- In `src/client/components/sync-status.ts`, wrap the label in
  `<a href="/sync-status">` for the `'warning'` and `'error'` states only,
  preserving the existing `<tool-tip>` and `role="status"` semantics and the
  `aria-label`.
- Scoped CSS so the link matches the existing `.sync-status.warning` /
  `.sync-status.error` appearance.

**Dependencies:** Phase 3 (route must exist).

**Done when:** The indicator is a link to `/sync-status` in the warning and
error states and a non-link in the other states (asserted by role/href, not
copy). Covers `sync-status-detail.AC1` (entry point).
<!-- END_PHASE_6 -->

## Additional Considerations

**Retry that fails again:** a requeued op that fails its fresh attempt budget
returns to `dead_letter_outbox` with updated `last_error`; the row reappears
with refreshed text rather than vanishing. No infinite-retry loop — the normal
dead-letter cap applies to the new attempts.

**Op/feed overlap:** a dead-lettered op may itself be a `delete_feed` or
`subscribe` targeting a feed that also appears in the failed-feeds list. The two
sections are independent views of the same underlying state; acting in one
re-runs the loader, which reflects any cross-effects. No special coordination is
designed in v1.

**Testing constraint:** per project rules, tests assert behavior and structure
(roles, stable hooks, dispatched methods), never specific rendered copy, and do
not test docs.
