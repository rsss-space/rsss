# Oversize Article Fallback — Phase 2: Client Messaging + Notice UI

**Goal:** Replace the single generic "Couldn't load the full article." line
with a status-specific notice. Map each terminal `full_content_status` to a
distinct, human-readable notice variant and action set, render it as a
polished notice card **above** the article body, and keep the RSS-summary
fallback on hard failures. Partial salvage (`succeeded_partial`) shows the
body plus a non-error "info" notice pointing to the publisher.

**Architecture:** A pure `noticeForStatus(status)` function (new module
`src/client/routes/item-reader-notice.ts`) maps a status to a small
`ReaderNotice` view-model. A new presentational `ArticleNotice` component
(`src/client/components/article-notice.{ts,css}` — or notice CSS folded into
`item-reader.css`, see Task 2) renders the card with a decorative icon,
title, optional body, and an actions row (publisher CTA `<a>`, plus a Retry
`<button>` only where retrying can help). `item-reader.ts` computes the
notice, renders it above the body, and collapses the duplicate bottom
publisher link when the notice owns the CTA. Server is unchanged; this phase
only reads `item.full_content_status` (which now includes
`succeeded_partial` from Phase 1).

**Tech Stack:** TypeScript (browser, ES2022 via Vite), Preact,
`@preact/signals`, `htm/preact`. Tests via `@substrate-system/tapzero`,
bundled with `esbuild` and run in a real DOM through `tapout`.

**Scope:** Phase 2 of 3 from
`DOCS/design-plans/2026-05-30-028-oversize-article-fallback.md`. Depends on
Phase 1 (`succeeded_partial` enum value must exist).

**Codebase verified:** 2026-05-30 (via codebase-investigator + direct reads
of `item-reader.ts`, `item-reader.css`, `item-row.ts`, `publisher-link.ts`,
`_variables.css`).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 028-oversize-article-fallback.AC1: Oversize pages are salvaged *(client half)*
...the reader displays that (partial) body. (Server half done in Phase 1.)

### 028-oversize-article-fallback.AC2: Unsalvageable oversize → clear failure *(client half)*
...the reader shows the "page too large to download" notice with a publisher
CTA.

### 028-oversize-article-fallback.AC3: Per-status messaging
Given an item with a terminal `full_content_status`, the reader renders a
status-specific notice variant. Each of `failed_too_large`,
`failed_network`, `failed_status`, `failed_redirect`, `failed_non_html`,
`failed_no_body`, and the new partial-success status maps to its own copy
and action set. No two distinct statuses collapse to the same message.

### 028-oversize-article-fallback.AC4: Partial content is labeled
Given a partially-salvaged article, the reader shows the body **and** a
non-error notice telling the reader the full page was too large to download
and offering "Read on <publisher>". The notice does not look like a failure
(warning palette, not error palette).

### 028-oversize-article-fallback.AC6: Notice quality
The notice meets the project CSS rules: font-size ≥ 1rem, all colors from
`_variables.css`, nested selectors over class proliferation, and is
keyboard-reachable and screen-reader sensible (the icon is decorative /
`aria-hidden`; meaning lives in text).

### 028-oversize-article-fallback.AC7: Notice placement and failure fallback
Given any item that renders a notice (partial or any `failed_*`), the notice
appears **above** the article body in DOM order. Given a hard failure
(`failed_*` with no salvaged content), the reader still renders the existing
`content`/`description` summary fallback beneath the notice — the summary is
not suppressed.

---

## Context for the implementing engineer

This is a Preact client using `htm/preact` tagged templates (NOT JSX). A
component is invoked `<${Component} prop=${value} />`; a child closes with
`<//>` or self-closes. Components are `FunctionComponent`s returning a single
`html\`...\`` template.

**Reader render structure today (`src/client/routes/item-reader.ts`,
verified):**
- `import { html } from 'htm/preact'` (line 1), `import './item-reader.css'`
  (line 21).
- Computed booleans: `isFetching` (line 69), `fetchFailed` =
  `status.startsWith('failed_')` (lines 70–73), `fetchErrorMessage` from the
  `articleFetchError` signal when `itemId` matches (lines 74–77).
- `handleRetry` (lines 79–81) calls
  `State.fetchFullArticle(state, itemId, { force:true })`.
- `articleHtml = sanitizeHtml(item.full_content || item.content ||
  item.description || '')` (lines 59–64) — **always computed; body is never
  gated on status.** A `failed_*` item already renders the summary fallback.
