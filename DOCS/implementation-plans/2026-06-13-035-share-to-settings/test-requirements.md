# Test Requirements — Move "Share to Bluesky" to Settings

Feature: `035-share-to-settings`
Last updated: 2026-06-13

This document maps every acceptance criterion in the design plan
(`DOCS/design-plans/2026-06-13-035-share-to-settings.md`) to its verification:
either an automated test or documented human verification. Every AC is covered.

The feature is a pure client-side UI relocation (Preact + `@preact/signals`,
TypeScript browser app). It moves the per-feed "Share to Bluesky" control out of
the `FeedNav` sidebar into a new presentational `FeedShareControl` component
hosted by `SettingsRoute`. There is no backend, Durable Object, or sync change.

## Test conventions

- **Test type:** every automated test below is a browser unit/component test —
  a Preact component mounted into a `<div>` appended to `document.body`, queried
  with `querySelector`/`querySelectorAll` after `await nextTick()`, asserted
  with `@substrate-system/tapzero`, and unmounted in a `finally`.
- **Runner:** browser component tests are registered as imports in
  `test/browser-tests.ts` and run via `npm run test:browser` (not registered in
  `test/run-all-tests.mjs`). Any `console.error` fails the run even on green TAP.
- **Checkbox interaction:** a `<check-box>` change is simulated by setting
  `box.checked = <bool>` then
  `box.dispatchEvent(new Event('change', { bubbles: true }))`.
- **Status string:** the in-progress status text is exactly `Sharing...` (three
  ASCII dots, not an ellipsis); the failure status is `Failed: <error>`; the
  published status is `Published`; otherwise the status is empty.
- **Scoped status assertions:** status-text assertions are scoped to the
  specific `#share-feed-<id>-status` span, never `root.textContent`, because
  `SettingsRoute` renders much more surrounding text.
- **Section-order assertions:** section placement (AC2.1) is asserted by DOM
  index comparison — collecting `.settings-section` elements as an array and
  comparing the index of the share section against the Subscriptions and Delete
  sections — not by reading copy.
- **No brittle assertions:** tests query specific elements by `name`/`id`/class
  rather than matching whole-page text content.

---

## AC1 — FeedShareControl renders per-feed publish state

Phase 1. Covered by the isolation test `test/feed-share-control.ts`, which
mounts `<FeedShareControl>` directly (not via a route) with a minimal fake
`AppState` (only the `feedPublishInProgress` / `feedPublishErrors` signals), a
`feed()` factory, and an `onToggle` spy.

| AC | Criterion | Test type | Automated test file |
| --- | --- | --- | --- |
| `035-share-to-settings.AC1.1` | Unpublished feed (`published: 0`, no error, not in progress) renders an unchecked, enabled checkbox with empty status. | Browser component | `test/feed-share-control.ts` |
| `035-share-to-settings.AC1.2` | Published feed (`published === 1`) renders a checked checkbox with `Published` status. | Browser component | `test/feed-share-control.ts` |
| `035-share-to-settings.AC1.3` | Feed with publish in progress (`feedPublishInProgress[id] === true`) renders a disabled checkbox with `Sharing...` status. | Browser component | `test/feed-share-control.ts` |
| `035-share-to-settings.AC1.4` | Feed with a publish error renders the `Failed: <error>` status text with the error styling class (`className` contains `error`). | Browser component | `test/feed-share-control.ts` |
| `035-share-to-settings.AC1.5` | Toggling the checkbox invokes `onToggle` with `(feed.id, checked)` — `true` on the enable path, `false` on the disable path. | Browser component | `test/feed-share-control.ts` |

Assertions scope to `check-box[name="share-feed-<id>"]` (checkbox `checked` /
`disabled`) and the `#share-feed-<id>-status` span (status text + `className`).

---

## AC2 — Share to Bluesky settings section

Phase 2 (migrated). Covered by `test/feed-share-toggle.ts`, re-pointed to mount
`SettingsRoute` (with `isAuthenticated: signal(false)` and a per-test
`localStorage.removeItem('rsss.localFirst')` so the only network call is the
publish POST/DELETE). Queries are scoped to `.share-section`.

| AC | Criterion | Test type | Automated test file |
| --- | --- | --- | --- |
| `035-share-to-settings.AC2.1` | The "Share to Bluesky" section is positioned below Subscriptions and above Delete. Asserted by DOM index comparison: the index of the section containing `.settings-share-list` / `.share-section` is greater than the `.settings-feeds-list` (Subscriptions) section index and less than the `.danger-zone` (Delete) section index. | Browser component | `test/feed-share-toggle.ts` |
| `035-share-to-settings.AC2.2` | The section renders exactly one share control per followed feed. With two feeds mounted, exactly two `check-box[name^="share-feed-"]` exist within the share section, with the unpublished feed unchecked and the published feed checked. | Browser component | `test/feed-share-toggle.ts` |
| `035-share-to-settings.AC2.3` | With zero feeds (`feeds: signal([])`), the section shows a `.empty-state` element and contains no `.settings-share-list`. | Browser component | `test/feed-share-toggle.ts` |

