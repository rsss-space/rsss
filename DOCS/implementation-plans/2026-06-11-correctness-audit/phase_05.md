# Correctness Audit — Phase 5: Server fetch robustness (bounded refresh + bounded pagination)

**Goal:** (1) Make `POST /feeds/refresh` use the bounded worker pool instead of
firing every feed fetch at once, and stop a single feed failure from
suppressing the `refresh-complete` broadcast. (2) Bound the two AT-proto
pagination loops with a max-page cap and a cursor-unchanged bail, and stop
conflating "fetch failed" with "no results."

**Architecture:**
- `POST /feeds/refresh` runs `Promise.all(feeds.map(...))` (unbounded
  concurrency) inside `ctx.waitUntil`; the alarm path uses a bounded pool
  (`refreshFeeds`, concurrency 8) but that helper calls only `fetchFeed` (no
  cursor advance, no broadcast). We extract the pool mechanism into a reusable
  helper, route the manual refresh through it with a per-feed worker that does
  `fetchFeed` + `advanceFeedCursor` and is individually error-isolated, then
  broadcast once. The alarm path keeps its current per-feed behavior.
- `getBlueskyFollows` and `listRemoteSubscriptions` loop until the upstream
  returns a falsy cursor — no max-page cap, no "cursor unchanged" detection —
  so a hostile/misbehaving PDS returning a constant non-empty cursor loops
  until the Worker CPU limit. `getBlueskyFollows` also does
  `if (!response.ok) return []` mid-pagination (discarding collected results)
  and `catch { return [] }` (making "failed" indistinguishable from "empty").
  We add a cap + cursor-unchanged bail to both, and give `getBlueskyFollows` a
  result shape that distinguishes failure from emptiness and returns the
  partial list on mid-pagination failure.

**Tech Stack:** TypeScript (Cloudflare Workers + DO, ES2022 lib), Hono,
AT Protocol (`app.bsky.graph.getFollows`, `com.atproto.repo.listRecords`),
`ctx.waitUntil`, DO broadcast.

**Scope:** Phase 5 of 8. Derived from audit findings **P1 #5** and **P1 #6**.

**Codebase verified:** 2026-06-11 (codebase-investigator + AT-proto research).
Confirmed: `POST /feeds/refresh` at `src/server/durable-objects/index.ts:1797–1812`
(unbounded `Promise.all`, per-feed `fetchFeed` + `advanceFeedCursor`, then
`broadcast('refresh-complete', { refreshed: feeds.length })`); bounded pool
`refreshFeeds` at `index.ts:3667–3679` with `FEED_REFRESH_CONCURRENCY = 8`,
calls only `this.fetchFeed`, no cursor advance, no broadcast; alarm path calls
`refreshFeeds`. `getBlueskyFollows` at `src/server/bluesky-follows.ts:29–76`
(`do { ... if (!response.ok) return []; ... } while (cursor)`, outer
`catch { return [] }`, returns `Promise<BlueskyFollow[]>`, sole caller is the
recommendations deps adapter). `listRemoteSubscriptions` at `index.ts:850–888`
(`do { ... if (!response.ok) throw ...; ... } while (cursor)`, returns
`Promise<Map<string, RemoteSubscription>>`; reached from `GET /feeds` via
`reconcilePublishedFeeds` in `ctx.waitUntil`, and `POST /feeds/reconcile-published`).
Test fetch mocking: injectable `deps.fetch` (bluesky-follows) and
`globalThis.fetch` replacement.

---

## Acceptance Criteria Coverage

