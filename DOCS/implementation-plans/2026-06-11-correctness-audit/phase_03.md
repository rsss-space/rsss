# Correctness Audit — Phase 3: Validate subscription-record URLs (stored XSS)

**Goal:** Stop a stored-XSS vector where another user's attacker-controlled
PDS subscription record can carry a `javascript:`/`data:` URL that the app
renders as a clickable `href` in its own origin. Validate `feedUrl`/`siteUrl`
to `http(s)`-only at parse time, reusing the existing validator.

**Architecture:** `parseSubscriptionRecord` (server) reads
`feedUrl`/`siteUrl`/`title` from a public, third-party PDS record with **no
protocol validation**. The client renders `href=${sub.siteUrl}` directly
(htm/preact attribute binding — safe from innerHTML injection, but a
`javascript:` href still executes on click). `src/shared/publisher-link.ts`
already has the correct `http:`/`https:`-only `URL` check (`tryParse`), but it
is not exported. The fix: export the validator (or a small wrapper) and apply
it in `parseSubscriptionRecord`, dropping/normalizing non-`http(s)` values
before they are stored or returned to the client.

**Tech Stack:** TypeScript (Cloudflare Workers + browser via Vite), Preact +
`htm/preact`, AT Protocol records.

**Scope:** Phase 3 of 8. Derived from audit finding **P1 #3**.

**Codebase verified:** 2026-06-11 (codebase-investigator). Confirmed:
`parseSubscriptionRecord` at `src/server/profile-api.ts:51–67` does only
`typeof` checks (no protocol validation), reads `feedUrl` (required),
`siteUrl`, `title`; called server-only at `index.ts:2127` and `:2148`.
`src/shared/publisher-link.ts:8–18` has private `tryParse` enforcing
`http:`/`https:`; it is **not exported** (only `publisherLinkLabel`,
`publisherLinkHref`, `sourceLinkLabel` are). Client render at
`src/client/routes/profile.ts:179–186` uses `href=${sub.siteUrl}`. `feedUrl`
flows to `State.addFeed` → POST `/api/feeds` → server `validateFeedUrl`
(already `http(s)`-only), so `feedUrl` is validated server-side on add; but it
is **not** validated where it is parsed/returned, and `siteUrl` is never
validated. `publisher-link.ts` has existing tests asserting `javascript:`/
`mailto:`/malformed → null (mirror them).

---

## Acceptance Criteria Coverage

This phase implements and tests (ACs derived from audit P1 #3):

### correctness-audit.AC4: Subscription-record URLs are `http(s)`-validated at parse time
- **correctness-audit.AC4.1 Failure:** a record whose `siteUrl` is non-`http(s)`
  (e.g. `javascript:alert(1)`, `data:...`, `mailto:...`) yields a parsed
  subscription with `siteUrl === null` (dropped), so nothing renders it as an
  href.
- **correctness-audit.AC4.2 Failure:** a record whose `feedUrl` is non-`http(s)`
  is rejected — `parseSubscriptionRecord` returns `null` (the record is
  unusable without a valid feed URL).
- **correctness-audit.AC4.3 Success:** a record with valid `http`/`https`
  `feedUrl` and `siteUrl` passes through unchanged.

---

## Notes for the executor

- This is a **functionality** phase: tests are deliverables.
- Prefer reusing the existing validator over writing a new one. The minimal,
  DRY move is to **export** a predicate/normalizer from `publisher-link.ts`
  and call it from `parseSubscriptionRecord`. Do not duplicate the
  protocol-check logic.
- `feedUrl` is required for a usable subscription; an invalid `feedUrl` should
  drop the whole record (return `null`). `siteUrl` is optional; an invalid
  `siteUrl` should be nulled but the record kept (it still has a feed).
- Findings: `/tmp/plan-2026-06-11-correctness-audit-12661ed6/phase3-findings.md`.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Export an `http(s)`-only URL validator from `publisher-link.ts`

**Verifies:** (enabling step for AC4 — no standalone AC)

**Files:**
- Modify: `src/shared/publisher-link.ts`

**Implementation:**
Expose the existing `http(s)`-only check so other modules can reuse it without
duplicating logic. Either export `tryParse` directly, or add a thin named
export that returns the validated/normalized string (or `null`):

```ts
// Returns the input URL string iff it parses and is http(s); else null.
export function httpUrlOrNull (link:string|null|undefined):string|null {
    if (!link) return null
    const url = tryParse(link)        // existing private helper, http(s)-only
    return url ? link : null
}
```

Keep `tryParse` as-is (or export it too if cleaner). Do not change the
behavior of the existing `publisherLink*` exports.

**Testing:**
Add unit cases alongside the existing `publisher-link` tests:
- `httpUrlOrNull('https://x.example')` → `'https://x.example'`
- `httpUrlOrNull('http://x.example')` → `'http://x.example'`
- `httpUrlOrNull('javascript:alert(1)')` → `null`
- `httpUrlOrNull('mailto:a@b')` → `null`
- `httpUrlOrNull('data:text/html,...')` → `null`
- `httpUrlOrNull('')` / `null` / `undefined` → `null`
Mirror the existing test style in the publisher-link test file.

**Verification:**
Run: `npm test` (publisher-link tests). Expected: new cases pass; existing
publisher-link tests unchanged and green.

**Commit:** `refactor(shared): export http(s)-only URL validator`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Apply the validator in `parseSubscriptionRecord`

**Verifies:** correctness-audit.AC4.1, AC4.2, AC4.3

**Files:**
- Modify: `src/server/profile-api.ts` (`parseSubscriptionRecord`, ~51–67).

**Implementation:**
Import `httpUrlOrNull` from `src/shared/publisher-link.ts`. Validate both URL
fields:
- `feedUrl`: if `httpUrlOrNull(v.feedUrl)` is `null`, return `null` (drop the
  whole record — a subscription without a valid feed URL is unusable).
- `siteUrl`: set the result's `siteUrl` to `httpUrlOrNull(v.siteUrl)` (null
  when absent or non-`http(s)`).

```ts
const feedUrl = httpUrlOrNull(typeof v.feedUrl === 'string' ? v.feedUrl : null)
if (!feedUrl) return null
// ...
return {
    uri,
    rkey,
    feedUrl,
    title: typeof v.title === 'string' ? v.title : null,
    siteUrl: httpUrlOrNull(typeof v.siteUrl === 'string' ? v.siteUrl : null)
}
```

Keep the existing `title` handling and `rkey` derivation untouched.

**Testing (in `test/profile-api.ts`):**
- AC4.1: a record with `siteUrl: 'javascript:alert(1)'` → parsed subscription
  has `siteUrl === null`, record otherwise intact.
- AC4.2: a record with `feedUrl: 'javascript:...'` (or `data:`/`mailto:`) →
  `parseSubscriptionRecord` returns `null`.
- AC4.3: a record with valid `http(s)` `feedUrl` + `siteUrl` → both pass
  through unchanged.
Follow the existing `test/profile-api.ts` style (it already tests
`buildProfileResponse` with subscriptions).

**Verification:**
Run: `npm test` (profile-api tests). Expected: new AC4 cases pass; existing
profile-api tests still green.

**Commit:** `fix(profile): http(s)-validate subscription feedUrl/siteUrl`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
