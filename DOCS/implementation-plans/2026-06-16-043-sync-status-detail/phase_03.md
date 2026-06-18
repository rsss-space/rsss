# Sync Status Detail (`/sync-status`) — Phase 3

**Goal:** A reachable, auth-gated `/sync-status` page that loads the problem
lists on mount, reacts to background sync changes, renders the "Current sync
error" section, and shows the empty state when nothing is wrong.

**Codebase verified:** 2026-06-18 (via codebase-investigator).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### sync-status-detail.AC1: Header entry point & route reachability
- **sync-status-detail.AC1.4 Success:** An authenticated user reaches the page
  directly by URL.
- **sync-status-detail.AC1.5 Failure:** An unauthenticated user at
  `/sync-status` is redirected to `/login`.
  *(AC1.1-AC1.3, the header link, are Phase 6.)*

### sync-status-detail.AC5: Empty state
- **sync-status-detail.AC5.1 Success:** With no current error, no dead-letters,
  and no failed feeds, the page shows the "everything's syncing" empty state.
- **sync-status-detail.AC5.2 Success:** Resolving the last problem while the page
  is open transitions it to the empty state.

### sync-status-detail.AC7: Current sync error section
- **sync-status-detail.AC7.1 Success:** When `syncStatus === 'error'`, the page
  shows the `syncError` message.
- **sync-status-detail.AC7.2 Edge:** When `syncStatus !== 'error'`, the section
  is omitted.

---

## Verified codebase facts (read before implementing)

- `src/client/routes/index.ts` — routes register via
  `router.addRoute(path, handler)`; the `/updates` handler is the model:
  ```ts
  router.addRoute('/updates', () => {
      if (!state.authLoading.value && !state.isAuthenticated.value) {
          return state._setRoute('/login')
      }
      return UpdatesRoute
  })
  ```
  `state.isAuthenticated` is `computed(() => state.user.value !== null)`;
  `state._setRoute` is the route setter.
- `src/client/routes/updates.ts` — the route-component model:
  `FunctionComponent<{ state:AppState }>`, `htm/preact` (`html\`...\``), a
  `useEffect` auth guard (`if (!authLoading && !isAuthenticated)
  _setRoute('/login')`), `if (!state.isAuthenticated.value) return null`, signal
  reads via `.value`, and co-located `import './updates.css'`.
- Signals (`src/client/db/sync-status.ts`): `syncStatus:Signal<'idle' |
  'syncing' | 'error' | 'offline' | 'warning'>`, `syncError:Signal<string|null>`,
  `syncDeadLetters:Signal<number>`.
- DB handle for the loader: `getBootstrappedDb() ?? getLocalDb(did)` from
  `src/client/db/index.ts` (both return `Sqlite3Db|null` synchronously; the
  loader early-returns/empties on null). Pattern lifted from
  `src/client/routes/settings.ts` (~112-124).
- Phase 1 reads: `listDeadLetterOutbox(db)` (`db/push-sync.js`),
  `listFailedFeeds(db)` (`db/local-adapter.js`).
- CSS: `_variables.css` provides `--color-warning`, `--color-error`,
  `--color-primary`, `--color-text`, `--color-text-secondary`,
  `--color-border`, `--color-surface`, `--color-success`. **There are NO
  spacing variables** — hard-code spacing consistent with `routes/updates.css`
  (e.g. `padding: 1rem`, `gap: 0.75rem`, list `gap: 0.5rem`). Use the
  `.route.sync-status { & ... }` nesting convention. No new colors.
- Tests: `@substrate-system/tapzero`; components mounted with `preact`'s
  `render` + `htm/preact` `html`; helper pattern `mountRoot()` / `waitFor()` /
  `nextTask()` and signal seeding via `batch()` (see
  `test/payment-method-modal.ts`). Assert on roles/classes/structure and
  dynamic data bindings — never static UI copy. Browser tests are imported as
  side-effect modules in `test/browser-tests.ts`.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Page-local state module + loader

**Verifies:** (supports AC5 / AC7 rendering; no standalone AC test here)

**Files:**
- Create: `src/client/routes/sync-status-state.ts`

**Implementation:**
Export module-level page signals and a loader:
- `deadLetters` = `signal<DeadLetterRow[]>([])` (type from `../db/push-sync.js`)
- `failedFeeds` = `signal<Feed[]>([])` (type from `../db/types.js`)
- `loading` = `signal(false)`
- `loadSyncStatus(state:AppState):Promise<void>`:
  - Resolve `db = did ? (getBootstrappedDb() ?? getLocalDb(did)) : null` where
    `did = state.user.value?.did`.
  - If `db` is null, set `deadLetters=[]`, `failedFeeds=[]`, `loading=false` in a
    `batch()` and return.
  - Else set `loading=true`, run
    `Promise.all([listDeadLetterOutbox(db), listFailedFeeds(db)])`, then in a
    `batch()` assign both signals and `loading=false`. On error, set
    `loading=false` in a `batch()` (never throw out of the loader).
- Keep lines <= 80 cols; no space between `:` and type.

**Testing:**
No standalone AC test (exercised via the route tests in Tasks 2-3). The
implementor MAY add a focused loader test (seed a real `openLocalDb`, prime the
`getLocalDb` cache or use the same seam the route tests use, call
`loadSyncStatus`, assert the two signals populate).

**Verification:** `npm run lint` clean; type-checks.

**Commit:** `feat: add sync-status page state + loader`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Route component shell (auth guard, mount load, reactivity,
current-error section, empty state)

