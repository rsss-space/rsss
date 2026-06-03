# Mobile Feeds View (`/feeds`) Implementation Plan — Phase 1

**Goal:** Extract the desktop sidebar's inner body into a new shared
`FeedNav` component so it can later be reused by a mobile `/feeds` route,
with the desktop sidebar rendering and behaving identically.

**Architecture:** `FeedNav` (new, `src/client/components/feed-nav.ts`) holds
all the markup, local add-feed state, handlers, and child-component usage
currently inside `Sidebar`. `Sidebar` becomes a thin wrapper:
`<aside class="sidebar"><FeedNav state/></aside>`. This is a pure refactor —
no behavior change, no new signals, no CSS rule changes.

**Tech Stack:** TypeScript (browser, ES2022 via Vite), Preact,
`@preact/signals`, `htm/preact`. Tests via `@substrate-system/tapzero` +
`tapout` (`.ts`) and `node:test` + `node:assert/strict` (`.mjs` static).

**Scope:** Phase 1 of 3 from
`docs/design-plans/2026-05-30-027-mobile-feeds-route.md`.

**Codebase verified:** 2026-05-30 (via codebase-investigator agents).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 027-mobile-feeds-route.AC3: `/feeds` exposes the same controls as the desktop sidebar via a shared component
- **027-mobile-feeds-route.AC3.2 Success:** `Sidebar` (desktop) renders the
  same `<FeedNav>` — single source of truth.
- **027-mobile-feeds-route.AC3.3 Success:** `FeedNav` contains the full
  control set: All Items + Starred (`SidebarItem`), the Feeds header (gear ->
  `/settings`, "+" add-feed toggle + form), the feed list (per-feed unread
  count, pending count, resolving spinner, failed label, retry, delete), and
  `SidebarFooter` (Refresh Feeds + Settings).

### 027-mobile-feeds-route.AC5: Desktop behavior and breakpoints are unchanged
- **027-mobile-feeds-route.AC5.1 Success:** After the `FeedNav` extraction,
  the desktop sidebar renders and behaves identically
  (add/delete/retry/refresh/navigation/counts/spinner/failed states).

---

## Context for the implementing engineer

You are refactoring a Preact client. Components are written with
`htm/preact` tagged template literals (NOT JSX): a component call looks like
`<${Component} prop=${value}>children<//>` and a closing tag is `<//>`.
A component returns a single `html\`...\`` template; multiple sibling roots
are wrapped in a Preact `Fragment`.

The desktop layout (`src/client/routes/feed-reader.ts:188`) renders
`<${Sidebar} state=${state} />`. The `Sidebar` component currently lives in
`src/client/components/sidebar.ts` and contains everything: state, handlers,
and the full feed-management markup.

**Current `sidebar.ts` shape (verified, 261 lines):**
- Imports (lines 1–19): `html`, `FunctionComponent`, `useState`/`useCallback`,
  `CogWheel`, `SidebarItem`, `SidebarFooter`, `Button`, `CloseIcon`,
  `ELLIPSIS`, `ButtonIcon`, `{ type Feed, type AppState, State, stripProtocol }`
  from `../state.js`, `import './sidebar.css'`, and a `Debug` logger
  (`const debug = Debug('rsss:view')`).
- Component (lines 21–261): destructures
  `{ feedsLoading, feedsError, feeds, route, counts }` from `state`; local
  `useState` for `showAddFeed` / `addingFeed` / `addFeedError`; handlers
  `handleDeleteFeed` (calls `State.deleteFeed`) and `handleAddFeed`
  (`useCallback`, reads the form input via
  `els.namedItem('new-feed-url') as HTMLInputElement`, calls `State.addFeed`);
  `const allFeeds = !route.value.startsWith('/feed/')` (a plain boolean, NOT
  a signal/computed); then `return html\`<aside class="sidebar"> ... </aside>\``
  containing two `.sidebar-section` blocks and `<${SidebarFooter} state/>`.

**CSS facts (verified):** Only the `.sidebar` rule itself (width, background,
flex, overflow) is `.sidebar`-scoped, in `sidebar.css`. Almost everything the
body renders is styled by GLOBAL class rules in `sidebar.css`
(`.sidebar-section`, `.sidebar-header`, `.feeds-controls`, `.item-controls`,
`.feeds-list .feed-item` and its children) and in `style.css` (`.badge`,
`.feed-item`, `.feed-select`, `.btn-delete`, `.feeds-list`, `.add-feed-form`,
`.form-error`, `.empty-state`, `.loading-text`). The mobile-hide rule
`@media (width < 768px) { .sidebar { display: none } }` lives in `style.css`
(NOT `sidebar.css`). Do not modify any of these files in this phase.

