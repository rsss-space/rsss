# Phase 3: Build the paint-cache module

**Goal:** Stand up `src/client/paint-cache.ts` as a standalone module
with synchronous read / debounced write semantics, capped storage, and
per-DID isolation. Cover its behavior with tests that match the
existing client-test conventions.

**Architecture:** Pure functional core: a single file that owns three
exported functions (`readPaintCache`, `writePaintCache`,
`clearPaintCache`) plus narrow summary types (`FeedSummary`,
`ItemSummary`) and the versioned snapshot interface (`PaintCacheV1`).
Storage backend is `localStorage` only. Errors are swallowed — the
cache is best-effort. The module has no Preact / signals imports; it
is a pure I/O wrapper. The module also exports a small helper
`getStoredDid()` / `setStoredDid()` / `clearStoredDid()` for the
companion `rsss.lastSessionDid` key (used by Phase 4 to know which
DID's cache to hydrate before auth completes).

**Tech Stack:** TypeScript (browser, ES2022). `@substrate-system/tapzero`
for tests, esbuild + tapout for the bundler.

**Scope:** Phase 3 of 8. Independent of Phases 1, 2. No wiring into
`state.ts` or `index.ts` happens in this phase — that is Phase 4 (reads)
and Phase 5 (writes).

**Codebase verified:** 2026-05-24

**Key facts from investigation:**
- Existing localStorage hydration pattern lives in
  `src/client/local-first-settings.ts` (lines 26-62 for the `loadXxx`
  shape, lines 64-73 for the `saveXxx` shape). Uses `try { … } catch
  { /* ignore corrupt storage */ }`, key constant at top of module
  (`LS_KEY = 'rsss.localFirst'`). The paint-cache module mirrors this
  style — top-level key constant, swallow-on-parse-error, no
  exception propagation.
- Tests use `@substrate-system/tapzero`. Pattern:
  `import { test } from '@substrate-system/tapzero'`,
  `test('description', async (t) => { ... t.equal(...) })`. Tests
  reset state with `localStorage.removeItem('rsss.localFirst')` and
  dynamic `await import('../src/client/X.js')`. Example file:
  `test/local-first-settings.ts:1-49`.
- Test script convention: each module gets a `test:<name>` entry in
  `package.json` (lines 15-41), pattern
  `"esbuild ./test/<file>.ts --bundle | tapout"`. The umbrella
  `npm test` runs `node test/run-all-tests.mjs`, which has each
  command listed explicitly (no glob).
- Domain types live in `src/client/db/types.ts`. `Feed` (lines 9-20)
  has `id:number, url:string, title:string|null,
  description:string|null, site_url:string|null, last_fetched:string|null,
  last_error:string|null, last_status:number|null, created_at:string,
  updated_at:string`. `Item` (lines 22-45) has `id, feed_id, guid,
  title, link, description, content, author, pub_date,
  thumbnail_url, og_image_url?, blurhash?, image_width?, image_height?,
  is_read, is_starred, created_at, updated_at, feed_title?,
  full_content?, full_content_fetched_at?, full_content_status?`.
  `CountsResponse` (lines 54-59) has `unread, starred, total,
  perFeed:Record<string, number>`.
- Signal shapes in `state.ts`: `feeds:Signal<Feed[]>` (line 394),
  `items:Signal<Item[]>` (line 420), `counts:Signal<CountsResponse>`
  (line 424), `selectedFeedId:Signal<number|null>` (line 428).
- `scheduleIdle` is at `src/client/util/schedule-idle.ts` and has the
  signature `scheduleIdle(fn:()=>void, opts?:{timeout?:number}):IdleHandle`
  with a default timeout of 200ms. The paint-cache module itself does
  NOT call `scheduleIdle` — Phase 5 wires the call from
  `state.ts`. This phase only defines the synchronous primitives.
- No existing `rsss.lastSessionDid` (or any "last user" persistence)
  exists; this is a new localStorage key introduced here.
- Project house-style (from `CLAUDE.md`): no space after colon in type
  annotations (`x:Type`), 80-column limit, ternaries with the operator
  at the end of the first line, multi-signal writes via `batch()`
  (not needed in this phase — no signals).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 023-fix-initial-load.AC2: Paint cache module persists and reads correctly
- **023-fix-initial-load.AC2.1 Success:** `writePaintCache(did, snap)`
  followed by `readPaintCache(did)` round-trips an equivalent snapshot
  when the snapshot is under all caps.
- **023-fix-initial-load.AC2.2 Success:** A snapshot with 300 items
  is written with exactly 200 items after truncation (newest-first
  preserved).
- **023-fix-initial-load.AC2.3 Success:** A snapshot whose serialized
  JSON would exceed 1 MB has additional items dropped from the tail
  until under the cap.
- **023-fix-initial-load.AC2.5 Failure:** `readPaintCache(did)`
  returns `null` (does not throw) when the localStorage key is
  missing.
- **023-fix-initial-load.AC2.6 Failure:** `readPaintCache(did)`
  returns `null` when the stored JSON is malformed.
- **023-fix-initial-load.AC2.7 Failure:** `readPaintCache(did)`
  returns `null` when `schemaVersion` does not match the current
  version constant.

### 023-fix-initial-load.AC6: Logout and account-switch cleanup
- **023-fix-initial-load.AC6.4 Failure:** Logout of DID-A does not
  remove a paint-cache entry for DID-B.

  *Note: only the module-level capability is verified here
  (`clearPaintCache(didA)` does not touch DID-B's key). The wiring of
  `clearPaintCache` into the logout flow itself is Phase 5.*

(`AC2.4` — debounced write via `scheduleIdle` in success paths — is
covered in Phase 5, where the wiring lives. This phase only provides
the synchronous `writePaintCache` primitive that the Phase 5 helper
will schedule.)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create the paint-cache module

**Verifies:** AC2.1, AC2.5, AC2.6, AC2.7 (the implementation that the
tests in Task 3 will pin down).

**Files:**
- Create: `src/client/paint-cache.ts`

**Implementation:**

Create the file with the following exact content. Inline comments mark
the spots where each acceptance criterion is enforced. The module
contains zero Preact/signals imports and zero side effects on import.

```typescript
/**
 * Paint cache — a best-effort, capped, per-DID localStorage snapshot
 * of the current feed list, item list, counts, and selected feed.
 *
 * Read synchronously at bootstrap (before Preact mounts) to seed
 * signals so the shell paints from real data without a network
 * round-trip. Written debounced after each successful load.
 *
 * Storage is best-effort: read/write errors are swallowed. The cache
 * is never the source of truth; OPFS-SQLite (paid users) and the
 * remote HTTP API (free users) remain authoritative.
 */

import type {
    Feed,
    Item,
    CountsResponse
} from './db/types.js'

const PAINT_CACHE_KEY_PREFIX = 'rsss.paintCache.v1.'
const LAST_SESSION_DID_KEY = 'rsss.lastSessionDid'

const SCHEMA_VERSION = 1 as const

const MAX_FEEDS = 100
const MAX_ITEMS = 200
const MAX_BYTES = 1_000_000

/**
 * FeedSummary matches the full `Feed` shape — feeds are small (100
 * max) so we keep them whole for direct assignment to the feeds
 * signal on hydrate.
 */
export interface FeedSummary {
    id:number
    url:string
    title:string|null
    description:string|null
    site_url:string|null
    last_fetched:string|null
    last_error:string|null
    last_status:number|null
    created_at:string
    updated_at:string
}

/**
 * ItemSummary mirrors `Item` minus the heavy text fields (description,
 * content, full_content*). These are filled with `null` defaults so
 * the shape can be assigned directly to the items signal without
 * padding logic at the hydration site.
 */
export interface ItemSummary {
    id:number
    feed_id:number
    guid:string
    title:string|null
    link:string|null
    description:null
    content:null
    author:string|null
    pub_date:string|null
    thumbnail_url:string|null
    og_image_url?:string|null
    blurhash?:string|null
    image_width?:number|null
    image_height?:number|null
    is_read:number
    is_starred:number
    created_at:string
    updated_at:string
    feed_title?:string
    full_content?:null
    full_content_fetched_at?:null
    full_content_status?:null
}

export interface PaintCacheV1 {
    schemaVersion:1
    writtenAt:number
    feeds:FeedSummary[]
    items:ItemSummary[]
    counts:CountsResponse
    selectedFeedId:number|null
}

export type PaintCacheSnapshotInput = Omit<
    PaintCacheV1,
    'schemaVersion'|'writtenAt'
>

function storageKey (did:string):string {
    return PAINT_CACHE_KEY_PREFIX + did
}

function toFeedSummary (feed:Feed):FeedSummary {
    return {
        id: feed.id,
        url: feed.url,
        title: feed.title,
        description: feed.description,
        site_url: feed.site_url,
        last_fetched: feed.last_fetched,
        last_error: feed.last_error,
        last_status: feed.last_status,
        created_at: feed.created_at,
        updated_at: feed.updated_at
    }
}

function toItemSummary (item:Item):ItemSummary {
    return {
        id: item.id,
        feed_id: item.feed_id,
        guid: item.guid,
        title: item.title,
        link: item.link,
        description: null,
        content: null,
        author: item.author,
        pub_date: item.pub_date,
        thumbnail_url: item.thumbnail_url,
        og_image_url: item.og_image_url,
        blurhash: item.blurhash,
        image_width: item.image_width,
        image_height: item.image_height,
        is_read: item.is_read,
        is_starred: item.is_starred,
        created_at: item.created_at,
        updated_at: item.updated_at,
        feed_title: item.feed_title,
        full_content: null,
        full_content_fetched_at: null,
        full_content_status: null
    }
}

/**
 * Convert full Feed[] / Item[] into the narrow summary shapes used by
 * the paint cache. Callers in state.ts produce these from signals.
 */
export function snapshotFromState (
    feeds:Feed[],
    items:Item[],
    counts:CountsResponse,
    selectedFeedId:number|null
):PaintCacheSnapshotInput {
    return {
        feeds: feeds.map(toFeedSummary),
        items: items.map(toItemSummary),
        counts,
        selectedFeedId
    }
}

/**
 * Apply caps (feeds, items, total bytes) before serialization. Items
 * are assumed to be in newest-first order; truncation drops from the
 * tail. Returns the capped snapshot.
 */
function capSnapshot (
    snap:PaintCacheV1
):PaintCacheV1 {
    const cappedFeeds = (
        snap.feeds.length > MAX_FEEDS ?
            snap.feeds.slice(0, MAX_FEEDS) :
            snap.feeds
    )
    let cappedItems = (
        snap.items.length > MAX_ITEMS ?
            snap.items.slice(0, MAX_ITEMS) :
            snap.items
    )

    let candidate:PaintCacheV1 = {
        ...snap,
        feeds: cappedFeeds,
        items: cappedItems
    }
    let serialized = JSON.stringify(candidate)

    // Tail-drop items until we fit under MAX_BYTES. Feeds/counts are
    // small enough that we never need to truncate them, but if the
    // byte cap is exceeded with zero items, the snapshot is written
    // empty rather than skipped.
    while (serialized.length > MAX_BYTES && cappedItems.length > 0) {
        cappedItems = cappedItems.slice(0, cappedItems.length - 1)
        candidate = { ...candidate, items: cappedItems }
        serialized = JSON.stringify(candidate)
    }

    return candidate
}

export function readPaintCache (did:string):PaintCacheV1|null {
    try {
        const raw = localStorage.getItem(storageKey(did))
        if (!raw) return null  // AC2.5: missing key returns null
        const parsed = JSON.parse(raw) as unknown
        if (!isPaintCacheV1(parsed)) return null  // AC2.7 / AC2.6
        return parsed
    } catch {
        return null  // AC2.6: malformed JSON returns null
    }
}

export function writePaintCache (
    did:string,
    snapshot:PaintCacheSnapshotInput
):void {
    try {
        const full:PaintCacheV1 = {
            schemaVersion: SCHEMA_VERSION,
            writtenAt: Date.now(),
            ...snapshot
        }
        const capped = capSnapshot(full)
        localStorage.setItem(
            storageKey(did),
            JSON.stringify(capped)
        )
    } catch {
        // best-effort: swallow quota / serialization errors
    }
}

/**
 * Clear paint cache entries.
 *
 * - `clearPaintCache(did)` removes only that DID's entry. Other DIDs'
 *   entries are preserved (AC6.4).
 * - `clearPaintCache()` removes every `rsss.paintCache.v1.*` key.
 *   Used for migration / forced invalidation.
 */
export function clearPaintCache (did?:string):void {
    try {
        if (did !== undefined) {
            localStorage.removeItem(storageKey(did))
            return
        }
        const toRemove:string[] = []
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)
            if (k && k.startsWith(PAINT_CACHE_KEY_PREFIX)) {
                toRemove.push(k)
            }
        }
        for (const k of toRemove) localStorage.removeItem(k)
    } catch {
        // best-effort
    }
}

export function getStoredDid ():string|null {
    try {
        return localStorage.getItem(LAST_SESSION_DID_KEY)
    } catch {
        return null
    }
}

export function setStoredDid (did:string):void {
    try {
        localStorage.setItem(LAST_SESSION_DID_KEY, did)
    } catch {
        // best-effort
    }
}

export function clearStoredDid ():void {
    try {
        localStorage.removeItem(LAST_SESSION_DID_KEY)
    } catch {
        // best-effort
    }
}

function isPaintCacheV1 (v:unknown):v is PaintCacheV1 {
    if (typeof v !== 'object' || v === null) return false
    const o = v as Record<string, unknown>
    if (o.schemaVersion !== SCHEMA_VERSION) return false  // AC2.7
    if (typeof o.writtenAt !== 'number') return false
    if (!Array.isArray(o.feeds)) return false
    if (!Array.isArray(o.items)) return false
    if (typeof o.counts !== 'object' || o.counts === null) return false
    if (
        o.selectedFeedId !== null &&
        typeof o.selectedFeedId !== 'number'
    ) {
        return false
    }
    return true
}
```

**Implementation notes:**

- `MAX_BYTES = 1_000_000` is the JSON-string-length ceiling, not a
  precise byte count. JSON serialized to UTF-16 in localStorage will
  typically be 2x the byte count, but localStorage quotas are
  themselves measured in characters (per spec), so character-length
  is the right cap.
- The capping loop drops items from the *tail* under the assumption
  that callers pass items newest-first (which matches the convention
  used by the items signal in `state.ts`). Tests in Task 3 verify
  this.
- `clearPaintCache()` iterates all localStorage keys; safe even with
  large stores because the prefix scan is O(n) and n is small in
  practice. Errors are swallowed.
- The version constant is exported only as a type-level `1` literal;
  bumping it (when the snapshot shape changes) means changing both the
  storage key suffix (`.v1.` -> `.v2.`) and the `SCHEMA_VERSION`
  constant in the same commit.

**Verification:**

Run: `npm run typecheck`
Expected: Clean. The new module compiles with the existing TS config
and produces no new errors.

Run: `npm run lint`
Expected: Clean (passes eslint with the existing config).

**Commit:**

```bash
git add src/client/paint-cache.ts
git commit -m "feat: add paint-cache module (read/write/clear)

New synchronous, per-DID, capped localStorage cache for the app's
last-known feed/item/count snapshot. Read at bootstrap before Preact
mounts (Phase 4), written debounced after each successful load
(Phase 5). 100-feed / 200-item / 1 MB caps; tail-drop on overflow;
swallowed errors (best-effort).

Module-level capability only — no wiring yet.

Part of 023-fix-initial-load."
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add the `test:paint-cache` script

**Verifies:** None directly — infrastructure step required by Task 3.

**Files:**
- Modify: `package.json` (add one line to `scripts`)
- Modify: `test/run-all-tests.mjs` (add one command to the `commands` array)

**Implementation:**

1. In `package.json`, add a new script entry alphabetically among the
   other `test:*` entries (insert between `test:local-first` line 18
   and `test:sqlite-init` line 19):

   ```json
   "test:paint-cache": "esbuild ./test/paint-cache.ts --bundle | tapout",
   ```

2. In `test/run-all-tests.mjs`, add the same command to the `commands`
   array (place it near the other simple `esbuild ... | tapout` entries,
   e.g., after the `test/schedule-idle.ts` line 22):

   ```javascript
       'esbuild ./test/paint-cache.ts --bundle | tapout',
   ```

**Verification:**

Run: `node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).scripts['test:paint-cache'])"`
Expected output: `esbuild ./test/paint-cache.ts --bundle | tapout`

