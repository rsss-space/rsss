# Correctness Audit — RSSS

**Repo**: `/Users/nick/code/rsss`
**Branch**: `staging`
**Date**: 2026-06-10
**Method**: Six parallel subsystem audits, then every P0/P1 personally
re-verified by reading the exact code and checking Cloudflare/runtime API
semantics. False positives were discarded (listed at the end).

---

## Meta-finding: `nitpicker.md` is stale and its checkboxes are unreliable

`nitpicker.md` is dated 2026-04-25 and the codebase has moved far past it.
Its headline P0s are genuinely **fixed** (verified against current code):

- **SSRF** — `src/server/feed-fetch.ts` validates `url.protocol` is `http(s)`,
  blocks `localhost`/`.local`/private + loopback IP literals
  (`isBlockedHostname`, `isBlockedIpv4/6`), bounds the body
  (`MAX_FEED_BYTES`), and sets `AbortSignal.timeout(...)` on every outbound
  fetch including each redirect hop.
- **Session cookie** — carries only an opaque signed `sid`; OAuth tokens live
  in DO storage; `verifySessionCookie` checks `sessionExpiresAt`; logout
  deletes the KV record.
- **DPoP** — key pair persisted in `OAuthCredentialRecord`; used by
  `token-refresh.ts`.
- **Admin routes** — gated behind `app.use('/admin/*', requireAdmin, ...)`.
- **CORS** — restricted to `APP_ORIGIN` (not `*`).

Do not trust the `[ ]`/`[x]` state in `nitpicker.md`. The live risk has moved
into the **new, never-reviewed subsystems** (registry / follow / profile /
recommendations / subscription publishing) and a few **systemic patterns**
below.

---

## P0 — Confirmed, real

### 1. `SqlStorageCursor.one()` throws on zero rows; ~15 call sites treat it as nullable

**Files**: `src/server/durable-objects/index.ts`,
`src/server/durable-objects/registry.ts`

Cloudflare's `SqlStorage` cursor `.one()` is typed `one(): T`
(`worker-configuration.d.ts:3261`, non-nullable) and the runtime **throws**
when the query returns zero or more than one row. The code does
`.one() as ... | null` followed by `if (!row)` — a guard that never executes
because the throw fires first. `this.sql = ctx.storage.sql`
(`durable-objects/index.ts:465`) is the real SqlStorage, so production
**500s on the normal zero-row path**:

- `durable-objects/index.ts:1126` — `followUser` existing-check. Following a
  user you do not already follow returns **zero rows** → throws. The follow
  happy-path is broken.
