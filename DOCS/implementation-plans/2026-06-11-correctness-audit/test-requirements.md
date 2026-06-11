# Correctness Audit — Test Requirements

Maps every acceptance criterion across the eight phases
(`correctness-audit.AC1.1` … `correctness-audit.AC20.1`) to either an
**AUTOMATED** test or a **HUMAN** verification step.

- **Test framework:** `@substrate-system/tapzero`, run via `npm test`
  (`node test/run-all-tests.mjs`). Test files are bundled with esbuild.
- **Lint/type:** `npm run lint` (`eslint "./**/*.{ts,js}"`).
- **Runner reality:** these are unit/integration-style tests in the bundled
  runner. There is no separate e2e harness. Real OPFS reclamation, real Web
  Locks cross-tab behavior, and live browser rendering cannot be exercised
  reliably in the runner (tests disable the Web Locks API and stub the SQLite
  worker), so a small number of ACs carry a HUMAN step in addition to (or
  instead of) their automated assertion.

ACs are tagged **Success** / **Failure→handled** / **Failure** per the phase
files. The mapping reflects what each phase already says to assert; the
implementor writes the code.

---

## Per-AC mapping

### Phase 1 — `.one()` zero-row crash + DO test fake

| AC | Text | Map | Test type | File | Asserts |
|----|------|-----|-----------|------|---------|
| AC1.1 | Success: `followUser` for a target the user does not already follow completes the follow (happy path), instead of 500. | AUTOMATED | integration (DO) | `test/graph-follow.ts` | Follow a target with **no** pre-existing `graph_follows` row → follow succeeds (no throw / expected status), using the corrected shared fake. |
| AC1.2 | Success: `unfollowUser` existing-check on a not-followed target returns gracefully (no throw). | AUTOMATED | integration (DO) | `test/graph-follow.ts` (or `test/graph-following.ts`) | Unfollow existing-check on a not-followed target returns gracefully, no throw. |
| AC1.3 | Failure→handled: `GET /graph/follow/:targetDid` for a target the user does not follow returns a normal "not following" response (200), not 500. | AUTOMATED | integration (DO) | `test/graph-follow.ts` | `GET /graph/follow/:targetDid` for a non-followed target → 200 "not following", not 500. |
| AC1.4 | Failure→handled: feed-by-id endpoints (`publish`, `unpublish`, `PATCH`, `refresh`) return 404 for a missing/deleted feed id, not 500. | AUTOMATED | integration (DO) | `test/feed-create.ts` (or a feed-by-id route test) | A feed-by-id endpoint (`publish`) for a non-existent id → 404, not 500. |
| AC1.5 | Failure→handled: registry `GET /lookup/:did` for an unregistered DID returns its not-found response, not 500. | AUTOMATED | integration (DO) | `test/registry.ts` | `GET /lookup/:did` for an unregistered DID → its not-found response, not 500. |
| AC2.1 | Failure: the shared test fake `one()` throws when the result set has zero rows. | AUTOMATED | unit | `test/helpers/sql-fake.test.ts` (new) | `fakeResult([]).one()` throws. |
| AC2.2 | Failure: the shared test fake `one()` throws when the result set has more than one row. | AUTOMATED | unit | `test/helpers/sql-fake.test.ts` (new) | `fakeResult([a, b]).one()` throws; `fakeResult([a]).one()` returns `a`. |
| AC2.3 | Success: the full `npm test` suite passes after every DO test file is migrated to the shared fake. | AUTOMATED | integration (suite) | entire `test/` suite (17 migrated files import `test/helpers/sql-fake.ts`) | Full `npm test` green; `rg -n 'one\s*\(\s*\)\s*\{' test` returns only `test/helpers/sql-fake.ts`. |

### Phase 2 — Bind OAuth `iss` to the flow's authorization server

