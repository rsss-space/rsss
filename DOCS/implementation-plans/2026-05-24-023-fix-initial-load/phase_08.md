# Phase 8: Finalize — full AC test coverage, manual verification, cleanup

**Goal:** Backfill any acceptance criterion tests not landed in
earlier phases (notably AC7.* — third-party latency does not block
paint), run the full verification suite, perform manual end-to-end
verification per the project's `verify` skill, delete dead code
surfaced by Phase 7, and open the PR.

**Architecture:** No new behavior. This phase is verification +
cleanup. The biggest concrete code action is auditing and (if dead)
deleting `state.initialLoadComplete`, plus the `PageSkeleton` /
`ItemSkeleton` component files if Phase 7's removal made them
orphans.

**Tech Stack:** Existing.

**Scope:** Phase 8 of 8. Depends on Phases 1-7.

**Codebase verified:** 2026-05-25

**Key facts from investigation:**
- `state.initialLoadComplete` is set to `true` in
  `State.loadInitialView`'s `finally` block (`state.ts:780-782` as
  of 2026-05-25 — Phases 4-7 add new declarations and helpers
  earlier in the file, so these line numbers will shift by ~20-50
  lines by the time Phase 8 runs). The audit grep below is the
  authoritative way to find current line numbers; do not rely on
  the numbers cited here. After Phase 7 removes `pageReady`, the
  flag has no remaining reader on the hot path. Phase 8 audits the
  codebase for any straggling consumer (event handlers, components,
  tests) and either removes the flag or documents why it is kept
  (e.g., a test still asserts it, or a non-render side-effect reads
  it).
- `PageSkeleton` (`src/client/components/page-skeleton.ts`) and
  `ItemSkeleton` (`src/client/components/item-skeleton.ts`) had only
  one consumer each — `src/client/index.ts`. After Phase 7 removes
  those imports, the files become dead. Phase 8 deletes them.
- The project has a `verify` skill referenced from the global
  CLAUDE.md / system prompt. Phase 8 runs it for the manual checks
  required by AC1.*, AC5.*, AC7.*, AC8.* that cannot be expressed as
  unit tests.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 023-fix-initial-load.AC7: Third-party latency does not block paint
- **023-fix-initial-load.AC7.1 Success:** With `/api/billing/status`
  artificially delayed (5s stub), first paint of the home route still
  occurs within 1s of JS bundle execution (cached-data render path).
- **023-fix-initial-load.AC7.3 Failure:** Failure of
  `/api/billing/status` (503 response) does not prevent the shell
  from rendering or items from appearing.

(AC7.2 — `loadBillingStatus` not awaited on critical path — was
verified in Phase 6, Task 2.)

This phase also runs the end-to-end manual verification for AC1.*,
AC5.*, AC8.* and serves as the closing wrap-up for AC9.1.

---

<!-- START_TASK_1 -->
### Task 1: Add slow-billing integration test

**Verifies:** AC7.1, AC7.3

**Files:**
- Create: `test/paint-cache-slow-billing.ts`
- Modify: `package.json` (add the `test:` script)
- Modify: `test/run-all-tests.mjs` (add the new command)

**Testing:**

The test exercises the property: "first paint of items on the home
route does NOT depend on `/api/billing/status` resolving."

The exact testing strategy depends on what level of integration the
project supports. Two options — task-implementor picks based on
what's already in place:

**Option A (preferred, if `api` is stubbable):** Stub
`api.get('billing/status')` to return a promise that resolves after
5000ms (or never resolves). With a pre-populated paint cache,
construct an `AppState` via `State()`, call `hydratePaintCache`
synchronously, then assert that `state.feeds.value`,
`state.items.value`, and `state.counts.value` are populated *before*
the (still-pending) billing fetch resolves. Use the existing
`api` stubbing pattern from other tests (e.g., `test/sync.ts`).

**Option B (fallback):** Test the constraint structurally. Run

```bash
rg -n "await\\s+(State\\.)?loadBillingStatus" src/
rg -n "loadBillingStatus.*\\.then" src/
rg -n "await\\s+.*billing/status" src/
```

Assert (via a `node test/<name>.mjs` script) that each grep returns
zero matches. This proves no code path awaits the billing status
load. A static guarantee is weaker than a behavioral test but
inflicts no test-stub complexity.

The AC7.3 case (503 failure does not block) is verified by the same
test as AC7.1 — if the test does not await the request, neither a
slow response nor an error response can block.

Wire the new test script into `package.json` and
`test/run-all-tests.mjs` per the established convention.

**Verification:**

Run: `npm run test:paint-cache-slow-billing`
Expected: All tests pass.

Run: `npm test`
Expected: Full suite passes.

**Commit:**