(The script invocation itself is verified in Task 3 once the test
file exists.)

**Commit:** Combine with Task 3 — do not commit a half-wired script.

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Property + behavior tests for the paint-cache module

**Verifies:** 023-fix-initial-load.AC2.1, AC2.2, AC2.3, AC2.5, AC2.6,
AC2.7, AC6.4

**Files:**
- Create: `test/paint-cache.ts`

**Testing:**

Tests use `@substrate-system/tapzero` to match the existing client-side
test conventions (see `test/local-first-settings.ts:1-49` for the
canonical example). Each test resets the cache via `clearPaintCache()`
before running. The test file dynamically re-imports the module
between tests where needed to mirror the existing pattern, though for
this module dynamic re-import is not strictly required because the
module is stateless apart from localStorage.

Tests must verify each AC listed above:
- **AC2.1 (round-trip):** Build a snapshot with a handful of feeds, a
  handful of items, a counts object, and a selectedFeedId. Write it
  for `did:plc:alice`. Read it back. Assert the deserialized snapshot's
  `feeds`, `items`, `counts`, and `selectedFeedId` deep-equal the
  inputs; `schemaVersion === 1`; `writtenAt` is a recent timestamp
  within the last 5 seconds.
- **AC2.2 (item truncation):** Build a snapshot with 300 items (each
  small enough that the byte cap doesn't kick in first; use
  `ItemSummary` shape with short strings). Write it; read it back;
  assert `items.length === 200`. Assert the *first* item read back
  equals the *first* item written (i.e., newest-first preservation).