**CSS ownership decision for this refactor:** Move the `import './sidebar.css'`
into `feed-nav.ts` (the component that renders the markup those rules style),
so `FeedNav` is self-contained and will carry its inner styling into the
future `/feeds` route without depending on the desktop module graph being
bundled. The thin `Sidebar` wrapper then receives `sidebar.css` transitively
through `FeedNav` (it still imports `feed-nav.js`), so the `.sidebar`
container rule still applies to the `<aside>`. Vite bundles all imported CSS
app-wide, and these rules are uniquely scoped, so source-order changes cannot
alter resolution — desktop styling stays identical.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create the shared `FeedNav` component

**Verifies:** 027-mobile-feeds-route.AC3.3 (FeedNav holds the full control
set), and is the foundation for AC3.2.

**Files:**
- Create: `src/client/components/feed-nav.ts`
- Reference (read, do not yet edit): `src/client/components/sidebar.ts:1-261`

**Implementation:**

Create `feed-nav.ts` by moving the entire current `Sidebar` body into a new
`FeedNav` component with the identical `{ state:AppState }` prop. Concretely:

1. Copy imports lines 1–19 from `sidebar.ts` into `feed-nav.ts` verbatim,
   including `import './sidebar.css'` and the `Debug` logger line. (These are
   the imports the body actually uses.)
2. Export the component as `FeedNav` instead of `Sidebar`, same signature:
   ```ts
   export const FeedNav:FunctionComponent<{
       state:AppState
   }> = function ({ state }) {
   ```
3. Move the component body verbatim — the `state` destructure
   (`feedsLoading`, `feedsError`, `feeds`, `route`, `counts`), the three
   `useState` hooks, `handleDeleteFeed`, `handleAddFeed`, and
   `const allFeeds = !route.value.startsWith('/feed/')`.
4. Change ONLY the return's outer wrapper: instead of returning
   `<aside class="sidebar"> ...three children... </aside>`, return a Preact
   `Fragment` containing the SAME three children (the two
   `<div class="sidebar-section">` blocks and `<${SidebarFooter} state/>`),
   with NO `<aside>` and NO `class="sidebar"`. Add `Fragment` to the existing
   `preact` import:
   ```ts
   import { type FunctionComponent, Fragment } from 'preact'
   ```
   and wrap the children:
   ```ts
   return html`
       <${Fragment}>
           <div class="sidebar-section"> ... </div>
           <div class="sidebar-section"> ... </div>
           <${SidebarFooter} state=${state} />
       <//>
   `
   ```
   Keep every inner line (the `SidebarItem` rows, the Feeds header with the
   `<a class="cog-wheel" href="/settings">` gear and the `ButtonIcon` "+"
   toggle, the `add-feed-form`, the `feeds-list` with the All Feeds row,
   loading text, the `feeds.value.map(...)` per-feed entries — unread badge,
   `(pending)` count, `feed-spinner`, `feed-select` link, `feed-failed-label`,
   `item-controls` retry/delete — and the empty-state) byte-for-byte as in
   `sidebar.ts`. The `Fragment` renders no DOM node, so the resulting DOM is
   identical to the old `<aside>`'s children.

Keep all lines within 80 columns (match the existing wrapping in
`sidebar.ts`).

**Testing:** No standalone test for this task; Task 3 covers it (the retargeted
static test reads `feed-nav.ts`).

**Verification:**
Run: `npm run build`
Expected: Builds without TypeScript errors. (`feed-nav.ts` is not yet imported
anywhere, but it must type-check.)

**Commit:** `refactor: add shared FeedNav component (extract from Sidebar)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Slim `Sidebar` to a thin wrapper around `FeedNav`

**Verifies:** 027-mobile-feeds-route.AC3.2 (Sidebar renders `<FeedNav>`),
027-mobile-feeds-route.AC5.1 (desktop identical).

**Files:**
- Modify: `src/client/components/sidebar.ts` (replace its entire contents)

**Implementation:**

Replace the full contents of `sidebar.ts` with the thin wrapper. It imports
only what the wrapper needs and renders `<aside class="sidebar">` around
`<FeedNav>`. Do NOT import `./sidebar.css` here — `FeedNav` now owns that
import (see the CSS ownership decision above).

```ts
import { html } from 'htm/preact/index.js'
import { type FunctionComponent } from 'preact'
import { type AppState } from '../state.js'
import { FeedNav } from './feed-nav.js'

