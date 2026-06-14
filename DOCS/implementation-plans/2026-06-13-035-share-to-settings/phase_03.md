# Move "Share to Bluesky" to Settings — Phase 3

**Goal:** Strip all sharing UI out of `FeedNav` so the sidebar and the mobile
`/feeds` route render single-line feed rows again, remove the now-dead CSS, and
add a regression guard proving `FeedNav` no longer renders a share checkbox or
consent modal.

**Architecture:** Removal-only. `FeedNav` keeps its routing job (unread count,
pending count, title link, resolving spinner / "Failed to fetch", retry,
delete). The share feature now lives solely in `SettingsRoute` (added in
Phase 2). `FeedNav` is rendered on two surfaces — the desktop sidebar
(`components/sidebar.ts`) and the mobile `/feeds` route (`routes/feeds.ts`) — so
removing the control from `FeedNav` removes it from both at once.

**Tech Stack:** TypeScript (browser, ES2022 via Vite), Preact, `htm/preact`,
`@substrate-system/tapzero` (tests).

**Scope:** Phase 3 of 3.

**Codebase verified:** 2026-06-13

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 035-share-to-settings.AC4: Sidebar decluttered
- **035-share-to-settings.AC4.1 Success:** Mounting `FeedNav` renders no share
  checkbox.
- **035-share-to-settings.AC4.2 Success:** Mounting `FeedNav` renders no
  consent modal.
- **035-share-to-settings.AC4.3 Success:** `FeedNav` still renders feed
  navigation (unread count, title link, delete) — relocation didn't break the
  sidebar.

---

## Engineer Orientation (read before starting)

- **Style:** 80-col max, no space before type-annotation colon, ternary `?`/`:`
  trailing, no emojis.
- **Do not touch `SettingsRoute` or `FeedShareControl`** — Phases 1-2 already
  host the feature there. This phase only deletes from `feed-nav.ts` and
  `feeds.css`, confirms `style.css`, and adds a test.
- **Remove by matching code, not by line number.** Line numbers below are the
  pre-edit positions for orientation; once you delete an early block the later
  numbers shift. Delete each block by its content.
- **After deleting the share UI, two imported hooks become unused** in
  `feed-nav.ts` (`useEffect` and `useRef` are used ONLY by the consent
  machinery). Trim them from the `preact/hooks` import or `npm run lint` will
  fail on unused imports. `useState` and `useCallback` remain in use.

---

<!-- START_TASK_1 -->
### Task 1: Remove the share UI from FeedNav

**Files:**
- Modify: `src/client/components/feed-nav.ts`

**Implementation:**

Delete the following from `src/client/components/feed-nav.ts`. After each
deletion, the file must still build.

1. **Imports** (lines 4-6):
   ```ts
   import { CheckBox } from '@substrate-system/check-box'
   import { ModalWindow } from '@substrate-system/dialog'
   import '@substrate-system/dialog/css'
   ```

2. **Trim unused hooks** — change the hooks import (line 3) from:
   ```ts
   import { useState, useCallback, useEffect, useRef } from 'preact/hooks'
   ```
   to:
   ```ts
   import { useState, useCallback } from 'preact/hooks'
   ```

3. **The `ModalWindowAttrs` type + `declare module 'preact'` augmentation**
   (lines 24-40 — the whole `type ModalWindowAttrs = ...` block through the
   closing `}` of the `declare module 'preact'` block). `settings.ts` now owns
   this declaration (added in Phase 2), and `payment-method-modal.ts` also
   declares it, so removing the `feed-nav.ts` copy leaves the JSX type intact
   app-wide.

4. **The consent state** (lines 57-60):
   ```ts
   const [consentFeedId, setConsentFeedId] = useState<
       number|null
   >(null)
   const consentModalRef = useRef<HTMLElement|null>(null)
   ```

5. **The three handlers** (lines 75-96): `handleShareFeed`,
   `handleConsentCancel`, and `handleConsentConfirm` (the whole block from
   `async function handleShareFeed (` through the closing `}` of
   `handleConsentConfirm`).

