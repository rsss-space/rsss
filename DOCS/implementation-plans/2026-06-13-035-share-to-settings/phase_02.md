# Move "Share to Bluesky" to Settings — Phase 2

**Goal:** Add a working "Share to Bluesky" section to `SettingsRoute`, gated by
the relocated consent modal. After this phase the feature exists on BOTH the
settings page and (still) the sidebar — intentional temporary duplication.

**Architecture:** `SettingsRoute` becomes the new host for the consent state
(`consentFeedId`), the single consent `<modal-window>`, and the three publish
handlers. It maps `feeds.value` to `<FeedShareControl onToggle=...>` (the
component from Phase 1). The publish data flow is unchanged: checkbox change →
(consent gate on enable) → `State.toggleFeedPublished` → POST/DELETE
`/api/feeds/:id/publish` → publish signals + feed-row update → re-render.

**Tech Stack:** TypeScript (browser, ES2022 via Vite), Preact, `htm/preact`,
`@preact/signals`, `@substrate-system/dialog` (`<modal-window>`),
`@substrate-system/check-box` (via `FeedShareControl`),
`@substrate-system/tapzero` (tests).

**Scope:** Phase 2 of 3.

**Codebase verified:** 2026-06-13

---

## Acceptance Criteria Coverage

This phase implements and tests:

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

---

## Engineer Orientation (read before starting)

- **Style:** 80-col max, no space before type-annotation colon, ternary `?`/`:`
  trailing, no emojis. Multi-signal writes go through `batch()` (not needed
  here — handlers set one piece of state at a time).
- **`SettingsRoute` file:** `src/client/routes/settings.ts`. It already imports
  `State` and `AppState` (line 7), already imports the preact hooks `useState`,
  `useRef`, `useEffect`, `useCallback` (all in use), and `import './settings.css'`
  (line 59). The component renders a root `<div class="route settings">` (line
  483) containing a sequence of `<section class="settings-section ...">`
  blocks. The closing `</div>` is at line 958; `<${PaymentMethodModal} ... />`
  is rendered just before it (lines 954-957).
- **Section order today:** Subscription (subscription-section, line 489) →
  Local Storage (local-first-section, 571) → Cache (cache-section, 663) →
  Subscriptions (settings-feeds-list, 744-924) → Delete (danger-zone, 926-953).
  The new "Share to Bluesky" section goes **between** the Subscriptions section
  `</section>` (line 924) and the Delete `<section class="settings-section
  danger-zone">` (line 926).
- **Reused action / signals (unchanged):**
  `State.toggleFeedPublished(state, feedId:number, publish:boolean)` (async).
  `state.feedPublishInProgress` / `state.feedPublishErrors` are read by
  `FeedShareControl`, not directly here.
- **The exact consent state/handlers/effect and consent-modal markup already
  exist in `src/client/components/feed-nav.ts`** (state/handlers at lines
  57-105, modal at lines 370-419). You are relocating them, with ONE change:
  `handleShareFeed` changes from `(ev:Event, feed:Feed)` to
  `(feedId:number, checked:boolean)` because `FeedShareControl` now extracts
  `checked` and passes `(feed.id, checked)` via its `onToggle` prop. Do NOT
  modify `feed-nav.ts` in this phase (Phase 3 removes its copy).
- **CLAUDE.md note:** `src/client/CLAUDE.md` documents a billing-scoped
  boundary that "only `payment-method-modal.ts` may import
  `@substrate-system/dialog`." That boundary is about the Stripe/billing
  surface; `feed-nav.ts` already imports `@substrate-system/dialog` for this
  same consent modal, so moving that import to `settings.ts` is consistent with
  current reality. (The Phase 3 librarian step will reconcile docs.)
- **Test mount pattern:** `test/settings-route.ts` is the reference for mounting
  `SettingsRoute`. The migrated share suites keep their own richer `makeState`
  (which provides `feedPublishInProgress` / `feedPublishErrors`) but must add
  `isAuthenticated: signal(false)`. With `isAuthenticated` false and
  `user: signal(null)`, `SettingsRoute`'s mount-time effects do NOT fetch
  billing/payment data and do NOT touch a local DB, so the ONLY network call in
  these tests is the publish POST/DELETE — keeping `globalThis.fetch` stubs
  clean.

---

<!-- START_TASK_1 -->
### Task 1: Relocate the consent-modal CSS into settings.css

**Files:**
- Modify: `src/client/routes/settings.css` (append the moved block + a
  settings-scoped override)
- Modify: `src/client/routes/feeds.css` (remove the relocated
  `modal-window.publish-consent-modal` block)