```bash
git add test/paint-cache-slow-billing.ts package.json test/run-all-tests.mjs
git commit -m "test: 023 — billing-status latency does not block first paint

Part of 023-fix-initial-load."
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Audit and remove `state.initialLoadComplete`

**Verifies:** None (cleanup); supports AC1.* by removing dead
machinery that could re-introduce the bug.

**Files:**
- Modify: `src/client/state.ts` (remove signal declaration + the
  `finally` setter in `loadInitialView`)
- Modify: any other file flagged by the audit grep

**Implementation:**

1. Find every consumer:

   ```bash
   rg -n "initialLoadComplete" src/ test/
   ```

2. Classify each match (line numbers will have shifted from the
   pre-Phase-4 baseline cited below — use the current grep output,
   not the cited numbers):
   - **Declaration** in `state.ts` (was line 430 pre-Phase-4) —
     remove.
   - **Setter** in `state.ts` `loadInitialView` finally block (was
     lines 780-782 pre-Phase-4) — remove.
   - **Type / interface reference** in `AppState` definition (was
     around state.ts:382-432 pre-Phase-4) — remove.
   - **Test reference** — remove or update.
   - **Any other reader** — if found, evaluate whether it should
     read `paintCacheHydratedOnBootstrap` or
     `bootstrapInProgress` instead. Stop and surface to the user if
     unclear.

3. If grep finds zero non-declaration / non-setter readers, the
   removal is straightforward:
   - Remove the `initialLoadComplete: signal<boolean>(false)` line
     from the `state` object literal.
   - Remove the `if (!state.initialLoadComplete.value) {
     state.initialLoadComplete.value = true }` block from
     `loadInitialView`'s `finally`.
   - Remove the field from any `AppState` type alias if explicit.

If the audit surfaces a reader you cannot safely remove,
**leave `initialLoadComplete` in place** and document why in a
comment above the declaration. Don't force a partial cleanup.

**Verification:**

Run: `npm run typecheck`
Expected: Clean. Any error here is the audit catching a missed
consumer — handle it and re-run.

Run: `npm test`
Expected: All tests pass.

**Commit:**

```bash
git add src/client/state.ts test/
git commit -m "chore: remove dead state.initialLoadComplete signal

The pageReady gate that read this signal was removed in Phase 7.
Audit confirmed no remaining consumers; deleting the declaration
and the setter in loadInitialView's finally block.

Part of 023-fix-initial-load."
```

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Remove orphan skeleton components (if applicable)

**Verifies:** None (cleanup).

**Files:**
- Delete (conditional): `src/client/components/page-skeleton.ts`
- Delete (conditional): `src/client/components/page-skeleton.css`
  (if a sibling stylesheet exists)
- Delete (conditional): `src/client/components/item-skeleton.ts`
- Delete (conditional): `src/client/components/item-skeleton.css`
  (if a sibling stylesheet exists)

**Implementation:**

1. Confirm dead status:

   ```bash
   rg -n "PageSkeleton|ItemSkeleton|page-skeleton|item-skeleton" src/ test/
   ```

2. If no matches (Phase 7 removed the last consumers), delete the
   component files. Also check for and delete:
   - Sibling `.css` files in the same directory.
   - Any CSS `@import` of those stylesheets in
     `src/client/style.css` or per-route CSS.

3. If matches remain (e.g., another route still uses
   `ItemSkeleton`), leave the file in place.

**Verification:**

Run: `npm run typecheck && npm run lint && npm run stylelint`
Expected: All clean.

Run: `npm test`
Expected: All tests pass.

**Commit:**

```bash
git rm src/client/components/page-skeleton.ts \
       src/client/components/item-skeleton.ts
# Plus any sibling CSS files
git commit -m "chore: remove orphan skeleton components

Phase 7 removed the global pageReady render gate; PageSkeleton
and ItemSkeleton had no remaining consumers. Deleting the
component files.