---

## AC3 — Consent + publish flow from settings

Phase 2 (migrated). Split across two suites: the toggle/publish-status outcomes
in `test/feed-share-toggle.ts`, and the consent-modal open/close/cancel/disable
behaviors in `test/publish-consent-modal.ts`. Both mount `SettingsRoute`.

| AC | Criterion | Test type | Automated test file |
| --- | --- | --- | --- |
| `035-share-to-settings.AC3.1` | Enabling a feed's checkbox opens the consent modal (`modal-window.publish-consent-modal` present, `active === 'true'`) and does not publish yet (a `fetch` stub flag stays `false`). | Browser component | `test/publish-consent-modal.ts` |
| `035-share-to-settings.AC3.2` | Confirming consent calls `toggleFeedPublished(…, true)` (POST `/api/feeds/1/publish`) and the row reflects published state: `#share-feed-1-status` shows `Sharing...` while pending (checkbox `disabled === true`) then `Published` after resolve, and `state.feeds.value[0].published === 1`. | Browser component | `test/feed-share-toggle.ts` |
| `035-share-to-settings.AC3.3` | Cancelling consent (click `button.consent-cancel`) closes the modal (`active` attribute gone / `null`) with no publish fetch. | Browser component | `test/publish-consent-modal.ts` |
| `035-share-to-settings.AC3.4` | Disabling an already-published feed (`published: 1`, set `check-box` `checked = false` + dispatch `change`) calls `toggleFeedPublished(…, false)` immediately: the captured request is `DELETE /api/feeds/1/publish` and no consent modal appears. | Browser component | `test/publish-consent-modal.ts` |
| `035-share-to-settings.AC3.5` | A publish failure surfaces the failure status in the section: with `state.feedPublishErrors.value = { '1': 'boom' }`, `#share-feed-1-status` text includes `Failed: boom` and its `className` contains `error`. | Browser component | `test/feed-share-toggle.ts` |
| `035-share-to-settings.AC3.6` | The modal's close event resets `consentFeedId` (no feed stuck mid-consent): after opening the modal and dispatching `ModalWindow.event('close')`, the modal is gone / no longer `active`. | Browser component | `test/publish-consent-modal.ts` |

---

## AC4 — Sidebar decluttered

Phase 3 (new). Covered by the regression guard `test/feed-nav.ts`, which mounts
`FeedNav` with a fake `AppState` providing the signals it reads (`feedsLoading`,
`feedsError`, `feeds`, `route`, `counts`, `feedUpdateCounts`) and asserts the
share UI is gone while feed navigation still renders. Queries are scoped to the
mounted `root`.

| AC | Criterion | Test type | Automated test file |
| --- | --- | --- | --- |
| `035-share-to-settings.AC4.1` | Mounting `FeedNav` renders no share checkbox: `root.querySelector('check-box')` and `root.querySelector('check-box[name^="share-feed-"]')` are both `null`. | Browser component | `test/feed-nav.ts` |
| `035-share-to-settings.AC4.2` | Mounting `FeedNav` renders no consent modal: `root.querySelector('modal-window.publish-consent-modal')` is `null`. | Browser component | `test/feed-nav.ts` |
| `035-share-to-settings.AC4.3` | `FeedNav` still renders feed navigation: the unread-count badge (`.feed-unread-count`), a title link (`a.feed-select`), and a delete button (`.btn-delete`) all exist. | Browser component | `test/feed-nav.ts` |

---

## Human Verification

The automated tests above cover all functional behavior. Only genuinely
visual/UX aspects — which the DOM-query tests cannot fully assert — need a manual
pass. Run a dev server, sign in, and confirm:

1. **Single-line sidebar rows (AC4.x visual companion).** On the desktop sidebar
   and the mobile `/feeds` route, each feed row renders on a single line with no
   "Share to Bluesky" checkbox or status line beneath the title. The automated
   guard confirms the elements are absent; this confirms the row layout reads as
   single-line and visually uncluttered.

2. **Consent modal appearance and copy (AC3.1 visual companion).** Open the
   consent modal from the settings share section and confirm it displays
   legibly — heading, the four privacy bullets (records to your PDS, public on
   the AT Protocol network, not shown in your Bluesky timeline, removable at any
   time), and the Cancel / Share buttons — and that the copy reads correctly.
   The copy moves verbatim, so this is a visual/readability check, not a
   behavioral one (behavior is automated in `test/publish-consent-modal.ts`).

3. **Share section placement and styling (AC2.1 visual companion).** In
   `/settings`, confirm the "Share to Bluesky" section sits directly below
   Subscriptions and above Delete, with the share controls flush-aligned (the
   sidebar `margin-left: 3.5rem` indent is cancelled in the settings scope) and
   list spacing matching the other settings sections. The automated test asserts
   DOM order; this confirms the visual placement and styling read correctly.

These items are listed because pixel layout, visual legibility, and copy
readability are not reliably assertable via `querySelector`. All
behavior — toggle, consent gate, publish/unpublish, status text, error
surfacing, and sidebar removal — is covered by the automated tests above.
