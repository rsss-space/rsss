# Move "Share to Bluesky" to Settings Design

## Summary

This feature relocates the "Share to Bluesky" capability from the home sidebar
to the Settings page. Currently, each feed row in `FeedNav` (rendered on both
the desktop sidebar and the mobile feeds route) carries a share checkbox, a
publish-status line, and a consent modal. This scatters sharing UI across a
navigation component whose job is routing, not configuration, and makes feed
rows multi-line. The move puts all sharing controls in one dedicated place —
the Settings page — alongside the other per-subscription preferences (cache
policy, subscriptions management).

The implementation is a pure UI relocation across three sequential phases: first
a standalone `FeedShareControl` presentational component is extracted and
tested in isolation; second, a new "Share to Bluesky" section is added to
`SettingsRoute` that wires `FeedShareControl` to the existing
`State.toggleFeedPublished` action and relocates the consent modal there;
third, the now-redundant share UI is stripped from `FeedNav`. Between Phase 2
and Phase 3 the control intentionally exists in both places so the feature is
never absent from a shipped surface. No backend, Durable Object, or sync logic
changes — only which component hosts the existing publish machinery.

## Definition of Done

Primary deliverables:

1. The home sidebar (`src/client/components/feed-nav.ts`) renders **no**
   sharing UI. The per-feed "Share to Bluesky" checkbox, the publish-status
   line ("Sharing…" / "Published" / "Failed: …"), the consent modal, and
   their handlers are removed. Feed rows show only: unread count, pending
   count, title, resolving spinner / "Failed to fetch" label, retry, and
   delete.

2. The settings page (`src/client/routes/settings.ts`) has a new
   **"Share to Bluesky"** section, positioned directly **below** the
   Subscriptions section, listing each followed feed with a checkbox toggle
   and its publish status. The zero-feed empty state is handled.

3. Toggling a feed **on** opens the existing consent modal (records written
   to your PDS, public on the AT Protocol network, not shown in your Bluesky
   timeline, removable at any time) before publishing; toggling **off**
   unpublishes immediately. This reuses the existing
   `State.toggleFeedPublished`, `feed.published` / `feed.publish_error`, and
   the publish in-progress / error signals.

Success criteria:

- Sharing a feed and unsharing it both work end-to-end from the settings
  page, with publish status reflected; the consent modal still gates the
  on-toggle.
- The sidebar is visibly simpler — feed rows are single-line again with no
  share control.
- `npm test && npm run lint` pass.

Out of scope:

- Any change to the Bluesky publish backend, Durable Object SQLite, or sync
  logic. This is a pure UI relocation.
- Any change to the consent modal copy or flow (it moves verbatim).
- Any new sidebar indicator of share state.

## Acceptance Criteria

### 035-share-to-settings.AC1: FeedShareControl renders per-feed publish state
- **035-share-to-settings.AC1.1 Success:** An unpublished feed renders an
  unchecked, enabled checkbox with empty status.
- **035-share-to-settings.AC1.2 Success:** A published feed (`published === 1`)
  renders a checked checkbox with "Published" status.
- **035-share-to-settings.AC1.3 Success:** A feed with publish in progress
  renders a disabled checkbox with "Sharing…" status.
- **035-share-to-settings.AC1.4 Failure:** A feed with a publish error renders
  the failure status text with the error styling class.
- **035-share-to-settings.AC1.5 Success:** Toggling the checkbox invokes
  `onToggle` with `(feed.id, checked)`.

### 035-share-to-settings.AC2: Share to Bluesky settings section
- **035-share-to-settings.AC2.1 Success:** Settings renders a "Share to
  Bluesky" section positioned below Subscriptions and above Delete.
- **035-share-to-settings.AC2.2 Success:** The section renders one share
  control per followed feed.
- **035-share-to-settings.AC2.3 Edge:** With zero feeds, the section shows an
  empty-state message instead of a list.

### 035-share-to-settings.AC3: Consent + publish flow from settings
- **035-share-to-settings.AC3.1 Success:** Enabling a feed's checkbox opens the
  consent modal and does not publish yet.
- **035-share-to-settings.AC3.2 Success:** Confirming consent calls
  `toggleFeedPublished(…, true)` and the feed row reflects published state.
- **035-share-to-settings.AC3.3 Success:** Cancelling consent closes the modal
  with no publish call.
