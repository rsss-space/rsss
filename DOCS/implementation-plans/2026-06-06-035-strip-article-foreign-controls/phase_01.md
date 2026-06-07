# Strip Foreign Controls from Article Bodies — Phase 1

**Goal:** Stop publisher chrome — "Save this story" bookmark widgets,
share bars, inline subscribe controls — from rendering inside the
reader. The reader injects publisher HTML verbatim via
`dangerouslySetInnerHTML`, and the client sanitizer currently keeps
interactive form controls, so a Rolling Stone article shows two stray
"Save this story" buttons (with broken icon stubs where their `<svg>`
was stripped). Harden `sanitizeHtml` to drop interactive controls —
element **and** their label text.

**Architecture:** One change, one chokepoint. `sanitizeHtml`
(`src/client/util.ts`) is the single pass every rendered article body
goes through — both feed-embedded `content`/`description` and
server-fetched `full_content`. DOMPurify's `html` profile permits
`<button>`/`<input>`/`<label>`, and merely forbidding a tag re-parents
its children (`KEEP_CONTENT` defaults `true`), so forbidding `<button>`
alone would leave the bare text "Save this story" behind. Register a
`uponSanitizeElement` hook on the DOMPurify singleton that removes the
whole control node (subtree included). No server change; no change to
the reader's own star/"Mark read" buttons (those live in the reader
header, not in the sanitized body).

**Tech Stack:** TypeScript (browser, ES2022 lib via Vite), `dompurify`
3.4.1. Tests via `@substrate-system/tapzero`, run in a real headless
browser through the consolidated `test/browser-tests.ts` bundle
(`npm run test:browser`) — a real DOM is required because DOMPurify
parses HTML.

**Scope:** Single phase. Fleshed-out spec confirmed in conversation on
2026-06-06 (goal: strip, not populate; scope: all interactive controls;
layer: client sanitizer only).

**Codebase verified:** 2026-06-06 via direct reads of
`src/client/util.ts`, `src/client/routes/item-reader.ts`,
`test/browser-tests.ts`, and `node_modules/dompurify/dist/purify.cjs.js`
(confirmed `KEEP_CONTENT` default `true`; `DEFAULT_FORBID_CONTENTS` does
**not** include `button`/`input`/`select`/`textarea`/`label`). Confirmed
`src/client/util.ts` is the only module that imports the `dompurify`
singleton, so a global hook affects nothing else.

---

## Acceptance Criteria Coverage

### 035-strip-article-foreign-controls.AC1: Interactive controls removed
Given article HTML containing interactive form controls (`<button>`,
`<input>`, `<select>`, `<textarea>`, `<label>`) — e.g. a
`<button><svg/> Save this story</button>` bookmark widget — when passed
through `sanitizeHtml`, then neither the control element nor its label
text ("Save this story") appears in the output.

### 035-strip-article-foreign-controls.AC2: Prose, links, images survive
Given article HTML with ordinary content — paragraphs, `<a href>`
links, `<img>` figures, headings, lists — when passed through
`sanitizeHtml`, then that content is preserved (links keep their `href`,
images keep their `src`, text is intact). Stripping controls must not
collapse surrounding prose.

### 035-strip-article-foreign-controls.AC3: No reader regression
The reader's own controls are unaffected: the star and "Mark read"
buttons in `item-reader`'s header are rendered by Preact outside the
sanitized body, so they remain. The existing
`test/item-reader-render-state.ts` suite still passes.

---

## Context for the implementing engineer

`src/client/util.ts` exports `sanitizeHtml(html)`, the only consumer of
the `dompurify` singleton in the app. It is called once, from
`src/client/routes/item-reader.ts:61`, to clean the article body before
`dangerouslySetInnerHTML` (`item-reader.ts:186-192`).

The current implementation:

```ts
export function sanitizeHtml (html:string):string {
    return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['style', 'form'],
        FORBID_ATTR: ['style']
    })
}
```

