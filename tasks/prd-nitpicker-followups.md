# PRD: Nitpicker Follow-up Tasks

## Introduction

A recent adversarial review (`nitpicker.md`) produced a long list of
findings. Most P0/P1 items have already been fixed or superseded, but five
actionable follow-ups remain in `nitpicker-tasks.md` (tasks 1-5). This PRD
scopes those five into discrete, verifiable work items:

1. Reconcile the `nitpicker.md` checklist with the current code.
2. Make `POST /feeds` strictly non-blocking.
3. Correct stale session wording in the README.
4. Stop clobbering the `DEBUG` localStorage key on every load.
5. Enforce the project's TypeScript colon-spacing style with a lint rule
   and a repo-wide cleanup.

Tasks 6 (commit-message quality) and 7 (item-list virtualization) are
explicitly out of scope (see Non-Goals).

## Goals

- Bring `nitpicker.md` in line with reality so it stays a useful audit
  artifact — checked items are genuinely fixed, unchecked items are real.
- Guarantee `POST /feeds` returns promptly (`201`) regardless of how slow
  the upstream feed is, with discovery completing in the background.
- Make the README accurately describe the signed-session-id + KV auth model.
- Respect a user-customized `DEBUG` value instead of overwriting it on load.
- Achieve repo-wide consistency on the no-space-before-colon type style,
  enforced by lint so it does not regress.
- Keep `npm test && npm run lint` green throughout.

## User Stories

### US-001: Reconcile the nitpicker.md checklist
**Description:** As a maintainer, I want `nitpicker.md` to reflect which
findings are actually fixed so the checklist remains trustworthy for audits.

**Acceptance Criteria:**
- [ ] For each finding in `#5-12`, `#14-20`, `#22-26`, `#28-39`, `#43`,
      `#46`, `#48-50`, verify against the current tree that the code
      genuinely addresses it before marking it complete
- [ ] Mark only the verified-fixed findings as complete; leave any that are
      NOT actually addressed unchecked, with a one-line note on what remains
- [ ] No other sections of `nitpicker.md` are rewritten or reordered
- [ ] `npm test && npm run lint` still passes (no code changed, sanity check)

### US-002: Make POST /feeds strictly non-blocking
**Description:** As a user adding a feed, I want the request to return
immediately so the UI is never blocked waiting on a slow upstream fetch.

**Acceptance Criteria:**
- [ ] `POST /feeds` inserts the feed row, pulls the discovery alarm forward
      (preserving the existing `RESOLVE_WINDOW_MS` behavior), then returns
      `201` with the freshly-inserted feed row WITHOUT awaiting `fetchFeed`
- [ ] The initial `fetchFeed` runs entirely in the background via
      `ctx.waitUntil` after the response is constructed
- [ ] Response time for `POST /feeds` does not depend on upstream feed
      latency (verified by a test where `fetchFeed` is slow/stubbed and the
      handler still responds promptly with `201`)
- [ ] The now-unused `awaitFetchOrTimeout` helper and `POST_HYBRID_WAIT_MS`
      constant are removed; `test/dead-code.mjs` passes
- [ ] Existing 409/400/validation paths for `POST /feeds` are unchanged
- [ ] `npm test && npm run lint` passes

### US-003: Correct README session wording
**Description:** As a developer reading the README, I want an accurate
description of the session model so I understand what rotation does.

**Acceptance Criteria:**
- [ ] Confirm the actual implementation first: sessions live in KV behind a
      random session id carried in a signed cookie (not an encrypted cookie)
- [ ] Replace "encrypted cookies" wording with "signed session-id cookies"
      in all three locations (overview list, `SESSION_SECRET` table row, and
      the "Rotate `SESSION_SECRET`" section)
- [ ] The rotation section explains that rotating `SESSION_SECRET`
      invalidates existing signed cookie values (signatures no longer
      verify), so users must sign in again
- [ ] No code changes; the session implementation itself is untouched

### US-004: Stop stomping the DEBUG localStorage key
**Description:** As a developer, I want my customized `DEBUG` value to
survive a page reload instead of being overwritten or deleted.

**Acceptance Criteria:**
- [ ] In dev/staging, `DEBUG` is seeded to `rsss,rsss:*` ONLY when no
      `DEBUG` value already exists in localStorage
- [ ] An existing user-set `DEBUG` value is never overwritten or deleted on
      load (no unconditional `setItem`/`removeItem`)
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill: set a custom `DEBUG` value,
      reload, and confirm it persists; with no value set, confirm the
      default is seeded in dev

### US-005: Add a lint rule for colon-spacing
**Description:** As a maintainer, I want the no-space-before-colon type
style enforced by lint so it cannot silently regress.

**Acceptance Criteria:**
- [ ] Add `@typescript-eslint/type-annotation-spacing` to `.eslintrc`,
      configured to match the house style (`url:string`, `classes?:string[]`)
- [ ] The rule flags a deliberately mis-spaced annotation (e.g. `x: string`)
      as an error when linted
- [ ] The rule is auto-fixable via `eslint --fix` (used in US-006)
- [ ] No unrelated ESLint rules are changed

### US-006: Repo-wide colon-spacing cleanup
**Description:** As a maintainer, I want the whole repo to conform to the
colon-spacing style so the new rule passes everywhere.

**Acceptance Criteria:**
- [ ] Run a mechanical cleanup pass (`eslint --fix`) across all `.ts`/`.js`
      files, then manually resolve any stragglers the autofix missed
- [ ] `npm run lint` passes with zero errors across the repo
- [ ] The cleanup is mechanical only — no behavioral code changes
- [ ] `npm test` still passes

