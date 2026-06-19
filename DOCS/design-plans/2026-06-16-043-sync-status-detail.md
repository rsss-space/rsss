# Sync Status Detail (`/sync-status`) Design

## Summary

The `/sync-status` route is a new authenticated page that gives users a
detailed, actionable view of everything currently failing in the sync pipeline.
Today the header shows a vague "Sync warning" or "Sync error" indicator; this
feature turns it into a link that leads to a full diagnostic page. The page is
client-only — no server or schema changes — and draws entirely from the local
SQLite mirror that the app already maintains.

The page is organized around its failure categories: a transient sync error
from the most recent push attempt, dead-lettered outbox operations (local
changes that have permanently failed to reach the server after exhausting their
retry budget), and failed feeds (feeds whose last fetch or Bluesky publish
attempt returned an error, shown as two labeled sections). Each category is a
separate section shown only when it has content; each entry exposes just enough
detail to act on — operation type and last error for outbox items, feed name and
error type for feeds — along with per-row actions. Destructive actions (Discard,
Unsubscribe) require an inline confirmation step before firing; non-destructive
retries act immediately. The page is implemented in six phases: read-layer
queries first, then dead-letter remediation primitives, then the route scaffold,
then the blocked-changes section, then the failed-feeds sections, and finally
the header link that ties it all together.

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

### sync-status-detail.AC1: Header entry point & route reachability
- **sync-status-detail.AC1.1 Success:** In the `warning` state, the sync
  indicator renders a link to `/sync-status`.
- **sync-status-detail.AC1.2 Success:** In the `error` state, the sync indicator
  renders a link to `/sync-status`.
- **sync-status-detail.AC1.3 Success:** In the `idle`, `syncing`, and `offline`
  states, the indicator is not a link (no `href`).
- **sync-status-detail.AC1.4 Success:** An authenticated user reaches the page
  directly by URL.
- **sync-status-detail.AC1.5 Failure:** An unauthenticated user at
  `/sync-status` is redirected to `/login`.

### sync-status-detail.AC2: Blocked local changes are listed
- **sync-status-detail.AC2.1 Success:** Each `dead_letter_outbox` row appears as
  a row in the "Blocked local changes" section.
- **sync-status-detail.AC2.2 Success:** A row shows the op description, attempt
  count, and last error.
- **sync-status-detail.AC2.3 Edge:** With no dead-letter rows, the section is
  omitted.

### sync-status-detail.AC3: Failed feeds are listed and partitioned
- **sync-status-detail.AC3.1 Success:** A feed with `last_error` (or
  `last_status >= 400`) appears under "Feeds that couldn't fetch".
- **sync-status-detail.AC3.2 Success:** A feed with `publish_error` appears under
  "Feeds that couldn't share to Bluesky".
- **sync-status-detail.AC3.3 Edge:** A feed with both a fetch error and a publish
  error appears in both sections.
- **sync-status-detail.AC3.4 Edge:** A feed with no error appears in neither
  section.
- **sync-status-detail.AC3.5 Edge:** An empty feed-failure section is omitted.

### sync-status-detail.AC4: Blocked changes can be retried or discarded
- **sync-status-detail.AC4.1 Success:** Retry moves the row from
  `dead_letter_outbox` back into `outbox` with `attempts` reset to 0 and
  `last_error` cleared.
- **sync-status-detail.AC4.2 Success:** Retry removes the row from view and
  decrements the dead-letter count signal.
- **sync-status-detail.AC4.3 Success:** Discard deletes the `dead_letter_outbox`
  row and decrements the count.
- **sync-status-detail.AC4.4 Failure:** If the requeue transaction fails, neither
  table is left partially modified (atomic) and the row remains dead-lettered.
- **sync-status-detail.AC4.5 Edge:** A retried op that fails again returns to
  `dead_letter_outbox` with refreshed `last_error`.

### sync-status-detail.AC5: Empty state
- **sync-status-detail.AC5.1 Success:** With no current error, no dead-letters,
  and no failed feeds, the page shows the "everything's syncing" empty state.
- **sync-status-detail.AC5.2 Success:** Resolving the last problem while the page
  is open transitions it to the empty state.

### sync-status-detail.AC6: Op descriptions
- **sync-status-detail.AC6.1 Success:** Known ops render a human-readable
  description derived from the payload.
- **sync-status-detail.AC6.2 Edge:** An unrecognized op renders a safe fallback
  description (no crash).

### sync-status-detail.AC7: Current sync error section
- **sync-status-detail.AC7.1 Success:** When `syncStatus === 'error'`, the page
  shows the `syncError` message.
- **sync-status-detail.AC7.2 Edge:** When `syncStatus !== 'error'`, the section
  is omitted.