- `durable-objects/index.ts:1182` — `unfollowUser` existing-check.
- `durable-objects/index.ts:2335` — `GET /graph/follow/:targetDid`
  (follow-status of someone you don't follow).
- `registry.ts:80` — `GET /lookup/:did` for an unregistered DID (used by
  profile + recommendations).
- `durable-objects/index.ts:1667, 1689, 1722, 1756` — feed-by-id lookups →
  500 instead of 404 on a missing/deleted feed id.

**Why the tests miss it (systemic)**: every DO test fake implements
`one() { return rows[0] ?? null }` — modeling the *opposite* of real
behavior (`test/graph-follow.ts:21`, `test/graph-following.ts:28`,
`test/registry.ts`, `test/feed-cursor.ts:21`, `test/fetch-full-endpoint.ts:33`,
etc.). The entire DO test suite is blind to this class of bug.

**Fix**: replace optional-row `.one()` with `.toArray()[0] ?? null` (or
`[...cursor][0] ?? null`). Make the shared test fake `one()` throw on a
non-singleton result so the gap surfaces in CI. Leave `.one()` only on
queries guaranteed to return exactly one row (e.g. `SELECT COUNT(*)`).

- [ ] complete

---

## P1 — Confirmed, real

### 2. OAuth `iss` is client-supplied and not bound to the flow's authorization server

**Files**: `src/server/auth/oauth.ts:50` (`OAuthState`),
`src/server/index.ts:756` (callback)

`OAuthState` stores `nonce`, `verifier`, `returnTo`, and the DPoP keys, but
**not** the `authServer` that was resolved during `startOAuthFlow`
(`oauth.ts:346-347`). At callback time the server trusts `body.iss` (sent by
the browser) verbatim:

```ts
const exchange = await exchangeCode(
    body.code, storedState, clientId, redirectUri,
    body.iss            // client-supplied; not bound to stored state
)
```

`exchangeCode` then fetches
`${body.iss}/.well-known/oauth-authorization-server` and POSTs the code +
PKCE verifier to whatever `token_endpoint` comes back. This is the
authorization-server mix-up vector that RFC 9207 `iss` validation exists to
prevent.

**Fix**: persist the resolved `authServer` in `OAuthState` before writing it
to KV; at callback assert `body.iss === storedState.authServer` and reject on
mismatch before calling `exchangeCode`.

- [ ] complete

### 3. Stored XSS via another user's PDS subscription record

**Files**: `src/server/profile-api.ts` (`parseSubscriptionRecord`),
`src/client/routes/profile.ts:182`

`parseSubscriptionRecord` does **no** protocol/format validation on
`feedUrl`/`siteUrl` (contrast the careful `http(s)`-only `URL` check in
`src/shared/publisher-link.ts`). These values come from *another user's*
public, attacker-controlled PDS record. The client renders
`href=${sub.siteUrl}` directly:

```ts
<a class="subscription-site" href=${sub.siteUrl} ...>${sub.siteUrl}</a>
```

A malicious published record with `siteUrl: "javascript:..."` becomes a
clickable script URL in the app origin. `feedUrl` also flows into
`State.addFeed`.

**Fix**: in `parseSubscriptionRecord`, reuse the `http:`/`https:` `URL`
validation from `publisher-link.ts`; drop/normalize non-http(s) values before
storing or rendering.

- [ ] complete

### 4. Pull-sync collides on `UNIQUE(url)` and can roll back / wedge

**Files**: `src/client/db/pull-sync.ts:170` (`upsertFeed`),
`src/shared/schema.ts:48` (`url TEXT NOT NULL UNIQUE`),
`src/client/db/push-sync.ts` (outbox 5xx retry)

`upsertFeed` reconciles server feeds with `INSERT ... ON CONFLICT(id) DO
UPDATE`, but `url` is a **separate** UNIQUE column. When the server's feed
arrives under a different `id` than a local row that already holds the same
`url` (optimistic add not yet reconciled, or a row created on another device),
the INSERT violates the `url` constraint — which `ON CONFLICT(id)` does **not**
catch — so it **throws and the entire pull transaction rolls back**, dropping
that page of updates. If an `add_feed` outbox row is in a 5xx retry loop (no
attempt cap), the collision re-throws on every subsequent sync and `lastPullAt`
never advances → persistent sync wedge.

**Fix**: make the upsert conflict-safe on `url` as well (handle `ON
CONFLICT(url)`), and/or have `shouldSkipFeed` skip server rows whose `url`
matches a pending `add_feed` outbox entry.

- [ ] complete

### 5. `POST /feeds/refresh` unbounded fan-out + whole-batch error swallow

**File**: `src/server/durable-objects/index.ts:1802`

```ts
this.ctx.waitUntil((async () => {
    await Promise.all(feeds.map(async feed => {
        await this.fetchFeed(feed)
        this.advanceFeedCursor(feed.id)
    }))
    this.broadcast('refresh-complete', { refreshed: feeds.length })
})())
```

This fires **all** feed fetches concurrently — for a user with many feeds it
can blow the DO CPU/subrequest budget. The alarm path deliberately uses a
bounded pool of 8 (`refreshFeeds`); this manual route bypasses it. Also, a
single `advanceFeedCursor` throw rejects the whole `Promise.all`, so
`refresh-complete` never fires and remaining work is unobserved.

**Fix**: route through the existing bounded `refreshFeeds(feeds)`.

- [ ] complete

### 6. Unbounded AT-proto pagination loops; error-as-empty conflation

**Files**: `src/server/bluesky-follows.ts:47`,
`src/server/durable-objects/index.ts:856` (`listRemoteSubscriptions`)

Both loops terminate only when the upstream returns a falsy `cursor` — no
max-page cap and no "cursor unchanged" detection. A misbehaving or hostile PDS
returning a constant non-empty cursor produces an infinite loop until the
Worker CPU limit. `listRemoteSubscriptions` is reached from `GET /feeds` via
`reconcilePublishedFeeds` (`ctx.waitUntil`), and its cursor comes from the
user's PDS. `getBlueskyFollows` additionally does `if (!response.ok) return []`
*mid-pagination*, discarding everything already collected, and its outer
`catch { return [] }` makes "fetch failed" indistinguishable from "no follows."

**Fix**: add a max-iteration cap + bail when the returned cursor equals the
previous one. On mid-pagination failure, return the partial list (or an error
sentinel) rather than `[]`.

- [ ] complete

---

## P2 — Real, narrower trigger

### 7. Multi-tab reset/bootstrap races: lock released before OPFS delete

**Files**: `src/client/db/bootstrap.ts:178`, `src/client/db/index.ts:325`

Both paths call `releaseLocalTabLock()` *before* the blocking
`await confirmTerminalReset(...)` / `await removeOpfsDb(did)` /
re-bootstrap. In the window, a second tab can acquire the Web Lock and open the
SAH-pool DB; the subsequent `removeOpfsDb` then fails (open sync handle) and the
error is swallowed. Trigger needs two tabs + the reset or terminal-corruption
path.

**Fix**: hold the lock through confirmation and deletion; release only after
`removeOpfsDb` (and after re-bootstrap re-acquires).

- [ ] complete

### 8. Subscription `rkey` canonicalization mismatch

**Files**: `src/shared/subscription-rkey.ts`,
`src/server/durable-objects/index.ts` (`buildFeedSubscriptionRecord`,
reconcile keyed on raw `feed.url`)

`rkey` is derived from the **canonicalized** URL, but the published record
stores and reconcile keys on the **raw** `feed.url`. Two feeds whose raw URLs
differ only by fragment/query-order/default-port canonicalize to the same rkey:
publishing the second `putRecord`-overwrites the first's PDS record, and
reconcile can no longer match the overwritten record back to the first feed →
inconsistent local `published` state.

**Fix**: store the canonical URL in the record and key reconcile on the
canonical URL, so the round-trip matches the rkey derivation.

- [ ] complete

### 9. Image cache: Cache Storage written before DB row → orphan + bad accounting

**File**: `src/client/db/image-cache.ts:63`

`bucket.put(url, ...)` runs before `recordCachedImage(db, ...)`; if the DB
write throws (e.g. `SQLITE_FULL`), the blob is in Cache Storage with no
`cached_images` row and the error is swallowed. Eviction accounting then
undercounts real storage, so size caps under-evict.

**Fix**: record in the DB first, or delete the Cache Storage entry in the
catch.

- [ ] complete

### 10. Followers endpoint conflates "fetch failed" with "no followers"

**File**: `src/server/index.ts:1958`

`available = !('code' in backlinkRes) || !('code' in countRes)` — true if
*either* call succeeds. When the list call fails but the count succeeds, the
UI shows "available, count N" with an **empty** follower list; when only the
count fails, the true count is replaced by `dids.length` capped at 100
(understated for >100 followers).

**Fix**: derive `available` from the call that actually backs `dids`; don't
substitute the capped length for a missing real count.

- [ ] complete

### 11. Lower-confidence (from subagent analysis, not personally re-traced)

- `src/client/db/push-sync.ts:512` — `delete_feed` 409 re-inserts the feed but
  not its items (already deleted locally) → feed reappears empty.
- `src/client/db/push-sync.ts:205` — `replaceOptimisticFeed` UPDATE omits
  `last_pulled_at`/`last_error`/`last_status`; after a 409 add-reconcile the
  feed can render empty until the next pull.
- `src/client/db/push-sync.ts:319` — 409 item reconcile (`upsertItemFromServer`)
  writes `content`/`description` ignoring per-feed cache policy (no `COALESCE`),
  unlike pull's policy-aware `upsertItem`.
- `src/client/db/cache-eviction.ts:93` — `currentSize` includes the open item's
  images but the candidate set excludes the open item → over-eviction.
- `src/server/durable-objects/index.ts` `FEEDS_UPDATED_AT_BUMP_KEY` — can re-run
  `UPDATE feeds SET updated_at = datetime('now')` on cold start for un-bumped
  DOs, forcing spurious full resyncs.
- `src/client/db/index.ts` `resetLocalFirst` does not `clearPaintCache(did)`
  (disable path does) → stale paint cache survives a reset.
- `src/client/db/sqlite-init.ts` `removeOpfsDb` deletes the named DB file but
  not SAH-pool auxiliary files → OPFS storage leak across DID switches.

- [ ] complete

---

## P3 — Nits

- `src/server/index.ts:1435,1670` — `stashPendingEmail` writes
  `billing_pending_email:<did>` which **nothing reads**. Dead write (the
  request-body-email-is-not-a-recipient policy is intentional and lives in the
  contact-email slot).
- `src/server/index.ts:899` — `timingSafeEqual` early-returns on length
  mismatch, leaking `ADMIN_TOKEN` length. Use `crypto.subtle` /
  pad-and-XOR without branching on length.
- `src/server/recommendations.ts` — no `/api/recommendations` route is wired,
  and the module never computes `sharedFeedsCount` nor sorts, so the advertised
  ranking does not happen and the feature is unreachable end-to-end.
- `durable-objects/index.ts` id params — `parseInt(...)` without a NaN guard
  returns 404 (NaN→NULL bind, no row) instead of 400; inconsistent with the
  validated pattern at `:2147`.
- `listRemoteSubscriptions` fetch does not pass `credentials.pdsEndpoint`
  through the SSRF guard. Low risk (self-targeting, the user's own PDS), but
  inconsistent with every other outbound fetch.
- `src/server/index.ts` — `requireAdmin` registered both via
  `app.use('/admin/*', ...)` and per-route; harmless double-check but charges
  the admin rate-limit bucket pre-auth.
- `src/server/index.ts:2302` — `/admin/refresh-all` iterates all KV-tracked
  users sequentially in one invocation; no `limit`/cursor, will truncate at the
  30s CPU limit for large user counts.

- [ ] complete

---

## Discarded — false positives caught during verification

- **rate-limit `Retry-After` "off by 1000×"** (`middleware/rate-limit.ts:100`)
  — WRONG. `(1 - available) / (refillPerMs * 1000)` is algebraically
  `… / refillPerMs / 1000`, which correctly converts a token deficit to
  seconds. Worked example: `bucketSize=1`, `windowSeconds=60` →
  `refillPerMs = 1/60000` → `ceil(1 / ((1/60000)*1000)) = ceil(60) = 60s`.
  Correct.
- **"email dedupe epoch suppresses legitimate resends"** (`email.ts:56`) — the
  epoch in `email_sent:<did>:<plan>:<event>:<epoch>` *is* the mitigation
  (exactly what the old review #20 asked for); flagging it re-flags the fix.
- **"request-body email silently dropped from notifications"**
  (`index.ts:resolveContactEmail`) — intentional and documented: only
  Autumn-verified customer emails may be recipients, to prevent a user from
  directing billing email at a third party.

---

## Confirmed-fixed (old `nitpicker.md` items that no longer apply)

SSRF + body bound + timeout on every fetch path; blocking-fetch on `POST
/feeds` now deferred via `awaitFetchOrTimeout` + `ctx.waitUntil`; `alarm()`
awaits `setAlarm` and fans out through a bounded pool; feed parser uses
`fast-xml-parser` (no regex backtracking); `getItemByRoute` matches exact
`link = ?`; `PRAGMA foreign_keys = ON` on client + server with consistent
cascade; client timestamp writes normalized via `time.ts` `formatSqliteTs`;
`pull-sync` surfaces `PullSyncAuthError` on 401; session cookie is opaque +
expiry-checked + KV-deleted on logout; DPoP keys persisted; admin routes
gated; CORS restricted to `APP_ORIGIN`; base64url symmetric in cookie
encode/decode.

---

## Recommended fix order

1. `.one()` → `.toArray()[0] ?? null` on optional-row queries **and** fix the
   shared DO test fake to throw on non-singleton results (P0 #1) — highest
   leverage: a live production breakage *and* a hole in the whole DO test
   suite.
2. OAuth `iss` binding (P1 #2).
3. Profile-record URL validation (P1 #3).
4. Pull-sync `ON CONFLICT(url)` safety (P1 #4).
5. `POST /feeds/refresh` → bounded `refreshFeeds` (P1 #5).
6. Pagination caps + error-vs-empty distinction (P1 #6).
7. Then the P2 cluster.
