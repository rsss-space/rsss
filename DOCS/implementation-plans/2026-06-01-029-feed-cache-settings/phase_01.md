# Feed Cache Settings (per-feed opt-in caching) Implementation Plan

**Goal:** Persist a tri-state per-feed content-caching override
(`1` / `0` / `null`) in the local `feed_cache_policy` table and expose one
resolver, `override ?? globalStoreContent`, shared by every consumer.

**Architecture:** Add a nullable `content_enabled INTEGER` column to the
client-only SQLite table `feed_cache_policy` (new DBs via the CREATE TABLE
string; existing DBs via a lazy `ALTER TABLE` migration guarded by a
`WeakSet`, matching the repo's existing migration style). Thread the new
field through the row type, the upsert (whose "all-null → DELETE" rule must
now keep a row that has only `content_enabled` set), and add resolver
functions that compute effective caching as `perFeedOverride ??
storeContent.value`.

**Tech Stack:** TypeScript (browser, ES2022 lib via Vite) + `@preact/signals`;
`@sqlite.org/sqlite-wasm` (local DB); tests with `@substrate-system/tapzero`
+ real WASM SQLite.

**Scope:** Phase 1 of 4 from the design plan
`DOCS/design-plans/2026-06-01-029-feed-cache-settings.md`.

**Codebase verified:** 2026-06-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 029-feed-cache-settings.AC2: Tri-state effective resolution (`override ?? global`)
- **029-feed-cache-settings.AC2.1 Success:** override `null` + global on →
  effective on.
- **029-feed-cache-settings.AC2.2 Success:** override `null` + global off →
  effective off.
- **029-feed-cache-settings.AC2.3 Success:** override `true` + global off →
  effective on.
- **029-feed-cache-settings.AC2.4 Success:** override `false` + global on →
  effective off.
- **029-feed-cache-settings.AC2.5 Edge:** override `true` + global on →
  effective on.

### 029-feed-cache-settings.AC7: Persistence in local SQLite; tri-state; client-only
- **029-feed-cache-settings.AC7.1 Success:** `true` / `false` / `null`
  round-trip across reload.
- **029-feed-cache-settings.AC7.2 Success:** A `{content_enabled:0}` row
  with null mode/size/age survives upsert.
- **029-feed-cache-settings.AC7.3 Success:** An all-null row (override null
  + null mode/size/age) is deleted (back to inherit).
- **029-feed-cache-settings.AC7.4 Success:** No server/network write occurs
  for cache settings.

### 029-feed-cache-settings.AC9 (upsert portion): Smart-checkbox & read-path consistency
- **029-feed-cache-settings.AC9.1 Success (storage layer):** Writing `null`
  for `content_enabled` (plus null mode/size/age) clears the row
  (delete-to-inherit). *(UI behavior that decides to write `null` is Phase
  3; here we prove the upsert honors it.)*
- **029-feed-cache-settings.AC9.2 Success (storage layer):** Writing `0` or
  `1` persists an explicit override row.

> Note: AC9.3 (all read paths agree) is implemented in Phase 2; AC1, AC3,
> AC4 (UI), AC5, AC6, AC8 are later phases.

---

## Verified Codebase Context (read before coding)

Exact current state confirmed on 2026-06-01. Generate fresh code; these
snippets are reference for *where* and *how*.

**`src/client/db/local-schema.ts:23-33`** — `feed_cache_policy` create
string (used for NEW databases only):
```ts
export const FEED_CACHE_POLICY_SQL = `
    CREATE TABLE IF NOT EXISTS feed_cache_policy (
        feed_id INTEGER PRIMARY KEY,
        cache_mode TEXT CHECK (
            cache_mode IN ('text', 'text_images')
        ),
        max_size_bytes INTEGER,
        max_age_seconds INTEGER,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
`
```

**Migration pattern to copy** — `src/client/db/pull-sync.ts:106-149`
(`ensureItemFullContentColumns`) and `src/client/db/local-db.ts:109-125`
(`ensureFeedTerminalStateColumns`): a module-level `new WeakSet<Sqlite3Db>()`
readiness flag + `PRAGMA table_info(<table>)` check + conditional
`ALTER TABLE ... ADD COLUMN`. `CREATE TABLE IF NOT EXISTS` will NOT add the
column to existing DBs, so the `ALTER` path is required.

**`src/client/db/feed-cache-policy.ts`** (the whole file is the work area):
- `FeedCachePolicyRow` interface, lines 11-16 (currently: `feed_id`,
  `cache_mode`, `max_size_bytes`, `max_age_seconds`).
- `feedPolicies` signal, line 29:
  `signal<Record<number, FeedCachePolicyRow|null>>({})`.
- `resolveEffectivePolicy(row)`, lines 35-51 (falls back to
  `defaultCacheMode.value` / `defaultMaxSizeBytes.value` /
  `defaultMaxAgeSeconds.value`).
- `getFeedCachePolicy(db, feedId)`, lines 53-64 — `SELECT feed_id,
  cache_mode, max_size_bytes, max_age_seconds FROM feed_cache_policy
  WHERE feed_id = ?` via `queryOneDb<FeedCachePolicyRow>`.
- `upsertFeedCachePolicy(db, feedId, updates)`, lines 66-103 — the
  all-null→DELETE guard is lines 75-85; the INSERT…ON CONFLICT is 86-102.
- `loadFeedPolicies(db, feedIds, opts?)`, lines 105-116.

**`src/client/local-first-settings.ts`** — `storeContent:Signal<boolean>`
(line 12, default `false`); `DEFAULT_CACHE_MODE='text_images'` (line 6),
`defaultCacheMode`/`defaultMaxSizeBytes`/`defaultMaxAgeSeconds` signals
(lines 14-…). `storeContent` is the global fallback.

**Boolean-in-SQLite convention:** booleans are stored as INTEGER `0`/`1`
and typed `number` in row interfaces (e.g. `items.is_read`,
`is_starred`). Follow that here — type `content_enabled` as
`number|null` (values `0` / `1` / `null`); do not invent a boolean
mapping layer (the SELECT helpers map columns straight onto the generic
row type).

**Tests:** `test/feed-cache-policy.ts` (already exists; wired into the
aggregate `test/index.ts` at line 29, run by `npm test`). Pattern: real
WASM SQLite —
```ts
import { test } from '@substrate-system/tapzero'
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm'
import { openLocalDb, setTestMode } from '../src/client/db/sqlite-init.js'
setTestMode(true, wasmUrl as string)
// const db = await openLocalDb('did:test:<unique>'); try { ... }
//   finally { db.close() }
```
Project style: TAP via tapzero, real DB (not mocked), unique `did:test:*`
per test, `try/finally` close. Honor global CLAUDE.md: no lines > 80 cols;
no space before type annotations (`x:Type`); ternary operator on its own
lines; wrap multi-signal writes in `batch()`. Do NOT assert specific HTML
text.

---

## House Decision (read): tri-state representation

`content_enabled` is stored as INTEGER and typed `number|null`:
- `1` = force on, `0` = force off, `null`/absent = inherit global.
- The migration adds the column **nullable with NO default** so every
  pre-existing row reads as `null` (inherit) — preserving today's behavior
  for users who already store content globally. Do **not** write
  `DEFAULT 0` (that would silently force every existing feed off).

Effective rule (single source of truth):
```ts
// core: a policy row (or null) + the global signal → boolean
export function isContentCachedForPolicy (
    row:FeedCachePolicyRow|null|undefined
):boolean {
    const o = row?.content_enabled ?? null
    return o == null ?
        storeContent.value :
        o === 1
}
```
`o == null` is true only for SQL `NULL` (note `0 == null` is `false`), so
`0` correctly resolves to effective-off and `1` to effective-on.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add `content_enabled` to the new-DB schema string

**Verifies:** Supports AC7 (new databases created with the column).

**Files:**
- Modify: `src/client/db/local-schema.ts:23-33`
  (`FEED_CACHE_POLICY_SQL`)

**Implementation:**
Add a nullable `content_enabled INTEGER` column to the
`feed_cache_policy` CREATE TABLE string, placed before `updated_at`. No
`DEFAULT` clause (so it is `NULL` for rows that don't set it). Result:
```ts
export const FEED_CACHE_POLICY_SQL = `
    CREATE TABLE IF NOT EXISTS feed_cache_policy (
        feed_id INTEGER PRIMARY KEY,
        cache_mode TEXT CHECK (
            cache_mode IN ('text', 'text_images')
        ),
        max_size_bytes INTEGER,
        max_age_seconds INTEGER,
        content_enabled INTEGER,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
`
```

**Verification:**
Run: `npm run lint`
Expected: passes (no eslint or type errors introduced).

**Commit:** `feat: add content_enabled column to feed_cache_policy schema`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add the additive migration for existing local DBs

**Verifies:** AC7.1 (existing DBs gain the column so values round-trip).

**Files:**
- Modify: `src/client/db/feed-cache-policy.ts` (add a migration helper
  near the top, after imports)

**Implementation:**
Add a `WeakSet`-guarded migration that mirrors
`ensureItemFullContentColumns` (`pull-sync.ts:106-149`). Use the existing
`execDb` / `queryDb` helpers (import `queryDb` alongside the existing
`execDb`, `queryOneDb` from `./local-db.js`):
```ts
const feedCachePolicyColumnsReady = new WeakSet<Sqlite3Db>()

export async function ensureFeedCachePolicyColumns (
    db:Sqlite3Db
):Promise<void> {
    if (feedCachePolicyColumnsReady.has(db)) return
    const cols = await queryDb<{ name:string }>(
        db,
        'PRAGMA table_info(feed_cache_policy)'
    )
    const has = (name:string) => cols.some((col) => col.name === name)
    if (!has('content_enabled')) {
        await execDb(
            db,
            'ALTER TABLE feed_cache_policy ADD COLUMN content_enabled' +
            ' INTEGER'
        )
    }
    feedCachePolicyColumnsReady.add(db)
}
```
Call `await ensureFeedCachePolicyColumns(db)` at the start of
`getFeedCachePolicy` and `upsertFeedCachePolicy` (Tasks 3 and 4) so any
read/write path lazily migrates. Export it so Phase 2's `pull-sync` can
pre-warm the migration before its write transaction.

**Verification:**
Run: `npm run lint`
Expected: passes.

**Commit:** `feat: add additive content_enabled migration helper`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-6) -->

<!-- START_TASK_3 -->
### Task 3: Extend the row type and read path

**Verifies:** AC7.1 (read-back of stored value).

**Files:**
- Modify: `src/client/db/feed-cache-policy.ts:11-16`
  (`FeedCachePolicyRow`)
- Modify: `src/client/db/feed-cache-policy.ts:53-64`
  (`getFeedCachePolicy`)

**Implementation:**
1. Add `content_enabled:number|null` to `FeedCachePolicyRow` (values
   `0` / `1` / `null`).
2. In `getFeedCachePolicy`, call `await ensureFeedCachePolicyColumns(db)`
   first, then add `content_enabled` to the SELECT column list:
   `SELECT feed_id, cache_mode, max_size_bytes, max_age_seconds,
   content_enabled FROM feed_cache_policy WHERE feed_id = ?`.

**Verification:**
Run: `npm run lint`
Expected: passes (TypeScript compiler verifies the type; no unit test for
the type itself).

**Commit:** `feat: read content_enabled in FeedCachePolicyRow`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Thread `content_enabled` through the upsert + fix the DELETE rule

**Verifies:** AC7.2, AC7.3, AC9.1 (storage), AC9.2 (storage).

**Files:**
- Modify: `src/client/db/feed-cache-policy.ts:66-103`
  (`upsertFeedCachePolicy`)

**Implementation:**
1. Call `await ensureFeedCachePolicyColumns(db)` first.
2. Widen the `updates` param type to include
   `content_enabled:number|null`. (Phase 3's `saveFeedPolicy` passes a full
   `FeedCachePolicyRow` value — which also carries `feed_id` — as
   `updates`; that extra property is harmless under structural typing since
   it's a variable, not an object literal. Do not tighten the param type in
   a way that rejects it.)
3. **Fix the all-null→DELETE guard** so it only deletes when
   `content_enabled` is *also* null:
   ```ts
   if (
       updates.cache_mode == null &&
       updates.max_size_bytes == null &&
       updates.max_age_seconds == null &&
       updates.content_enabled == null
   ) {
       // DELETE ... (unchanged)
   }
   ```
   This keeps a `{content_enabled:0, others null}` row alive (AC7.2) while
   still collapsing a fully-null row to inherit (AC7.3).
4. Add `content_enabled` to the INSERT column list, the `VALUES`
   placeholder list, the `ON CONFLICT … DO UPDATE SET` list
   (`content_enabled = excluded.content_enabled`), and the `bind` array
   (bind `updates.content_enabled`).

**Testing:** covered by Task 6.

**Verification:**
Run: `npm run lint`
Expected: passes.

**Commit:** `feat: persist content_enabled via upsertFeedCachePolicy`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Add the effective-state resolvers

**Verifies:** AC2.1–AC2.5 (logic; exercised by Task 6).

**Files:**
- Modify: `src/client/db/feed-cache-policy.ts` (imports + new exports)

**Implementation:**
1. Import `storeContent` from `../local-first-settings.js` (add to the
   existing import block from that module).
2. Add the core resolver and the signal-based convenience:
   ```ts
   export function isContentCachedForPolicy (
       row:FeedCachePolicyRow|null|undefined
   ):boolean {
       const o = row?.content_enabled ?? null
       return o == null ?
           storeContent.value :
           o === 1
   }

   export function isContentCachedForFeed (feedId:number):boolean {
       return isContentCachedForPolicy(
           feedPolicies.value[feedId] ?? null
       )
   }
   ```
   `isContentCachedForPolicy` is the DB-side-friendly form (takes a row
   straight from `getFeedCachePolicy`, used by Phase 2's `pull-sync` and
   `cache-status`). `isContentCachedForFeed` is the signal-based form for
   the UI and on-demand fetch. Do not modify `resolveEffectivePolicy`
   (its `cache_mode`/size/age contract is unchanged).

**Verification:**
Run: `npm run lint`
Expected: passes.

**Commit:** `feat: add isContentCachedForPolicy / isContentCachedForFeed`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Tests — persistence round-trip, DELETE rule, resolver

**Verifies:** AC2.1, AC2.2, AC2.3, AC2.4, AC2.5, AC7.1, AC7.2, AC7.3,
AC7.4, AC9.1 (storage), AC9.2 (storage).

**Files:**
- Modify: `test/feed-cache-policy.ts` (add tests; it is already imported
  by `test/index.ts:29`)

**Testing:** Generate test code at execution time following the existing
file's patterns (real WASM SQLite via `openLocalDb`, unique `did:test:*`,
`try/finally` close, tapzero assertions). Add cases that verify:

- **AC7.1 round-trip:** upsert `content_enabled` = `1`, re-open/read via
  `getFeedCachePolicy`, assert `1`; repeat for `0`; for inherit, upsert
  the row to all-null and assert the row is gone (reads back `null`).
- **AC7.2 zero-survives:** `upsertFeedCachePolicy(db, id, {cache_mode:null,
  max_size_bytes:null, max_age_seconds:null, content_enabled:0})`, then
  `getFeedCachePolicy` returns a non-null row with `content_enabled === 0`.
- **AC7.3 all-null deletes:** upsert with every field null → row is
  deleted (`getFeedCachePolicy` returns `null`). Also assert that a row
  with only `content_enabled` cleared back to `null` but a non-null
  `cache_mode` still survives (the DELETE only fires when *all four* are
  null).
- **AC9.1 / AC9.2 (storage):** writing `0`/`1` produces an explicit row;
  writing all-null removes it.
- **AC2.1–AC2.5 resolver:** drive `isContentCachedForPolicy` with each
  combination of `content_enabled ∈ {null, 0, 1}` and
  `storeContent.value ∈ {true, false}`; assert effective value matches the
  truth table (null→follows global; 0→false; 1→true). Set
  `storeContent.value` directly in the test and restore it afterward.
- **AC7.4 client-only:** assert no `fetch` is performed by the upsert.
  Follow the file's existing approach; if it has no fetch stub, install a
  minimal `globalThis.fetch` spy that fails the test if called during
  `upsertFeedCachePolicy`, and restore it in `finally`.

Do **not** assert on HTML or DOM text (this is a DB/logic suite).

**Verification:**
Run: `npm test`
Expected: the full suite passes, including the new `feed-cache-policy`
cases. (To iterate faster on just this suite, run the aggregate bundle:
`esbuild ./test/index.ts --bundle
--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts
--alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts
--loader:.css=text --loader:.wasm=dataurl | tapout`.)

Run: `npm run lint`
Expected: passes.

**Commit:** `test: cover content_enabled persistence and resolver`
<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase 1 Done When

- `content_enabled INTEGER` exists in both the CREATE TABLE string (new
  DBs) and via the additive `ALTER TABLE` migration (existing DBs), with
  no default so existing rows read as `null`.
- `FeedCachePolicyRow`, `getFeedCachePolicy`, and `upsertFeedCachePolicy`
  carry `content_enabled`; the upsert's DELETE rule keeps
  `{content_enabled:0}` rows and deletes only fully-null rows.
- `isContentCachedForPolicy` and `isContentCachedForFeed` return
  `override ?? storeContent.value` correctly for all three override
  states.
- `npm test` and `npm run lint` pass.
