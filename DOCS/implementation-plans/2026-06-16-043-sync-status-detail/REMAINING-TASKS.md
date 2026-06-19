# sync-status-detail — Remaining Tasks

_Snapshot of execution state for `/sync-status` feature (plan dir:
`DOCS/implementation-plans/2026-06-16-043-sync-status-detail/`)._

## Current state (verified)

- Branch: `error-states`, tip `9144d73`, working tree clean.
- All 6 phases implemented, each per-phase code-reviewed and APPROVED.
- Final holistic code review: APPROVED (zero issues, full AC1.1–AC11.2
  coverage confirmed).
- `npm run test:browser`: exit 0, `# ok`, **1287 tests pass** (3x clean,
  no flaking).
- `npm run lint`: exit 0.
- Project context (`CLAUDE.md`) updated by the librarian (commit
  `94aaadd`, now in branch history): two durable contracts added
  (dead-letter requeue atomicity; `refreshDeadLetterCounts` must not
  clobber a transient `syncError`).

## Remaining tasks

### 1. Finalize: test analysis (IN PROGRESS — re-run was interrupted)

- `test-analyst` was re-dispatched to re-validate coverage at `9144d73`
  after the two coverage gaps were fixed (commit `9144d73`). The run was
  interrupted before returning.
- First pass returned **FAIL** with two gaps; both are now fixed by
  `9144d73`:
  - AC11.2: dead-letter `.discard-btn` enabled-while-offline — added
    (`test/sync-status-feeds.ts` ~1045-1092).
  - AC3.5: `.feeds-publish-failed` omitted when empty — added
    (`test/sync-status-feeds.ts` ~922-970).
  - AC11.1 also tightened to assert both retry buttons disabled offline
    (~972-1043).
- **Action:** re-run `test-analyst` against
  `test-requirements.md` (BASE 700bed8, HEAD = current). Expect PASS now.
  If PASS, extract the "Human Test Plan" section and write it to
  `DOCS/test-plans/2026-06-16-043-sync-status-detail.md`, then commit
  (`docs: add test plan for sync-status-detail`).
- Human-only items the plan should cover (manual, out of automation
  scope): screen-reader voicing of the `role="status"`/`aria-live`
  region (AC9.1/9.2); real keyboard focus experience on row removal
  (AC9.3); full re-auth OAuth round-trip from the reauth link (AC10.2);
  real-network retry-fetch / retry-share behavior (tests stub the server
  round-trip).

### 2. Finalize: completion report + finishing-a-development-branch

- Provide the completion report (per phase: tasks implemented, review
  cycles, any compromises).
- Then activate the `finishing-a-development-branch` skill (merge / PR /
  cleanup decision). Do NOT activate it before the test plan is written.

## Important notes / flags for the user

- **Lost pre-existing change:** the uncommitted `M README.md` edit present
  at session start was discarded by a code-reviewer subagent's
  `git checkout a966005` (run for an email-suite counterfactual). It was
  never committed or stashed, so it is unrecoverable. Unrelated to this
  feature.
- **Detached-HEAD recovery:** that same subagent checkout left HEAD
  detached at `a966005`; Phase 5-fix and Phase 6 commits (`ee63adf`,
  `644704f`, `2aa9075`) landed off-branch. Recovered non-destructively by
  cherry-picking them onto `error-states` (now `d1ef9e5`, `d09884d`,
  `37c1e6f`). All work is on the branch; verified by content + green suite.
- **Pre-existing `npm test` failure (NOT this feature):** the full
  `node test/run-all-tests.mjs` gate fails in `test/email.ts`
  ("retries once after transient Resend failure") — a deliberate
  transient-failure simulation that logs `console.error`, tripping
  tapout's heuristic. Confirmed pre-existing (reproduces on the base; this
  branch's diff touches no email/server files). The authoritative gate for
  this feature is `npm run test:browser` + `npm run lint` (both green).
  Worth tracking/fixing separately.

## Quick verification commands

```sh
git -C /Users/nick/code/rsss rev-parse --abbrev-ref HEAD   # error-states
npm run test:browser   # exit 0, # ok, 1287 tests
npm run lint           # exit 0
```
