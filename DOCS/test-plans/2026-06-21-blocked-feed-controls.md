# Test Plan: Blocked Feed Controls

Feature: surface dead-lettered sync ops and failed-fetch feeds in the UI — a
static amber warning circle next to the affected feed in the sidebar, and a
Retry/Discard banner at the top of that feed's article page.

Coverage validation: PASS — 21/21 automated acceptance criteria covered,
0 missing. The manual steps below are an optional smoke pass to confirm the
rendering is visually and audibly correct end to end; there are no hard
coverage gaps requiring human-only verification.

## Prerequisites

- Local dev server running (the project's dev command), logged in with a test
  account.
- `npm test && npm run lint` passing.
- A way to force a feed to fail resolution (e.g. add a feed with a URL that
  404s or is not a feed) and a way to force a sync op to dead-letter (e.g. take
  the network offline after queuing an op, or use a feed whose server returns a
  permanent error so the outbox op exhausts retries into `dead_letter_outbox`).
- A screen reader for the accessibility pass (VoiceOver on macOS).

## Phase 1: Sidebar circle states

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Add a feed with a URL that fails to resolve (404 page or non-feed URL). | That sidebar row shows a solid amber circle (`--color-warning`), not a spinning blue spinner. The row keeps its "Failed to fetch" label and a Retry control. |
| 1.2 | Add a normal, valid feed that is still resolving (just added, fetch in flight). | While resolving, that row shows the blue spinner (animated), not the amber circle. |
| 1.3 | Wait for the valid feed to finish resolving cleanly. | The spinner and the circle both disappear; the row shows no status indicator. |
| 1.4 | Cause a sync op to dead-letter on an otherwise-resolved feed (queue an op offline / against a failing endpoint until it exhausts retries). | That feed's row shows the amber circle (blocked), even though the feed itself resolved fine. The circle does not spin. |

## Phase 2: Blocked-op banner (Case A)

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Click into the feed that has a dead-lettered op (from 1.4). | Above the item list, an amber banner renders. The empty "No items" state does not show if there are no items — the banner replaces it. |
| 2.2 | Inspect each op row in the banner. | Each blocked op shows a description, an attempts count, and the last error text. There is one row per blocked op. |
| 2.3 | Click Retry on a banner op. | The op is retried (it leaves the dead-letter state on success); the banner and the sidebar amber circle update / disappear once the op clears. No error in the console. |
| 2.4 | Cause another op to dead-letter, return to the banner, click Discard. | An "Are you sure?" confirm prompt appears inline. Nothing is removed yet. |
| 2.5 | Click the confirm/commit button in the prompt. | The op is discarded; banner and sidebar circle update. For a non-`add_feed` op, the feed and its items remain and you stay on the same page. |

## Phase 3: Failed-fetch banner (Case B)

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Click into the failed-fetch feed from 1.1 (no dead-lettered ops, just a fetch error). | The amber banner renders above the list showing the fetch error. |
| 3.2 | Inspect the banner controls. | Only a Retry control is present — there is no Discard control in this case. |
| 3.3 | Click Retry. | The feed re-resolves. On success the banner clears and the sidebar circle disappears; on repeated failure the banner stays with the updated error. No console error. |

## End-to-end: Discard a blocked feed add

Purpose: validates the `add_feed` discard path (AC5.1, AC5.2, AC5.4) — that
discarding a feed whose initial add dead-lettered fully removes it locally
without enqueuing a server delete and navigates away.

1. Add a feed in a way that makes the `add_feed` sync op dead-letter (server
   permanently rejects, or stay offline long enough for the op to exhaust
   retries). Confirm the feed appears in the sidebar with the amber circle.
2. Open that feed's page; confirm the blocked-op banner shows the `add_feed`
   op with its error.
3. Click Discard, then confirm in the "Are you sure?" prompt.
4. Expected: the feed row disappears from the sidebar, its items are gone, you
   are navigated back to the home/all-items route (`/`), and the sidebar's
   dead-letter indicator count drops. No `delete_feed` request is sent to the
   server (the feed never existed server-side). No console error.

## End-to-end: /sync-status unchanged

Purpose: validates AC6.1 — the `/sync-status` page reads the same promoted
`deadLetterRows` signal and its Retry/Discard behavior is unchanged.

1. With at least one dead-lettered op present, navigate to `/sync-status`.
2. Expected: the "blocked changes" list renders the dead-letter rows.
3. Click Retry on a row — the op retries immediately (no confirm prompt for
   retry).
4. Click Discard on a row — an inline confirm appears; commit it — for an
   `add_feed` row the op is removed (the row leaves the list); the
   feed-removal/navigation behavior lives in the feed banner, not here, so
   `/sync-status` discard only removes the op.

## Accessibility pass

Purpose: validates AC1.6 with a real assistive technology, beyond the
structural automated assertions.

1. With VoiceOver on, navigate the sidebar to a failed-fetch feed row.
   Expected: the status circle is announced as an image with a label
   mentioning "Failed to fetch."
2. Navigate to a blocked feed row. Expected: the circle is announced as an
   image labeled "Blocked."
3. Tab through the sidebar. Expected: the status circle is not focusable (Tab
   skips it); it is not announced as a live `status` region that steals focus
   or interrupts.

## Human verification required

| Criterion | Why manual | Steps |
|-----------|------------|-------|
| (Supplementary) Visual correctness of amber color vs blue spinner | Automated tests assert classes/roles, not pixels/color | Phase 1 steps 1.1-1.4 |
| (Supplementary) Screen-reader announcement wording | Automated test asserts `aria-label` presence/content structurally, not actual SR output | Accessibility pass steps 1-3 |

## Traceability

| Acceptance criterion | Automated test | Manual step |
|----------------------|----------------|-------------|
| AC1.1 | `feed-nav-warning.ts` | 1.1, 1.4 |
| AC1.2 | `feed-nav-warning.ts` | 1.1 |
| AC1.3 | `blocked-ops.ts`, `feed-nav-warning.ts` | 1.2 |
| AC1.4 | `blocked-ops.ts`, `feed-nav-warning.ts` | 1.3 |
| AC1.5 | `blocked-ops.ts` | 1.4 |
| AC1.6 | `feed-nav-warning.ts` | Accessibility pass 1-3 |
| AC2.1-AC2.5 | `blocked-ops.ts` | covered structurally; 1.4 / 2.1 exercise the mapping visibly |
| AC3.1 | `feed-blocked-banner.ts`, `feed-reader-blocked-banner.ts` | 2.1, 2.2 |
| AC3.2 | `feed-blocked-banner.ts` | 2.3 |
| AC3.3 | `feed-blocked-banner.ts` | 2.4, 2.5 |
| AC3.4 | `feed-reader-blocked-banner.ts` | 2.1 |
| AC4.1 | `feed-blocked-banner.ts`, `feed-reader-blocked-banner.ts` | 3.1, 3.2 |
| AC4.2 | `feed-blocked-banner.ts` | 3.3 |
| AC4.3 | `feed-blocked-banner.ts` | 2.1 |
| AC5.1 | `remove-local-feed-row.ts`, `discard-blocked-feed-add.ts` | E2E: Discard a blocked feed add |
| AC5.2 | `remove-local-feed-row.ts` | E2E: Discard a blocked feed add (step 4) |
| AC5.3 | `feed-blocked-banner.ts` | 2.5 |
| AC5.4 | `discard-blocked-feed-add.ts` | E2E: Discard a blocked feed add (step 4) |
| AC6.1 | `sync-status-route.ts`, `sync-status-feeds.ts` | E2E: /sync-status unchanged |
| AC6.2 | full `npm test && npm run lint` gate | Run `npm test && npm run lint` before sign-off |