6. **The modal-close `useEffect`** (lines 98-105):
   ```ts
   useEffect(() => {
       const el = consentModalRef.current
       if (!el) return
       const evt = ModalWindow.event('close')
       const handler = () => setConsentFeedId(null)
       el.addEventListener(evt, handler)
       return () => el.removeEventListener(evt, handler)
   }, [consentFeedId])
   ```

7. **The publish-status derivation** inside `feeds.value.map(...)` (lines
   226-245): the `publishKey`, `publishPending`, `publishError`, `isPublished`,
   `publishStatus`, and `publishStatusClass` `const` declarations. Leave the
   surrounding `feedPath` / `isActive` / `feedUnread` / `pending` /
   `isResolving` / `hasFailed` / `stateClass` lines intact.

8. **The `.feed-share-control` block** (lines 321-348): the entire
   ```ts
   <div class="feed-share-control">
       <${CheckBox.TAG} ...>
           Share to Bluesky
       <//>
       <span class=${'feed-share-state' + publishStatusClass} ...>
           ${publishStatus}
       </span>
   </div>
   ```
   After removal, the feed-item `<div>` closes directly after its
   `<div class="feed-item-row">...</div>` (the row becomes single-line again).

9. **The consent `<modal-window>` block** (lines 370-420): the entire
   ```ts
   ${consentFeedId != null && html`
       <modal-window ref=${consentModalRef} class="publish-consent-modal" ...>
           ...
       </modal-window>
   `}
   ```

**After deleting, verify nothing dangles:** grep the file for `CheckBox`,
`ModalWindow`, `consentFeedId`, `consentModalRef`, `publishStatus`,
`publishPending`, `publishError`, `feed-share`, and `handleConsent` — there
should be zero matches.

**Verification:**

Run: `npm run build`
Expected: builds and type-checks (no unused-import or unresolved-symbol
errors).

Run: `npm run lint`
Expected: no errors (in particular, no unused-import errors for `useEffect` /
`useRef` / `CheckBox` / `ModalWindow`).

**Commit:** `refactor: remove share UI from FeedNav sidebar`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Remove the dead feed-share CSS override from feeds.css

**Files:**
- Modify: `src/client/routes/feeds.css`
- Confirm (no edit expected): `src/client/style.css`

**Implementation:**

1. In `src/client/routes/feeds.css`, delete the now-dead nested overrides
   inside the `.route.feeds { ... }` block (currently lines ~19-32):
   ```css
       & .feed-share-control check-box {
           & label {
               gap: 0.4rem;
           }

           & input {
               width: 1rem;
               height: 1rem;
           }
       }

       & .feed-share-state {
           min-height: 1rem;
       }
   ```
   Also remove any now-orphaned explanatory comment that referred only to the
   share control. Leave the other `.route.feeds` rules (`.sidebar-item`,
   `.item-controls button`, etc.) untouched. The
   `modal-window.publish-consent-modal` block was already moved to
   `settings.css` in Phase 2 — confirm it is gone from `feeds.css`.

2. In `src/client/style.css`, confirm the `.feed-share-control` and
   `.feed-share-state` rules were already removed in Phase 1 (Task 1 of
   phase_01). Grep `style.css` for `feed-share` — expect zero matches. No edit
   if already clean.

**Verification:**

Run: `npm run build`
Expected: builds; CSS valid.

Run: `grep -rn 'feed-share' src/client/style.css src/client/routes/feeds.css`
Expected: no matches in either file (the rules now live only in
`components/feed-share-control.css`).

**Commit:** `style: remove dead feed-share overrides from feeds route`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add a FeedNav regression guard test

**Verifies:** 035-share-to-settings.AC4.1, AC4.2, AC4.3

**Files:**
- Create: `test/feed-nav.ts`
- Modify: `test/browser-tests.ts` (register the new test in the bundle)

**Implementation:**

Create `test/feed-nav.ts` that mounts `FeedNav` and asserts the share UI is
gone while feed navigation still renders. Model the mount/`makeState`/`feed`
factory on the pre-migration `test/feed-share-toggle.ts` (which mounted
`FeedNav`). `FeedNav` reads `feedsLoading`, `feedsError`, `feeds`, `route`,
`counts`, and `feedUpdateCounts` from state, so the fake state must provide
those signals (cast `as unknown as AppState`):