- Render order inside `<article class="reader-content">`:
  1. in-flight `<p class="article-fetch-status">Fetching full article…</p>`
     (lines 166–170),
  2. failed block `<p class="article-fetch-status failed">…Retry…</p>`
     (lines 172–188) — **this is what we replace**,
  3. body `<div class="article-body" …>` (lines 190–201),
  4. bottom `<p class="article-publisher-link"><a href=…>` (lines 203–218).

**Publisher-link helpers (`src/shared/publisher-link.ts`, verified):**
- `publisherLinkLabel(link:string):string|null` → `'Read the full article on
  <host>'` or `null`.
- `publisherLinkHref(link:string):string|null` → URL string or `null`.
- Already imported in `item-reader.ts` (lines 17–20).

**Color tokens (`src/client/_variables.css`, verified):** `--color-warning`
`#b45309`, `--color-warning-bg` `#fffbeb`, `--color-error` `#dc2626`,
`--color-surface` `#fff`, `--color-text` `black`, `--color-muted` `#606060`,
`--color-border` `#7e7d7d`, `--color-primary` `#2563eb`. **There is no
`--color-error-bg`** — error notices use `--color-surface` as background (the
red left bar carries the error signal). **`--color-text-secondary` is
currently `black`**, so use `--color-muted` for the notice body line.

**Icon pattern (`src/client/components/close.ts`, verified):** an icon is a
`FunctionComponent` returning an inline `<svg>` inside an `html` template,
using `stroke="currentColor"` so it inherits text color. Follow this for the
decorative notice icons.

**Test conventions (verified):**
- Pure-logic tests: `test/item-reader-render-state.ts` tests small extracted
  functions with `t.equal`/`t.deepEqual` (no rendering). Leave it as-is — its
  `pickBody`/`isFailedStatus` mirrors still hold.
- **Component render tests run in a REAL DOM**: `test/item-row.ts` does
  `const root = document.createElement('div'); body.appendChild(root);
  render(html\`<${ItemRow} .../>\`, root)` then queries `root.querySelector(
  '.item-link')` and asserts **DOM order** with
  `t.equal(link.firstElementChild, thumbnail, 'places thumbnail before …')`
  and element presence via `.className` / `t.ok(node)`. This is the pattern
  for AC6/AC7 — assert classes, presence, and order, **never text content**
  (project rule: no brittle HTML-text assertions).
- `preact-render-to-string` is NOT a dependency; use `render` from `preact`
  into a real DOM node, exactly like `item-row.ts`.

**Verification commands (run from repo root):**
- New notice test (CSS + wasm loaders, mirrors `updating-pill-lifecycle.ts`):
  `esbuild ./test/article-notice.ts --bundle --loader:.css=text --loader:.wasm=dataurl | tapout`
- `npm test` (full suite) and `npm run lint` and `npm run stylelint`.

**Project rules to honor:** lines ≤ 80 cols; no space after a type colon;
ternary `?`/`:` on their own lines; CSS uses nested selectors and
`_variables.css` tokens only, font-size ≥ 1rem; **navigation uses `<a href>`
not `<button onClick>`** (route-event handles link clicks globally — see
memory `feedback_links_not_buttons`); wrap any multi-signal writes in
`batch()` (not expected here).

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: `noticeForStatus` status→view-model function

**Verifies:** 028-oversize-article-fallback.AC3 (per-status mapping,
distinct messages), and the model behind AC4 (`succeeded_partial` → info).

**Files:**
- Create: `src/client/routes/item-reader-notice.ts`
- Test: `test/article-notice.ts` (new; the mapping half — pure, no DOM)

**Implementation:**

