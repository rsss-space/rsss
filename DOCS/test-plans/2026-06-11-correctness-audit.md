# Human Test Plan — Correctness Audit (2026-06-11)

Manual verification for the 8-phase correctness audit. All 44 acceptance
criteria have faithful, mutation-verified automated tests (run `npm test`);
the steps below confirm the fixes in the real app and cover the few criteria
that the automated runner cannot fully exercise (real multi-tab Web Locks and
real OPFS byte reclamation).

## Prerequisites
- A Chromium-based browser (OPFS + Web Locks supported; DevTools → Application
  → Storage available).
- Two real ATProto/Bluesky accounts (DID-1, DID-2); at least one with a
  non-trivial Bluesky follow list and a couple of subscribed feeds.
- An admin token configured for the admin routes.
- A deploy of the `correctness-audit` branch (or `npm run dev` with `.dev.vars`
  port matching `vite.config.js` — dev port and APP_ORIGIN must stay in sync or
  non-exempt POSTs return 403 "Cross-origin request rejected").
- Baseline: `npm test` passing under normal memory conditions. The 4
  pre-existing `test/bootstrap.ts` quota-classification failures (tests
  ~16/18/19/20) fail at the base commit too and are excluded.

## Phase 2 — OAuth `iss` binding (AC3)
1. Sign out, then sign in normally via the OAuth flow (enter handle, complete
   the PDS authorization). Expected: login succeeds; no `invalid_iss` error.
2. Sign out and re-authenticate a second time. Expected: repeatable clean
   login; no stuck "resolving" state.
(The attacker-`iss` rejection is automated; this confirms the happy path still
works.)

## Phase 7 — Followers count + list (AC11)
1. Open the graph/followers view for a profile with rsss followers. Expected:
   follower list renders; a follower-count badge shows a number.
2. For a profile where the count call fails while the list call succeeds,
   reload. Expected: the list still renders; the count badge is **absent** —
   not "0", not a wrong/capped number, no broken empty badge.

## Phase 8 — Recommendations route (AC18)
1. Signed in, open the recommendations page (consumes `GET
   /api/recommendations`). Expected: recommended users appear (Bluesky follows
   ∩ rsss registry, minus yourself and people you already follow); you do not
   appear in your own list.
2. DevTools → Network, reload, inspect `GET /api/recommendations`. Expected:
   200 with a JSON array.
3. In a private window with no session, request `/api/recommendations`
   directly. Expected: 401 / redirect to login — never data for an
   unauthenticated caller.

## Phase 5 — Bounded feed refresh (AC6, AC7)
1. With more than 8 subscribed feeds, trigger refresh / "Fetch updates"; watch
   the Network panel. Expected: fetches fan out in waves (≤ 8 concurrent), not
   all at once; the UI reaches a settled "up to date" state.
2. Make one feed unreachable (host 404s), then refresh. Expected: the bad feed
   errors but the others still update and the refresh completes (no hang).

## Phase 8 — SSRF guard (AC20)
1. Exercise the remote-subscription reconcile path for an account whose PDS
   resolves normally. Expected: records import without error.
2. (Optional security sanity) Confirm via logs that no outbound fetch is ever
   attempted to a loopback/private PDS host.

## End-to-end — Multi-tab local-first reset race (AC8.1)
The automated runner disables Web Locks, so real cross-tab contention is
manual.
1. Sign in as DID-1; sync enough feeds/items to populate the local OPFS DB.
2. Open the app in two tabs on the same origin/DID.
3. In tab A, trigger the local-first reset (terminal-reset path).
4. While the reset is in flight, interact with tab B (force a DB open / reload).
5. Expected: tab A's reset completes; `removeOpfsDb` does not fail with an
   open-sync-handle error; tab B re-bootstraps cleanly; no swallowed
   `removeOpfsDb` errors in the console.

## End-to-end — Real OPFS space reclamation (AC15.2)
The runner only spies the unlink RPC; real reclamation is manual.
1. Sign in as DID-1; sync enough feeds/items/images to grow the OPFS DB
   measurably.
2. Note OPFS usage (DevTools → Application → Storage, or
   `navigator.storage.estimate()`).
3. Reset local-first (or switch to DID-2 and back) to trigger `removeOpfsDb`.
4. Expected: DID-1's logical DB is gone and its space is reclaimed (only the
   SAH-pool's reserved capacity files remain — expected, not a leak).
5. Re-open as DID-1; confirm no stale pre-reset data surfaces.

## End-to-end — Subscription canonicalization round-trip (AC9)
1. Subscribe to a feed and publish/share it (writes a subscription record under
   its canonical rkey).
2. Trigger a reconcile / reload from a fresh session (or DID switch and back).
3. Expected: the feed shows as **published** and is matched back to its
   subscription — no orphaned duplicate, no lost published state.

## Human-verification-required summary
| Criterion | Why manual | Steps |
|-----------|------------|-------|
| AC8.1 | Runner disables Web Locks; real cross-tab contention can't be exercised | Multi-tab reset race |
| AC15.2 | SAH-pool stores files opaquely; real byte reclamation needs a real browser | OPFS reclamation |
| AC11.2 | Client render decision (omit badge when count is null) is a UI behavior | Phase 7 step 2 |
