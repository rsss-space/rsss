# Scheduled-drain ingestion — Phase 3: Per-event apply (applyCommit)

**Goal:** Apply a single Jetstream commit event to the index — upsert on
create/update of a valid record, delete by `uri` on delete, drop everything
off-lexicon — with idempotent writes so replays are harmless.

**Architecture:** A synchronous pure-ish function `applyCommit(sql, evt)` plus
the Jetstream event types, under a new `src/server/indexer/` module. It reuses
`isValidRecord` (Phase 2) as the validation boundary and writes to the `items`
table (Phase 1). The drain loop (Phase 4) calls it per event.

**Tech Stack:** TypeScript (Cloudflare Workers runtime), Durable Object SQLite
(`SqlStorage`), `@substrate-system/tapzero` node-platform tests.

**Scope:** Phase 3 of 6 (scheduled-drain ingestion).

**Codebase verified:** 2026-06-19

---

## Verification gate (typecheck baseline)

The `hose-listening` branch baseline is NOT type-clean: `npm run typecheck`
(`tsc --noEmit`) exits non-zero with **25 pre-existing errors unrelated to this
feature** — 3 in `src/` (`src/client/routes/sync-status-format.ts`,
`src/client/routes/sync-status-state.ts`) and ~22 in `test/` (an undefined
`QueryResult` global). CI (`.github/workflows/nodejs.yml`) runs the same
command, so the branch is already red.

Therefore, wherever a task below says "`npm run typecheck` → passes", read it
as: **introduces NO NEW type errors in the files this task creates or
modifies.** Capture the baseline once before starting
(`npm run typecheck 2>&1 | grep -c 'error TS'` → `25`) and confirm the count
does not increase and that no new error line names a file this task touched.
`npm run lint` (clean on baseline) and `npm test` remain hard pass/fail gates.

---

## Acceptance Criteria Coverage

Implements and tests `scheduled-drain.AC2` (per-event apply). Derived from
`specs/scheduled-drain.md` "Per-event handling" and "Correctness invariants"
(at-least-once delivery made effectively-once by idempotent, `uri`-keyed
writes).

### scheduled-drain.AC2: Per-event apply
- **scheduled-drain.AC2.1 create→upsert:** a `create` op for a valid record
  issues `INSERT … ON CONFLICT(uri) DO UPDATE` with binds
  `[uri, did, collection, rkey, cid, JSON.stringify(record), time_us, <number>]`.
- **scheduled-drain.AC2.2 update→upsert:** an `update` op for a valid record
  issues the same upsert.
- **scheduled-drain.AC2.3 delete→delete:** a `delete` op issues exactly
  `DELETE FROM items WHERE uri = ?` with `[uri]`, and performs no validation or
  insert.
- **scheduled-drain.AC2.4 off-lexicon drop:** a create/update for an
  unknown-collection or invalid record performs **zero** SQL writes.
- **scheduled-drain.AC2.5 uri format:** the URI is
  `at://<did>/<collection>/<rkey>`.
- **scheduled-drain.AC2.6 idempotent:** the upsert is keyed `ON CONFLICT(uri)`
  (and delete is by `uri`), so re-delivered events are no-ops.
- **scheduled-drain.AC2.7 missing-cid drop:** a create/update whose `cid` is
  absent/empty performs no write (keeps the `cid NOT NULL` invariant
  meaningful).

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Jetstream event types

**Files:**
- Create: `src/server/indexer/types.ts`

**Implementation:**

```ts
export type JetstreamKind = 'commit' | 'identity' | 'account'
export type JetstreamOperation = 'create' | 'update' | 'delete'

export interface JetstreamCommit {
    rev?:string
    operation:JetstreamOperation
    collection:string
    rkey:string
    cid?:string             // absent on delete
    record?:unknown         // absent on delete; untrusted shape otherwise
}

export interface JetstreamEvent {
    did:string
    time_us:number          // microseconds since epoch
    kind:JetstreamKind
    commit?:JetstreamCommit  // present when kind === 'commit'
}
```

Types only — verified by the compiler, no test.

**Verify:** `npm run typecheck` && `npm run lint`.

**Commit:** `feat: add Jetstream event types for the indexer`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: applyCommit

**Verifies:** scheduled-drain.AC2.1–AC2.7

**Files:**
- Create: `src/server/indexer/apply-commit.ts`

**Implementation:**