Create the module with the `ReaderNotice` type and the pure mapping. Copy is
a starting point only (the `/impeccable craft` pass in Task 4 may refine it);
tests must NOT assert copy strings. `succeeded_partial` is **info** (not a
failure); only network/status failures set `retry:true` (retrying a
size/redirect/non-html/no-body failure is deterministic and won't help).

```ts
export type NoticeVariant = 'info'|'error'

export interface ReaderNotice {
    variant:NoticeVariant;
    title:string;
    body?:string;
    retry:boolean;
}

export function noticeForStatus (
    status:string|null|undefined
):ReaderNotice|null {
    switch (status) {
        case 'succeeded_partial': return {
            variant: 'info',
            retry: false,
            title: 'This page was too large to download in full.',
            body: 'We’ve shown the part we could read.'
        }
        case 'failed_too_large': return {
            variant: 'error',
            retry: false,
            // Framed "show in full", not "download": this status is also
            // reached when the page downloaded but the extracted body
            // exceeded the content cap (see Phase 1 A2).
            title: 'This article is too large to show in full.',
            body: 'We couldn’t pull a readable version from this page.'
        }
        case 'failed_network': return {
            variant: 'error',
            retry: true,
            title: 'We couldn’t reach the publisher.'
        }
        case 'failed_status': return {
            variant: 'error',
            retry: true,
            title: 'The publisher’s site returned an error.'
        }
        case 'failed_redirect': return {
            variant: 'error',
            retry: false,
            title: 'This link redirected too many times.'
        }
        case 'failed_non_html': return {
            variant: 'error',
            retry: false,
            title: 'This link isn’t a readable article page.'
        }
        case 'failed_no_body': return {
            variant: 'error',
            retry: false,
            title: 'We couldn’t find the article text on this page.'
        }
        default: return null
    }
}
```

**Testing:** In `test/article-notice.ts`, import the real `noticeForStatus`
(do not re-implement a mirror) and assert behavior:
- AC3: for each of the 7 terminal statuses (`succeeded_partial`,
  `failed_too_large`, `failed_network`, `failed_status`, `failed_redirect`,
  `failed_non_html`, `failed_no_body`), the returned `variant` and `retry`
  match the table above (e.g. `succeeded_partial` → `info`/`false`,
  `failed_network` → `error`/`true`, `failed_redirect` → `error`/`false`).
- AC3 distinctness: collect the 7 `title` strings and assert they are
  pairwise unique (a Set of titles has size 7). This proves "no two distinct
  statuses collapse to the same message" without asserting specific copy.
- `noticeForStatus('succeeded')`, `noticeForStatus(null)`,
  `noticeForStatus(undefined)`, and an unknown string all return `null`.

**Verification:**
Run: `esbuild ./test/article-notice.ts --bundle --loader:.css=text --loader:.wasm=dataurl | tapout`
Expected: the mapping assertions pass. (The render tests are added in later
tasks of this file; it is fine for the file to grow across tasks.) Keep the
`--loader:.css=text --loader:.wasm=dataurl` flags on this command for ALL
tasks in this file — even this pure-mapping task — because the same file will
import CSS-importing modules (the component, the route) in Tasks 2–3, and the
bundle must stay buildable with one consistent command.

**Commit:** `feat: add noticeForStatus status->notice mapping`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: `ArticleNotice` component + notice CSS

**Verifies:** 028-oversize-article-fallback.AC4 (info palette, CTA),
AC6 (font ≥ 1rem, tokens only, nested selectors, decorative aria-hidden
icon, keyboard-reachable affordances), AC3 (action affordances per variant).

**Files:**
- Create: `src/client/components/article-notice.ts`
- Modify: `src/client/routes/item-reader.css` (replace the
  `.article-fetch-status.failed` rule at lines 122–124 with the
  `.article-notice` ruleset; keep `.article-fetch-status` for the in-flight
  line)
- Test: `test/article-notice.ts` (extend with the component render tests)

**Implementation:**

Create `article-notice.ts`. The component is purely presentational: it takes
the `ReaderNotice`, the item `link`, and an `onRetry` callback. It always
renders the publisher CTA when the link resolves (the CTA is the primary
affordance for info and retry-less errors). Retry renders only when
`notice.retry`. The icon is decorative — wrap it in a span with
`aria-hidden="true"`; meaning lives in the title text.

```ts
import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import {
    publisherLinkLabel,
    publisherLinkHref
} from '../../shared/publisher-link.js'
import { type ReaderNotice } from '../routes/item-reader-notice.js'

const InfoIcon:FunctionComponent = function () {
    return html`<svg viewBox="0 0 24 24" fill="none" width="20"
        height="20"><circle cx="12" cy="12" r="9" stroke="currentColor"
        stroke-width="2" /><path d="M12 11v5M12 7.5v.5"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round" /></svg>`
}

const WarningIcon:FunctionComponent = function () {
    return html`<svg viewBox="0 0 24 24" fill="none" width="20"
        height="20"><path d="M12 4 2.5 20h19L12 4Z" stroke="currentColor"
        stroke-width="2" stroke-linejoin="round" /><path d="M12 10v4M12 17v.5"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round" /></svg>`
}