**Implementation:**

1. Cut the entire `modal-window.publish-consent-modal { ... }` top-level block
   from `src/client/routes/feeds.css` (currently lines ~36-86 — locate by
   selector). Paste it verbatim at the end of `src/client/routes/settings.css`.
   This block is global (not nested under a route class), so it keeps styling
   the consent modal wherever it renders — including the sidebar's still-present
   copy during this phase.

   Do NOT touch the `.route.feeds { ... & .feed-share-control ... }` sizing
   override in `feeds.css` yet — that is deleted in Phase 3.

2. In `src/client/routes/settings.css`, add a settings-scoped override so the
   share control (whose base rule carries a sidebar-oriented
   `margin-left: 3.5rem` from `feed-share-control.css`) sits flush in the
   settings section. Add inside the existing `.route.settings { ... }` block
   (use nested selectors per house style), or as a nested rule:

   ```css
   & .share-section {
       & .settings-share-list {
           display: flex;
           flex-direction: column;
           gap: 0.75rem;
       }

       & .feed-share-control {
           margin-left: 0;
       }
   }
   ```

   (`margin-left: 0` cancels the sidebar indent; the list spacing matches the
   other settings sections.)

**Verification:**

Run: `npm run build`
Expected: builds without errors; CSS is valid.

**Commit:** `style: relocate publish-consent modal CSS to settings`
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-4) -->

<!-- START_TASK_2 -->
### Task 2: Wire the Share to Bluesky section into SettingsRoute

**Verifies:** (implementation for) 035-share-to-settings.AC2.*, AC3.*

**Files:**
- Modify: `src/client/routes/settings.ts`

**Implementation:**

Make four edits to `src/client/routes/settings.ts`.

**(a) Imports + JSX augmentation.** Near the existing component imports, add:
```ts
import { ModalWindow } from '@substrate-system/dialog'
import '@substrate-system/dialog/css'
import { FeedShareControl } from '../components/feed-share-control.js'
```
And add the `modal-window` JSX augmentation (relocated from `feed-nav.ts`
lines 24-40) at module scope, after the imports:
```ts
type ModalWindowAttrs = preact.JSX.HTMLAttributes<HTMLElement> & {
    active?:string;
    closable?:string;
    'no-icon'?:string|boolean;
    animated?:string;
    noclick?:string|boolean;
    close?:string;
};

declare module 'preact' {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    export namespace JSX {
        interface IntrinsicElements {
            'modal-window':ModalWindowAttrs;
        }
    }
}
```
(If `settings.ts` already declares an identical `modal-window` augmentation,
do not duplicate it — verify first. As of 2026-06-13 it does not.)

**(b) Consent state + handlers + modal-close effect.** Inside the
`SettingsRoute` function body (alongside the other `useState`/`useRef`/
`useEffect` declarations, e.g. near line 117), add:
```ts
const [consentFeedId, setConsentFeedId] = useState<
    number|null
>(null)
const consentModalRef = useRef<HTMLElement|null>(null)

async function handleShareFeed (
    feedId:number,
    checked:boolean
):Promise<void> {
    if (checked) {
        setConsentFeedId(feedId)
        return
    }
    await State.toggleFeedPublished(state, feedId, false)
}

function handleConsentCancel ():void {
    setConsentFeedId(null)
}

async function handleConsentConfirm ():Promise<void> {
    const id = consentFeedId
    if (id == null) return
    setConsentFeedId(null)
    await State.toggleFeedPublished(state, id, true)
}

useEffect(() => {
    const el = consentModalRef.current
    if (!el) return
    const evt = ModalWindow.event('close')
    const handler = () => setConsentFeedId(null)
    el.addEventListener(evt, handler)
    return () => el.removeEventListener(evt, handler)
}, [consentFeedId])
```

**(c) The Share to Bluesky section markup.** Insert between the Subscriptions
section's closing `</section>` (line 924) and the Delete section's opening
`<section class="settings-section danger-zone">` (line 926):
```ts
        <section class="settings-section share-section">
            <h2>Share to Bluesky</h2>
            ${feeds.value.length === 0 ?
                html`
                    <p class="empty-state">
                        No feeds to share yet.
                    </p>
                ` :
                html`
                    <ul class="settings-share-list">
                        ${feeds.value.map(feed => html`
                            <li
                                class="settings-share-item"
                                key=${feed.url}
                            >
                                <${FeedShareControl}
                                    state=${state}
                                    feed=${feed}
                                    onToggle=${handleShareFeed}
                                />
                            </li>
                        `)}
                    </ul>
                `}
        </section>
```

