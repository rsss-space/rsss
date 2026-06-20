# Scheduled-drain ingestion — Phase 2: Record validation (isValidRecord)

**Goal:** Provide `isValidRecord(collection, record)` — the App View's
defensive validation boundary — so the drain can drop off-lexicon and
unknown-collection records before indexing them.

**Architecture:** A pure function in `src/shared/lexicons/`, validating an
untrusted record against the existing hand-written `rsssLexicons`
representation. Shared so it serves both the App View (defensive, Phase 3) and
the frontend's optimistic pre-write check (`specs/README.md`).

**Tech Stack:** TypeScript (ES2022, shared module — runs on both Workers and
browser), `@substrate-system/tapzero` tests via esbuild → node → tap-spec.

**Scope:** Phase 2 of 6 (scheduled-drain ingestion).

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

This phase implements and tests `scheduled-drain.AC1` (record validation). These
criteria are derived from the spec's validation boundary
(`specs/scheduled-drain.md` "Per-event handling" and `specs/README.md` "The App
View"), which states off-lexicon records must be dropped, never indexed.

Validation policy (approved): **lenient** — strict on required-field
presence/type, `$type` consistency, and declared-property type; tolerant of
extra undeclared keys; string `format` (uri/did/datetime) is NOT enforced this
phase (a documented future tightening).

### scheduled-drain.AC1: Record validation
- **scheduled-drain.AC1.1 Success:** a `space.rsss.feed.subscription` record
  with string `feedUrl` and `createdAt` is valid.
- **scheduled-drain.AC1.2 Success:** a `space.rsss.graph.follow` record with
  string `subject` and `createdAt` is valid.
- **scheduled-drain.AC1.3 Failure:** an unknown collection (e.g.
  `space.rsss.post`) is invalid (dropped).
- **scheduled-drain.AC1.4 Failure:** a known collection missing a required
  field is invalid.
- **scheduled-drain.AC1.5 Failure:** a record whose `$type` is present but does
  not equal the collection is invalid.
- **scheduled-drain.AC1.6 Failure:** a non-object record (`null`, array,
  string, number) is invalid.
- **scheduled-drain.AC1.7 Failure:** a declared property present with a
  non-string value (e.g. `feedUrl: 123`) is invalid.
- **scheduled-drain.AC1.8 Lenient:** a record with all required fields plus
  extra undeclared keys is valid.
- **scheduled-drain.AC1.9 Optional property typed:** a
  `space.rsss.feed.subscription` record with a valid optional `title` (string)
  is valid; the same record with `title: 123` is invalid (exercises the
  declared-but-optional property type branch — `feed.subscription` declares
  optional `title` and `siteUrl`).

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Implement isValidRecord

**Verifies:** scheduled-drain.AC1.1–AC1.9

**Files:**
- Create: `src/shared/lexicons/validate.ts`

**Implementation:**

```ts
import { rsssLexicons } from './index.js'

const byCollection = new Map(
    rsssLexicons.map((doc) => [doc.id, doc])
)

export function isValidRecord (
    collection:string,
    record:unknown
):boolean {
    const doc = byCollection.get(collection)
    if (!doc) return false  // unknown collection -> drop

    if (typeof record !== 'object' || record === null ||
        Array.isArray(record)
    ) {
        return false
    }
    const rec = record as Record<string, unknown>

    // $type, when present, must name this collection.
    if ('$type' in rec && rec.$type !== collection) return false

    const { required, properties } = doc.defs.main.record

    // Required fields must be present and well-typed (non-empty string).
    for (const field of required) {
        const value = rec[field]
        if (typeof value !== 'string' || value.length === 0) return false
    }

    // Declared properties present must match their declared type (all
    // space.rsss.* properties are strings today). Unknown/extra keys are
    // tolerated — the lexicon's property set is not exhaustive of a record.
    for (const [key, prop] of Object.entries(properties)) {
        if (key in rec && rec[key] !== undefined &&
            prop.type === 'string' && typeof rec[key] !== 'string'
        ) {
            return false
        }
    }

    return true
}
```

Notes:
- `rsssLexicons` is `as const`, so `doc.id`, `required`, and `properties` are
  precisely typed. `prop.type` is the literal `'string'` today; the explicit
  `prop.type === 'string'` guard future-proofs added non-string types.
- Do NOT enforce string `format` here (uri/did/datetime). That is a deliberate
  future tightening, recorded in the design.
- `byCollection`'s value type is a UNION of the two `as const` doc literal
  types; the `const { required, properties } = doc.defs.main.record` destructure
  and the `Object.entries(properties)` loop rely on both members sharing
  `required:readonly string[]` and `properties:Record<string,
  LexiconStringProperty>` from `LexiconRecordDefinition` (they do). Because the
  whole-project typecheck gate is red on baseline (see Verification gate),
  confirm `validate.ts` itself introduces no new type error after creating it
  (it must not appear in the `npm run typecheck` error list).

**Step 1:** Create the file with the content above.

**Step 2: Verify operationally**

Run: `npm run typecheck`  → passes.
Run: `npm run lint`       → passes.

**Step 3: Commit**

```bash
git add src/shared/lexicons/validate.ts
git commit -m "feat: add isValidRecord lexicon validation boundary"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for isValidRecord

**Verifies:** scheduled-drain.AC1.1–AC1.9

**Files:**
- Create: `test/lexicon-validate.ts` (unit)
- Modify: `test/run-all-tests.mjs` (register the new suite)

**Testing:**

Author with the project idiom (mirror `test/helpers/sql-fake.test.ts`):
`import { test } from '@substrate-system/tapzero'`, one `test('scheduled-drain.AC1.x: …', (t) => …)`
per case. The task-implementor writes the actual assertions at execution time;
each test must verify its AC case against the real `isValidRecord` export
(no mocks — it's a pure function):

- AC1.1: valid `space.rsss.feed.subscription` (feedUrl + createdAt strings) →
  `true`.
- AC1.2: valid `space.rsss.graph.follow` (subject + createdAt strings) → `true`.
- AC1.3: `isValidRecord('space.rsss.post', {...})` → `false`.
- AC1.4: subscription record missing `createdAt` → `false`.
- AC1.5: subscription record with `$type: 'space.rsss.graph.follow'` (≠
  collection) → `false`.
- AC1.6: `null`, `[]`, `'x'`, `42` each → `false`.
- AC1.7: subscription record with `feedUrl: 123` → `false`.
- AC1.8: subscription record with required fields + an extra `note: 'hi'` key →
  `true`.
- AC1.9: subscription record with required fields + a valid optional
  `title: 'My feed'` → `true`; the same record with `title: 123` → `false`.

Register in `test/run-all-tests.mjs`, in the "node-platform tests" section
(after the existing `esbuild … | node … | tap-spec` entries), with NO
cloudflare alias (pure shared module):

```js
    [
        'esbuild ./test/lexicon-validate.ts --bundle',
        '--platform=node --format=esm',
        '| node --input-type=module | tap-spec'
    ].join(' '),
```

**Verification:**

Run: `npm test`
Expected: the new `lexicon-validate` suite runs and all AC1.x assertions pass;
the full run stays green (no console.error anywhere — a console.error fails the
run even with green TAP).

Run: `npm run typecheck` && `npm run lint`  → pass.

**Commit:** `test: cover isValidRecord (scheduled-drain.AC1)`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

---

## Phase 2 done when

- `src/shared/lexicons/validate.ts` exports `isValidRecord(collection, record)`
  with the lenient contract above.
- `test/lexicon-validate.ts` covers AC1.1–AC1.9 and is registered in
  `test/run-all-tests.mjs`.
- `npm test`, `npm run typecheck`, and `npm run lint` all pass.
