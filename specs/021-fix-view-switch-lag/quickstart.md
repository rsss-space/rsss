# Quickstart: Verify the Starred ⇄ All Items Switch is Instant

**Branch**: `021-fix-view-switch-lag` | **Date**: 2026-05-20

This is the manual browser verification the constitution requires for
UI changes ("UI changes MUST be exercised in a browser before being
claimed complete").

## Prerequisites

- `npm install` clean.
- A user account that already has at least 1 feed and ≥ 1 starred
  item. The fastest way is to use `auth/dev-login` against the local
  worker.
- DevTools open with **Performance** and **Network** panels available.

## Setup

```sh
npm start
```

Open the app, sign in via dev login, and add (or confirm) one feed
that has items. Star at least one item.

Confirm the local-first capability is active by checking the sync
status pill in the header — it should show the local-first dot. If
the page is not cross-origin-isolated (no SharedArrayBuffer), the
`remoteAdapter` path is exercised instead, which is also valid for
this test.

## Test 1 — Cold first switch (loading state allowed)

1. Hard-refresh the page.
2. Watch the items list area on the first paint.
3. **Expected**: It is acceptable to briefly see "Loading items…"
   here. This is the genuine first-load case (FR-003 explicitly
   permits the placeholder before the cache has any entry).
4. Once items render, click **Starred**.
5. **Expected**: The first switch to Starred (which also has no
   cache entry yet) may show a brief loading state on a cold worker.
6. Click **All Items**.
7. **Expected**: All Items now has a cache entry from the initial
   load; the switch should be instant.

## Test 2 — Warm switches (the bug)

After Test 1 has populated both caches:

1. Click **Starred**.
2. Click **All Items**.
3. Click **Starred**.
4. Click **All Items**.

**Expected**:

- Each switch repaints the items list on the same frame as the
  click. There is **no** "Loading items…" text. The list is **never**
  blank in between.
- The active highlight on the sidebar entry and the items list
  change together.
- Scroll position resetting to the top is acceptable (existing
  route behavior).

**Failing signature**: Any frame in which the previous view's items
are visible after the click but the destination view's items have
not yet rendered. Or: a "Loading items…" placeholder.

## Test 3 — Background refresh does not flash

1. Open DevTools Performance, start recording.
2. Click **Starred**, then immediately **All Items**.
3. Stop the recording.

**Expected**:

- The frame in which the click is processed contains the destination
  view's items.
- Subsequent frames may include an in-place update if the background
  refresh returned new data, but the `<ul.items-list>` element MUST
  NOT be torn down and re-created. Confirm this in the **Elements**
  panel by attaching a breakpoint on subtree modifications to the
  `<ul.items-list>` element before clicking; the only mutations
  during a switch should be child reorder / attribute changes on
  existing rows, not a wholesale remove + add of the `<ul>`.

## Test 4 — Throttled network (FR-004 / Story 2)

1. In Network, set **Slow 3G**. (This affects the remote adapter
   path; the local adapter does not hit the network on `getItems`,
   so this test is most informative when you have toggled off
   `syncSubscriptions` in `/settings` to force the remote adapter.)
2. Click **Starred**, then **All Items** repeatedly.

**Expected**: Every switch still paints instantly. When the remote
fetch eventually returns, the visible list is updated in place; the
view is not blanked.

## Test 5 — Stale refresh (FR-006)

1. Set Network to **Slow 3G** with the remote adapter active.
2. Click **Starred**. (A slow remote refresh starts for the starred
   view.)
3. Before that refresh returns, click **All Items**.

**Expected**: When the slow Starred refresh eventually resolves, the
items list still shows All Items. The Starred response is silently
discarded (with the apply-time guard). The user must not see a flash
of Starred items appearing in the All Items view.

## Test 6 — Empty Starred view

1. Unstar every item.
2. Click **All Items**, then **Starred**.

**Expected**: The Starred view shows its empty state immediately on
switch — no loading placeholder. (Spec edge case.)

## Test 7 — Empty All Items view

This requires a brand-new account with no feeds, so it is only
meaningful in a fresh worker state. If reachable:

1. After a fresh sign-in with zero feeds, switch between Starred
   and All Items.

**Expected**: The "Maybe add some feeds…" empty state appears
immediately on every switch.

## Test 8 — Mutations evict the cache

1. From All Items, mark an item as read (it leaves the list if
   "Unread only" is on).
2. Click **Starred**, then **All Items**.

**Expected**: The All Items list reflects the mutation (no
ghost-unread item). The switch is still instant on the second
round-trip because the cache is repopulated by the background
refresh between the mutation and the second switch.

## Test 9 — Repeated A→B→A under load

1. Click between Starred and All Items 20 times rapidly.

**Expected**: All 20 switches are instant; none re-trigger the
first-load loading state (SC-004).

## Test 10 — Sidebar entries are `<a>` links

1. In DevTools Elements panel, inspect the **All Items** entry.
2. Confirm the element is `<a href="/">`, not `<button>`.
3. Right-click and choose "Open in new tab".

**Expected**: A new tab opens at `/`. (The link semantics work as a
fallback for screen readers and middle-clicks; the in-tab click runs
through `route-event`.)

## Automated tests

In addition to the manual verification, the following automated tests
must pass:

```sh
npm test
npm run lint
npm run typecheck
```

The new specs under `test/`:

- `test/view-switch-instant.ts`: asserts the synchronous behavior of
  `State.showAll` / `State.showStarred` against a stubbed adapter.
- `test/view-switch-stale-refresh.ts`: asserts the apply-time guard.
- `test/view-switch-cache-invalidate.ts`: asserts cache invalidation
  on mutations.
- Extension of `test/sidebar-item.ts`: asserts the element is an
  anchor.

Per `CLAUDE.md` rules, none of these tests assert on specific HTML
text content; they exercise the signal-level contract.
