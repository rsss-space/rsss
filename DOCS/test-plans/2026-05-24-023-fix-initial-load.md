# Human Test Plan: 023-fix-initial-load

Manual verification plan for the 023-fix-initial-load branch (29 commits;
30 with this test-plan commit). Generated from the test-analyst's
coverage validation against `DOCS/implementation-plans/2026-05-24-023-fix-initial-load/test-requirements.md`.

**Coverage validation result:** PASS — 25/25 automated acceptance
criteria are covered by automated tests. The steps below verify the
integration-level criteria (AC1.1, AC1.2, AC1.5, AC5.1 literal copy,
AC7.1 timing, AC7.3 live 503, AC8.1, AC8.3, AC9.1) that cannot be
unit-tested.

## Prerequisites

- Local dev server running: `npm run dev`
- Build verified: `npm run build` completed without errors
- All automated tests passing: `npm test` returns green for the targeted
  files:
  - `npm run test:paint-cache`
  - `npm run test:paint-cache-bootstrap`
  - `npm run test:paint-cache-cleanup`
  - `npm run test:paint-cache-slow-billing`
  - `npm run test:adapter-factory`
  - `npm run test:sync-billing-recovery`
  - `npm run test:feed-reader-render-state`
  - `npm run test:local-first-opfs-persistence`
- Chrome DevTools available; one test user account with at least 3
  subscribed feeds and 50+ items
- One additional test user (DID-B) for account-switch verification
- Stripe publishable key configured (for AC8.3)

## Phase 1: Stripe SDK is not on the home critical path

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Open a fresh Chrome incognito window; open DevTools → Network; filter by `stripe`; check "Disable cache" | Filter is empty, network log clear |
| 1.2 | Log in to the app; navigate to `/` (home) | App shell + items pane render |
| 1.3 | While still on `/`, inspect Network filter for `stripe` | **Zero rows.** No `https://js.stripe.com/*` requests appear (AC8.1) |
| 1.4 | View page source (Cmd-U) or DevTools → Elements → `<head>` | The literal tag `<link rel="preconnect" crossorigin href="https://js.stripe.com">` is in `<head>` (AC8.2) |
| 1.5 | Navigate to `/settings`; click "Manage payment methods" → "Add a card" | Stripe Elements card-input iframe renders; Network shows `https://js.stripe.com/v3/*` succeeding at this point (AC8.3) |
| 1.6 | Open `DOCS/implementation-plans/2026-05-24-023-fix-initial-load/phase_01_findings.md` | Contains "Reproduction", "Root cause", "Resolution" sections (AC9.1) |

## Phase 2: Render gate removed — shell paints unconditionally

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Open `/login` in a fresh incognito tab | Login form renders immediately; no skeleton/blank flash precedes it (AC1.5) |
| 2.2 | Log in as test user with populated feeds; let app fully load so paint cache is written. Confirm in DevTools → Application → Local Storage that `rsss.paintCache.v1.<did>` exists | Key is present and non-empty JSON |
| 2.3 | In DevTools → Network, right-click `/api/feeds`, choose "Block request URL" (or set throttling to "Slow 3G"). Hard reload | Sidebar feed list renders **before** `/api/feeds` returns; you can observe the pending request in Network while the sidebar is already populated (AC1.1). Screenshot recommended. |
| 2.4 | While `/api/feeds` is throttled, inspect Elements panel | `<header>` element is present in DOM from first paint through the entire `authLoading` window (AC1.2) |
| 2.5 | Remove the block; reload normally | App returns to normal; no orphan UI |

## Phase 3: First-ever bootstrap UI

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Sign out. In DevTools → Application → Storage → "Clear site data" (so OPFS + localStorage are clean). Log in as a paid user with `syncSubscriptions = true` for the first time on this profile | Items pane shows a card with title "Setting up your local cache" and body "This only happens once on this device." (AC5.1 literal copy check) |
| 3.2 | While the card is visible, observe its progress line | Shows live `<feeds count> feeds · <items count> items` updating as bootstrap progresses (AC5.2 in real DOM) |
| 3.3 | Wait for bootstrap to complete | Card disappears in the same render that real items appear; no flash of "Maybe add some feeds" or empty state (AC5.3 in real DOM) |
| 3.4 | Reload the page (paint cache is now populated) | Card does **not** appear — items hydrate from paint cache immediately (AC5.4 in real DOM) |