**(d) The consent modal.** Relocate the `<modal-window class=
"publish-consent-modal">` block verbatim from `feed-nav.ts` lines 370-419
(its privacy copy is unchanged). Render it just before the
`<${PaymentMethodModal} ... />` element (near line 954), gated on
`consentFeedId`:
```ts
        ${consentFeedId != null && html`
            <modal-window
                ref=${consentModalRef}
                class="publish-consent-modal"
                active="true"
                closable="true"
                aria-labelledby="publish-consent-title"
                aria-describedby="publish-consent-body"
            >
                <h2 id="publish-consent-title">
                    Share to Bluesky network
                </h2>
                <div
                    id="publish-consent-body"
                    class="publish-consent-body"
                >
                    <p>Before sharing, note that:</p>
                    <ul>
                        <li>
                            Records are written to your own
                            personal data server (PDS)
                        </li>
                        <li>
                            Subscriptions are public on the
                            AT Protocol network
                        </li>
                        <li>
                            Shared subscriptions do not appear
                            in your Bluesky timeline
                        </li>
                        <li>You can remove them at any time</li>
                    </ul>
                </div>
                <div class="publish-consent-actions">
                    <button
                        type="button"
                        class="consent-cancel"
                        onClick=${handleConsentCancel}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        class="consent-confirm"
                        onClick=${handleConsentConfirm}
                    >
                        Share
                    </button>
                </div>
            </modal-window>
        `}
```

**Verification:**

Run: `npm run build`
Expected: builds and type-checks without errors.

Run: `npm run lint`
Expected: no new lint errors (watch the 80-col limit and colon spacing).

**Commit:** `feat: add Share to Bluesky section to settings`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Migrate feed-share-toggle test to SettingsRoute

**Verifies:** 035-share-to-settings.AC2.1, AC2.2, AC2.3, AC3.2, AC3.5

**Files:**
- Modify: `test/feed-share-toggle.ts`

**Implementation:**

Re-point this suite from mounting `FeedNav` to mounting `SettingsRoute`, then
keep the publish-flow assertions and add the section-structure + failure-status
assertions.

1. Change the import from
   `import { FeedNav } from '../src/client/components/feed-nav.js'`
   to
   `import { SettingsRoute } from '../src/client/routes/settings.js'`.
2. In `makeState`, add `isAuthenticated: signal(false),` to the returned object
   (keep all existing fields, especially `feedPublishInProgress` /
   `feedPublishErrors`). Add `localStorage.removeItem('rsss.localFirst')` at the
   top of each test body (mirrors `settings-route.ts`) for isolation.
3. Change `mount` to render
   `html\`<${SettingsRoute} state=${state} />\``.
4. Keep the existing two tests, adjusting them for the settings host:
   - **AC2.2** (rename the existing "renders per-feed ... toggles" test):
     mount two feeds (one `published: 0`, one `published: 1`); assert exactly
     two `check-box[name^="share-feed-"]` exist within the share section, that
     `share-feed-1` is unchecked and `share-feed-2` is checked. Scope queries to
     the share section: `root.querySelector('.share-section')` then
     `.querySelectorAll('check-box[name^="share-feed-"]')`.
   - **AC3.2** (the existing "shows progress and stores returned feed" test):
     keep the consent-confirm → POST `/api/feeds/1/publish` → row-updates flow.
     It already clicks the consent confirm button and asserts
     `state.feeds.value[0].published === 1`. Scope status-text assertions to the
     specific status span (`#share-feed-1-status`), NOT `root.textContent`
     (SettingsRoute renders much more text). Assert the status span text
     includes `Sharing...` while pending and `Published` after resolve, and the
     `check-box[name="share-feed-1"]` `disabled === true` while saving.
5. Add new tests:
   - **AC2.1** (section position): mount one feed; collect
     `root.querySelectorAll('.settings-section')` as an array; assert the index
     of the section containing `.settings-share-list` (or `.share-section`) is
     greater than the index of the section containing `.settings-feeds-list`
     (Subscriptions) and less than the index of the `.danger-zone` section
     (Delete). Model this on the existing settings-route.ts test "renders cache
     section after local-first section" (it does exactly this index comparison).
   - **AC2.3** (empty state): mount with `feeds: signal([])`; assert the share
     section contains a `.empty-state` element and contains NO
     `.settings-share-list`.
   - **AC3.5** (failure status surfaces): mount one feed; set
     `state.feedPublishErrors.value = { '1': 'boom' }`; `await nextTick()`;
     assert `#share-feed-1-status` text includes `Failed: boom` and its
     `className` contains `error`. (This directly tests the section surfacing a
     publish error; it does not require a network round-trip.)