export const ArticleNotice:FunctionComponent<{
    notice:ReaderNotice;
    link:string|null;
    onRetry:() => void;
}> = function ({ notice, link, onRetry }) {
    const label = link ? publisherLinkLabel(link) : null
    const href = link ? publisherLinkHref(link) : null
    const Icon = notice.variant === 'info' ? InfoIcon : WarningIcon
    return html`
        <div class="article-notice ${notice.variant}">
            <span class="article-notice-icon" aria-hidden="true">
                <${Icon} />
            </span>
            <div class="article-notice-content">
                <p class="article-notice-title">${notice.title}</p>
                ${notice.body && html`
                    <p class="article-notice-body">${notice.body}</p>
                `}
                <div class="article-notice-actions">
                    ${notice.retry && html`
                        <button
                            type="button"
                            class="btn btn-small article-notice-retry"
                            onClick=${onRetry}
                        >Retry</button>
                    `}
                    ${label && href && html`
                        <a
                            class="article-notice-cta"
                            href=${href}
                            target="_blank"
                            rel="noopener noreferrer"
                        >${label}</a>
                    `}
                </div>
            </div>
        </div>
    `
}
```

CSS: in `item-reader.css`, **replace** the `.article-fetch-status.failed`
rule (lines 122–124) with the `.article-notice` ruleset below, nested under
the existing `.route.item-reader` block (match the file's nesting style).
Keep `.article-fetch-status` (the italic in-flight line) and
`.article-fetch-retry` untouched. All colors are tokens; text is ≥ 1rem.

```css
.route.item-reader {
    & .article-notice {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
        margin: 0 0 1.5rem;
        padding: 1rem 1.25rem;
        border-radius: 6px;
        border-left: 3px solid var(--color-border);
        background: var(--color-surface);
        font-size: 1rem;
        line-height: 1.5;

        & .article-notice-icon {
            flex: 0 0 auto;
            margin-top: 0.1rem;
            display: inline-flex;
        }

        & .article-notice-title {
            font-weight: 600;
            color: var(--color-text);
            margin: 0;
        }

        & .article-notice-body {
            color: var(--color-muted);
            margin: 0.25rem 0 0;
        }

        & .article-notice-actions {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-top: 0.75rem;
        }

        & .article-notice-cta {
            color: var(--color-primary);
        }

        &.info {
            border-left-color: var(--color-warning);
            background: var(--color-warning-bg);

            & .article-notice-icon {
                color: var(--color-warning);
            }
        }

        &.error {
            border-left-color: var(--color-error);

            & .article-notice-icon {
                color: var(--color-error);
            }
        }
    }
}
```

**Testing:** In `test/article-notice.ts`, render the component into a real
DOM node (follow `test/item-row.ts`: `document.createElement('div')` →
`body.appendChild` → `render(html\`<${ArticleNotice} .../>\`, root)`), then:
- AC4: render an `info` notice (e.g. the `succeeded_partial` model from
  `noticeForStatus`) with a valid `link`. Assert the root element has class
  `article-notice` and `info` (and NOT `error`) — proves warning palette, not
  error palette. Assert a publisher CTA `<a.article-notice-cta>` is present
  with a non-empty `href`.
- AC3 affordances: render an `error` notice with `retry:true`
  (`failed_network` model) — assert an `<a.article-notice-cta>` exists AND a
  `<button.article-notice-retry>` exists, and clicking it (dispatch a click /
  call the handler) invokes the passed `onRetry`. Render an error notice with
  `retry:false` (`failed_redirect` model) — assert the CTA exists and the
  Retry button is ABSENT.
- AC6: assert the icon wrapper `.article-notice-icon` has attribute
  `aria-hidden="true"` (decorative), and that the title text node exists
  (meaning carried in text). Do not assert the title's text content.

**Verification:**
Run: `esbuild ./test/article-notice.ts --bundle --loader:.css=text --loader:.wasm=dataurl | tapout`
Run: `npm run stylelint`
Expected: render assertions pass; stylelint clean.

**Commit:** `feat: add ArticleNotice component and notice styles`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Wire the notice into the reader (placement, fallback, CTA collapse)