| AC | Text | Map | Test type | File | Asserts |
|----|------|-----|-----------|------|---------|
| AC3.1 | Failure: when `body.iss` does not equal the `authServer` stored in `OAuthState`, the callback rejects with an error (e.g. 400) **before** calling `exchangeCode` — no outbound token request is made to the attacker-supplied issuer. | AUTOMATED | integration | `test/oauth-credential-persistence.ts` | Stored `authServer=https://auth.example`, callback `iss=https://attacker.example` → 400 / `invalid_iss`, and the fetch mock records **no** token-exchange/metadata fetch. |
| AC3.2 | Success: when `body.iss` equals the stored `authServer`, the callback proceeds and the code is exchanged. | AUTOMATED | integration | `test/oauth-credential-persistence.ts` | Matching `iss` → existing happy path completes (code exchanged, session/credentials persisted). |
| AC3.3 | Success: `OAuthState` persists the resolved `authServer` through the KV write/read round-trip. | AUTOMATED | integration | `test/oauth-credential-persistence.ts` | After `startOAuthFlow`, the KV record at `oauth:${nonce}` parses to an `OAuthState` whose `authServer` matches the resolved value. |

(Phase 2 Task 3 adds a fail-closed case: stored state with `authServer`
absent/empty → callback rejects. AUTOMATED, same file — folded into AC3.1's
robustness; no separate AC.)

### Phase 3 — Validate subscription-record URLs (stored XSS)

| AC | Text | Map | Test type | File | Asserts |
|----|------|-----|-----------|------|---------|
| AC4.1 | Failure: a record whose `siteUrl` is non-`http(s)` (e.g. `javascript:alert(1)`, `data:...`, `mailto:...`) yields a parsed subscription with `siteUrl === null` (dropped). | AUTOMATED | unit | `test/profile-api.ts` | Record with `siteUrl: 'javascript:alert(1)'` → parsed subscription `siteUrl === null`, record otherwise intact. |
| AC4.2 | Failure: a record whose `feedUrl` is non-`http(s)` is rejected — `parseSubscriptionRecord` returns `null`. | AUTOMATED | unit | `test/profile-api.ts` | Record with non-`http(s)` `feedUrl` → `parseSubscriptionRecord` returns `null`. |
| AC4.3 | Success: a record with valid `http`/`https` `feedUrl` and `siteUrl` passes through unchanged. | AUTOMATED | unit | `test/profile-api.ts` | Valid `http(s)` `feedUrl` + `siteUrl` → both pass through unchanged. |

(Phase 3 Task 1 adds `httpUrlOrNull` unit cases in the publisher-link test
file — AUTOMATED, enabling step, no standalone AC.)

### Phase 4 — Pull-sync `UNIQUE(url)` collision wedge

| AC | Text | Map | Test type | File | Asserts |
|----|------|-----|-----------|------|---------|
| AC5.1 | Success: when one server feed in a pull page has a `url` that collides with a local row under a different `id`, the other feeds in that page are still upserted and `lastPullAt` still advances. | AUTOMATED | integration (client DB) | `test/pull-sync.ts` | Seed `local-1`/url `U`; pull page with a collider (different id, url `U`) + independent `srv-2`/url `V` → `srv-2` present, `lastPullAt` advanced, pull did not throw. |
| AC5.2 | Success: `shouldSkipFeed` skips a server feed whose `url` matches a pending `add_feed` outbox entry. | AUTOMATED | integration (client DB) | `test/pull-sync.ts` | Seed pending `add_feed` outbox for url `U`; pull page contains server feed url `U` under a new id → server feed **not** inserted (skipped). |
| AC5.3 | Failure→handled: an `add_feed` outbox entry that keeps receiving 5xx is promoted to `dead_letter_outbox` after `DEAD_LETTER_ATTEMPT_LIMIT` attempts (no infinite retry loop). | AUTOMATED | integration (client DB) | `test/push-sync.ts` | Drive an `add_feed` row through repeated 5xx; after `DEAD_LETTER_ATTEMPT_LIMIT` attempts the row is in `dead_letter_outbox`, not stuck in `outbox`. |