- **035-share-to-settings.AC3.4 Success:** Disabling an already-published feed
  calls `toggleFeedPublished(…, false)` immediately, with no consent modal.
- **035-share-to-settings.AC3.5 Failure:** A publish failure surfaces the
  failure status in the section.
- **035-share-to-settings.AC3.6 Edge:** The modal's close event resets
  `consentFeedId` (no feed stuck mid-consent).

### 035-share-to-settings.AC4: Sidebar decluttered
- **035-share-to-settings.AC4.1 Success:** Mounting `FeedNav` renders no share
  checkbox.
- **035-share-to-settings.AC4.2 Success:** Mounting `FeedNav` renders no
  consent modal.
- **035-share-to-settings.AC4.3 Success:** `FeedNav` still renders feed
  navigation (unread count, title link, delete) — relocation didn't break the
  sidebar.

## Glossary

- **AT Protocol (atproto):** The open, federated protocol underlying Bluesky.
  Data written to it (including published feed records) is stored on a user's
  Personal Data Server and is publicly readable by anyone on the network.
- **PDS (Personal Data Server):** A user's home server on the AT Protocol
  network. Publishing a feed writes a record to the user's PDS; removing it
  deletes that record.
- **Durable Object (DO):** A Cloudflare Workers primitive that provides a
  single-threaded, stateful compute unit with co-located SQLite storage. Used
  here as the per-user server-side database (unchanged by this feature).
- **`FeedNav`:** The client component (`src/client/components/feed-nav.ts`)
  that renders the list of followed feeds in both the desktop sidebar and the
  mobile `/feeds` route. This is the component being decluttered.
- **`FeedShareControl`:** The new presentational component introduced by this
  feature. It renders a single feed's share checkbox and publish-status span,
  with no internal state — all derived from `AppState` and the `Feed` record
  passed in.
- **`SettingsRoute`:** The client route component
  (`src/client/routes/settings.ts`) that renders the `/settings` page. This
  feature adds a new section to it.
- **`State.toggleFeedPublished`:** The existing client-side action that POSTs
  or DELETEs `/api/feeds/:id/publish` and updates the publish signals. It is
  reused verbatim — this feature only changes which component calls it.
- **Consent modal:** A `<modal-window>` dialog (using `@substrate-system/dialog`)
  shown before a feed is first published. It informs the user that the record
  will be public on the AT Protocol network, visible outside their Bluesky
  timeline, and removable at any time. Publishing is blocked until the user
  confirms.
- **`@substrate-system/check-box`:** The custom-element checkbox component used
  across the app, including for the per-feed share toggle.
- **`@substrate-system/dialog` / `<modal-window>`:** The custom-element dialog
  used for the consent modal. Emits a `ModalWindow.event('close')` event on
  dismissal.
- **`@preact/signals`:** The reactive-state library used throughout the client.
  Signals are fine-grained observables; components re-render only when a signal
  they read changes.
- **Presentational component:** A component that owns no state of its own — it
  derives everything it needs from its props and renders accordingly. Testing a
  presentational component is straightforward because there is no lifecycle or
  side-effect to set up.
- **`consentFeedId`:** A `useState`-managed nullable number tracking which feed
  is mid-consent. `null` means the modal is closed; a feed id means the modal
  is open for that feed.
- **`publish_error` / `feedPublishErrors`:** The per-feed error state for the
  Bluesky publish action — stored as a column in the local SQLite feed row and
  mirrored in a client signal (`state.feedPublishErrors`). The settings section
  surfaces this as a "Failed: …" status line.

## Architecture

Pure client-side UI relocation. No backend, Durable Object SQLite, sync, or
`State` action changes — the existing publish machinery is reused verbatim.

The share control today lives in `src/client/components/feed-nav.ts`, which is
rendered on two surfaces: the desktop sidebar (`components/sidebar.ts`) and the
mobile `/feeds` route (`routes/feeds.ts`). Removing the control from `FeedNav`
removes it from both. Both surfaces already link to `/settings` (the cog-wheel
in the sidebar header), so the new settings section serves desktop and mobile.

Three units of code:

