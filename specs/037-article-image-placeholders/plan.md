# Article Image Dimension Placeholders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reserve the correct box and show a light-gray placeholder for
article-body images that declare width/height, and lazy-load all article
images — purely client-side at render time.

**Architecture:** A pure client util adds `loading="lazy"`/
`decoding="async"` to every `<img>` in the article HTML before
sanitization. One CSS line paints the gray placeholder; box reservation
rides on the browser's existing aspect-ratio-from-attributes behavior
(`.article-body img` already sets `height: auto`). No server, storage,
or sync change.

**Tech Stack:** TypeScript (browser, ES2022 via Vite), Preact +
`preact/hooks`, DOMPurify, `DOMParser`; tests in
`@substrate-system/tapzero` run through `tapout` (headless browser).

**Spec:** `specs/037-article-image-placeholders/design.md`

---

## File Structure

- `src/client/util.ts` — add `addImageLoadingHints(html):string` next to
  the existing `sanitizeHtml`. Pure `string -> string`.
- `test/article-images.ts` — new tapzero unit test for the util. Runs in
  the browser bundle (needs `DOMParser`).
- `test/browser-tests.ts` — register the new test in the consolidated
  browser bundle so `npm test` runs it.
- `src/client/routes/item-reader.ts` — wire the transform into the
  article HTML, memoized.
- `src/client/routes/item-reader.css` — add the placeholder color to the
  existing `.article-body img` rule.

---

## Task 1: `addImageLoadingHints` util (TDD)

**Files:**
- Create: `test/article-images.ts`
- Modify: `src/client/util.ts`
- Modify: `test/browser-tests.ts`

- [ ] **Step 1: Write the failing test**

Create `test/article-images.ts`:

```ts
import { test } from '@substrate-system/tapzero'
import { addImageLoadingHints } from '../src/client/util.js'

test('addImageLoadingHints - adds loading + decoding to an img', t => {
    const out = addImageLoadingHints('<p>hi</p><img src="https://x/a.jpg">')
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const img = doc.querySelector('img')
    t.equal(img?.getAttribute('loading'), 'lazy', 'loading is lazy')
    t.equal(img?.getAttribute('decoding'), 'async', 'decoding is async')
})

test('addImageLoadingHints - preserves existing attributes', t => {
    const out = addImageLoadingHints(
        '<img src="https://x/a.jpg" width="640" height="480" alt="cat">'
    )
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const img = doc.querySelector('img')
    t.equal(img?.getAttribute('src'), 'https://x/a.jpg', 'src kept')
    t.equal(img?.getAttribute('width'), '640', 'width kept')
    t.equal(img?.getAttribute('height'), '480', 'height kept')
    t.equal(img?.getAttribute('alt'), 'cat', 'alt kept')
})

test('addImageLoadingHints - applies to multiple images', t => {
    const out = addImageLoadingHints(
        '<img src="a.jpg"><p>x</p><img src="b.jpg">'
    )
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const imgs = doc.querySelectorAll('img')
    t.equal(imgs.length, 2, 'two images present')
    imgs.forEach((img) => {
        t.equal(img.getAttribute('loading'), 'lazy', 'each img is lazy')
        t.equal(img.getAttribute('decoding'), 'async', 'each is async')
    })
})

test('addImageLoadingHints - no images returns input unchanged', t => {
    const input = '<p>no images here</p>'
    t.equal(addImageLoadingHints(input), input, 'returned unchanged')
})

test('addImageLoadingHints - empty string returns empty string', t => {
    t.equal(addImageLoadingHints(''), '', 'empty stays empty')
})

test('addImageLoadingHints - idempotent', t => {
    const once = addImageLoadingHints('<img src="a.jpg">')
    const twice = addImageLoadingHints(once)
    t.equal(twice, once, 'second pass identical to first')
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `esbuild ./test/article-images.ts --bundle | tapout`
Expected: FAIL — esbuild reports no matching export for
`addImageLoadingHints` in `src/client/util.ts` (the function does not
exist yet).

- [ ] **Step 3: Write the minimal implementation**

In `src/client/util.ts`, add this function directly below the existing
`sanitizeHtml` function (after the closing brace on line 53):

```ts
export function addImageLoadingHints (html:string):string {
    if (!html) return html
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const imgs = doc.body.querySelectorAll('img')
    if (imgs.length === 0) return html
    imgs.forEach((img) => {
        img.setAttribute('loading', 'lazy')
        img.setAttribute('decoding', 'async')
    })
    return doc.body.innerHTML
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `esbuild ./test/article-images.ts --bundle | tapout`
Expected: PASS — all assertions across the six tests pass.

- [ ] **Step 5: Register the test in the browser bundle**

In `test/browser-tests.ts`, add this import alongside the other
imports (e.g. directly after the existing `import './article-detect.js'`
line):

```ts
import './article-images.js'
```

- [ ] **Step 6: Commit**

```bash
git add src/client/util.ts test/article-images.ts test/browser-tests.ts
git commit -m "feat: add addImageLoadingHints util for article images"
```

---

## Task 2: Wire the transform into the article reader

**Files:**
- Modify: `src/client/routes/item-reader.ts:3` (hook import)
- Modify: `src/client/routes/item-reader.ts:6` (util import)
- Modify: `src/client/routes/item-reader.ts:62-67` (article HTML)

No new unit test: per the spec we do not write DOM-text assertions on
the reader. Verification is lint + the existing browser test suite
(`item-reader-render-state` and the new `article-images` both run in the
consolidated browser bundle).

- [ ] **Step 1: Add `useMemo` to the hooks import**

Change line 3 from:

```ts
import { useCallback, useEffect } from 'preact/hooks'
```

to:

```ts
import { useCallback, useEffect, useMemo } from 'preact/hooks'
```

- [ ] **Step 2: Add `addImageLoadingHints` to the util import**

Change line 6 from:

```ts
import { formatDate, sanitizeHtml } from '../util.js'
```

to:

```ts
import { formatDate, sanitizeHtml, addImageLoadingHints } from '../util.js'
```

- [ ] **Step 3: Memoize the article HTML through the transform**

Replace the existing block (currently lines 62-67):

```ts
    const articleHtml = sanitizeHtml(
        item.full_content ||
        item.content ||
        item.description ||
        ''
    )
```

with:

```ts
    const rawHtml = item.full_content ||
        item.content ||
        item.description ||
        ''
    const articleHtml = useMemo(
        () => sanitizeHtml(addImageLoadingHints(rawHtml)),
        [rawHtml]
    )
```

- [ ] **Step 4: Verify lint passes**

Run: `npm run lint`
Expected: PASS — no eslint errors (watch the 80-column rule on the
edited lines).

- [ ] **Step 5: Verify the browser tests pass**

Run: `npm run test:browser`
Expected: PASS — the consolidated browser bundle, including
`item-reader-render-state` (no regression) and the new `article-images`
tests, all pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/routes/item-reader.ts
git commit -m "feat: lazy-load and hint article body images"
```

---

## Task 3: Light-gray placeholder (CSS)

**Files:**
- Modify: `src/client/routes/item-reader.css:88-92`

- [ ] **Step 1: Add the placeholder background to `.article-body img`**

Replace the existing rule (currently lines 88-92):

```css
        & img {
            max-width: 100%;
            height: auto;
            margin: 1rem 0;
        }
```

with:

```css
        & img {
            max-width: 100%;
            height: auto;
            margin: 1rem 0;
            background-color: var(--color-placeholder);
        }
```

`--color-placeholder` (`#dcdcdc`) is the existing light-gray token in
`src/client/_variables.css`. Do not introduce a new color.

- [ ] **Step 2: Verify the build compiles the CSS**

Run: `npm run build`
Expected: PASS — Vite/lightningcss builds with no CSS errors.

- [ ] **Step 3: Manual visual check**

Run: `npm start`, open an article that contains body images (e.g. a
Wired post), and confirm:
- images that declare width/height show a light-gray box at the correct
  size before they load, with no layout jump as they paint;
- images without dimensions appear normally (no gray box);
- no unrelated styling changed.

- [ ] **Step 4: Commit**

```bash
git add src/client/routes/item-reader.css
git commit -m "feat: light-gray placeholder for article images"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite and lint**

Run: `npm test && npm run lint`
Expected: PASS — the entire suite (including the new `article-images`
browser test) and eslint both succeed.

- [ ] **Step 2: Confirm scope discipline**

Run: `git diff --stat main...HEAD`
Expected: only these files changed — `src/client/util.ts`,
`test/article-images.ts`, `test/browser-tests.ts`,
`src/client/routes/item-reader.ts`, `src/client/routes/item-reader.css`.
No eslint config, no unrelated CSS, no server/DO/SQLite/sync files.

---

## Self-Review Notes

- **Spec coverage:** placeholder color (Task 3), box reservation via
  existing attrs+CSS (Task 3, relies on `height: auto`), lazy/decoding
  for all images (Tasks 1-2), client-only / no backend (no server task),
  dimensionless images load normally (no special handling — covered by
  the CSS only painting where a box is reserved), tests are
  pure-function only (Task 1). All covered.
- **Type consistency:** `addImageLoadingHints(html:string):string` is
  defined in Task 1 and imported/called identically in Task 2.
- **No placeholders:** every code and command step is concrete.