### Phase 5 — Bounded refresh + bounded pagination

| AC | Text | Map | Test type | File | Asserts |
|----|------|-----|-----------|------|---------|
| AC6.1 | Success: refresh fans out with at most `FEED_REFRESH_CONCURRENCY` concurrent feed fetches (not all feeds at once). | AUTOMATED | integration (DO) | `test/api-router.ts` (extend) or new focused DO refresh test | With N > `FEED_REFRESH_CONCURRENCY` feeds, an in-flight counter around `fetchFeed` never exceeds `FEED_REFRESH_CONCURRENCY`. |
| AC6.2 | Failure→handled: when one feed's `fetchFeed`/`advanceFeedCursor` throws, the remaining feeds still process and `refresh-complete` is still broadcast. | AUTOMATED | integration (DO) | same as AC6.1 | One feed's `fetchFeed`/`advanceFeedCursor` throws → other feeds still complete and a `refresh-complete` broadcast is emitted. |
| AC7.1 | Failure→handled: `getBlueskyFollows` stops after a max page cap (does not loop unboundedly). | AUTOMATED | unit | `test/bluesky-follows.ts` | Fetch mock always returns a non-empty cursor → stops at `MAX_FOLLOW_PAGES`, `ok: false`. |
| AC7.2 | Failure→handled: `getBlueskyFollows` bails when the returned cursor equals the previous cursor. | AUTOMATED | unit | `test/bluesky-follows.ts` | Mock returns the same cursor twice → bail, `ok: false`. |
| AC7.3 | Failure→handled: on a mid-pagination non-OK response, `getBlueskyFollows` returns the partial collected list (not `[]`). | AUTOMATED | unit | `test/bluesky-follows.ts` | Page 1 OK (collects follows), page 2 `!ok` → `result.follows` has page-1 follows, `ok: false`. |
| AC7.4 | Failure→handled: `getBlueskyFollows` distinguishes "fetch failed" from "no follows" (typed result / flag). | AUTOMATED | unit | `test/bluesky-follows.ts` | Outer error (fetch throws) → `ok: false`, distinguishable from a real empty `{ follows: [], ok: true }`. |
| AC7.5 | Failure→handled: `listRemoteSubscriptions` stops after a max page cap and bails on an unchanged cursor. | AUTOMATED | integration (DO) | DO test with mocked `fetch` (extend `test/api-router.ts` or a reconcile test) | Constant non-empty cursor → bounded fetch-call count (stops at `MAX_RECORD_PAGES`); unchanged-cursor mock also bails. |

### Phase 6 — Client data-integrity cluster

| AC | Text | Map | Test type | File | Asserts |
|----|------|-----|-----------|------|---------|
| AC8.1 | Success: in the reset/terminal-reset paths, `releaseLocalTabLock()` is not called until **after** `removeOpfsDb(did)` (and after re-bootstrap reacquires, where applicable) — no release/delete window. | AUTOMATED (call-order spy) + HUMAN (real cross-tab race) | integration (client DB) | `test/bootstrap.ts` | Spies on `removeOpfsDb` and `releaseLocalTabLock` → `removeOpfsDb` invoked-and-resolved before `releaseLocalTabLock`; lock still released on the error path (delete throws → release still called after). Real two-tab race needs a HUMAN check (see plan). |
| AC9.1 | Success: `buildFeedSubscriptionRecord` stores the canonical URL (the same form `subscriptionRkeyForFeedUrl` hashes). | AUTOMATED | unit | `test/subscription-rkey.ts` | `buildFeedSubscriptionRecord({ url: rawWithFragmentOrQueryOrder })` stores `feedUrl === canonicalizeFeedUrl(raw)`. |
| AC9.2 | Success: reconcile keys/matches on the canonical URL, so a record published under the rkey round-trips back to its feed even when the raw URL differs by fragment/query-order/default-port. | AUTOMATED | integration (DO) | `test/subscription-rkey.ts` and/or the reconcile/feeds test | Reconcile matches a published record back to a feed whose raw `url` differs only by fragment/query-order/default-port; `remoteByUrl` lookup succeeds and `published` state is set. |
| AC10.1 | Failure→handled: if `recordCachedImage` throws, the Cache Storage entry written for that URL is removed (no orphan blob). | AUTOMATED | integration (client DB) | `test/image-cache.ts` | Inject a DB that errors on insert → `bucket.match(url)` is undefined afterward (no orphan). |
| AC10.2 | Success: after a DB-write failure, eviction accounting (`cached_images` sums) reflects only blobs that actually have rows. | AUTOMATED | integration (client DB) | `test/image-cache.ts` | After the simulated DB failure, `sumTotal()`/`sumByFeed()` do not count the rolled-back blob. |