Part of 023-fix-initial-load."
```

(Skip this task entirely if Task 3 step 1 finds remaining
consumers.)

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Full manual verification per the `verify` skill

**Verifies:** AC1.1, AC1.2, AC1.5, AC5.1-AC5.4, AC7.1, AC7.3, AC8.1,
AC8.2, AC8.3, AC9.1 (the integration-level checks not covered by
unit tests)

**Files:**
- Create: `DOCS/implementation-plans/2026-05-24-023-fix-initial-load/manual-verification.md`
  (or — if the project's `verify` skill specifies a different path —
  use that)

**Implementation:**

Use the project's `verify` skill (per the system prompt's
"Session-specific guidance" — invoke it via `Skill` tool). The skill
runs the local dev server and walks through user-visible behavior.
Follow it for each AC below; capture screenshots / DevTools network
panels into the verification document.

Required checks (with the AC each ties to):

| AC | Check |
|---|---|
| AC1.1 | Slow-stub `/api/feeds`; confirm sidebar feeds present in DOM before fetch resolves. |
| AC1.2 | Cold load; confirm `<header>` element in DOM throughout `authLoading`. |
| AC1.5 | Incognito tab to `/login`; confirm form renders, no skeleton flash. |
| AC5.1 | Fresh paid-user browser profile; confirm bootstrap card text. |
| AC5.2 | Same as AC5.1; confirm progress counts (feeds, items) tick up. |
| AC5.3 | Same as AC5.1; confirm card vanishes when bootstrap completes. |
| AC5.4 | Returning paid user (cache present); confirm no card. |
| AC7.1 | Throttle `/api/billing/status` to 5s; confirm home paints under 1s. |
| AC7.3 | Stub `/api/billing/status` to 503; confirm shell + items render. |
| AC8.1 | Fresh tab to home; confirm no `https://js.stripe.com/*` request. |
| AC8.2 | `curl localhost:<dev-port>/ | grep preconnect`; confirm tag present. |
| AC8.3 | Open `/settings`, click "Add a card"; confirm Elements loads and renders. |
| AC9.1 | The PR description (or `phase_01_findings.md`) contains the Stripe v3 investigation conclusion. |

Each row produces an entry in `manual-verification.md` with:
- Date and dev-server commit SHA.
- The exact step taken.
- Pass / Fail.
- Screenshot or network log path (commit screenshots to a
  `manual-verification/` subdirectory if useful).

If any row fails, halt and open a sub-task to fix; do not claim AC
coverage on a failing row.

**Verification:**

`manual-verification.md` exists and every row above is filled in
with Pass.

**Commit:**

```bash
git add DOCS/implementation-plans/2026-05-24-023-fix-initial-load/manual-verification.md \
        DOCS/implementation-plans/2026-05-24-023-fix-initial-load/manual-verification/
git commit -m "docs: 023 — manual verification log for all integration ACs"
```

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Final test + lint pass and PR

**Verifies:** Test-suite green; ready to merge.

**Files:** None modified (verification + PR opening).

**Implementation:**

1. Run the full suite:

   ```bash
   npm run typecheck
   npm run lint
   npm run stylelint
   npm test
   ```

   Expected: Each command exits 0 with no warnings (or with only
   warnings already present in the baseline).

2. Review `git log origin/staging..HEAD` for the branch. Confirm:
   - Each phase has at least one commit.
   - No "WIP" or "fix typo" commits remain — squash if needed.
   - Each commit message has the `Part of 023-fix-initial-load.`
     trailer.

3. Push the branch and open the PR. Use this skeleton for the PR
   body — the project's `gh pr create` heredoc pattern is
   established in the system prompt's "Creating pull requests"
   section:

   ```markdown
   ## Summary

   - Re-architects the client bootstrap to remove the global
     `pageReady` render gate; the app shell and last-known data
     paint immediately on every load after the first successful
     sync.
   - Adds `src/client/paint-cache.ts`: a synchronous, per-DID,
     capped (100 feeds / 200 items / 1 MB) localStorage cache
     read at bootstrap before Preact mounts.
   - Decouples `getAdapter` from `billingStatus` so adapter
     selection no longer waits for the (slow) Autumn round-trip.
     Lapsed-billing enforcement remains via the existing
     SyncBillingError handlers on the next sync cycle.
   - Defers Stripe.js script injection via `@stripe/stripe-js/pure`
     and adds a `<link rel=preconnect>` hint for `js.stripe.com`,
     so the home critical path never fetches the Stripe SDK.
   - First-ever device bootstrap surfaces an explicit
     "Setting up your local cache" card with live progress.

   ## Phase 1 Stripe Investigation Finding

   [Paste from phase_01_findings.md — either "DOM leftover from a
   prior modal open in the same tab" OR "@stripe/stripe-js was
   injecting the v3 script at module-import time".]

   ## Test plan

   - [ ] `npm run typecheck && npm run lint && npm test` clean.
   - [ ] Manual verification log under
     `DOCS/implementation-plans/2026-05-24-023-fix-initial-load/manual-verification.md`
     all-pass.
   - [ ] Confirm no `https://js.stripe.com/*` requests on home
     route in a fresh tab.
   - [ ] Confirm sidebar feeds render in <1s on a returning
     paid-user load.
   - [ ] Confirm bootstrap card on a fresh-device paid-user load.
   - [ ] Confirm logout clears `rsss.paintCache.v1.<did>` and
     `rsss.lastSessionDid` (and preserves other DIDs' caches).

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   ```

4. Confirm with the user before pushing / opening the PR.
   `git push` and `gh pr create` are visible-to-others actions
   per the system prompt's "Executing actions with care" — do not
   run them autonomously.

**Verification:**

PR URL exists; CI passes; user has acknowledged readiness to merge.

**Commit:** None — the PR itself is the artifact.

<!-- END_TASK_5 -->
