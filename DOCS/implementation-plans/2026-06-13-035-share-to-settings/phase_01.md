# Move "Share to Bluesky" to Settings — Implementation Plan

**Goal:** Extract the per-feed Bluesky share control out of `FeedNav` into a
standalone, presentational `FeedShareControl` component (unused for now),
covered by an isolation test.

**Architecture:** Pure client-side UI. `FeedShareControl` owns no state — it
derives its display values from an `AppState` + a `Feed` and calls back an
`onToggle(feedId, checked)` prop on checkbox change. It renders the existing
`@substrate-system/check-box` plus the publish-status `<span>`. The consent
modal and the publish action stay out of this component (they live in the
settings orchestration added in Phase 2).

**Tech Stack:** TypeScript (browser, ES2022 via Vite), Preact, `htm/preact`,
`@preact/signals`, `@substrate-system/check-box`, `@substrate-system/tapzero`
(tests).

**Scope:** Phase 1 of 3 from the design plan
(`DOCS/design-plans/2026-06-13-035-share-to-settings.md`).

**Codebase verified:** 2026-06-13

---

## Acceptance Criteria Coverage

This phase implements and tests:

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

---

## Engineer Orientation (read before starting)

You have zero context for this codebase. Key facts:

- **Code style (enforced by lint, `npm run lint`):** No line longer than 80
  columns. No space between a colon and a type annotation
  (`name:string`, not `name: string`). Ternaries break with the `?` and `:`
  at the end of the line (see existing code below). No emojis in code or
  comments. These are hard requirements — match the surrounding code exactly.
- **Rendering:** Components are Preact function components written with
  `htm/preact` tagged-template `html`...`` syntax (not JSX). Custom elements
  like the checkbox are rendered as `<${CheckBox.TAG} ...>` and closed with
  `<//>`.
- **State:** `AppState` (exported from `src/client/state.js`) is a bag of
  `@preact/signals` signals. `Feed` is exported from both
  `src/client/state.js` (re-export) and `src/client/db/types.js`. The two
  signals this component reads are:
  - `state.feedPublishInProgress` — `Signal<Record<string, boolean>>`, keyed
    by `String(feedId)`.
  - `state.feedPublishErrors` — `Signal<Record<string, string>>`, keyed by
    `String(feedId)`.
  - `feed.published` — optional `number` (1 means published).
  - `feed.publish_error` — optional `string|null`.
- **Precedent component:** `src/client/components/cache-settings.ts` is the
  pattern to follow for a feed-scoped presentational component consumed by a
  route. Its shape is:
  ```ts
  export const CacheSettings:FunctionComponent<{
      state:AppState;
      selectedFeed:Feed;
  }> = function CacheSettings ({ state, selectedFeed }) { ... }
  ```
  It imports its CSS via a sibling `import './cache-settings.css'`.
- **Source of the code you are extracting:** the current share UI lives in
  `src/client/components/feed-nav.ts`. Do NOT modify `feed-nav.ts` in this
  phase — you are copying its logic into the new component. `feed-nav.ts` is
  decluttered later, in Phase 3. Temporary duplication is intentional.

**Exact derivation logic to replicate** (from `feed-nav.ts:226-245`, verbatim
behavior — note the status string is `'Sharing...'` with three ASCII dots,
and the status class has a leading space `' error'`):
```ts
const publishKey = String(feed.id)
const publishPending = Boolean(
    state.feedPublishInProgress
        .value[publishKey]
)
const publishError = (
    state.feedPublishErrors
        .value[publishKey] ??
    feed.publish_error ??
    null
)
const isPublished = feed.published === 1
const publishStatus = publishPending ?
    'Sharing...' :
    publishError ?
        `Failed: ${publishError}` :
        isPublished ? 'Published' : ''
const publishStatusClass = publishError ?
    ' error' :
    ''
```

**Exact markup to replicate** (from `feed-nav.ts:321-348`): the
`<div class="feed-share-control">` wrapper containing the `<${CheckBox.TAG}>`
(with label text `Share to Bluesky`, `name="share-feed-${feed.id}"`,
`aria-describedby="share-feed-${feed.id}-status"`, `checked`/`disabled`
mirrored from `isPublished`/`publishPending`) and the status `<span
class="feed-share-state${publishStatusClass}" id="share-feed-${feed.id}-status"
role="status" aria-live="polite">`. The one change from `feed-nav.ts`: the
checkbox `onChange` must call the `onToggle` prop, not an internal handler —
extract `checked` from the event and call `onToggle(feed.id, checked)`.