### Phase 7 — Followers conflation + lower-confidence cluster

| AC | Text | Map | Test type | File | Asserts |
|----|------|-----|-----------|------|---------|
| AC11.1 | Failure→handled: when the list call fails (count may succeed), `available` is false (UI does not show "available" with an empty follower list). | AUTOMATED | unit | graph test (`test/` graph coverage; add a focused `getFollowers`/`buildGraphResponse` test if none exists) | Stubbed `getDistinct` returns a `code` error, count succeeds → `available` false, `dids` empty. |
| AC11.2 | Failure→handled: when the count call fails, the count is reported as unknown (`null`), not the capped `dids.length`. | AUTOMATED (server boundary) + HUMAN (optional UI badge omission) | unit | same graph test | Stubbed count returns a `code` error, list succeeds → `followersCount === null` (not capped `dids.length`), `dids` populated, `available` true. Client omitting the count badge when `null` is an optional HUMAN UI check. |
| AC12.1 | Success: a `delete_feed` 409 re-insert restores the feed's items too (feed is not empty). | AUTOMATED | integration (client DB) | `test/push-sync.ts` | Simulate `delete_feed` → 409 with a feed payload including items → feed AND its items present locally afterward. |
| AC12.2 | Success: `replaceOptimisticFeed` writes `last_pulled_at`, `last_error`, and `last_status`. | AUTOMATED | integration (client DB) | `test/push-sync.ts` | Reconcile an optimistic feed via `replaceOptimisticFeed` with a server payload carrying those columns → local row reflects `last_pulled_at`/`last_error`/`last_status`. |
| AC12.3 | Success: `upsertItemFromServer` honors per-feed cache policy (COALESCE-preserves cached body when caching is disabled), same as pull's `upsertItem`. | AUTOMATED | integration (client DB) | `test/push-sync.ts` | Caching-disabled feed → reconciled item preserves existing cached `content`/`description`; caching-enabled feed → content written. |
| AC13.1 | Success: the size total and the candidate set treat the open item consistently, so eviction does not over-evict. | AUTOMATED | integration (client DB) | `test/cache-eviction.ts` | Seed open-item images + other items near the cap → eviction does not evict more of the others than the corrected (consistent) accounting requires. |
| AC14.1 | Success: the `FEEDS_UPDATED_AT_BUMP` guard cannot re-run the bump on a cold start (flag persisted before/atomically with the UPDATE). | AUTOMATED | integration (DO) | `test/do-migrations.ts` (or `test/alarm.ts`) | Instantiate the DO twice with storage already holding the bump flag → `UPDATE feeds SET updated_at` does NOT run on the second instantiation (spy on exec/UPDATE or assert `updated_at` unchanged). |
| AC15.1 | Success: `resetLocalFirst` calls `clearPaintCache(did)`. | AUTOMATED | integration (client DB) | `test/paint-cache.ts` (or the reset test) | Seed a paint-cache entry for `did`, run `resetLocalFirst(did)` → entry gone (`clearPaintCache` invoked / entry absent). |
| AC15.2 | Success: `removeOpfsDb` removes the DB from the opfs-sahpool VFS (via `poolUtil.unlink`), so its space is reclaimed. | AUTOMATED (worker-unlink spy) + HUMAN (real OPFS reclamation) | integration (client DB) | `test/local-first-opfs-persistence.ts` | If the env exercises real OPFS: a subsequent open finds no prior data. Otherwise (per the phase): assert `removeOpfsDb` invokes the worker `remove`/`unlink` RPC for the correct logical name (spy); real space reclamation is the HUMAN step. |

