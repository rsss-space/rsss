# Correctness Audit — Implementation Plan Overview

**Source:** `/Users/nick/code/rsss/correctness-audit-2026-06-10.md`
**Branch:** `correctness-audit` (from `staging`)
**Created:** 2026-06-11
**Scope:** Everything the audit raised (P0–P3), minus two verified false
positives. Codebase verified per phase on 2026-06-11.

This plan fixes the findings of the correctness audit. The audit is not a
formal design doc, so each phase derives its own acceptance criteria (slug
`correctness-audit`, e.g. `correctness-audit.AC1.1`) from the audit's
documented bug-behavior and recommended fix.

## Execute phases strictly in order (1 → 8)

Several phases have cross-phase dependencies. **Do not reorder or parallelize.**

| Phase | File | Audit items | Notes |
|-------|------|-------------|-------|
| 1 | `phase_01.md` | P0 #1 | `.one()` zero-row crash + DO test-fake. Fix all production sites **before** flipping the shared test fake. Scope is ~25–27 optional-row sites (3× the audit's 8) + 17 test files. |
| 2 | `phase_02.md` | P1 #2 | OAuth `iss` binding to stored `authServer`. |
| 3 | `phase_03.md` | P1 #3 | Stored XSS — `http(s)`-validate subscription `feedUrl`/`siteUrl`. |
| 4 | `phase_04.md` | P1 #4 | Pull-sync `UNIQUE(url)` wedge: per-feed SAVEPOINT + url-skip + dead-letter cap. Does **not** mutate a PK (FK children). |
| 5 | `phase_05.md` | P1 #5, #6 | Bounded `POST /feeds/refresh` + bounded pagination. **Changes `getBlueskyFollows` return shape to `{ follows, ok }` — Phase 8 depends on this.** |
| 6 | `phase_06.md` | P2 #7, #8, #9 | Tab-lock ordering, rkey canonicalization, image-cache ordering. |
| 7 | `phase_07.md` | P2 #10, #11a–g | Followers conflation + 7 confirmed lower-confidence items. Largest phase (8 tasks). |
| 8 | `phase_08.md` | P3 (real items) + recommendations route | Constant-time admin compare, NaN id guards, SSRF-guard, paginate `/admin/refresh-all`, **wire `GET /api/recommendations`**. |

## Cross-phase dependencies (must hold)

1. **Phase 1, within-phase:** fix the production `.one()` sites (Tasks 1–2)
   **before** making the shared test fake throw (Tasks 4–5). Flipping the fake
   first reddens the suite across unrelated tests.
2. **Phase 5 → Phase 8:** Phase 5 Task 2 changes `getBlueskyFollows` to return
   `{ follows, ok }`. Phase 8 Task 5 (recommendations route) consumes that
   shape (`!ok` → 503). Phase 5 must ship first.
3. **Phase 5 Task 3 + Phase 8 Task 3** both edit
   `listRemoteSubscriptions` (~850–888): Phase 5 adds pagination caps, Phase 8
   adds the SSRF guard. Phase 8 must apply its change on top of Phase 5's.
4. **Phase 6 Task 1 + Phase 7 Task 7** both touch the reset/teardown path
   (lock ordering vs. `clearPaintCache`); keep them consistent.

## Verified false positives (intentionally no code change)

- **P3 #1** `billing_pending_email` "dead write" — the value **is** read during
  account deletion (`durable-objects/index.ts:3555`).
- **P3 #6** `requireAdmin` "double-charge" — middleware runs once per request;
  the per-route checks are redundant but do not double-charge the rate limit.

These are documented in `phase_08.md` and must remain untouched.

## Verification

- Per task: `npm test` (filtered where possible) + `npm run lint`.
- Whole plan: `npm test && npm run lint` green on the `correctness-audit`
  branch.
- Investigation findings (grounding the line numbers/claims) live in
  `/tmp/plan-2026-06-11-correctness-audit-12661ed6/phase{1..8}-findings.md`.
- `test-requirements.md` (this directory) maps each AC to its automated test or
  human-verification step.