**Verifies:** sync-status-detail.AC1.4, sync-status-detail.AC1.5,
sync-status-detail.AC5.1, sync-status-detail.AC5.2,
sync-status-detail.AC7.1, sync-status-detail.AC7.2

**Files:**
- Create: `src/client/routes/sync-status.ts` (`SyncStatusRoute`)
- Create: `src/client/routes/sync-status.css` (imported by the route)
- Test: `test/sync-status-route.ts` (new browser test; wire into
  `test/browser-tests.ts`)

**Implementation:**
`SyncStatusRoute:FunctionComponent<{ state:AppState }>` using `htm/preact`,
mirroring `UpdatesRoute`:
- `useEffect` auth guard: if `!state.authLoading.value &&
  !state.isAuthenticated.value`, call `state._setRoute('/login')`. Dependency
  array `[state.authLoading.value, state.isAuthenticated.value]`.
- `useEffect` mount + reactivity: call `loadSyncStatus(state)`; dependency array
  `[syncDeadLetters.value]` so a background sync that changes the dead-letter
  count re-runs the loader (no polling).
- `if (!state.isAuthenticated.value) return null`.
- Read `syncStatus.value`, `syncError.value`, `deadLetters.value`,
  `failedFeeds.value`.
- Render a top-level `<div class="route sync-status">` with an `<h1>` heading.
- Include a **persistent** announcement region in the shell —
  `<div role="status" aria-live="polite">` — always rendered (Phase 4 populates
  it; it must exist before content is injected). Give it a stable class hook.
- **Current sync error section** (AC7): render only when
  `syncStatus.value === 'error'`. Use a stable hook (e.g.
  `class="sync-status-section current-error"`). Render `syncError.value`
  (dynamic) inside it. Omit entirely otherwise (AC7.2).
- **Empty state** (AC5): when there is no current error
  (`syncStatus.value !== 'error'`) AND `deadLetters.value.length === 0` AND
  `failedFeeds.value.length === 0`, render an `<div class="empty-state">`
  ("everything's syncing"). The blocked-changes (Phase 4) and failed-feeds
  (Phase 5) sections render only when their lists are non-empty; this phase may
  stub those section regions as empty placeholders or omit them until later
  phases — but the empty-state condition above must already be correct.

`sync-status.css`: base shell only — `.route.sync-status { padding: 1rem; & h1
{ ... } & .empty-state { color: var(--color-text-secondary); } &
.sync-status-section { ... } & .current-error { color: var(--color-error); } }`.
Hard-code spacing per `updates.css`; colors via vars; no new colors.

**Testing (browser, `test/sync-status-route.ts`):**
Mount `SyncStatusRoute` with a minimal `AppState` (signals for `authLoading`,
`user`/`isAuthenticated`, `_setRoute` spy). Seed page + sync signals via
`batch()`. Assert on roles/classes/structure and dynamic bindings — not copy.
- sync-status-detail.AC1.4: authenticated state (`user` set,
  `isAuthenticated` true) → the component renders its root
  (`.route.sync-status` present), no `_setRoute('/login')` call.
- sync-status-detail.AC1.5: unauthenticated state (`authLoading` false,
  `user` null) → `_setRoute` spy was called with `'/login'` and the component
  renders null (no root).
- sync-status-detail.AC5.1: authenticated, `deadLetters=[]`, `failedFeeds=[]`,
  `syncStatus='idle'` → `.empty-state` present; no `.current-error`.
- sync-status-detail.AC5.2: start with one dead-letter row seeded
  (`deadLetters=[row]`) → `.empty-state` absent; then in `batch()` set
  `deadLetters=[]` and `syncDeadLetters=0` and `await` a render tick → `.empty-state`
  now present (reactive transition).
- sync-status-detail.AC7.1: `syncStatus='error'`, `syncError='SENTINEL_ERR'` →
  `.current-error` section present AND contains the sentinel string (tests the
  dynamic binding, not static copy).
- sync-status-detail.AC7.2: `syncStatus='idle'` → `.current-error` absent.

Use `mountRoot()`/`waitFor()`/`nextTask()` helpers and clean up (unmount + reset
signals) in `finally`. Add `import './sync-status-route.js'` to
`test/browser-tests.ts`.

**Verification:** run `npm run test:browser` (and `npm run lint`).
Expected: all pass.

**Commit:** `feat: add /sync-status route shell, loader reactivity, empty +
current-error sections`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Register the `/sync-status` route (auth-gated)

**Verifies:** sync-status-detail.AC1.4, sync-status-detail.AC1.5 (registration)

**Files:**
- Modify: `src/client/routes/index.ts` (add the route beside `/updates`; import
  `SyncStatusRoute`)

**Implementation:**
Register the route mirroring `/updates` exactly:
```ts
router.addRoute('/sync-status', () => {
    if (!state.authLoading.value && !state.isAuthenticated.value) {
        return state._setRoute('/login')
    }
    return SyncStatusRoute
})
```

**Testing:**
Behavioral auth coverage is in Task 2 (component-level guard). The registration
itself is straightforward config mirroring `/updates`; no separate brittle test.
If the project already has a routing-table test, add a `/sync-status` assertion
there following its conventions.

**Verification:** `npm run lint` clean; build succeeds; manually confirm the
route resolves (covered end-to-end by Task 2 + later phases).

**Commit:** `feat: register auth-gated /sync-status route`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

---

**Done when:** Visiting `/sync-status` unauthenticated redirects to `/login`
(AC1.5) and authenticated renders the page (AC1.4); the empty state renders when
there are no problems and transitions in reactively (AC5.1, AC5.2); the
current-error section renders iff `syncStatus === 'error'` (AC7.1, AC7.2). Tests
pass; `npm run lint` clean.