**The DOMPurify content-retention pitfall (the reason for a hook).**
DOMPurify removes any tag not in the active allow-list, but by default
(`KEEP_CONTENT = true`) it *keeps the removed element's children*,
re-parenting them into the tree. It only discards the content of tags in
its `DEFAULT_FORBID_CONTENTS` set (`script`, `style`, `svg`, …) — which
does **not** include `button`/`input`/`label`. So:

- `FORBID_TAGS: ['button']` turns `<button>Save this story</button>`
  into the bare text `Save this story` — visible junk in the prose.
- Passing a custom `FORBID_CONTENTS` array *replaces* the default set
  (see `purify.cjs.js:623`), which would reintroduce `<script>`/`<style>`
  text leakage — brittle and unsafe.

A `uponSanitizeElement` hook that removes the node outright sidesteps
both: removing the element during traversal drops its whole subtree
(label text included), and it does not disturb DOMPurify's defaults.

**TypeScript style (project rule):** no space between a colon and its
type (`html:string`), ternaries with `?`/`:` on their own lines, lines
≤ 80 columns.

**Testing conventions (verified):**
- `@substrate-system/tapzero`: `test('desc', t => { ... })` with
  `t.ok(cond, msg)` / `t.equal(actual, expected, msg)`.
- Client/DOM tests run in a real browser via the consolidated bundle
  `test/browser-tests.ts` (one `import './name.js'` line per file),
  executed by `npm run test:browser` (already wired into
  `test/run-all-tests.mjs`). A real DOM is mandatory here — DOMPurify
  needs `DOMParser`. Do **not** add a separate `test:*` script; the
  consolidated bundle is the home for new DOM tests.
- Per the project's no-brittle-tests rule, assert on **structure**
  (tag presence/absence, attribute survival), not on incidental wording
  of prose. The control-label assertion targets a specific marker string
  we put in the fixture; that is the behavior under test, not arbitrary
  copy.

**Verification command (single suite):**
`esbuild ./test/sanitize-html.ts --bundle | tapout`
Full gate: `npm test && npm run lint`.

> Note: `test/deploy-config.mjs` has a known, unrelated pre-existing
> failure (queue naming). It is out of scope — confirm your touched
> suites pass; do not fix it here.

---

<!-- START_TASK_1 -->
### Task 1: Failing test for control stripping

**Verifies:** AC1, AC2 (red first — the current sanitizer keeps
`<button>` and its label, so the AC1 assertions must fail before Task 2).

**Files:**
- Create: `test/sanitize-html.ts`
- Modify: `test/browser-tests.ts` (add one import line)

**Implementation:**

1. Create `test/sanitize-html.ts`:
   ```ts
   import { test } from '@substrate-system/tapzero'
   import { sanitizeHtml } from '../src/client/util.js'

   test('strips publisher save/share controls + their labels', t => {
       const dirty = '<p>Lede.</p>' +
           '<button class="save"><svg></svg>' +
           'SAVE_WIDGET_MARKER</button>' +
           '<p>Body.</p>'
       const clean = sanitizeHtml(dirty)
       t.ok(
           !/<button/i.test(clean),
           'button element is gone'
       )
       t.ok(
           !clean.includes('SAVE_WIDGET_MARKER'),
           'button label text is gone, not re-parented'
       )
   })

   test('strips form controls', t => {
       const dirty = '<p>x</p>' +
           '<label>L<input type="email"></label>' +
           '<select><option>o</option></select>' +
           '<textarea>t</textarea>'
       const clean = sanitizeHtml(dirty)
       for (const tag of ['input', 'select', 'textarea', 'label']) {
           t.ok(
               !new RegExp('<' + tag + '\\b', 'i').test(clean),
               tag + ' is removed'
           )
       }
   })

   test('preserves prose, links, and images', t => {
       const dirty = '<h2>Heading</h2>' +
           '<p>Para with <a href="https://ex.com/x">link</a>.</p>' +
           '<img src="https://ex.com/p.jpg" alt="pic">' +
           '<ul><li>one</li></ul>'
       const clean = sanitizeHtml(dirty)
       t.ok(clean.includes('Heading'), 'heading text kept')
       t.ok(
           /href="https:\/\/ex\.com\/x"/.test(clean),
           'link href preserved'
       )
       t.ok(
           /src="https:\/\/ex\.com\/p\.jpg"/.test(clean),
           'image src preserved'
       )
       t.ok(clean.includes('<li>one</li>'), 'list item kept')
   })
   ```