export const Sidebar:FunctionComponent<{
    state:AppState
}> = function ({ state }) {
    return html`
        <aside class="sidebar">
            <${FeedNav} state=${state} />
        </aside>
    `
}
```

`feed-reader.ts:188` still renders `<${Sidebar} state=${state} />` — no change
there. The `.sidebar` container rule applies to the `<aside>` (sidebar.css is
bundled via `FeedNav`), and the `Fragment` from `FeedNav` injects the two
sections + footer directly as the `<aside>`'s flex children — exactly as
before.

**Testing:** Covered by Task 3 (asserts `sidebar.ts` references `FeedNav`).

**Verification:**
Run: `npm run build && npm run lint`
Expected: Build and lint both pass.

Manual parity check (required by AC5.1 — desktop must be identical): start the
dev server (`npm run dev` — confirm the exact script in `package.json`), open
the app at desktop width (>=768px), and confirm the sidebar renders and
behaves identically: All Items / Starred rows with counts, the Feeds header
gear + "+" toggle, add a feed, delete a feed, a resolving spinner, a failed
feed's "Failed to fetch" + retry, Refresh Feeds, and navigation to `/` and
`/feed/...`.

**Commit:** `refactor: slim Sidebar to a FeedNav wrapper`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Retarget and extend the static parity test

**Verifies:** 027-mobile-feeds-route.AC3.2, 027-mobile-feeds-route.AC3.3.

**Files:**
- Modify: `test/sidebar-static.mjs`

**Background:** `test/sidebar-static.mjs` is a static source-wiring test
(`node:test` + `node:assert/strict`). It currently `readFileSync`s
`../src/client/components/sidebar.ts` and asserts three things about the
add-feed / empty-state markup:
1. the add-feed input is read via
   `els.namedItem('new-feed-url') as HTMLInputElement` (and NOT via index
   access),
2. the empty-state uses a `feedsError.value ? ... : ...` ternary and has a
   "No feeds yet" fallback,
3. `feedsError` is destructured from state.

All three concern markup/logic that now lives in `feed-nav.ts`.

**Implementation:**

1. Change the source the existing three assertions read from
   `../src/client/components/sidebar.ts` to
   `../src/client/components/feed-nav.ts`. Keep the existing assertions
   unchanged otherwise (this preserves existing coverage; do not add new
   HTML-text assertions — per the project rule against brittle
   text-content tests).
2. Add a NEW test that reads `../src/client/components/sidebar.ts` and asserts
   the wrapper now renders `FeedNav` (source-wiring, not text content):
   ```js
   const sidebarSrc = readFileSync(
       new URL('../src/client/components/sidebar.ts', import.meta.url),
       'utf8'
   )
   test('Sidebar renders the shared FeedNav', () => {
       assert.match(sidebarSrc, /\bFeedNav\b/)
       assert.match(sidebarSrc, /class="sidebar"/)
   })
   ```
   This proves AC3.2 (single source of truth: Sidebar delegates to FeedNav).

**Testing:** This task IS the test. The retargeted assertions verify FeedNav
holds the add-feed input handling and empty-state (part of AC3.3); the new
assertion verifies Sidebar renders FeedNav (AC3.2).

**Verification:**
Run: `node test/sidebar-static.mjs`
Expected: All assertions pass.

Run: `npm test && npm run lint`
Expected: The full suite and lint pass. In particular,
`test/sidebar-feed-counts.ts` — which renders the real `<Sidebar>` and asserts
on its inner DOM (`.feeds-list .feed-item`, `.feed-unread-count`,
`a.feed-select`, pending-count prefixes) — is the strongest behavioral guard
for AC5.1 and MUST stay green. Because `FeedNav` re-emits the same children
via a `Fragment` (no extra DOM node) and `Sidebar` still renders that tree, it
should pass unchanged; treat its continued green as the signal that desktop
DOM is byte-for-byte preserved, not a coincidence. (The bundle uses
`--loader:.css=text`, so moving the `sidebar.css` import into `feed-nav.ts`
does not affect it.) No test reads `sidebar.ts`'s inner markup as source text
except the retargeted `sidebar-static.mjs`.

**Commit:** `test: retarget sidebar-static at FeedNav, assert Sidebar wraps it`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

---

## Phase 1 Done When

- `src/client/components/feed-nav.ts` exists, exporting `FeedNav` with the
  full control set and owning `import './sidebar.css'`.
- `src/client/components/sidebar.ts` is the thin
  `<aside class="sidebar"><FeedNav state/></aside>` wrapper.
- `npm run build`, `npm run lint`, and `npm test` all pass.
- `test/sidebar-static.mjs` reads `feed-nav.ts` for the inner-markup
  assertions and additionally asserts `sidebar.ts` renders `FeedNav`.
- Manual desktop parity confirmed (AC5.1).
- No changes to `sidebar.css`, `style.css`, or any breakpoint.