## Functional Requirements

- FR-1: For each listed `nitpicker.md` finding, verify the current code
  addresses it before checking it; do not check unverified or unaddressed
  findings.
- FR-2: `POST /feeds` must return `201` with the freshly-inserted feed row
  immediately after the insert and alarm-pull-forward, without awaiting the
  initial fetch.
- FR-3: The initial feed fetch must execute in the background via
  `ctx.waitUntil`; terminal feed state is delivered through the existing
  alarm sweep + live channel convergence pipeline.
- FR-4: Remove `awaitFetchOrTimeout` and `POST_HYBRID_WAIT_MS`
  (`src/server/durable-objects/index.ts`) once they are unused; keep
  `test/dead-code.mjs` green.
- FR-5: README must describe authentication as "signed session-id cookies"
  backed by KV in the overview, the `SESSION_SECRET` table row, and the
  rotation section; remove all "encrypted cookies" / "cannot be decrypted"
  language.
- FR-6: The rotation section must state that rotating `SESSION_SECRET`
  invalidates existing signed cookie values (signatures stop verifying),
  forcing re-login.
- FR-7: `src/client/index.ts` must seed `DEBUG='rsss,rsss:*'` only when no
  `DEBUG` value already exists, and only in dev/staging.
- FR-8: `src/client/index.ts` must not unconditionally delete or overwrite
  an existing `DEBUG` value.
- FR-9: Add the `@typescript-eslint/type-annotation-spacing` rule to
  `.eslintrc`, configured for the no-space-before-colon style.
- FR-10: Run a repo-wide mechanical cleanup so `npm run lint` passes with
  zero errors.
- FR-11: Every change must leave `npm test && npm run lint` passing.

## Non-Goals

- Task 6 (commit-message quality) — a process norm, not a code change.
- Task 7 (item-list virtualization) — explicitly deferred while the page
  size stays capped at 100 items.
- Re-auditing or rewriting the "Fixed Or Superseded Findings" section of
  `nitpicker-tasks.md`.
- Changing the session implementation itself (US-003 is docs only).
- Changing CSS or `stylelint` configuration.
- Any change to existing ESLint rules other than adding the one new
  colon-spacing rule.

## Design Considerations

- **POST /feeds response shape (RESEARCHED — safe):** Once non-blocking, the
  `201` body carries the bare inserted row (`id`, `url`, `created_at`,
  `updated_at` populated; `title`/`last_fetched`/etc. null) and `unread` is
  `0` at insert time. No client relies on the body carrying fetched
  metadata:
  - Remote adapter path (`State.addFeed`) discards the returned feed
    entirely; it re-fetches via `loadFeeds` and waits for SSE release.
  - Local-first push-sync (`reconcileSuccessfulAddFeed` →
    `replaceOptimisticFeed`/`upsertFeedFromServer`) needs only `feed.id`
    plus `created_at`/`updated_at`; all other fields are `?? null`-coalesced.
    The optimistic local row already had null `title`/`last_fetched`, and
    convergence (pull-sync + live channel) fills in terminal state.
  - `retryResolveFeed` uses a different endpoint (`POST /feeds/:id/refresh`),
    is unaffected by this change, and already tolerates a missing body.

  Crucially, the bare-row `201` is ALREADY the response today whenever the
  upstream fetch exceeds `POST_HYBRID_WAIT_MS` (3s) — this change just makes
  that existing slow-path universal. The only behavioral shift is cosmetic:
  fast feeds will briefly render in the `resolving` state (which
  `feedRowState` is designed for) instead of appearing resolved on the `201`.
- **DEBUG seeding:** Use a presence check (`localStorage.getItem('DEBUG')`)
  before writing. Decide the production branch explicitly (see Open
  Questions) — the current behavior unconditionally removes the key.

## Technical Considerations

- `POST_HYBRID_WAIT_MS` and `awaitFetchOrTimeout` have no test references,
  so removing them is low-risk; `test/dead-code.mjs` will catch them if left
  orphaned.
- The alarm-pull-forward (`RESOLVE_WINDOW_MS`) logic must be preserved — it
  is the safety net that runs discovery even if the `waitUntil` fetch is
  dropped. Do not remove it along with the wait.
- ESLint here is v8 with `.eslintrc` (not flat config);
  `@typescript-eslint/type-annotation-spacing` is autofixable, but the
  default config is `{ before: false, after: true }` while the house style
  wants no space after the colon either (`classes?:string[]`). The rule
  config likely needs explicit `before`/`after` overrides; verify
  `eslint --fix` output actually matches the house style before the bulk run.
- The lint command is `eslint "./**/*.{ts,js}"`; the cleanup pass should use
  the same glob with `--fix`.

## Success Metrics

- `POST /feeds` p95 latency is independent of upstream feed fetch time.
- `npm run lint` reports zero colon-spacing violations repo-wide and fails
  on a newly-introduced violation.
- `nitpicker.md` checked items are verifiably fixed; no false checkmarks.
- A user-set `DEBUG` value survives reloads.

## Open Questions

- **Production DEBUG default:** Should production simply leave `DEBUG`
  untouched when absent (never seed, never clobber), or still actively
  ensure debug logging is off by default? The current code does
  `removeItem` in production.
- **type-annotation-spacing config:** Does `eslint --fix` with the chosen
  config reproduce the exact house style (no space on either side of the
  colon for type annotations) without breaking arrow/return-type spacing? If
  not, what manual config tuning is needed?

(Resolved during research: no client relies on the `POST /feeds` 201 body
carrying fetched metadata — see Design Considerations.)