### Phase 8 — P3 nits + recommendations route

| AC | Text | Map | Test type | File | Asserts |
|----|------|-----|-----------|------|---------|
| AC16.1 | Success: the comparison does not early-return on length mismatch (no timing/length oracle); equal tokens accept, unequal reject. | AUTOMATED | unit | `test/admin-auth.ts` (new) | Equal tokens → accept; unequal-same-length → reject; unequal-different-length → reject (full-digest compare, no early length return — assert behavior, not timing). |
| AC17.1 | Failure→handled: a non-numeric / `<= 0` / noncanonical id param returns 400, matching the validated pattern at `index.ts:2147`. | AUTOMATED | integration (DO route) | DO route test (extend `test/api-router.ts` or feed-by-id route test) | `/feeds/abc/...`, id `<= 0`, and noncanonical `"01"` each → 400; a valid id still routes normally. |
| AC18.1 | Success: `GET /api/recommendations` (`requireAuth`) returns computed recommendations for the session user. | AUTOMATED | integration (route) | route test reusing `test/recommendations.ts` fixtures | With a session + stubbed deps (follows ∩ registry minus self/already-following) → response is the expected `RecommendedUser[]` (asserts wiring: auth, deps assembled, JSON shape). |
| AC18.2 | Failure→handled: an unauthenticated request is rejected by `requireAuth`. | AUTOMATED | integration (route) | same route test | Unauthenticated `GET /api/recommendations` → rejected by `requireAuth` (401/redirect per the middleware contract). |
| AC19.1 | Success: the handler accepts/forwards a cursor/limit and does not attempt to process all users in one invocation. | AUTOMATED | integration (admin route) | admin route test (extend existing or add `test/admin-*`) | Mock `KV.list` to return a `cursor`/`list_complete`; with more users than `limit`, the handler processes one page and surfaces the next `cursor`. |
| AC20.1 | Success: the PDS endpoint is validated through the same guard as other outbound fetches before the request is made. | AUTOMATED | integration (DO) | DO test with mocked fetch (same area as AC7.5) | Credentials/PDS endpoint resolving to a blocked host (loopback/private literal) → function refuses to fetch (guard rejects); a normal PDS host → fetch proceeds. |

---

## Human verification plan

Most ACs are fully automated in the bundled runner. The items below either
cannot be exercised faithfully in the runner (real OPFS / Web Locks / live
browser) or have a UI surface worth a manual sanity check beyond the
server-boundary assertion.

### H1 — Multi-tab reset race (supplements AC8.1)

The runner **disables the Web Locks API** (see `test/bootstrap.ts`), so the
automated test only proves call ordering (`removeOpfsDb` resolves before
`releaseLocalTabLock`) via spies. It cannot prove a second tab is actually
blocked from acquiring the `rsss-opfs` lock during the OPFS delete.

Steps:
1. Sign in in a real browser (Chromium-based; OPFS + Web Locks supported).
2. Open the app in **two** tabs on the same origin/DID.
3. In tab A, trigger the local-first reset (or terminal-reset) path.
4. While the reset is in flight, interact with tab B (force a DB open / reload).
5. Verify: the reset completes, `removeOpfsDb` does not fail with an
   open-sync-handle error, and tab B re-bootstraps cleanly afterward (no stuck
   "resolving"/corruption state). Check the console for swallowed
   `removeOpfsDb` errors — there should be none.

