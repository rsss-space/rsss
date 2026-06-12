# Correctness Audit — Phase 8: P3 nits + recommendations route

**Goal:** Address the confirmed P3 nits and wire the unreachable
recommendations feature. Two audit nits are confirmed **false positives** and
get no code change (documented below).

**Architecture:** Independent small fixes plus one piece of feature glue:
- **#2** admin token comparison early-returns on length mismatch, leaking the
  token length → replace with a constant-time comparison that does not branch
  on length.
- **#4** id route params use `parseInt` without a NaN guard (NaN binds to NULL
  → 404 instead of 400) at 9 sites → apply the validated pattern that already
  exists at `index.ts:2147`.
- **#5** `listRemoteSubscriptions` outbound fetch does not pass the PDS endpoint
  through the SSRF guard used by every other outbound fetch (low risk —
  self-targeting the user's own PDS — but inconsistent) → route it through the
  guard.
- **#7** `/admin/refresh-all` iterates all KV-tracked users sequentially in one
  invocation with no limit/cursor → truncates at the 30s CPU limit for large
  user counts → add cursor/limit pagination.
- **Recommendations route** (audit nit #3, user decision: **wire it**): the
  `computeRecommendations` module is implemented + unit-tested but has no HTTP
  route, so the feature is unreachable → add `GET /api/recommendations`
  (`requireAuth`), mirroring the `/api/graph` dep-construction pattern.

**Tech Stack:** TypeScript (Cloudflare Workers + DO, ES2022 lib), Hono,
`crypto.subtle` (WebCrypto in Workers), KV (`user:` prefix), AT Protocol,
Constellation.

**Scope:** Phase 8 of 8. Derived from audit **P3 — Nits** + nit #3.

**Codebase verified:** 2026-06-11 (codebase-investigator). Verdicts:
- **#1 dead `billing_pending_email` write — FALSE POSITIVE.** The value IS read
  during account deletion (`durable-objects/index.ts:3555`). **No change.**
- **#2 `timingSafeEqual` length leak — REAL.** `src/server/index.ts:899–906`,
  `if (a.length !== b.length) return false`. `crypto.subtle` available; the
  admin auth handler is async.
- **#3 recommendations unwired — REAL.** `src/server/recommendations.ts`
  exports `computeRecommendations(userDid, deps)` and types
  (`RecommendationsDeps`, `RecommendedUser`, `RegistryUser`); 11 unit tests in
  `test/recommendations.ts`; no route in `index.ts`. (The audit's claim that it
  "never computes sharedFeedsCount nor sorts" is inaccurate — the module is
  implemented; it just isn't wired. `sharedFeedsCount` is an optional field the
  module does not currently populate; leave it unpopulated — out of scope.)
- **#4 `parseInt` NaN guard — REAL (9 sites).** Validated pattern at
  `index.ts:2147–2150`. Unguarded sites: `1626, 1638, 1663, 1685, 1708, 1755,
  1819, 1820, 1842/1870`.
- **#5 SSRF guard on `listRemoteSubscriptions` — REAL (absent).** Guard
  `isBlockedHostname`/`parseAndAssertAllowed` in `src/server/feed-fetch.ts`
  (reusable, pure).
- **#6 `requireAdmin` double registration — FALSE POSITIVE.** Middleware runs
  once per request; per-route checks are redundant but do **not** double-charge
  the rate limit. **No change** (optional cleanup only; not pursued, to avoid
  removing intentional defense-in-depth).
- **#7 `/admin/refresh-all` no pagination — REAL.** `index.ts:~2286–2302`,
  `SESSIONS.list({ prefix: 'user:' })` with no `limit`/`cursor`.

---

## Acceptance Criteria Coverage

This phase implements and tests (ACs derived from audit P3):

### correctness-audit.AC16: Admin token comparison is constant-time, no length leak
- **correctness-audit.AC16.1 Success:** the comparison does not early-return on
  length mismatch (no timing/length oracle); equal tokens accept, unequal
  reject.

### correctness-audit.AC17: Numeric id route params return 400 (not 404) on invalid input
- **correctness-audit.AC17.1 Failure→handled:** a non-numeric / `<= 0` / noncanonical
  id param returns 400, matching the validated pattern at `index.ts:2147`.

### correctness-audit.AC18: `/api/recommendations` is reachable
- **correctness-audit.AC18.1 Success:** `GET /api/recommendations`
  (`requireAuth`) returns computed recommendations for the session user.
- **correctness-audit.AC18.2 Failure→handled:** an unauthenticated request is
  rejected by `requireAuth`.

### correctness-audit.AC19: `/admin/refresh-all` is paginated
- **correctness-audit.AC19.1 Success:** the handler accepts/forwards a
  cursor/limit and does not attempt to process all users in one invocation.

### correctness-audit.AC20: Outbound `listRemoteSubscriptions` fetch passes the SSRF guard
- **correctness-audit.AC20.1 Success:** the PDS endpoint is validated through
  the same guard as other outbound fetches before the request is made.

---

## Notes for the executor

- This is a **functionality** phase: tests are deliverables.
- **No change** for nits #1 and #6 (false positives — documented above). Do not
  "fix" them.
- The recommendations route (Task 5) depends on Phase 5's `getBlueskyFollows`
  result shape (`{ follows, ok }`); Phase 5 ships first.
- Findings: `/tmp/plan-2026-06-11-correctness-audit-12661ed6/phase8-findings.md`.

---

<!-- START_TASK_1 -->
### Task 1: Constant-time admin token comparison (no length leak) (#2)

**Verifies:** correctness-audit.AC16.1

**Files:**
- Modify: `src/server/index.ts` (the `timingSafeEqual`-style comparison,
  ~899–906, and its (async) caller).

**Implementation:**
Replace the length-branching comparison with a constant-time comparison that
does not reveal length. Use WebCrypto to hash both inputs to a fixed-length
digest and compare those, so length never short-circuits:

```ts
async function constantTimeEqual (a:string, b:string):Promise<boolean> {
    const enc = new TextEncoder()
    const [ha, hb] = await Promise.all([
        crypto.subtle.digest('SHA-256', enc.encode(a)),
        crypto.subtle.digest('SHA-256', enc.encode(b))
    ])
    const va = new Uint8Array(ha)
    const vb = new Uint8Array(hb)
    let diff = 0
    for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!
    return diff === 0
}
```
Make the comparison helper `async` and `await` it at the call site (the admin
auth path is already async). Remove the `if (a.length !== b.length) return
false` branch. (Hashing equal-length digests means a length difference no
longer changes the comparison's control flow or timing.)

**Testing (add `test/admin-auth.ts` or extend an existing admin test;
investigator found no admin auth test):**
- AC16.1: equal tokens → accept; unequal-same-length → reject; unequal
  different-length → reject (and the function still compares full digests, i.e.
  no early length return — assert behavior, not timing).

**Verification:** `npm test` + lint/type-check.

**Commit:** `fix(admin): constant-time token compare without length leak`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: NaN-guard numeric id route params → 400 (#4)

**Verifies:** correctness-audit.AC17.1

**Files:**
- Modify: `src/server/durable-objects/index.ts` at the 9 unguarded id-parse
  sites: `1626, 1638, 1663, 1685, 1708, 1755, 1819, 1820, 1842/1870`
  (re-confirm each current line; they may have shifted with Phase 1/5/7 edits —
  grep `Number\.parseInt|parseInt\(` and the route param reads).

**Implementation:**
Apply the validated pattern that already exists at `index.ts:2147–2150`. Factor
it into a small helper to avoid repeating it 9 times (DRY):

```ts
function parseIdParam (raw:string):number | null {
    const id = Number.parseInt(raw, 10)
    if (!Number.isFinite(id) || id <= 0 || String(id) !== raw) return null
    return id
}
```
At each site, replace the bare `parseInt` with `parseIdParam(...)`; on `null`
return `c.json({ error: 'invalid_id' }, 400)` (match the existing error shape
at 2147). Then refactor the 2147 site to use the same helper so there is one
source of truth.

**Testing (DO route tests):**
- AC17.1: for a representative id route, request with a non-numeric id
  (`/feeds/abc/...`), an id `<= 0`, and a noncanonical id (`"01"`); assert each
  returns 400, while a valid id still routes normally. Follow the DO route test
  harness.

**Verification:** `npm test` (route tests).

**Commit:** `fix(do): 400 on invalid numeric id params (shared parseIdParam)`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Route `listRemoteSubscriptions` fetch through the SSRF guard (#5)

**Verifies:** correctness-audit.AC20.1

**Files:**
- Modify: `src/server/durable-objects/index.ts` (`listRemoteSubscriptions`
  fetch, ~850–888) — the same function bounded in Phase 5 Task 3.
- Reference: `src/server/feed-fetch.ts` (`parseAndAssertAllowed` /
  `isBlockedHostname`).

**Ordering (merge-hazard avoidance):** Phase 5 Task 3 lands first and already
adds the max-page cap + cursor-stall bail to this same function. Execute this
task **on top of** Phase 5's version — re-read the current
`listRemoteSubscriptions` body before editing and insert the SSRF guard at the
fetch site without reverting Phase 5's pagination changes. (Phases run strictly
in order 1→8, so Phase 5's edit is already present.)

**Implementation:**
Before fetching `this.listRecordsUrl(credentials, cursor)`, validate the PDS
endpoint host with the same guard other outbound fetches use
(`parseAndAssertAllowed` or `isBlockedHostname`). On a blocked host, fail the
same way the function already fails on a non-OK response (throw / return), so
callers' existing handling applies. Keep this consistent with Phase 5's
cap/cursor changes (coordinate if both edits touch the same lines).

**Testing (DO test with mocked fetch):**
- AC20.1: with a credentials/PDS endpoint resolving to a blocked host
  (e.g. loopback/private literal), assert the function refuses to fetch it
  (guard rejects) rather than issuing the request. With a normal PDS host, the
  fetch proceeds.

**Verification:** `npm test`.

**Commit:** `fix(do): SSRF-guard listRemoteSubscriptions PDS fetch`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Paginate `/admin/refresh-all` (#7)

**Verifies:** correctness-audit.AC19.1

**Files:**
- Modify: `src/server/index.ts` (`/admin/refresh-all`, ~2286–2302).

**Implementation:**
The handler does `SESSIONS.list({ prefix: 'user:' })` (no limit/cursor) and
processes every user sequentially in one invocation, which truncates at the 30s
CPU limit. Add pagination: accept `?cursor=` and `?limit=` query params, pass
`{ prefix: 'user:', limit, cursor }` to `KV.list`, process that page, and
return the next `cursor` (and `list_complete`) in the response so a caller can
drive subsequent pages. Choose a conservative default `limit` (e.g. 100) that
comfortably fits one invocation. Keep `requireAdmin`.

**Testing (admin route test):**
- AC19.1: with more users than `limit`, assert the handler processes only one
  page and returns a `cursor` for the remainder (does not attempt all users).
  Mock `KV.list` to return a `cursor`/`list_complete` and assert the response
  surfaces it. Follow the existing route test harness (or add `test/admin-*`).

**Verification:** `npm test`.

**Commit:** `fix(admin): paginate /admin/refresh-all with cursor + limit`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Wire `GET /api/recommendations` (#3)

**Verifies:** correctness-audit.AC18.1, AC18.2

**Files:**
- Modify: `src/server/index.ts` (add the route, near `/api/graph` ~1924).
- Reference: `src/server/recommendations.ts` (`computeRecommendations`,
  `RecommendationsDeps`), `src/server/bluesky-follows.ts` (`getBlueskyFollows`,
  new `{ follows, ok }` shape from Phase 5), the registry DO (lookup),
  and `/api/graph`'s `listFollowing` dep (DO `/graph/following`).

**Implementation:**
Add `app.get('/api/recommendations', requireAuth, async (c) => { ... })`,
constructing `RecommendationsDeps` the same way `/api/graph` builds its deps:
1. `getBlueskyFollows`: call `getBlueskyFollows(session.did, { fetch })` once;
   if `result.ok === false`, return `c.json({ error: 'recommendations_unavailable' }, 503)`
   (do not present a fetch failure as zero recommendations). Otherwise provide a
   dep that returns `result.follows` (shape `{ did, handle }[]`).
2. `listRsssFollowing`: copy `/api/graph`'s `listFollowing` (DO
   `GET /graph/following`, returns `dids`).
3. `batchLookupRegistry(dids)`: return `RegistryUser[]`. The registry DO
   **already exposes** `POST /batch-lookup` (`registry.ts:88`), which takes
   `{ dids: string[] }` and returns `{ users: { did, handle, avatar }[] }` —
   exactly the `RegistryUser` shape. Call it via the registry DO stub (the same
   way other code obtains the registry DO; grep for how `/lookup/:did` /
   `getRegistryDO`-style access is done) and return `body.users`. No new
   endpoint and no per-DID fan-out is needed.
4. `return c.json(await computeRecommendations(session.did, deps))`.
Wrap in try/catch mirroring `/api/graph` (`reportError` + a 503 fallback).

**Testing:**
- AC18.1: drive `GET /api/recommendations` with a session and stubbed deps
  (follows ∩ registry minus self/already-following) and assert the response is
  the expected `RecommendedUser[]`. Reuse `test/recommendations.ts`'s fixtures
  for the intersection logic; the route test asserts wiring (auth, deps
  assembled, JSON shape), not re-testing `computeRecommendations` internals.
- AC18.2: an unauthenticated request is rejected by `requireAuth` (401/redirect
  per the middleware's contract).

**Verification:** `npm test` (recommendations + route tests) + lint/type-check.

**Commit:** `feat(api): wire GET /api/recommendations route`
<!-- END_TASK_5 -->