**Verifies:** 028-oversize-article-fallback.AC1 (partial body shown), AC2
(too-large notice + CTA), AC4 (partial labeled), AC7 (notice above body;
summary fallback preserved on failure).

**Files:**
- Modify: `src/client/routes/item-reader.ts`
  (imports; replace failed block 172–188; gate bottom link 203–218)
- Test: `test/article-notice.ts` (extend with reader-placement render tests)

**Implementation:**

1. Import the new pieces near the existing imports:
   ```ts
   import { noticeForStatus } from './item-reader-notice.js'
   import { ArticleNotice } from '../components/article-notice.js'
   ```
2. Compute the notice from the item's status, preferring a live thrown-error
   message in the body when one exists for this item (the existing
   `fetchErrorMessage`, lines 74–77, from the `articleFetchError` signal).
   Place this near the other computed values (after `fetchErrorMessage`):
   ```ts
   const baseNotice = noticeForStatus(item.full_content_status)
   const notice = (baseNotice && fetchErrorMessage) ?
       { ...baseNotice, body: fetchErrorMessage } :
       baseNotice
   ```
   The old `fetchFailed` boolean (lines 70–73) is now unused — remove it.
   `noticeForStatus` returning non-null is what drives the notice. This keeps
   current behavior: no notice for `succeeded`/`null`; `succeeded_partial`
   yields an info notice while the body still renders normally.
3. **Replace** the failed block (lines 172–188) with the notice, rendered
   **above** the body (it sits between the in-flight line and the
   `.article-body` div, which is exactly where the old failed block was — so
   placement is uniform for info and error):
   ```ts
   ${notice && html`
       <${ArticleNotice}
           notice=${notice}
           link=${item.link}
           onRetry=${handleRetry}
       />
   `}
   ```
   Leave the in-flight `.article-fetch-status` block (166–170) and the
   `.article-body` block (190–201) unchanged. The body already falls back to
   `content`/`description` on failure (AC7 fallback) and shows
   `full_content` for `succeeded_partial` (AC1).
4. Collapse the duplicate bottom publisher link when the notice owns the CTA.
   Change the bottom-link guard (line 203) so it only renders when there is
   no notice:
   ```ts
   ${!notice && item.link && (() => {
       const label = publisherLinkLabel(item.link)
       const href = publisherLinkHref(item.link)
       if (!label || !href) return null
       return html`
           <p class="article-publisher-link">
               <a href=${href} target="_blank" rel="noopener noreferrer">
                   ${label}
               </a>
           </p>
       `
   })()}
   ```
   So: `succeeded`/clean → no notice, bottom link shows as before; any notice
   (partial or failure) → notice carries the CTA, bottom link hidden.

**Testing:** In `test/article-notice.ts`, render the real `ItemReader` route
into a DOM node (follow `test/item-row.ts` for the DOM harness, and
`test/updating-pill-lifecycle.ts` for importing route/state with the css+wasm
loaders). Build a minimal fake `AppState` satisfying only what `ItemReader`
reads: signals `route`, `routeItem`, `routeItemLoading`, and `items`
(cast `as unknown as AppState`, like `test/item-row.ts`). Set the
item's `full_content_status` to a terminal value so the auto-fetch
`useEffect` short-circuits (`if (item.full_content_status != null) return`) —
no network.

Resolve the item the simple way: set `state.routeItem.value = item` and
`state.route.value = '/post/' + <any non-empty fragment>`. The route helpers
live in `src/client/routing.ts` (re-exported via `state.ts`): `isItemRoute`
returns true for a `/post/...` route, and `findItemByRoute` matches an item
by its `link`. The reader's `itemSignal` is
`findItemByRoute(state, route) || state.routeItem.value`, so the
`routeItem.value` fallback resolves the item regardless of whether the route
fragment matches the link — you do not need to reverse-engineer the link
encoding. Confirm the `/post/` prefix against `routing.ts` at write time.

**Test isolation (required):** `articleFetchError` and
`articleFetchingItemId` are module-level singleton signals
(`src/client/state.ts`, ~lines 2633–2634). Reset them
(`articleFetchError.value = null`, `articleFetchingItemId.value = null`)
before/between render cases so a `fetchErrorMessage` set in one case does not
bleed into another. Then assert:
- AC7 order + AC4 (partial): for a `succeeded_partial` item with
  `full_content` set, query `.article-notice` and `.article-body` under the
  rendered root. Assert both exist, the notice has class `info`, and the
  notice precedes the body in DOM order — e.g.
  `t.ok(notice.compareDocumentPosition(body) &
  Node.DOCUMENT_POSITION_FOLLOWING, 'notice before body')`.