2. Register it in `test/browser-tests.ts` — add alongside the existing
   client-util consumers (e.g. near `import './article-notice.js'`):
   ```ts
   import './sanitize-html.js'
   ```

**Testing:** This *is* the test. Run it and confirm the AC1 cases fail
for the right reason (button + `SAVE_WIDGET_MARKER` still present),
while the AC2 "preserves" test already passes.

**Verification:**
Run: `esbuild ./test/sanitize-html.ts --bundle | tapout`
Expected: the two AC1 assertions FAIL (button/label still present); the
AC2 preservation assertions pass.

**Commit:** `test: control-stripping spec for sanitizeHtml (red)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Strip interactive controls in `sanitizeHtml`

**Verifies:** AC1, AC2, AC3.

**Files:**
- Modify: `src/client/util.ts`

**Implementation:**

Add a module-level `uponSanitizeElement` hook (registers once on import;
`util.ts` is the sole DOMPurify consumer) that removes interactive
controls outright, then leave the `sanitizeHtml` config as-is:

```ts
// Article bodies are publisher HTML injected verbatim via
// dangerouslySetInnerHTML. Publisher chrome ships interactive controls
// ("Save this story" bookmark widgets, share bars, inline subscribe
// forms) that have no place in a reader. DOMPurify's `html` profile
// keeps these tags, and merely forbidding a tag re-parents its children
// (KEEP_CONTENT defaults true) — so a forbidden <button> would leave
// its "Save this story" label behind. Remove the whole node instead.
const STRIPPED_CONTROL_TAGS = new Set([
    'button',
    'input',
    'select',
    'textarea',
    'label'
])

DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (STRIPPED_CONTROL_TAGS.has(data.tagName)) {
        node.remove()
    }
})
```

`data.tagName` is DOMPurify's lowercased tag name; `node` is the live
element being sanitized, so `node.remove()` drops it and its subtree.
If the installed `@types/dompurify` types `node` as the broader `Node`
(no `.remove()`), use `node.parentNode?.removeChild(node)` instead —
behaviorally identical. Place the `Set` + `addHook` immediately above
the existing `sanitizeHtml` function; do not change the `sanitizeHtml`
body.

**Testing:** Re-run the Task 1 suite — all assertions now pass.
`<a>` and `<img>` are not in the strip set, so AC2 holds. The reader's
header buttons are Preact-rendered outside the sanitized string, so
AC3 holds (no reader change).

**Verification:**
Run: `esbuild ./test/sanitize-html.ts --bundle | tapout`
Expected: all assertions pass.

Then the full gate:
Run: `npm test && npm run lint`
Expected: touched suites pass (notably `test:browser`, which now
includes `sanitize-html`, and the unchanged
`item-reader-render-state`); lint clean. The pre-existing
`deploy-config.mjs` failure is out of scope.

**Commit:** `fix: strip publisher controls from sanitized article bodies`
<!-- END_TASK_2 -->

---

## Phase Done When

- `sanitizeHtml` removes `<button>`, `<input>`, `<select>`,
  `<textarea>`, and `<label>` — element and label text — from article
  HTML, via a `uponSanitizeElement` hook on the DOMPurify singleton.
- Prose, headings, lists, `<a href>` links, and `<img>` survive
  unchanged.
- The reader's star and "Mark read" header buttons are unaffected.
- `esbuild ./test/sanitize-html.ts --bundle | tapout` passes, the test
  is wired into `test/browser-tests.ts`, and `npm test` + `npm run lint`
  pass (modulo the pre-existing out-of-scope `deploy-config.mjs`
  failure).
- No server change; no change to `item-reader.ts`.
