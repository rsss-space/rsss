# Scheduled-drain ingestion — Phase 1: Indexer DO scaffold and storage

**Goal:** Stand up the `RsssIndexerDO` global-singleton Durable Object and its
SQLite `items` index + `cursor` storage, so later phases have a DO, a schema,
and a cursor to write to.

**Architecture:** A new global-singleton DO (`idFromName('rsss-indexer')`)
modeled on the existing `RsssRegistryDO`. It owns an `items` table (the App
View index of `space.rsss.*` records) plus a `cursor` storage key, and
delegates `fetch()` to an internal Hono router. No drain, validation, alarm, or
public read API yet — those land in Phases 2–6.

**Tech Stack:** TypeScript (Cloudflare Workers runtime, ES2022 lib), Hono,
Durable Object SQLite, `wrangler.jsonc` DO bindings + migrations.

**Scope:** Phase 1 of 6 (scheduled-drain ingestion).

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

**Verifies: None.** This is an infrastructure phase (DO scaffold + storage
wiring). It is verified operationally — `npm run typecheck` and `npm run lint`
succeed and the worker registers the new DO class with a valid v5 SQLite
migration. Behavioral acceptance criteria for the index begin in Phase 2
(`isValidRecord`) and Phase 3 (`applyCommit`).

Design note (singleton tradeoff): a single global DO is normally an
anti-pattern, but here it is the deliberate design from
`specs/scheduled-drain.md` — a background drain + index reader off the
user-request hot path. The spec documents the escape hatch (move `items` to D1,
keep only the cursor in the DO) if a single object's SQLite gets tight. Kept as
a singleton.

---

<!-- START_TASK_1 -->
### Task 1: Create the RsssIndexerDO class

**Files:**
- Create: `src/server/durable-objects/indexer.ts`

**Implementation:**

Mirror `src/server/durable-objects/registry.ts` exactly (imports, narrow env
interface, schema-in-`blockConcurrencyWhile`, `fetch` → internal Hono router,
positional binds, `.one()` only for `count(*)`). Note: registry names its narrow
env type `RegistryEnv` (NOT `Env`); ours is `IndexerEnv`. Create the file with
this content:

```ts
import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'

export interface IndexerEnv {
    NODE_ENV?:string
    SENTRY_DSN?:string
}

export interface IndexItem {
    uri:string
    did:string
    collection:string
    rkey:string
    cid:string
    record:string
    time_us:number
    indexed_at:number
}

const CURSOR_KEY = 'cursor'

export class RsssIndexerDO extends DurableObject<IndexerEnv> {
    private sql:SqlStorage
    private app:Hono

    constructor (ctx:DurableObjectState, env:IndexerEnv) {
        super(ctx, env)
        this.sql = ctx.storage.sql
        ctx.blockConcurrencyWhile(async () => {
            this.sql.exec(
                `CREATE TABLE IF NOT EXISTS items (
                    uri        TEXT PRIMARY KEY,
                    did        TEXT NOT NULL,
                    collection TEXT NOT NULL,
                    rkey       TEXT NOT NULL,
                    cid        TEXT NOT NULL,
                    record     TEXT NOT NULL,
                    time_us    INTEGER NOT NULL,
                    indexed_at INTEGER NOT NULL
                )`
            )
            this.sql.exec(
                'CREATE INDEX IF NOT EXISTS items_by_did ON items(did)'
            )
            this.sql.exec(
                `CREATE INDEX IF NOT EXISTS items_by_coll
                    ON items(collection, time_us)`
            )
        })
        this.app = this.createRouter()
    }

    async fetch (request:Request):Promise<Response> {
        return this.app.fetch(request)
    }

    private async getCursor ():Promise<number|null> {
        return (await this.ctx.storage.get<number>(CURSOR_KEY)) ?? null
    }

    private async setCursor (next:number):Promise<void> {
        await this.ctx.storage.put(CURSOR_KEY, next)
    }

    private createRouter ():Hono {
        const app = new Hono()

        // Scaffolding route used by later dev verification (Phases 5–6).
        // Its behavioral test lands with the Phase 6 read API.
        app.get('/internal/index/stats', async (c) => {
            const count = Number(
                (this.sql.exec('SELECT count(*) AS c FROM items')
                    .one() as { c:number|string }).c
            )
            const cursor = await this.getCursor()
            return c.json({ items: count, cursor })
        })

        return app
    }
}
```

Notes for the implementer:
- `SqlStorage`, `DurableObjectState` are ambient global types (from
  `worker-configuration.d.ts`) — no import needed, same as `registry.ts`.
- `getCursor`/`setCursor` are `private` and currently only consumed by the
  stats route; Phase 5 (`runDrain`) is their primary consumer. Leaving them
  `private` now is fine — they are exercised within the class. If the linter
  flags `setCursor` as unused in this phase, keep it (Phase 5 uses it) and, if
  required to satisfy lint in isolation, the stats route already references
  `getCursor`; do not delete `setCursor`.
- `.one()` here is the sanctioned use (a `count(*)` always returns exactly one
  row), matching the project convention in `CLAUDE.md`.

**Step 1: Create the file** with the content above.

**Step 2: Verify operationally**

Run: `npm run typecheck`
Expected: `tsc --noEmit` passes with no errors.