**Testing approach (mirror `test/feed-share-toggle.ts`):** `@substrate-system/
tapzero` `test(name, async t => {})`. Mount a component into a fresh `<div>`
appended to `document.body`, `await nextTick()`, query with `querySelector`,
assert, then `unmount` in a `finally`. A `<check-box>` change is simulated by
setting `box.checked` then `box.dispatchEvent(new Event('change', { bubbles:
true }))`. Do NOT assert on full-page text content; query specific elements.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create the FeedShareControl component CSS

**Files:**
- Create: `src/client/components/feed-share-control.css`
- Modify: `src/client/style.css` (remove the relocated rules)

**Implementation:**

Move the `.feed-share-control` and `.feed-share-state` (+ `.error`) rule
blocks out of `src/client/style.css` (currently at lines ~263-284 — locate
them by selector, not line number) and into the new
`src/client/components/feed-share-control.css`. Move them verbatim. The exact
current rules are:

```css
/* The "Share to Bluesky" control sits on its own line below the feed
   title, indented to align under the title (past the unread-count badge). */
.feed-share-control {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-left: 3.5rem;

    & check-box {
        color: var(--color-text);
    }
}

.feed-share-state {
    color: var(--color-text-secondary);
    font-size: 1rem;

    &.error {
        color: var(--color-error);
    }
}
```

In `src/client/style.css`, delete those two rule blocks (including the
leading comment) so they are not duplicated. Leave the rest of `style.css`
untouched.

Note (no action required): the `margin-left: 3.5rem` indent was for sidebar
alignment. Phase 2 may add a settings-scoped override; do not add one here.

Note on transient styling: between this phase and Phase 2, the sidebar's
still-present share control briefly loses these styles (the component CSS is
only bundled once something imports `FeedShareControl`, which happens in
Phase 2). This is expected and harmless; Phase 3 removes the sidebar copy.

**Verification:**

Run: `npm run build`
Expected: builds without errors (CSS is syntactically valid; no missing
references introduced).

**Commit:** `refactor: move feed-share CSS into component stylesheet`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create the FeedShareControl component

**Verifies:** (implementation for) 035-share-to-settings.AC1.1, AC1.2, AC1.3,
AC1.4, AC1.5

**Files:**
- Create: `src/client/components/feed-share-control.ts`

**Implementation:**

Create the presentational component following the `cache-settings.ts`
precedent and the design contract. It imports the checkbox element and the
CSS from Task 1, derives the publish display values (using the exact logic in
the orientation section), and renders the share-control markup. The checkbox
`onChange` extracts `checked` and calls `onToggle(feed.id, checked)`.

Contract (from the design):
```ts
export const FeedShareControl:FunctionComponent<{
    state:AppState;
    feed:Feed;
    onToggle:(feedId:number, checked:boolean) => void;
}>
```

Complete file:

```ts
import { html } from 'htm/preact/index.js'
import { type FunctionComponent } from 'preact'
import { CheckBox } from '@substrate-system/check-box'
import {
    type Feed,
    type AppState
} from '../state.js'
import './feed-share-control.css'

export const FeedShareControl:FunctionComponent<{
    state:AppState;
    feed:Feed;
    onToggle:(feedId:number, checked:boolean) => void;
}> = function FeedShareControl ({ state, feed, onToggle }) {
    const publishKey = String(feed.id)
    const publishPending = Boolean(
        state.feedPublishInProgress
            .value[publishKey]
    )
    const publishError = (
        state.feedPublishErrors
            .value[publishKey] ??
        feed.publish_error ??
        null
    )
    const isPublished = feed.published === 1
    const publishStatus = publishPending ?
        'Sharing...' :
        publishError ?
            `Failed: ${publishError}` :
            isPublished ? 'Published' : ''
    const publishStatusClass = publishError ?
        ' error' :
        ''

    return html`
        <div class="feed-share-control">
            <${CheckBox.TAG}
                name=${`share-feed-${feed.id}`}
                aria-describedby=${
                    `share-feed-${feed.id}-status`
                }
                checked=${
                    isPublished || undefined
                }
                disabled=${
                    publishPending || undefined
                }
                onChange=${(ev:Event) => {
                    const checked = (
                        ev.target as HTMLInputElement
                    ).checked
                    onToggle(feed.id, checked)
                }}
            >
                Share to Bluesky
            <//>
            <span
                class=${'feed-share-state' +
                    publishStatusClass}
                id=${`share-feed-${feed.id}-status`}
                role="status"
                aria-live="polite"
            >
                ${publishStatus}
            </span>
        </div>
    `
}
```

