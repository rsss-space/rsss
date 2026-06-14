# Human Test Plan — Move "Share to Bluesky" to Settings (035)

Coverage validation: PASS — 17/17 acceptance criteria covered by automated
tests (`test/feed-share-control.ts`, `test/feed-share-toggle.ts`,
`test/publish-consent-modal.ts`, `test/feed-nav.ts`). This plan covers the
visual / end-to-end aspects that automated `querySelector` assertions cannot.

## Prerequisites

- Run the dev server (`npm run dev`), with `vite.config.js` port and
  `APP_ORIGIN` in `.dev.vars` in sync (else non-exempt POSTs 403).
- Sign in with a Bluesky account that has at least two followed feeds, where
  at least one is already shared/published and one is not.
- Confirm the feature's automated suites are green.

## Phase 1: FeedShareControl per-feed state (`/settings`)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to `/settings`, scroll to the "Share to Bluesky" section | Each followed feed has one row: a "Share to Bluesky" checkbox plus a status area |
| 2 | Locate an unshared feed's row | Checkbox is unchecked and enabled; no status text beside it |
| 3 | Locate an already-shared feed's row | Checkbox is checked; status reads `Published` |
| 4 | Toggle an unshared feed on, then confirm consent (see Phase 2) and watch the row during the request | While the request is in flight the checkbox is disabled and the status reads `Sharing...` (three ASCII dots); after success it reads `Published` |
| 5 | Force a publish failure (e.g. go offline, then toggle a feed on and confirm) | The row's status reads `Failed: <error>` rendered in the error style (red/error color), and the checkbox returns to an interactive state |

## Phase 2: Consent + publish/unpublish flow

| Step | Action | Expected |
|------|--------|----------|
| 1 | In `/settings`, check an unshared feed's "Share to Bluesky" box | The consent modal opens; nothing is published yet |
| 2 | Read the modal | Heading "Share to Bluesky network"; four privacy bullets (records written to your PDS, public on the AT Protocol network, do not appear in your Bluesky timeline, removable at any time); Cancel and Share buttons |
| 3 | Click Cancel | Modal closes; the feed remains unshared; the checkbox returns to unchecked |
| 4 | Re-check the box, click Share | Modal closes; status shows `Sharing...` then `Published`; the checkbox stays checked |
| 5 | Uncheck an already-shared feed's box | No consent modal appears; the feed unpublishes immediately and the checkbox becomes unchecked |
| 6 | Open the consent modal again, then dismiss it via the modal's own close affordance (Escape / backdrop / close button) rather than Cancel | Modal closes cleanly; re-opening on any feed works (no feed is stuck mid-consent) |

## Phase 3: Sidebar decluttered

| Step | Action | Expected |
|------|--------|----------|
| 1 | View the desktop sidebar feed list | Each feed row is a single line: title link, unread-count badge, delete control. No "Share to Bluesky" checkbox or status line beneath any title |
| 2 | Navigate to the mobile `/feeds` route (narrow viewport) | Same: single-line rows, no share UI in the list |
| 3 | Confirm feed navigation still works | Clicking a feed title navigates to that feed; unread badges show correct counts; delete control is present |

## End-to-End: Share a feed from settings, verify sidebar stays clean

Purpose: validates the full relocation — consent gate, publish, status, and
that the sidebar no longer hosts the control.

1. Start on the feed list (sidebar) and confirm no share controls appear there.
2. Go to `/settings`, share a previously-unshared feed via the consent modal
   (Share), and confirm the row reaches `Published`.
3. Return to the sidebar/feed list and confirm the newly-shared feed still
   renders as a single-line row with no share UI.
4. Back in `/settings`, unshare that same feed (uncheck, no modal) and confirm
   the row returns to unchecked with empty status.

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| Single-line sidebar rows (AC4.x visual companion) | Pixel layout / visual rhythm not assertable via `querySelector` | Phase 3, steps 1–2: confirm rows read as a single uncluttered line on desktop and mobile |
| Consent modal appearance + copy (AC3.1 visual companion) | Copy readability and modal legibility are visual, not behavioral | Phase 2, step 2: confirm heading, four bullets, and buttons render legibly and read correctly |
| Share section placement + styling (AC2.1 visual companion) | DOM order is automated; flush-alignment and spacing are visual | In `/settings`: confirm the share section sits directly below Subscriptions and above Delete, controls are flush-aligned (sidebar `margin-left: 3.5rem` indent cancelled), and list spacing matches other settings sections |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `feed-share-control.ts` (unchecked/enabled/empty) | Phase 1, step 2 |
| AC1.2 | `feed-share-control.ts` (checked + `Published`) | Phase 1, step 3 |
| AC1.3 | `feed-share-control.ts` (disabled + `Sharing...`) | Phase 1, step 4 |
| AC1.4 | `feed-share-control.ts` (`Failed:` + error class) | Phase 1, step 5 |
| AC1.5 | `feed-share-control.ts` (`onToggle` args) | Phase 2, steps 1/5 |
| AC2.1 | `feed-share-toggle.ts` (DOM index order) | Human Verification (placement) |
| AC2.2 | `feed-share-toggle.ts` (two scoped checkboxes) | Phase 1, step 1 |
| AC2.3 | `feed-share-toggle.ts` (empty-state) | mount with zero feeds |
| AC3.1 | `publish-consent-modal.ts` (modal opens, no fetch) | Phase 2, step 1 |
| AC3.2 | `feed-share-toggle.ts` (POST, pending→published) | Phase 2, step 4 |
| AC3.3 | `publish-consent-modal.ts` (cancel, no fetch) | Phase 2, step 3 |
| AC3.4 | `publish-consent-modal.ts` (DELETE, no modal) | Phase 2, step 5 |
| AC3.5 | `feed-share-toggle.ts` (`Failed: boom` + error) | Phase 1, step 5 |
| AC3.6 | `publish-consent-modal.ts` (close resets state) | Phase 2, step 6 |
| AC4.1 | `feed-nav.ts` (no share checkbox) | Phase 3, steps 1–2 |
| AC4.2 | `feed-nav.ts` (no consent modal) | Phase 3, steps 1–2 |
| AC4.3 | `feed-nav.ts` (nav still renders) | Phase 3, step 3 |