```ts
import { signal } from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { test } from '@substrate-system/tapzero'
import { FeedNav } from '../src/client/components/feed-nav.js'
import { type AppState, type Feed } from '../src/client/state.js'

function feed (id:number, overrides:Partial<Feed> = {}):Feed {
    return {
        id,
        url: `https://example.com/feed-${id}.xml`,
        title: `Feed ${id}`,
        description: null,
        site_url: null,
        last_fetched: '2026-06-10 00:00:00',
        last_error: null,
        last_status: 200,
        published: 0,
        published_rkey: null,
        published_at: null,
        publish_error: null,
        created_at: '2026-06-10 00:00:00',
        updated_at: '2026-06-10 00:00:00',
        ...overrides
    }
}

function makeState (feeds:Feed[]):AppState {
    return {
        feeds: signal(feeds),
        feedsLoading: signal(false),
        feedsError: signal(null),
        feedPublishInProgress: signal({}),
        feedPublishErrors: signal({}),
        route: signal('/'),
        user: signal(null),
        showUnreadOnly: signal(false),
        showStarredOnly: signal(false),
        counts: signal({
            unread: 3,
            starred: 0,
            total: 3,
            perFeed: { 1: 3 }
        }),
        feedUpdateCounts: signal({}),
        _setRoute: () => {}
    } as unknown as AppState
}

function mount (state:AppState):HTMLElement {
    const root = document.createElement('div')
    document.body.appendChild(root)
    render(html`<${FeedNav} state=${state} />`, root)
    return root
}

function unmount (root:HTMLElement):void {
    render(null, root)
    root.remove()
}

function nextTick ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}
```

Write three tests:

- **AC4.1** (no share checkbox): mount `makeState([feed(1), feed(2, {
  published: 1 })])`; `await nextTick()`; assert
  `root.querySelector('check-box')` is `null` and
  `root.querySelector('check-box[name^="share-feed-"]')` is `null`.
- **AC4.2** (no consent modal): same mount; assert
  `root.querySelector('modal-window.publish-consent-modal')` is `null`. (The
  modal was previously rendered inside `FeedNav`'s own tree, so a scoped
  `root` query is the correct check.)
- **AC4.3** (nav still works): same mount; assert the sidebar still renders a
  feed-unread-count badge (`root.querySelector('.feed-unread-count')` exists), a
  feed title link (`root.querySelector('a.feed-select')` exists), and a delete
  button (`root.querySelector('.btn-delete')` exists). Wrap each test body in
  `try { ... } finally { unmount(root) }`.

Register the test by adding an import to `test/browser-tests.ts`, alongside the
other component tests (e.g. after `import './feed-share-control.js'`):
```ts
import './feed-nav.js'
```
(Do NOT add to `test/run-all-tests.mjs`.)

**Verification:**

Run: `npm run test:browser`
Expected: the new `feed-nav` regression tests pass; no `console.error`.

**Commit:** `test: guard FeedNav against share-UI regression`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Full suite + lint

**Files:** none (verification only).

**Implementation:**

Run the full project gate to confirm nothing regressed across all surfaces.

**Verification:**

Run: `npm test && npm run lint`
Expected: the entire suite passes (browser bundles, node tests, static checks)
and lint is clean. In particular the migrated Phase 2 suites and the Phase 3
regression guard pass, and there are no unused-import lint errors in
`feed-nav.ts`.

Manually confirm (optional, if a dev server is handy): the desktop sidebar and
the mobile `/feeds` route show single-line feed rows with no "Share to Bluesky"
checkbox, and `/settings` has a working "Share to Bluesky" section.

**Commit:** none (this task gates; prior commits stand).
<!-- END_TASK_4 -->

---

## Phase 3 Done When

- `npm test && npm run lint` pass.
- `FeedNav` renders no share checkbox and no consent modal; feed rows in the
  sidebar and the mobile `/feeds` route are single-line again.
- The dead `.feed-share-control` / `.feed-share-state` overrides are gone from
  `feeds.css` and `style.css`; those rules now live only in
  `components/feed-share-control.css`.
- The regression guard (`test/feed-nav.ts`) confirms no checkbox / modal in
  `FeedNav` and that nav still renders.
- Covers 035-share-to-settings.AC4.*.