## Phase 4: Third-party latency does not block paint

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | In DevTools → Network, right-click `/api/billing/status`; choose "Override response" with a 5-second delay (or use the local-network condition to add latency). Hard reload `/` | Items pane renders within ~1 s of bundle execution; billing request still pending in Network (AC7.1 live timing) |
| 4.2 | In DevTools → Network, override `/api/billing/status` to return 503. Hard reload `/` | App shell renders normally; items appear; no error banner blocks the items pane (AC7.3 live error) |
| 4.3 | Clear overrides; reload | App returns to normal behavior |

## Phase 5: Logout and account-switch cleanup

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Log in as User A; let cache populate; in DevTools → Application → Local Storage, confirm both `rsss.paintCache.v1.<didA>` and `rsss.lastSessionDid` are present | Both keys exist |
| 5.2 | Log out via UI | After logout, `rsss.paintCache.v1.<didA>` and `rsss.lastSessionDid` are both gone from localStorage (AC6.1 + AC6.2 end-to-end) |
| 5.3 | Log in as User A again (re-populate cache). Manually inject a fake key for User B: in DevTools console run `localStorage.setItem('rsss.paintCache.v1.did:plc:userB', '{"schemaVersion":1,"writtenAt":' + Date.now() + ',"feeds":[],"items":[],"counts":{"unread":0,"starred":0,"total":0,"perFeed":{}},"selectedFeedId":null}')` | Both keys now present |
| 5.4 | Log out of User A | User A's key is gone; User B's key is **still present** (AC6.4 cross-account isolation in real UI) |
| 5.5 | Clean up the injected User B key from localStorage | Cleanup done |
| 5.6 | Log in; navigate to `/settings`; toggle "Disable local-first sync" off | `rsss.paintCache.v1.<did>` is removed from localStorage (AC6.3 end-to-end through real UI button) |

## End-to-End: Cold cache → paint-cache primed → reload uses cache

Purpose: Validates the full happy-path that this branch optimizes
(initial paint from cache without any network blocking).

Steps:

1. In an incognito window, log in as a paid user with
   `syncSubscriptions = true` for the first time.
2. Wait for the bootstrap card to appear, then disappear (real items
   populate).
3. In DevTools → Application → Local Storage, confirm
   `rsss.paintCache.v1.<did>` is now populated.
4. Hard-reload the page.
5. **Expected:** Items pane renders feeds and items immediately on this
   reload (no bootstrap card, no skeleton flash). `/api/feeds` and
   `/api/billing/status` complete in the background, not on the
   critical path.
6. In DevTools → Performance, record a reload trace. Confirm First
   Contentful Paint occurs within ~1 s of script execution.

## End-to-End: Account switch (User A → User B on same device)

Purpose: Validates per-DID isolation and that switching accounts does
not leak cached data.

Steps:

1. Log in as User A. Wait for cache to populate (sidebar shows User A's
   feeds).
2. Log out. Confirm User A's cache key is removed.
3. Log in as User B (different DID).
4. **Expected:** User B sees the first-time bootstrap card (not User A's
   stale data). Once bootstrap completes, sidebar shows only User B's
   feeds.