**Verification:**

Run: `npm run build`
Expected: builds without errors (type-checks; the import of
`@substrate-system/check-box` and `./feed-share-control.css` resolve).

**Commit:** `feat: add FeedShareControl presentational component`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Isolation test for FeedShareControl

**Verifies:** 035-share-to-settings.AC1.1, AC1.2, AC1.3, AC1.4, AC1.5

**Files:**
- Create: `test/feed-share-control.ts`
- Modify: `test/browser-tests.ts` (register the new test in the bundle)

**Implementation:**

Create `test/feed-share-control.ts` mounting `<FeedShareControl>` directly
(not via a route) with a fake `AppState`, a `feed()` factory, and an
`onToggle` spy. Reuse the fake-state shape from `test/feed-share-toggle.ts`
(it provides the `feedPublishInProgress` / `feedPublishErrors` signals this
component reads). Mount the component with `state`, a single `feed`, and the
spy as `onToggle`.

The component reads only `state.feedPublishInProgress` and
`state.feedPublishErrors`, plus the `feed` fields — so a minimal fake state
with just those two signals (cast `as unknown as AppState`) is sufficient.

Write these tests (one `test(...)` per AC case; do NOT assert on whole-page
text — query the specific `check-box[name="share-feed-<id>"]` and the
`#share-feed-<id>-status` span):

- **AC1.1** — feed with `published: 0`, no error, no in-progress entry: the
  checkbox exists, `checked === false`, `disabled === false`, and the status
  span's `textContent` is empty (trimmed).
- **AC1.2** — feed with `published: 1`: checkbox `checked === true`, status
  span text includes `Published`.
- **AC1.3** — `feedPublishInProgress` set to `{ '<id>': true }`: checkbox
  `disabled === true`, status span text includes `Sharing...`.
- **AC1.4** — `feedPublishErrors` set to `{ '<id>': 'boom' }` (or a feed with
  `publish_error: 'boom'`): status span text includes `Failed: boom`, and the
  span's `className` contains `error`.
- **AC1.5** — set `box.checked = true` then dispatch a bubbling `change`
  event; assert the spy was called once with `(feed.id, true)`. Then for the
  unchecked path, render a published feed, set `box.checked = false`,
  dispatch `change`, and assert the spy was called with `(feed.id, false)`.

Reference `TestCheckBox` type and the `feed()` factory exactly as in
`test/feed-share-toggle.ts`:
```ts
type TestCheckBox = HTMLElement & {
    checked:boolean
    disabled:boolean
}
```

Then register the test in `test/browser-tests.ts` by adding an import
alongside the other share tests (after the existing
`import './publish-consent-modal.js'` line):
```ts
import './feed-share-control.js'
```
(Do NOT add a line to `test/run-all-tests.mjs`; browser component tests are
registered as imports in `test/browser-tests.ts`, which the `test:browser`
command bundles and runs.)

**Verification:**

Run: `npm run test:browser`
Expected: the new `FeedShareControl` tests appear in the TAP output and pass;
no `console.error` (tapout fails the run on any `console.error` even with
green TAP).

**Commit:** `test: add FeedShareControl isolation tests`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

---

## Phase 1 Done When

- `npm run build` succeeds.
- `npm run test:browser` runs the new `test/feed-share-control.ts` and all its
  assertions pass (checkbox reflects published/pending/disabled; status span
  reflects published/error/pending; `onToggle` fires with `(feed.id,
  checked)`).
- `FeedShareControl` is additive — nothing imports it yet; `feed-nav.ts` is
  unchanged.
- Covers 035-share-to-settings.AC1.*.