**Testing notes:**
- Restore `globalThis.fetch` in `finally` for any test that stubs it.
- `check-box` change is simulated with `box.checked = <bool>` then
  `box.dispatchEvent(new Event('change', { bubbles: true }))`.
- Do not assert on `@substrate-system/check-box` internal DOM text beyond the
  visible label; query by `name` attribute.

**Verification:**

Run: `npm run test:browser`
Expected: the migrated `feed-share-toggle` tests pass; no `console.error`.

**Commit:** `test: migrate feed-share-toggle suite to settings route`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Migrate publish-consent-modal test to SettingsRoute

**Verifies:** 035-share-to-settings.AC3.1, AC3.3, AC3.4, AC3.6

**Files:**
- Modify: `test/publish-consent-modal.ts`

**Implementation:**

Re-point this suite from `FeedNav` to `SettingsRoute` (same import / `makeState`
/ `mount` changes as Task 3: import `SettingsRoute`, add
`isAuthenticated: signal(false)`, render `SettingsRoute`, add
`localStorage.removeItem('rsss.localFirst')` per test). Keep the existing tests
and add the missing AC cases.

Keep / adjust the existing tests (they already cover these once re-pointed):
- **AC3.1** ("Share toggle shows consent modal before publishing"): enable
  `share-feed-1` → assert `modal-window.publish-consent-modal` is present and
  `active === 'true'`, and that no publish fetch fired yet. Add a `fetch` stub
  that flips a `publishCalled` flag and assert it stayed `false`.
- **AC3.3** ("Canceling consent modal does not publish"): keep as-is — click
  `button.consent-cancel`, assert no publish fetch and modal closed
  (`active` attribute gone / `null`).
- (The "Consent modal contains required privacy copy" test may stay; it asserts
  on the moved copy. Keep it — the copy is unchanged.)
- (The existing "Confirming consent modal proceeds with publish" test overlaps
  AC3.2 which Task 3 covers; you may keep it here too — it still passes against
  SettingsRoute.)

Add new tests:
- **AC3.4** (disable published → unpublish immediately, no modal): mount a feed
  with `published: 1`; stub `globalThis.fetch` to capture method + url and
  return an updated feed row (`published: 0`); set the
  `check-box[name="share-feed-1"]` `checked = false` and dispatch `change`;
  `await nextTick()`. Assert NO `modal-window.publish-consent-modal` appeared,
  and the captured request was `DELETE /api/feeds/1/publish`. (The unchecked
  path calls `State.toggleFeedPublished(state, id, false)` directly, which
  DELETEs.)
- **AC3.6** (modal close event resets `consentFeedId`): enable `share-feed-1`
  to open the modal; grab the modal element and dispatch its close event —
  `modal.dispatchEvent(new Event(ModalWindow.event('close')))` (import
  `ModalWindow` from `@substrate-system/dialog` in the test). `await nextTick()`;
  assert the modal is gone (`document.querySelector(
  'modal-window.publish-consent-modal')` is null / no longer `active`),
  confirming `consentFeedId` was reset.

**Verification:**

Run: `npm run test:browser`
Expected: the migrated `publish-consent-modal` tests pass; no `console.error`.

If mounting `SettingsRoute` inside the `browser-tests.ts` bundle surfaces a
shared-singleton conflict with a neighboring suite (unlikely — these tests set
`isAuthenticated: false` and reset `localStorage`), the fallback is to move the
`import './feed-share-toggle.js'` and `import './publish-consent-modal.js'`
lines out of `test/browser-tests.ts` and into `test/index.ts` (next to
`import './settings-route.js'`), which is the bundle that already mounts
`SettingsRoute`. Prefer keeping them in `browser-tests.ts`; only move if a real
conflict appears.

**Commit:** `test: migrate publish-consent-modal suite to settings route`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->

---

## Phase 2 Done When

- `npm run build` and `npm run lint` succeed.
- `npm run test:browser` passes, including the migrated `feed-share-toggle` and
  `publish-consent-modal` suites mounted against `SettingsRoute`.
- Sharing and unsharing work end-to-end from the settings page with the consent
  gate on enable and immediate unpublish on disable; publish status is
  reflected; the zero-feed empty state renders.
- The sidebar still shows its share control (removed in Phase 3) — duplication
  is intentional this phase.
- Covers 035-share-to-settings.AC2.* and AC3.*.