5. Inspect localStorage: only `rsss.paintCache.v1.<didB>` exists; User
   A's key is absent.

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC1.1 | Requires DevTools network throttling to observe sidebar painting before `/api/feeds` resolves | Phase 2 step 2.3 |
| AC1.2 | Requires live DOM inspection during the brief `authLoading` window | Phase 2 step 2.4 |
| AC1.5 | Requires opening real `/login` route to confirm no skeleton flash | Phase 2 step 2.1 |
| AC5.1 (text) | Test-requirements forbids brittle text assertions; literal copy must be eyeballed | Phase 3 step 3.1 |
| AC7.1 (timing) | Real "time to first paint" measurement requires Chrome Performance panel | Phase 4 step 4.1 |
| AC7.3 (503 stub) | Requires real network override to return 503 | Phase 4 step 4.2 |
| AC8.1 | Requires DevTools Network panel inspection in fresh tab | Phase 1 steps 1.1-1.3 |
| AC8.3 | Requires real Stripe.js loading and Elements iframe rendering | Phase 1 step 1.5 |
| AC9.1 | Investigation deliverable is a written document — verified by reading | Phase 1 step 1.6 |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | — | Phase 2 step 2.3 |
| AC1.2 | — | Phase 2 step 2.4 |
| AC1.3 | `test/feed-reader-render-state.ts` ("AC1.3: empty-state renders…") | — |
| AC1.4 | `test/feed-reader-render-state.ts` ("AC1.4: loading text shown…") | — |
| AC1.5 | — | Phase 2 step 2.1 |
| AC2.1 | `test/paint-cache.ts` ("AC2.1: round-trip…") | — |
| AC2.2 | `test/paint-cache.ts` ("AC2.2: item truncation…") | — |
| AC2.3 | `test/paint-cache.ts` ("AC2.3: 1 MB byte cap…") | — |
| AC2.4 | Production wiring at `state.ts:917,1844,2142` (waived per test-requirements.md) + indirect verification via Phase 5 step 5.1 | Phase 5 step 5.1 (observes key after load) |
| AC2.5 | `test/paint-cache.ts` ("AC2.5: missing key…") | — |
| AC2.6 | `test/paint-cache.ts` ("AC2.6: malformed JSON…") | — |
| AC2.7 | `test/paint-cache.ts` ("AC2.7: schema version mismatch…") | — |
| AC3.1 | `test/paint-cache-bootstrap.ts` ("AC3.1 - hydration applies…") | — |
| AC3.2 | `test/paint-cache-bootstrap.ts` ("AC3.2 - hydration batches…") | — |
| AC3.3 | `test/paint-cache-bootstrap.ts` ("AC3.3 - no hydration when lastSessionDid…") | — |
| AC3.4 | `test/paint-cache-bootstrap.ts` ("AC3.4 - no crash when lastSessionDid is missing") | — |
| AC4.1 | `test/adapter-factory.ts` ("getAdapter returns localAdapter when billing is null…") | — |
| AC4.2 | `test/adapter-factory.ts` ("getAdapter returns remoteAdapter when syncSubscriptions is false") | — |
| AC4.3 | `test/sync-billing-recovery.ts` (both tests) | — |
| AC5.1 | `test/feed-reader-render-state.ts` ("AC5.1: bootstrap card renders…") for branch | Phase 3 step 3.1 for copy text |
| AC5.2 | `test/feed-reader-render-state.ts` ("AC5.2: bootstrap card text template…") | — |
| AC5.3 | `test/feed-reader-render-state.ts` ("AC5.3: card disappears…") | — |
| AC5.4 | `test/feed-reader-render-state.ts` ("AC5.4: card suppressed…") | — |
| AC6.1 | `test/paint-cache-cleanup.ts` ("AC6.1: clearPaintCache removes…") + `state.ts:1817` | Phase 5 step 5.2 (end-to-end via logout button) |
| AC6.2 | `test/paint-cache-cleanup.ts` ("AC6.2: clearStoredDid removes…") + `state.ts:1818` | Phase 5 step 5.2 |
| AC6.3 | `test/local-first-opfs-persistence.ts:453-467` (real `disableLocalFirst` call) + `test/paint-cache-cleanup.ts` ("AC6.3:") | Phase 5 step 5.6 |
| AC6.4 | `test/paint-cache.ts` ("AC6.4: per-DID isolation") + `test/paint-cache-cleanup.ts` ("AC6.4:") | Phase 5 steps 5.3-5.4 |
| AC7.1 | `test/paint-cache-slow-billing.mjs` (structural) | Phase 4 step 4.1 (live timing) |
| AC7.2 | `test/paint-cache-slow-billing.mjs` + `phase_06_findings.md` | — |
| AC7.3 | `test/paint-cache-slow-billing.mjs` (structural) | Phase 4 step 4.2 (live 503) |
| AC8.1 | — | Phase 1 steps 1.1-1.3 |
| AC8.2 | `index.html:6` source assertion (grep) | Phase 1 step 1.4 (optional eyeball) |
| AC8.3 | — | Phase 1 step 1.5 |
| AC9.1 | — | Phase 1 step 1.6 |