```ts
import { isValidRecord } from '../../shared/lexicons/validate.js'
import type { JetstreamEvent } from './types.js'

export function applyCommit (sql:SqlStorage, evt:JetstreamEvent):void {
    const c = evt.commit
    if (!c) return
    const uri = `at://${evt.did}/${c.collection}/${c.rkey}`

    if (c.operation === 'delete') {
        sql.exec('DELETE FROM items WHERE uri = ?', uri)
        return
    }

    // create / update. The firehose is untrusted input: require the
    // structural field the index needs (cid, NOT NULL) and validate the
    // record shape. Drop anything off-lexicon.
    if (typeof c.cid !== 'string' || c.cid.length === 0) return
    if (!isValidRecord(c.collection, c.record)) return

    sql.exec(
        `INSERT INTO items
           (uri, did, collection, rkey, cid, record, time_us, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uri) DO UPDATE SET
           cid = excluded.cid,
           record = excluded.record,
           time_us = excluded.time_us,
           indexed_at = excluded.indexed_at`,
        uri, evt.did, c.collection, c.rkey, c.cid,
        JSON.stringify(c.record), evt.time_us, Date.now()
    )
}
```

Notes:
- `SqlStorage` is an ambient global type (erased at build) — no import needed,
  and the function carries no `cloudflare:workers` import, so its test needs no
  alias.
- Synchronous by design (pure SQL + validation). The Phase 4 drain calls it via
  `await apply(evt)`, which works on a sync function.
- `indexed_at` is `Date.now()` (wall-clock ingest metadata). The cursor uses
  `time_us` from the event, never `indexed_at`.

**Verify:** `npm run typecheck` && `npm run lint`.

**Commit:** `feat: apply Jetstream commits to the index (upsert/delete)`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: applyCommit tests

**Verifies:** scheduled-drain.AC2.1–AC2.7

**Files:**
- Create: `test/apply-commit.ts` (unit)
- Modify: `test/run-all-tests.mjs` (register)

**Testing:**

Use a hand-rolled fake `SqlStorage` that records every `exec(query, ...binds)`
call and returns `fakeResult([])` (import `fakeResult` from
`./helpers/sql-fake.js`). Author with `@substrate-system/tapzero`; one
`test('scheduled-drain.AC2.x: …')` per case. Verify behavior, not wiring:

- AC2.1: a `create` event for a valid `space.rsss.feed.subscription` record →
  exactly one `exec`; query matches `/INSERT INTO items/` and
  `/ON CONFLICT\(uri\) DO UPDATE/`; binds equal
  `[uri, did, collection, rkey, cid, JSON.stringify(record), time_us, <number>]`
  (assert the 8th bind is `typeof === 'number'`, not an exact value).
- AC2.2: an `update` event for the same valid record → identical upsert.
- AC2.3: a `delete` event → exactly one `exec`; query is
  `DELETE FROM items WHERE uri = ?`; binds `[uri]`. (Construct the delete event
  with NO `cid`/`record`, mirroring the firehose.)
- AC2.4: a `create` for collection `space.rsss.post` (unknown) AND a `create`
  for `space.rsss.feed.subscription` missing `createdAt` → **zero** `exec`
  calls each.
- AC2.5: assert the `uri` bind equals `at://<did>/<collection>/<rkey>` for the
  create case.
- AC2.6: assert the create/update query contains `ON CONFLICT(uri)` (the
  idempotency contract).
- AC2.7: a `create` for a valid record but with `cid` absent → zero `exec`
  calls.

Register in `test/run-all-tests.mjs` node-platform section (NO cloudflare
alias — `apply-commit.ts` imports only `validate.js` + `types.js`):

```js
    [
        'esbuild ./test/apply-commit.ts --bundle',
        '--platform=node --format=esm',
        '| node --input-type=module | tap-spec'
    ].join(' '),
```

**Verify:** `npm test` (new suite green, whole run green, no console.error) +
`npm run typecheck` + `npm run lint`.

**Commit:** `test: cover applyCommit upsert/delete/drop (scheduled-drain.AC2)`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

---

## Phase 3 done when

- `src/server/indexer/types.ts` and `src/server/indexer/apply-commit.ts` exist;
  `applyCommit` upserts valid create/update, deletes by `uri`, and drops
  off-lexicon / missing-cid records.
- `test/apply-commit.ts` covers AC2.1–AC2.7 and is registered.
- `npm test`, `npm run typecheck`, `npm run lint` all pass.
