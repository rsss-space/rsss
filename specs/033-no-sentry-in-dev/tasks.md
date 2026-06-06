---
description: "Task list for feature 033-no-sentry-in-dev"
---

# Tasks: Sentry should not log things in dev mode

**Input**: Design documents from `/specs/033-no-sentry-in-dev/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md (N/A —
no entities), contracts/sentry-env-gating.md, quickstart.md

**Tests**: This feature is **test-only — no production code change** (plan.md
"Summary"; research.md "Decision: regression tests only, option 2"). The
regression tests ARE the deliverable, so the tasks below are the test tasks.
They pin existing, already-correct behavior; they should pass against the
current code and FAIL only if the wiring is later regressed (see T012).

**Organization**: Grouped by user story. US1 and US2 are both P1 and both edit
the single new file `test/sentry-wiring.ts`, so within that file they are
sequential (no `[P]` between them); US3 touches a different test.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are exact and relative to repo root `/Users/nick/code/rsss/`

## Path Conventions

Web app (Cloudflare worker/DO backend + Preact SPA). Touched files are
test-harness only:

- `test/sentry-cloudflare-stub.ts` — esbuild alias target for
  `@sentry/cloudflare` in worker/DO test bundles (extended, additive).
- `test/sentry-wiring.ts` — NEW regression suite.
- `test/run-all-tests.mjs`, `package.json` — runner registration.
- No `src/` changes (plan.md "What MUST NOT change").

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the build/run entry point both P1 stories execute through.

- [X] T001 Add a `test:sentry-wiring` script to `package.json` `scripts`,
  mirroring `test:api-router`: bundle `./test/sentry-wiring.ts` with esbuild
  (`--bundle --loader:.wasm=dataurl`,
  `--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts`,
  `--alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts`) piped to
  `tapout`. (Quickstart documents `npm run test:sentry-wiring`.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Capture the real worker/DO option callbacks and stand up the
suite skeleton that all per-story assertions extend.

**⚠️ CRITICAL**: US1, US2, and the smoke guard all depend on Phase 2.

- [X] T002 Extend `test/sentry-cloudflare-stub.ts` (additive only): have
  `withSentry` and `instrumentDurableObjectWithSentry` record the
  `optionsCallback` they receive into module-level slots; export
  `getWorkerSentryOptionsCallback()`, `getDOSentryOptionsCallback()`, and
  `resetCapturedSentryCallbacks()`. Keep the existing pass-through return
  values and every existing export unchanged so current consumers
  (`test:browser`, `test:api-router`, `test:report-error`, the
  `test/index.ts` bundle) are unaffected.
- [X] T003 Create `test/sentry-wiring.ts`: import the worker default export
  and `RsssUserDO` from `../src/server/index.js` (this triggers `withSentry` /
  `instrumentDurableObjectWithSentry` at module load and populates the
  captured callbacks), import the three getters from
  `./sentry-cloudflare-stub.js`, define `const DSN =
  'https://public@o0.ingest.sentry.io/0'`, and add a smoke `test(...)`
  asserting both captured callbacks are functions (proves the worker and DO
  are wired to a callback at all — contract "Wiring guarantees").
- [X] T004 Register the suite in `test/run-all-tests.mjs` by adding
  `'npm run test:sentry-wiring'` to the "kept separate" group next to
  `'npm run test:api-router'` (it imports the worker and mutates shared
  singletons, so it must run in its own bundle, not the consolidated one).

**Checkpoint**: `npm run test:sentry-wiring` runs and the smoke test passes.

---

## Phase 3: User Story 1 - Local errors never reach the dashboard (Priority: P1) 🎯 MVP

**Goal**: Prove that in local dev (and unset `NODE_ENV`) the real worker and
DO option callbacks yield `dsn: undefined` and omit `tracesSampleRate`, even
when a valid `SENTRY_DSN` is present — so no errors, traces, spans, or replays
can be transmitted (FR-001, FR-002, FR-003, FR-004, FR-007).

**Independent Test**: `npm run test:sentry-wiring` passes; reverting the
wiring to leak the DSN in dev (T012) makes exactly these assertions fail.

### Implementation for User Story 1

- [X] T005 [US1] In `test/sentry-wiring.ts`, add a test on the captured
  **worker** callback for `{ NODE_ENV: 'development', SENTRY_DSN: DSN }`:
  assert `cb(devEnv).dsn === undefined` and
  `'tracesSampleRate' in cb(devEnv) === false` (FR-001, FR-004, FR-007;
  contract `development` row).
- [X] T006 [US1] In `test/sentry-wiring.ts`, add the same dev-env assertions
  on the captured **DO** callback (`dsn === undefined`, no `tracesSampleRate`)
  so the stateful surface is covered, not just the request handler
  (FR-002, FR-003).
- [X] T007 [US1] In `test/sentry-wiring.ts`, add assertions for **unset**
  `NODE_ENV` (`{ SENTRY_DSN: DSN }`) on both worker and DO callbacks:
  `dsn === undefined` and `'tracesSampleRate' in opts === false` (contract
  `unset` row; edge case "labeled development").

**Checkpoint**: US1 fully covers local suppression across worker + DO.

---

## Phase 4: User Story 2 - Deployed environments keep reporting (Priority: P1)

**Goal**: Prove the same real callbacks still emit the DSN and correct
`tracesSampleRate` in production and staging, guarding against a suppression
change that silences deployed reporting (FR-005).

**Independent Test**: `npm run test:sentry-wiring` passes the
production/staging assertions; they fail if a builder change drops the DSN or
sample rate in deployed envs.

### Implementation for User Story 2

- [X] T008 [US2] In `test/sentry-wiring.ts`, add a test on the captured
  **worker** callback: `{ NODE_ENV: 'production', SENTRY_DSN: DSN }` →
  `dsn === DSN`, `tracesSampleRate === 0.2`; and
  `{ NODE_ENV: 'staging', SENTRY_DSN: DSN }` → `dsn === DSN`,
  `tracesSampleRate === 1.0` (FR-005; contract `production`/`staging` rows).
- [X] T009 [US2] In `test/sentry-wiring.ts`, add the same production/staging
  assertions on the captured **DO** callback (FR-003, FR-005).
- [X] T010 [US2] In `test/sentry-wiring.ts`, add a test asserting the worker
  and DO callbacks return deep-equal options for every env (`production`,
  `staging`, `development`, unset), so the two surfaces cannot drift
  (contract "Wiring guarantees" item 2).

**Checkpoint**: US1 + US2 together pin the full env → options contract for
both runtime surfaces.

---

## Phase 5: User Story 3 - Developers still see local errors (Priority: P2)

**Goal**: Confirm `reportError` still writes to `console.error` in dev, so
suppression does not reduce local debugging visibility (FR-006).

**Independent Test**: `npm run test:report-error` passes its
`console.error` assertion.

### Implementation for User Story 3

- [X] T011 [US3] Verify `test/report-error.ts` asserts `reportError` writes to
  `console.error` (it currently overrides `console.error` at ~lines 10-33 and
  checks it is called). Confirm `test:report-error` stays registered in
  `test/run-all-tests.mjs`. If the `console.error` assertion is absent or
  weakened, add an explicit assertion that a reported error still reaches
  `console.error`; otherwise no code change is needed and this task is a
  documented verification (FR-006).

**Checkpoint**: All three stories independently covered.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T012 Prove the regression guard has teeth: temporarily edit
  `src/server/index.ts` so `getSentryOptions`/`getDOSentryOptions` return the
  DSN in dev (e.g. `(env) => ({ dsn: env.SENTRY_DSN })`), run
  `npm run test:sentry-wiring`, confirm the US1 dev assertions (T005-T007)
  FAIL, then **revert** the edit and confirm the suite passes again. This is
  the whole point per research.md ("the wiring is untested"); leave no edit
  behind.
- [ ] T013 [P] Run the quickstart manual verification (spec Independent Tests
  for US1/US3): with a real `SENTRY_DSN` in `.dev.vars`, `npm start`, trigger
  an error, confirm no event appears in the Sentry dashboard for the
  development environment and the error still prints to the local
  console/`wrangler` output.
- [X] T014 Run the full project gate `npm test && npm run lint` and confirm
  green — verifying the additive stub change broke no existing suite and that
  no production source was modified (`git diff --stat` shows only `test/` and
  `package.json`).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1, T001)**: No dependencies — start immediately.
- **Foundational (Phase 2, T002-T004)**: T003 depends on T002 (getters);
  T004 depends on T001 (script) and T003 (file exists). BLOCKS all stories.
- **US1 (Phase 3)**, **US2 (Phase 4)**: depend on Phase 2. Both edit
  `test/sentry-wiring.ts`, so they are sequential with each other within that
  file (not parallel), even though both are P1.
- **US3 (Phase 5, T011)**: independent of US1/US2 (different file); depends
  only on the repo as-is.
- **Polish (Phase 6)**: T012 and T014 depend on US1+US2 being in place; T013
  is manual and can run any time after the code already behaves correctly.

### Within Each User Story

- US1: T005 → T006 → T007 (same file, sequential edits).
- US2: T008 → T009 → T010 (same file, sequential edits).

### Parallel Opportunities

- US3 (T011) can proceed in parallel with the US1/US2 work — different file.
- T013 (manual verification) is independent `[P]` of the automated tasks.
- Within US1 and within US2, tasks are NOT parallel: they edit the single
  file `test/sentry-wiring.ts`.

---

## Parallel Example

```bash
# After Phase 2, the cross-file work that can run concurrently:
Task: "US3 — verify console.error assertion in test/report-error.ts (T011)"
Task: "Manual quickstart verification with real SENTRY_DSN (T013)"
# Meanwhile one engineer drives US1 then US2 edits in test/sentry-wiring.ts.
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: add the `test:sentry-wiring` script (T001).
2. Phase 2: capture callbacks in the stub + suite skeleton + runner
   registration (T002-T004) — CRITICAL, blocks the stories.
3. Phase 3: dev/unset assertions (T005-T007).
4. **STOP and VALIDATE**: `npm run test:sentry-wiring` passes; run T012 to
   confirm the dev assertions actually fail on a simulated regression, then
   revert. That alone delivers the core "no local noise" guarantee.

### Incremental Delivery

1. Setup + Foundational → suite runs (smoke).
2. US1 → local suppression pinned (MVP).
3. US2 → deployed-reporting guardrail pinned.
4. US3 → confirm local console visibility retained.
5. Polish → prove teeth (T012), manual check (T013), full gate (T014).

---

## Notes

- Entire feature is test-only; `data-model.md` is N/A (no entities).
- The new assertions pin **current, correct** behavior — they go green
  immediately. Their value is failing on a future regression, which T012
  verifies empirically.
- Keep TS style: no space before type annotations, ≤80 columns.
- Do NOT add a brittle browser/source-text test for `client/sentry.ts`
  (research.md "Decision: do not add a brittle client-side test"); the dev
  bundle never calls `Sentry.init()` because it is gated on
  `import.meta.env.PROD`, a build-time constant — covered by construction.
- Commit after each logical group; the only non-`test/` change is the
  `package.json` script (T001).