This phase implements and tests (ACs derived from audit P1 #5 + #6):

### correctness-audit.AC6: `POST /feeds/refresh` uses bounded concurrency and always reports completion
- **correctness-audit.AC6.1 Success:** refresh fans out with at most
  `FEED_REFRESH_CONCURRENCY` concurrent feed fetches (not all feeds at once).
- **correctness-audit.AC6.2 Failure→handled:** when one feed's
  `fetchFeed`/`advanceFeedCursor` throws, the remaining feeds still process and
  `refresh-complete` is still broadcast.

### correctness-audit.AC7: AT-proto pagination is bounded and distinguishes error from empty
- **correctness-audit.AC7.1 Failure→handled:** `getBlueskyFollows` stops after a
  max page cap (does not loop unboundedly).
- **correctness-audit.AC7.2 Failure→handled:** `getBlueskyFollows` bails when the
  returned cursor equals the previous cursor.
- **correctness-audit.AC7.3 Failure→handled:** on a mid-pagination non-OK
  response, `getBlueskyFollows` returns the partial collected list (not `[]`).
- **correctness-audit.AC7.4 Failure→handled:** `getBlueskyFollows` distinguishes
  "fetch failed" from "no follows" (typed result / flag), so callers don't read
  an error as an empty follow list.
- **correctness-audit.AC7.5 Failure→handled:** `listRemoteSubscriptions` stops
  after a max page cap and bails on an unchanged cursor.

---

## Notes for the executor

- This is a **functionality** phase: tests are deliverables.
- Keep the **alarm** refresh behavior unchanged; only the manual
  `POST /feeds/refresh` route changes how it fans out. Do not add cursor
  advance to the alarm path in this phase (out of scope, behavior change).
- `getBlueskyFollows`'s return type changes — update its sole caller (the
  recommendations deps adapter) and its tests. Phase 8 (recommendations route)
  depends on this new shape; this phase ships first.
- Findings: `/tmp/plan-2026-06-11-correctness-audit-12661ed6/phase5-findings.md`.

---

<!-- START_SUBCOMPONENT_A (tasks 1) -->

<!-- START_TASK_1 -->
### Task 1: Route `POST /feeds/refresh` through a bounded, error-isolated pool

**Verifies:** correctness-audit.AC6.1, AC6.2

**Files:**
- Modify: `src/server/durable-objects/index.ts`
  - `refreshFeeds` (~3667–3679): extract the worker-pool mechanism into a
    reusable private helper.
  - `POST /feeds/refresh` handler (~1797–1812): call the pool with a per-feed
    worker that does `fetchFeed` + `advanceFeedCursor`, then broadcast.

**Implementation:**
1. Extract a generic bounded pool from `refreshFeeds`:
   ```ts
   private async runFeedPool (
       feeds:Feed[],
       worker:(feed:Feed) => Promise<void>
   ):Promise<void> {
       let next = 0
       const count = Math.min(FEED_REFRESH_CONCURRENCY, feeds.length)
       const runners = Array.from({ length: count }, async () => {
           while (next < feeds.length) {
               const feed = feeds[next++]!
               try {
                   await worker(feed)
               } catch (err) {
                   // Isolate per-feed failure: log, continue the pool.
                   reportError(err, 'refresh-feed', { feedId: feed.id })
               }
           }
       })
       await Promise.all(runners)
   }
   ```
   Re-implement `refreshFeeds` as `this.runFeedPool(feeds, f => this.fetchFeed(f))`
   (preserving its current alarm behavior — fetch only, no cursor advance).
   Match the existing pool's exact mechanics (the current code already shards
   `feeds` across workers — reuse that shape; the key additions are the
   per-feed `try/catch` and the worker callback).
2. Rewrite the `POST /feeds/refresh` body inside `ctx.waitUntil`:
   ```ts
   this.ctx.waitUntil((async () => {
       await this.runFeedPool(feeds, async feed => {
           await this.fetchFeed(feed)
           this.advanceFeedCursor(feed.id)
       })
       this.broadcast('refresh-complete', { refreshed: feeds.length })
   })())
   ```
   Because `runFeedPool` isolates per-feed errors, a single
   `advanceFeedCursor`/`fetchFeed` throw no longer rejects the whole batch, so
   `refresh-complete` always fires.

**Testing (in the DO refresh test — extend `test/api-router.ts` coverage or add
a focused DO test; follow existing DO test harness + fetch mock):**
- AC6.1: with N > `FEED_REFRESH_CONCURRENCY` feeds, instrument `fetchFeed`
  (e.g. a counter of in-flight calls) and assert peak concurrency never exceeds
  `FEED_REFRESH_CONCURRENCY`.
- AC6.2: make one feed's `fetchFeed` (or `advanceFeedCursor`) throw; assert the
  other feeds still completed and a `refresh-complete` broadcast was emitted.

**Verification:**
Run: `npm test` (refresh/DO tests). Expected: AC6.1, AC6.2 pass; alarm tests
(`test/alarm.ts`) still green (alarm behavior unchanged).

**Commit:** `fix(do): bounded, error-isolated POST /feeds/refresh fan-out`
<!-- END_TASK_1 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 2-3) -->