- **AC2.3 (byte cap):** Build a snapshot with 200 items where each
  item's `title` is a 10 KB string so the snapshot serialized would
  exceed 1 MB. Write; read back; assert `items.length < 200` AND the
  serialized length of the read snapshot is `≤ 1_000_000`.
- **AC2.5 (missing key):** `clearPaintCache()`; assert
  `readPaintCache('did:plc:bob') === null` (does not throw).
- **AC2.6 (malformed JSON):** Manually
  `localStorage.setItem('rsss.paintCache.v1.did:plc:carol', '{not json')`;
  assert `readPaintCache('did:plc:carol') === null` (does not throw).
- **AC2.7 (schema version mismatch):** Write a syntactically-valid
  JSON with `schemaVersion: 2`; assert `readPaintCache(...) === null`.
- **AC6.4 (per-DID isolation):** Write a snapshot for `did:plc:alice`
  and another for `did:plc:bob`. Call `clearPaintCache('did:plc:alice')`.
  Assert `readPaintCache('did:plc:alice') === null` AND
  `readPaintCache('did:plc:bob')` still returns Bob's snapshot.
- **Extra (clearStoredDid round-trip):** `setStoredDid('did:plc:dan')`
  followed by `getStoredDid()` returns `'did:plc:dan'`;
  `clearStoredDid()` followed by `getStoredDid()` returns `null`.

Follow the file pattern from `test/local-first-settings.ts`:
- Top of file imports `import { test } from '@substrate-system/tapzero'`.
- Each test is `async (t) => { ... }`.
- Use `t.equal`, `t.deepEqual`, `t.ok`, `t.notOk` from tapzero.
- Reset state at the start of each test (e.g.,
  `clearPaintCache(); clearStoredDid()`).
- 80-column line limit; no-space-after-colon type annotations.

Task-implementor generates actual test code at execution time.

**Verification:**

Run: `npm run test:paint-cache`
Expected: All tests pass. Sample output line: `tests: 8, passing: 8`.

Run: `npm run typecheck`
Expected: Clean.

**Commit:**

```bash
git add package.json test/run-all-tests.mjs test/paint-cache.ts
git commit -m "test: paint-cache module — round-trip, caps, isolation

Property + behavior tests covering AC2.1, AC2.2, AC2.3, AC2.5, AC2.6,
AC2.7, and AC6.4 (per-DID isolation). Wires the new test:paint-cache
script into both package.json and test/run-all-tests.mjs so npm test
picks it up.

Part of 023-fix-initial-load."
```

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