Run: `npm run lint`
Expected: eslint passes (no errors).

**Step 3: Commit**

```bash
git add src/server/durable-objects/indexer.ts
git commit -m "feat: add RsssIndexerDO scaffold with items index schema"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Register the INDEXER_DO binding and v5 migration

**Files:**
- Modify: `wrangler.jsonc` (three blocks: top-level, `env.staging`,
  `env.production`)

**Implementation:**

The top-level, `env.staging`, and `env.production` blocks each FULLY redeclare
`durable_objects.bindings` and `migrations` (they do not inherit). Update all
three. Leave v1–v4 byte-for-byte intact.

In each `durable_objects.bindings` array (top-level near `:14-25`, staging near
`:152-163`, production near `:233-243`), add after the `REGISTRY_DO` binding:

```jsonc
            {
                "name": "INDEXER_DO",
                "class_name": "RsssIndexerDO"
            }
```

In each `migrations` array (top-level near `:42-62`, staging near `:164-184`,
production near `:245-265`), append after the `v4` entry:

```jsonc
        {
            "tag": "v5",
            "new_sqlite_classes": ["RsssIndexerDO"]
        }
```

(Indentation: match the surrounding block — top-level uses one tab less than the
`env.*` blocks. Mirror the adjacent `v4`/`REGISTRY_DO` entries exactly.)

**Step 1: Edit all three blocks** as above.

**Step 2: Verify operationally**

Run: `npm run typecheck`
Expected: passes (no TS impact, but confirms nothing broke).

Run (if available offline): `npx wrangler deploy --dry-run --outdir /tmp/wr-dry`
Expected: config parses; the new binding/migration are accepted. If this command
needs network/auth and cannot run locally, skip it — Task 3's typecheck plus the
JSON validity are sufficient for this phase. Do NOT run a real `wrangler deploy`.

**Step 3: Commit**

```bash
git add wrangler.jsonc
git commit -m "chore: bind INDEXER_DO and add v5 sqlite migration"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire the worker entry (Env, import, accessor, class export)

**Files:**
- Modify: `src/server/index.ts`

**Implementation:**

Four edits, mirroring how `RsssRegistryDO` is wired:

1. Import the DO base class (near the existing DO imports, `:16-22`):

```ts
import {
    RsssIndexerDO as RsssIndexerDOBase
} from './durable-objects/indexer.js'
```

2. Add the binding to the `Env` interface (near `:88`, after `REGISTRY_DO`):

```ts
    INDEXER_DO?:DurableObjectNamespace<RsssIndexerDOBase>;
```

3. Add a singleton accessor next to `getRegistryDO` (near `:980-986`). Note the
   singleton name is `'rsss-indexer'` (per `specs/scheduled-drain.md`), not
   `'global'`:

```ts
function getIndexerDO (
    env:Env
):DurableObjectStub<RsssIndexerDOBase>|null {
    if (!env.INDEXER_DO) return null
    const id = env.INDEXER_DO.idFromName('rsss-indexer')
    return env.INDEXER_DO.get(id)
}
```

4. Re-export the class by name so Wrangler can resolve it (near the other DO
   re-exports, `:2567`). No Sentry wrapper — the indexer DO is intentionally NOT
   Sentry-instrumented (it is a background drain that surfaces failures via
   `console.error`); this is a conscious choice matching the plain
   `RsssRegistryDO` re-export, even though `IndexerEnv` carries `SENTRY_DSN?`.
   Mirror `RsssRegistryDO`:

```ts
// Wrangler resolves by export name — keep this named `RsssIndexerDO`.
export const RsssIndexerDO = RsssIndexerDOBase
```

Notes for the implementer:
- `getIndexerDO` is unused until Phase 5/6 wires worker routes to it. If eslint
  flags it as unused in this phase, prefix the declaration with an
  eslint-disable-next-line `@typescript-eslint/no-unused-vars` ONLY IF the
  project's eslint config errors on unused functions; otherwise leave as-is.
  Confirm by running lint. (Phase 5 removes the need for any suppression.)
- Use the `.js` extension in the import specifier to match the existing
  `./durable-objects/registry.js` / `./durable-objects/index.js` imports.

**Step 1: Apply the four edits.**

**Step 2: Verify operationally**

Run: `npm run typecheck`
Expected: passes — `INDEXER_DO` typechecks against the new base class.

Run: `npm run lint`
Expected: passes.

**Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: wire INDEXER_DO binding and getIndexerDO accessor"
```
<!-- END_TASK_3 -->

---

## Phase 1 done when

- `src/server/durable-objects/indexer.ts` exists and exports `RsssIndexerDO`
  with the `items` schema (+ two indexes) created in `blockConcurrencyWhile`,
  cursor get/set helpers, and a stats route.
- `wrangler.jsonc` registers `INDEXER_DO` → `RsssIndexerDO` and a `v5`
  `new_sqlite_classes` migration in all three blocks (top-level, staging,
  production); v1–v4 untouched.
- `src/server/index.ts` imports, types (`Env.INDEXER_DO`), accesses
  (`getIndexerDO`, `idFromName('rsss-indexer')`), and re-exports the class.
- `npm run typecheck` and `npm run lint` both pass.