### sync-status-detail.AC8: Inline confirmation for destructive actions
- **sync-status-detail.AC8.1 Success:** Clicking Discard reveals an inline
  confirm; the row is not removed yet.
- **sync-status-detail.AC8.2 Success:** Confirming commits the discard;
  cancelling restores the row.
- **sync-status-detail.AC8.3 Success:** Clicking Unsubscribe reveals an inline
  confirm before the feed is removed.
- **sync-status-detail.AC8.4 Success:** Non-destructive actions (Retry) act
  immediately with no confirm step.

### sync-status-detail.AC9: Accessibility of live updates
- **sync-status-detail.AC9.1 Success:** A persistent `role="status"`
  `aria-live="polite"` region exists and is present before content is injected.
- **sync-status-detail.AC9.2 Success:** Action outcomes announce via a single
  batched message, not per row.
- **sync-status-detail.AC9.3 Success:** When a row is removed, focus moves to the
  next actionable element (or the section heading if the list is now empty).

### sync-status-detail.AC10: Publish failures and re-authentication
- **sync-status-detail.AC10.1 Success:** Retry share calls
  `toggleFeedPublished(…, true)`; on success the feed leaves the publish-failed
  section.
- **sync-status-detail.AC10.2 Success:** When `publish_error === 'reauth_required'`,
  the row shows a re-authentication affordance instead of a plain Retry.
- **sync-status-detail.AC10.3 Failure:** A retry-share that fails leaves the feed
  in the publish-failed section with refreshed error text.

### sync-status-detail.AC11: Offline behavior
- **sync-status-detail.AC11.1 Success:** While offline, server-dependent actions
  (Retry fetch, Retry share) are disabled.
- **sync-status-detail.AC11.2 Success:** While offline, local-only Discard
  remains enabled.

## Glossary

- **Dead-letter outbox (`dead_letter_outbox`)**: A local SQLite table holding
  outbox operations that have exhausted their retry budget
  (`DEAD_LETTER_ATTEMPT_LIMIT`, currently 10). An operation lands here when it
  has failed repeatedly and the app has stopped retrying it automatically. The
  `/sync-status` page is the user's interface for resolving these stuck
  operations.
- **Outbox (`outbox`)**: A local SQLite table of pending write operations
  (subscribe, delete feed, mark read, etc.) queued for push-sync to the server.
  Operations move from `outbox` to `dead_letter_outbox` after exceeding the
  attempt limit; a manual Retry copies one back the other way.
- **Push-sync**: The client-to-server synchronization direction. The push-sync
  loop reads from the `outbox`, sends operations to the server, and handles
  failures — including dead-lettering ops that fail too many times. Implemented
  in `src/client/db/push-sync.ts`.
- **`syncDeadLetters` (signal)**: A `@preact/signals` reactive value holding the
  current count of dead-letter rows. The header reads it to decide whether to
  show the "N blocked" indicator; the `/sync-status` page subscribes to it to
  trigger a reload when the count changes.
- **`syncError` / `syncStatus` (signals)**: Reactive values tracking the result
  of the most recent push-sync attempt. `syncStatus` is one of `'idle'`,
  `'syncing'`, `'warning'`, `'error'`, or `'offline'`; `syncError` carries the
  message when status is `'error'`.
- **`publish_error` / `reauth_required`**: A column on the `feeds` table set when
  a Bluesky feed-sharing attempt fails. The special value `'reauth_required'`
  means the OAuth token has expired and the user must re-authenticate rather
  than simply retrying.
- **`last_error` / `last_status`**: Columns on the `feeds` table capturing the
  outcome of the most recent RSS/Atom fetch. A non-null `last_error` or a
  `last_status >= 400` means the feed could not be fetched.
- **`batch()` (`@preact/signals`)**: Groups multiple signal writes into a single
  reactive update, preventing intermediate renders. Required by project
  convention whenever more than one signal is written in sequence.
- **`queryDb` / `execDb`**: Helpers in `src/client/db/local-db.ts` that run SQL
  against the in-browser SQLite database and return typed results. All local DB
  reads and writes go through these.
- **`role="status"` / `aria-live="polite"`**: Accessibility primitives for a
  region whose content changes are announced by screen readers without
  interrupting the user. The page uses one persistent such region for action
  outcomes.
- **Inline row confirmation**: The confirmation pattern chosen here instead of a
  modal. Clicking a destructive action transforms the row in place to show
  "are you sure?" with Cancel (default-focused) and a danger-styled commit
  button, keeping the user on the page.
- **`toggleFeedPublished`**: An existing `State` method that enables/disables
  Bluesky sharing for a feed via `POST /api/feeds/:id/publish`. Retry-share
  reuses it by calling it with `true`.

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