### H2 — Real OPFS space reclamation (supplements AC15.2)

The automated test asserts the worker `remove`/`unlink` RPC is invoked with the
correct logical filename (spy). The SAH-pool stores files opaquely, so actual
byte reclamation across a DID switch needs a real browser.

Steps:
1. In a real browser, sign in as DID-1 and sync enough feeds/items/images to
   grow the OPFS DB measurably.
2. Note OPFS usage (DevTools → Application → Storage, or
   `navigator.storage.estimate()`).
3. Reset local-first (or switch to DID-2 and back), triggering `removeOpfsDb`.
4. Verify OPFS usage for the DID-1 DB is reclaimed (the logical DB is gone; only
   the SAH-pool's reserved capacity files — expected, not a leak — remain).
5. Re-open as DID-1 and confirm no stale data from before the reset surfaces.

### H3 — Followers count badge omission (optional, supplements AC11.2)

AC11.2 is fully asserted at the server boundary (`followersCount === null`).
The client render decision (omit the `graph-count` badge when `null`, while the
followers list still renders) is a UI behavior worth a manual confirmation.

Steps:
1. In a real session, open the graph/followers view for a profile where the
   count call can be made to fail while the list succeeds (or stub the
   server response to return `followersCount: null`).
2. Verify the followers list still renders and the count badge is simply
   absent (not "0", not a wrong/capped number, no broken/empty badge element).

---

## Coverage checklist

Every AC maps to exactly one of AUTOMATED / HUMAN (two ACs are AUTOMATED with an
additional HUMAN supplement; their primary mapping is AUTOMATED).

| AC | Mapping |
|----|---------|
| AC1.1 | AUTOMATED |
| AC1.2 | AUTOMATED |
| AC1.3 | AUTOMATED |
| AC1.4 | AUTOMATED |
| AC1.5 | AUTOMATED |
| AC2.1 | AUTOMATED |
| AC2.2 | AUTOMATED |
| AC2.3 | AUTOMATED |
| AC3.1 | AUTOMATED |
| AC3.2 | AUTOMATED |
| AC3.3 | AUTOMATED |
| AC4.1 | AUTOMATED |
| AC4.2 | AUTOMATED |
| AC4.3 | AUTOMATED |
| AC5.1 | AUTOMATED |
| AC5.2 | AUTOMATED |
| AC5.3 | AUTOMATED |
| AC6.1 | AUTOMATED |
| AC6.2 | AUTOMATED |
| AC7.1 | AUTOMATED |
| AC7.2 | AUTOMATED |
| AC7.3 | AUTOMATED |
| AC7.4 | AUTOMATED |
| AC7.5 | AUTOMATED |
| AC8.1 | AUTOMATED (+ HUMAN H1) |
| AC9.1 | AUTOMATED |
| AC9.2 | AUTOMATED |
| AC10.1 | AUTOMATED |
| AC10.2 | AUTOMATED |
| AC11.1 | AUTOMATED |
| AC11.2 | AUTOMATED (+ HUMAN H3, optional) |
| AC12.1 | AUTOMATED |
| AC12.2 | AUTOMATED |
| AC12.3 | AUTOMATED |
| AC13.1 | AUTOMATED |
| AC14.1 | AUTOMATED |
| AC15.1 | AUTOMATED |
| AC15.2 | AUTOMATED (+ HUMAN H2) |
| AC16.1 | AUTOMATED |
| AC17.1 | AUTOMATED |
| AC18.1 | AUTOMATED |
| AC18.2 | AUTOMATED |
| AC19.1 | AUTOMATED |
| AC20.1 | AUTOMATED |

**Totals:** 44 acceptance criteria. **44 AUTOMATED**, of which **3** also carry
a HUMAN supplement (AC8.1 → H1, AC11.2 → H3 optional, AC15.2 → H2) because the
bundled runner cannot exercise real Web Locks / OPFS / live-browser rendering.
No AC is left unmapped.