- AC7 fallback (failure): for a `failed_network` item with `content` set and
  no `full_content`, assert `.article-notice` (class `error`) exists, the
  `.article-body` exists and is non-empty (summary preserved — assert
  `body.innerHTML.length > 0` / `body.textContent` non-empty, NOT specific
  text), and the notice precedes the body.
- CTA collapse: for any item that renders a notice, assert there is NO
  `.article-publisher-link` element (the notice owns the CTA). For a
  `succeeded` item (no notice), assert `.article-publisher-link` IS present.

**Verification:**
Run: `esbuild ./test/article-notice.ts --bundle --loader:.css=text --loader:.wasm=dataurl | tapout`
Expected: all placement/fallback/collapse assertions pass.

Register the new test in `test/run-all-tests.mjs` (add next to the other
render tests, mirroring the `updating-pill-lifecycle.ts` entry):
```js
[
    'esbuild ./test/article-notice.ts --bundle',
    '--loader:.css=text',
    '--loader:.wasm=dataurl',
    '| tapout'
].join(' '),
```

Then run the full gate:
Run: `npm test && npm run lint && npm run stylelint`
Expected: all suites pass; lint + stylelint clean (modulo the pre-existing
out-of-scope `deploy-config.mjs` failure).

**Commit:** `feat: render status notice above reader body, collapse dup link`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: `/impeccable craft` polish pass on the notice

**Verifies:** 028-oversize-article-fallback.AC6 (final visual quality). No
new ACs; this is a human-in-the-loop design polish step.

**Files:**
- Possibly refine: `src/client/components/article-notice.{ts}` and the
  `.article-notice` CSS in `src/client/routes/item-reader.css`

**Implementation:**

Run `/impeccable craft` on the `ArticleNotice` component using the design's
"UI / Visual Design" section as the brief (two variants, one structure; left
accent bar; icon + title + optional body + actions row). Constraints that
MUST hold after polish:
- Colors only from `_variables.css`; font-size ≥ 1rem; nested selectors.
- Icon stays decorative (`aria-hidden`), meaning in the title text.
- Navigation stays an `<a href>` (CTA), Retry stays a `<button>`.
- The class names asserted by the Task 1–3 tests
  (`.article-notice`, `.info`/`.error`, `.article-notice-icon`,
  `.article-notice-cta`, `.article-notice-retry`) are preserved, or the tests
  are updated in lockstep.

**Verification:**
Run: `esbuild ./test/article-notice.ts --bundle --loader:.css=text --loader:.wasm=dataurl | tapout`
Run: `npm test && npm run lint && npm run stylelint`
Expected: all green; the notice tests still pass (class contract intact).

**Commit:** `style: polish ArticleNotice via impeccable craft`
<!-- END_TASK_4 -->

---

## Phase 2 Done When

- `noticeForStatus` exists in `src/client/routes/item-reader-notice.ts`,
  mapping every terminal status (incl. `succeeded_partial`) to a distinct
  `ReaderNotice`, and returning `null` for `succeeded`/null/unknown.
- `ArticleNotice` (`src/client/components/article-notice.ts`) renders the
  info/error card with a decorative `aria-hidden` icon, title, optional body,
  a publisher CTA `<a>`, and a Retry `<button>` only when `notice.retry`.
- `item-reader.ts` renders the notice **above** the body, keeps the summary
  fallback on failure, shows the partial body for `succeeded_partial`, and
  hides the bottom publisher link whenever a notice renders.
- `.article-notice` CSS lives in `item-reader.css` (tokens only, ≥ 1rem,
  nested, `.info` warning palette / `.error` error palette), replacing the
  old `.article-fetch-status.failed` rule.
- `test/article-notice.ts` (registered in `run-all-tests.mjs` with the
  css+wasm loaders) asserts: the status→variant/retry mapping + title
  distinctness (AC3), the component's variant/CTA/Retry/aria affordances
  (AC4/AC6), and the rendered reader's notice-before-body order + summary
  fallback + CTA-collapse (AC7/AC1/AC2).
- `npm test`, `npm run lint`, and `npm run stylelint` pass (modulo the
  pre-existing out-of-scope `deploy-config.mjs` failure). No server changes.
