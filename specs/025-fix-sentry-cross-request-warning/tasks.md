# Tasks: Fix Sentry Cross-Request Promise Warning on Blog Post Navigation

**Input**: Design documents from `/specs/025-fix-sentry-cross-request-warning/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/observability-config.md, quickstart.md

**Tests**: One unit test is included because the feature spec and research
(Decision 3) explicitly require locking the options-builder invariant matrix
against regression. The Workers-runtime warning itself is verified manually
(quickstart.md), since it is awkward to assert in an automated test.

**Organization**: Tasks are grouped by user story. The two code changes are
complementary per research.md: the dependency bump (Decision 1) fixes the
DSN-present/deployed path (US2); gating `tracesSampleRate` on DSN presence
(Decision 2) removes the DSN-absent/dev path's spans (US1).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Edge web service: worker + Durable Object under `src/server/`, Preact SPA
under `src/client/`, esbuild + tapout tests under `test/`. Paths below are
repository-root relative.

---

## Phase 1: Setup (Shared Pre-Work)

**Purpose**: Capture the failing baseline so the fix can be proven.

- [ ] T001 Reproduce the warning baseline per
  `specs/025-fix-sentry-cross-request-warning/quickstart.md` ("Reproduce"):
  run `npm start` (Vite on `http://127.0.0.1:5555`), navigate to
  `http://127.0.0.1:5555/post/brittanyellich.com/web-dev-challenge`, and
  record the `@sentry/cloudflare` cross-request warning
  (`_resolveSpanCompletion` / `SentrySpan.end`) in the dev terminal as
  before-state evidence.

---

## Phase 2: Foundational (Blocking Prerequisite)

**Purpose**: Land the upstream root-cause SDK upgrade. This is the shared
prerequisite — US2 is delivered by it directly, and US1/US3 must be
validated against the supported SDK version.

**⚠️ CRITICAL**: Complete this phase before validating any user story.

- [X] T002 Bump `@sentry/cloudflare` and `@sentry/browser` from `^10.53.1`
  to `^10.55.0` in `package.json` (lines 63-64, the two `@sentry/*` runtime
  deps; keep them in lockstep so they share one `@sentry/core`). Do NOT
  change `@sentry/vite-plugin`.
- [X] T003 Run `npm install` to regenerate `package-lock.json`, then verify
  both packages resolve to `10.55.x` via
  `npm ls @sentry/cloudflare @sentry/browser` (depends on T002).

**Checkpoint**: Supported SDK installed — user story work can proceed.

---

## Phase 3: User Story 1 - Clean logs when opening a blog post (Priority: P1) 🎯 MVP

**Goal**: Navigating to a blog post item page emits zero "different request
context" / "continuations ... canceled" warnings in the dev terminal.

**Independent Test**: Start the app locally, open several blog post item
URLs (cached + uncached + reloads) including the reported URL, and confirm
the terminal stays free of the cross-request promise warning while pages
serve normally.

- [X] T004 [US1] Create the pure options-builder module
  `src/server/sentry-options.ts`: move `isSentryEnv` out of
  `src/server/index.ts` (currently ~line 2057) and export it, and export
  `buildSentryOptions(env:{ NODE_ENV?:string; SENTRY_DSN?:string })`
  returning `{ dsn, environment, sendDefaultPii:false }` and adding a
  `tracesSampleRate` key ONLY when `isSentryEnv(env.NODE_ENV)` is true
  (`0.2` for `production`, otherwise `1.0`); when there is no DSN the
  `tracesSampleRate` key is omitted entirely (INV-1, INV-2, INV-3). Keep
  the module free of `@sentry/*` and `cloudflare:workers` imports so it is
  trivially unit-testable. Follow 80-col / no-space-before-type TS style.
- [X] T005 [US1] Wire `src/server/index.ts` to the builder (depends on
  T004): import `isSentryEnv` and `buildSentryOptions` from
  `./sentry-options`; replace the bodies of `getSentryOptions` (~line 2061)
  and `getDOSentryOptions` (~line 2069) to delegate to `buildSentryOptions`
  (single source for both worker and DO — INV-4); remove the now-duplicated
  local `isSentryEnv` definition and the unconditional
  `tracesSampleRate: env.NODE_ENV === 'production' ? 0.2 : 1.0`. Leave
  `withSentry` / `instrumentDurableObjectWithSentry` wiring (~lines
  2078-2084) unchanged in shape.
- [X] T006 [P] [US1] Add the options-builder unit test
  `test/sentry-options.ts` (depends on T004; different file from T005, so
  parallel) asserting the full behavior matrix from
  `contracts/observability-config.md`: `production` -> `dsn` set +
  `tracesSampleRate` `0.2`; `staging` -> `dsn` set + `1.0`; unset/dev ->
  `dsn` `undefined` + `tracesSampleRate` key **absent** (assert
  `!('tracesSampleRate' in opts)`, not `=== 0`); `sendDefaultPii` always
  `false`; worker and DO builders agree for the same env (INV-1..INV-4).
  Register it in `test/run-all-tests.mjs` as
  `esbuild ./test/sentry-options.ts --bundle | tapout`. Do not assert HTML
  or doc text.