1. **`FeedShareControl`** — new presentational component at
   `src/client/components/feed-share-control.ts`. It owns no state. Given a
   `state` and a `feed`, it derives the publish display values (the logic
   currently at `feed-nav.ts:226–245`) and renders the `@substrate-system/check-box`
   plus the status span. The checkbox `onChange` extracts `checked` and calls
   the `onToggle` callback. Contract:

   ```ts
   export const FeedShareControl:FunctionComponent<{
       state:AppState;
       feed:Feed;
       onToggle:(feedId:number, checked:boolean) => void;
   }>
   ```

   Derived internally from `state` + `feed` (no new fields):
   `isPublished` (`feed.published === 1`), `publishPending`
   (`state.feedPublishInProgress.value[id]`), `publishError`
   (`state.feedPublishErrors.value[id] ?? feed.publish_error`), and from those
   the status text ("Sharing…" / "Failed: …" / "Published" / "") and status
   class. The status span keeps its existing `aria-describedby` /
   `role="status"` / `aria-live="polite"` wiring.

2. **Settings orchestration** — inside `SettingsRoute` (`routes/settings.ts`).
   A new `<section class="settings-section">` headed "Share to Bluesky",
   positioned between the Subscriptions section and the Delete (danger-zone)
   section. It holds the consent state and the single consent modal, and maps
   `feeds.value` → `<FeedShareControl>`:

   - `consentFeedId` state (`useState<number|null>`), a `consentModalRef`, and
     the modal-close `useEffect` — moved verbatim from `feed-nav.ts`.
   - `handleShareFeed(feedId, checked)`: `checked` → open consent
     (`setConsentFeedId(feedId)`); else → `State.toggleFeedPublished(state,
     feedId, false)`.
   - `handleConsentCancel()` / `handleConsentConfirm()` (confirm calls
     `State.toggleFeedPublished(state, id, true)`) — verbatim.
   - The single `<modal-window class="publish-consent-modal">` consent dialog,
     rendered when `consentFeedId != null`, with its existing privacy copy.
   - An empty-state line when `feeds.value.length === 0`.

3. **`feed-nav.ts` removal** — strip the share checkbox + status span, the
   consent modal, the three handlers, the `consentFeedId` state / ref /
   `useEffect`, the publish-status derivation, and the now-unused imports
   (`CheckBox`, `ModalWindow`, `@substrate-system/dialog/css`) and the
   `ModalWindowAttrs` + `declare module 'preact'` JSX augmentation.

Data flow is unchanged: checkbox change → (consent gate on enable) →
`State.toggleFeedPublished` → POST/DELETE `/api/feeds/:id/publish` → publish
signals + feed row update → re-render. Only the host component moves.

## Existing Patterns

- **Per-concern extracted components**: `components/cache-settings.ts` is the
  precedent for a feed-scoped component consumed by a route
  (`export const CacheSettings:FunctionComponent<{state:AppState; ...}>`).
  `FeedShareControl` follows the same shape and the lowercase-hyphen file
  naming convention used across `components/`.
- **Settings section structure**: each block is
  `<section class="settings-section">` with an `<h2>`. The new section matches
  the existing Subscriptions/Cache/Delete sections.
- **`<modal-window>` consent dialog**: the relocated modal reuses the
  `@substrate-system/dialog` element and its `ModalWindow.event('close')`
  pattern unchanged. `routes/payment-method-modal` already uses this dependency
  inside the settings route, so the dependency is established there.
- **Route-mounted component tests**: `test/settings-route.ts` already mounts
  `SettingsRoute` with a `MinimalState` + `billingStatus` signal (no Stripe
  stubs needed for non-billing sections). The migrated consent/toggle tests
  reuse this mount pattern. Presentational `FeedShareControl` tests reuse the
  fake-state + `feed()` factory already present in `test/feed-share-toggle.ts`.
- **State reuse**: `State.toggleFeedPublished(state, feedId, publish)` and the
  `feedPublishInProgress` / `feedPublishErrors` signals (`state.ts`) and the
  `Feed.published` / `Feed.publish_error` fields (`db/types.ts`) are reused
  unchanged.

## Implementation Phases

Sequenced so every phase boundary builds and passes tests, and the share
feature is never unavailable on a shipped surface (settings gains it before
the sidebar loses it).

<!-- START_PHASE_1 -->
### Phase 1: Extract FeedShareControl component
**Goal:** A standalone, presentational per-feed share control, unused for now.