<!-- START_TASK_2 -->
### Task 2: Bound `getBlueskyFollows` and distinguish error from empty

**Verifies:** correctness-audit.AC7.1, AC7.2, AC7.3, AC7.4

**Files:**
- Modify: `src/server/bluesky-follows.ts` (`getBlueskyFollows`, ~29–76).
- Modify: the recommendations deps adapter (sole caller) — found via
  `rg -n 'getBlueskyFollows' src/server` (the adapter that satisfies
  `RecommendationsDeps.getBlueskyFollows`); Phase 8 finalizes the route, but
  this phase must keep the codebase compiling.

**Implementation:**
1. Add a module constant `const MAX_FOLLOW_PAGES = 50` (pick a generous but
   finite cap; document the reasoning — 50 pages × page size covers realistic
   follow counts).
2. Change the return type to distinguish failure from emptiness:
   ```ts
   export interface BlueskyFollowsResult {
       follows:BlueskyFollow[]
       ok:boolean   // false => a fetch error / cap / cursor-stall truncated it
   }
   ```
   Hoist the `follows` accumulator above the `try`. In the loop:
   - on `!response.ok` mid-pagination: `return { follows, ok: false }`
     (partial, AC7.3) — do not discard collected.
   - track `prevCursor`; if `cursor === prevCursor` (and non-empty):
     `return { follows, ok: false }` (AC7.2).
   - if page count reaches `MAX_FOLLOW_PAGES`: `return { follows, ok: false }`
     (AC7.1).
   - natural termination (falsy cursor, no error): `return { follows, ok: true }`.
   - outer `catch`: `return { follows, ok: false }` (AC7.4 — never silently `[]`).
3. Update the deps adapter to consume the new shape: pass `result.follows`
   into `computeRecommendations`'s `getBlueskyFollows` dep, and remember
   `result.ok` so Phase 8's route can surface a failure distinctly (e.g. 503)
   rather than rendering "0 recommendations." For now, the adapter maps
   `result.follows` and is structured so Phase 8 can read `ok`.

**Testing (in `test/bluesky-follows.ts`, using the injectable `deps.fetch`):**
- AC7.1: a fetch mock that always returns a non-empty cursor → result stops at
  `MAX_FOLLOW_PAGES`, `ok: false`.
- AC7.2: a fetch mock returning the same cursor twice → bail, `ok: false`.
- AC7.3: page 1 OK (collects some follows), page 2 returns `!ok` →
  `result.follows` contains page-1 follows, `ok: false` (not empty).
- AC7.4: outer error (fetch throws) → `ok: false` (distinguishable from a real
  empty `{ follows: [], ok: true }`).
- Happy path: finite pages, falsy final cursor → all follows, `ok: true`.
Update existing array-based assertions to the new result shape.

**Verification:**
Run: `npm test` (bluesky-follows tests) + lint/type-check. Expected: new cases
pass; caller compiles.

**Commit:** `fix(follows): cap pagination, return partial, distinguish error`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Bound `listRemoteSubscriptions` pagination

**Verifies:** correctness-audit.AC7.5

**Files:**
- Modify: `src/server/durable-objects/index.ts` (`listRemoteSubscriptions`,
  ~850–888).

**Implementation:**
Add `const MAX_RECORD_PAGES = 50` and a `prevCursor` track. In the loop:
- if page count reaches `MAX_RECORD_PAGES`: break (stop paginating) and return
  what has been collected, logging a warning (`reportError`/log with the
  user/DID context) so a stalling PDS is observable.
- if `cursor === prevCursor` (non-empty): break and return collected.
- keep the existing `if (!response.ok) throw` behavior on a hard error (its
  `ctx.waitUntil`/route callers already handle the throw) — the cap/stall guard
  is what prevents the infinite loop.

**Testing (DO test with mocked `fetch`):**
- AC7.5: a fetch mock returning a constant non-empty cursor → the loop stops at
  `MAX_RECORD_PAGES` (assert bounded number of fetch calls) rather than looping
  forever; an unchanged-cursor mock also bails.
Follow the DO test harness and `globalThis.fetch`/injected-fetch mock pattern.

**Verification:**
Run: `npm test`. Expected: AC7.5 passes; existing reconcile/feeds tests green.

**Commit:** `fix(do): cap listRemoteSubscriptions pagination + cursor-stall bail`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_B -->