- [ ] T007 [US1] Live terminal verification (SC-001, SC-004) per
  `quickstart.md` section A (depends on T005): `npm start`, open 10+ blog
  post item pages (mix of first-visit/uncached, revisited/cached, and hard
  reloads, including
  `/post/brittanyellich.com/web-dev-challenge`), and confirm **zero**
  cross-request promise warnings across all navigations.

**Checkpoint**: Dev terminal is clean on blog post navigation — MVP done.

---

## Phase 4: User Story 2 - Request-scoped async work completes safely (Priority: P2)

**Goal**: On the DSN-present (deployed) path, span-completion continuations
stay tied to their originating request and are not cancelled.

**Independent Test**: Exercise the blog-post path with the upgraded SDK and
confirm no per-request continuation is reported as cancelled, without
changing rendered output.

**Note**: The code for this story is the foundational upgrade (T002-T003) —
`@sentry/cloudflare` `10.55.0` ships `#21197` ("Use original waitUntil to
not create a deadlock"), the root-cause fix for the DSN-present path. This
phase verifies it.

- [ ] T008 [US2] Verify continuation safety on the DSN-present path (SC-004,
  FR-002, FR-005; depends on T003): confirm the installed
  `@sentry/cloudflare` is `10.55.x` (contains `#21197`, `#21156`, `#20889`),
  and that span completion no longer reports cancelled continuations.
  Document evidence per `quickstart.md` (the dev run from T007 already
  exercises the wrapped-`waitUntil` path; record that no
  "continuations ... canceled" message appears).

**Checkpoint**: Async span work is tied to its request lifecycle.

---

## Phase 5: User Story 3 - No regression in blog post rendering (Priority: P3)

**Goal**: Blog post pages render identically and deployed error/performance
telemetry is preserved.

**Independent Test**: Compare a blog post page before/after (content,
navigation, load) and confirm deployed sample rates are unchanged.

- [ ] T009 [US3] No-rendering-regression check (SC-002, FR-003) per
  `quickstart.md` section B: open the same blog post item pages used in the
  baseline and confirm content, layout, thumbnails/images, and in-app
  navigation are unchanged from before the fix.
- [X] T010 [US3] Confirm deployed telemetry is preserved (SC-003, FR-004)
  via the `test/sentry-options.ts` invariants from T006: `production` keeps
  `tracesSampleRate: 0.2` and `staging` keeps `1.0`, both with a `dsn` set,
  and `sendDefaultPii` stays `false` — so deployed error + performance
  coverage is unchanged (depends on T006).

**Checkpoint**: No user-facing or telemetry regression.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final gates and guard against unintended surface changes.

- [ ] T011 [P] Run the full verification suite (Done criteria /
  `quickstart.md` section D): `npm test`, `npm run lint`,
  `npm run typecheck` — all pass, including the new `test/sentry-options.ts`.
- [X] T012 [P] Confirm unchanged non-contract surfaces: `package.json` bumped
  only the two runtime `@sentry/*` deps (no other `@sentry/*` change), and
  `src/client/instrument.ts` still gates browser init on
  `dsn && import.meta.env.PROD` (untouched). Verify edited TypeScript in
  `src/server/sentry-options.ts` and `src/server/index.ts` stays within
  80 columns with no space before type annotations.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: T001 baseline — no dependencies; do first.
- **Foundational (Phase 2)**: T002 -> T003. Blocks validation of all stories.
- **User Story 1 (Phase 3)**: T004 -> {T005, T006 [P]} -> T007. Needs
  Foundational complete for live validation (T007).
- **User Story 2 (Phase 4)**: T008 depends on Foundational (T003) and reuses
  the T007 dev run. Independent of US1 code changes.
- **User Story 3 (Phase 5)**: T009 independent (manual); T010 depends on T006.
- **Polish (Phase 6)**: T011, T012 after all code tasks (T004-T006) land.

### Story independence

- US1's code (gating in `src/server/`) and US2's code (the dep bump in
  `package.json`) are in different files and are conceptually independent —
  US1 fixes the dev path, US2 the deployed path.
- US3 is a guard: its automated half (T010) reuses the US1 test (T006); its
  manual half (T009) is independent.

### Within-story parallel opportunities

- T005 (edit `src/server/index.ts`) and T006 (add `test/sentry-options.ts`
  + register in `test/run-all-tests.mjs`) are different files and both only
  depend on T004 — run in parallel.
- T011 and T012 (final gates) touch nothing — run in parallel.

```
# After T004, launch T005 and T006 together:
T005  Wire src/server/index.ts -> ./sentry-options (getSentryOptions/getDOSentryOptions)
T006  Add test/sentry-options.ts + register in test/run-all-tests.mjs
```

---

## Implementation Strategy

### MVP (User Story 1 only)

Foundational (T002-T003) + US1 (T004-T007) is a complete, shippable
increment: it eliminates the reported dev-terminal warning (SC-001/SC-004)
and locks the invariant with an automated test. This is the recommended
first deliverable.

### Incremental delivery

1. Setup (T001) — capture baseline.
2. Foundational (T002-T003) — upgrade SDK.
3. US1 (T004-T007) — gate tracing on DSN; **MVP, dev terminal clean**.
4. US2 (T008) — verify deployed-path continuation safety.
5. US3 (T009-T010) — confirm no rendering/telemetry regression.
6. Polish (T011-T012) — full `npm test`/`lint`/`typecheck` + surface audit.

Each phase is independently checkpointed; stop after any checkpoint with a
coherent, verifiable state.
```