**Components:**
- `src/client/components/feed-share-control.ts` — the `FeedShareControl`
  component (contract above): derives publish display values from `state` +
  `feed`, renders the `@substrate-system/check-box` and the status span,
  invokes `onToggle(feed.id, checked)` on change.
- `src/client/components/feed-share-control.css` — the `.feed-share-control`
  and `.feed-share-state` (+ `.error`) rules moved from
  `src/client/style.css:265–284`; imported by the component.
- `test/feed-share-control.ts` — isolation test mounting `<FeedShareControl>`
  with a fake state + `feed()` factory and an `onToggle` spy.
- `test/run-all-tests.mjs` — register the new test file.

**Dependencies:** None (additive; nothing consumes it yet).

**Done when:** `npm run build` succeeds; the isolation test verifies the
checkbox reflects published/pending/disabled state, the status span reflects
published/error/pending, and `onToggle` fires with `(feed.id, checked)`.
Covers 035-share-to-settings.AC1.*.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Add the Share to Bluesky settings section
**Goal:** The settings page gains a working share section gated by the consent
modal; the feature now exists on both settings and (still) the sidebar.

**Components:**
- `src/client/routes/settings.ts` — new `<section class="settings-section">`
  ("Share to Bluesky") below Subscriptions, above Delete; `consentFeedId`
  state + `consentModalRef` + modal-close `useEffect`; `handleShareFeed` /
  `handleConsentCancel` / `handleConsentConfirm`; the `<modal-window>` consent
  dialog; the `feeds.value` → `<FeedShareControl onToggle=${handleShareFeed}>`
  map; empty-state line; the `ModalWindowAttrs` + `declare module 'preact'`
  JSX augmentation relocated here.
- `src/client/routes/settings.css` — the `modal-window.publish-consent-modal`
  block (+ children) moved from `routes/feeds.css:36–86`; any settings-scoped
  checkbox sizing override if needed.
- `test/feed-share-toggle.ts` and `test/publish-consent-modal.ts` — re-pointed
  to mount `SettingsRoute` (existing `settings-route.ts` mount pattern); assert
  consent opens on enable, Cancel closes without publishing, Confirm publishes
  and updates the row, published feeds render checked, publish errors render
  the failure status.

**Dependencies:** Phase 1 (`FeedShareControl`).

**Done when:** `npm run build` succeeds; the migrated suites pass against
`SettingsRoute`; sharing/unsharing works end-to-end from settings with the
consent gate. Covers 035-share-to-settings.AC2.* and AC3.*.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Strip share UI from the sidebar
**Goal:** `FeedNav` (sidebar + mobile `/feeds` route) renders no sharing UI;
dead CSS removed.

**Components:**
- `src/client/components/feed-nav.ts` — remove the share checkbox + status
  span, the consent modal, the three handlers, `consentFeedId` state/ref/
  `useEffect`, the publish-status derivation, and the now-unused imports and
  JSX augmentation.
- `src/client/routes/feeds.css` — delete the dead `.route.feeds &
  .feed-share-control` sizing override (lines ~20–29).
- `src/client/style.css` — confirm the `.feed-share-control` / `.feed-share-state`
  rules removed in Phase 1 leave no dangling references.
- `test/feed-nav` regression guard — assert mounting `FeedNav` renders no
  `check-box` and no consent modal (new assertions, registered in
  `run-all-tests.mjs`).

**Dependencies:** Phase 2 (settings section must already host the feature).

**Done when:** `npm test && npm run lint` pass; feed rows in the sidebar and
mobile `/feeds` route are single-line with no share control; the regression
guard confirms no checkbox/modal in `FeedNav`. Covers
035-share-to-settings.AC4.*.
<!-- END_PHASE_3 -->

## Additional Considerations

**No behavior change for unresolved/failed feeds.** The sidebar currently
renders the share checkbox for every feed regardless of resolution state. The
settings section lists every feed the same way — this is a relocation, not a
policy change. Whether failed feeds should be shareable is out of scope.

**Temporary duplication is intentional.** Between Phase 2 and Phase 3 the share
control exists on both the sidebar and settings. This is deliberate so the
feature is never unavailable on a shipped surface; Phase 3 removes the sidebar
copy.

**Consent copy is unchanged.** The modal text (records to your PDS, public on
the AT Protocol network, not in your timeline, removable) moves verbatim. No
copy edits are in scope.
