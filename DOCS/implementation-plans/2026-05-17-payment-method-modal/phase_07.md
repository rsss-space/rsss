# Payment Method Modal — Phase 7: Adopt `@substrate-system/dialog`

**Goal:** Replace the project-owned native-`<dialog>` primitive (Phase 3)
and the bespoke wiring in the payment-method modal (Phase 4) with the
`@substrate-system/dialog` web component (`<modal-window>`). Net effect:
delete `src/client/components/dialog.{ts,css}` and `test/dialog.ts`,
swap the modal component's dialog substrate for `<modal-window>`, and
update the modal's tests to interact with the web-component API.

**Architecture:**
- `@substrate-system/dialog` exports a `<modal-window>` custom element
  that auto-registers on import. The element handles focus trap, Escape
  close, backdrop click close, focus restore to the trigger, scroll
  lock, and a11y (`role="dialog"`, `aria-modal="true"`, `aria-label`
  pulled from the first heading). API surface: `.open()` / `.close()`
  methods, an `active="true|false"` attribute, and namespaced events
  `ModalWindow.event('open')` / `ModalWindow.event('close')`.
- The payment-method modal becomes a Preact component that renders
  `<modal-window>` directly inside `html` template literals. It mirrors
  the `open` prop into the `active` attribute and listens to the
  `modal-window:close` event to invoke the parent's `onClose`. No
  `useEffect` is needed to manually call `.open()`/`.close()` — the
  attribute change drives the library's `attributeChangedCallback`.
- The library's CSS is imported once via `import
  '@substrate-system/dialog/css'`. Per-feature styling (`pm-list`,
  `pm-row`, `pm-default-badge`, `pm-error`, `pm-element-host`,
  `pm-actions`, `pm-brand-line`, `pm-exp`) stays in
  `src/client/components/payment-method-modal.css`. The library's CSS
  is configured via the documented `--modal-*` variables; if we need
  to align the dialog surface with `_variables.css`, we set the
  `--modal-*` overrides at the application root in
  `_variables.css` or in the modal's own stylesheet.

**Tech Stack:** `@substrate-system/dialog` (custom element +
scroll-lock dependency, both installed as part of the package),
Preact + `htm/preact`, `@preact/signals`, `@stripe/stripe-js`.

**Scope:** Revision of Phases 3 and 4. Depends on Phases 1, 2, 4 (the
modal component's internals — SetupIntent + PaymentElement integration
— are unchanged). Phase 5 (remove + set-default), Phase 6 (manual
smoke) follow after this. Verified codebase state as of 2026-05-17:
- `@substrate-system/dialog@0.0.30` is installed.
- `src/client/components/dialog.ts` (Phase 3 primitive) currently
  exists and is imported only by `src/client/components/payment-method-modal.ts:23`.
- `test/dialog.ts` (Phase 3 tests) exists and has its own runner entry
  at `test/run-all-tests.mjs` (the dialog.ts entry near the bottom).
- `test/payment-method-modal.ts` (Phase 4 modal tests) queries
  `dialog.app-dialog.payment-method-modal` — those queries are
  replaced by `modal-window`-based queries.
- AC7 was the "dialog primitive correctness (a11y)" criterion verified
  by `test/dialog.ts`. The library covers all five AC7.x criteria as
  documented behavior; we drop the AC7 tests rather than re-assert
  third-party behavior, but keep one integration assertion in the
  modal tests (`role="dialog"` and `aria-modal="true"` exist on the
  rendered element) to fail fast if the library is misconfigured.

---

## Acceptance Criteria Coverage

This phase re-implements (without behavioral change) the AC coverage
delivered by Phases 3 and 4:

### payment-method-modal.AC1: Modal launches from the Settings page
- **AC1.1 Success:** Clicking "Manage payment methods" opens the modal.
  Re-verified at the integration level (the `<modal-window>` is `active`
  in the DOM after the trigger click; `role="dialog"` is present).
- **AC1.2 Success:** URL unchanged on open. Re-verified.
- **AC1.3 Failure:** `useLive=false` + Add-a-card → inline
  `stripe_unconfigured` error. Re-verified.

### payment-method-modal.AC2.3 Success
- The default method shows a "Default" badge. Re-verified.

### payment-method-modal.AC3 (modal flow)
- **AC3.3 Success:** Successful confirmSetup refreshes the list.
- **AC3.4 / AC8.3 Failure:** Declined card surfaces inline error and
  modal stays open.
- **AC3.6 Edge:** Closing mid-flow resets on next open.
- All three are re-verified; the close-then-reopen race fixed in the
  Phase 4 review is no longer relevant because the library's open/close
  is attribute-driven and synchronous.

### payment-method-modal.AC7: Dialog primitive correctness (a11y)
- **Dropped from the automated test surface.** The library documents
  these behaviors (`role="dialog"`, `aria-modal="true"`, focus trap,
  Escape close, backdrop close, focus restore, `aria-label` from
  heading, `aria-describedby` pass-through). We add one assertion in
  the modal tests that the rendered `<modal-window>` exposes
  `role="dialog"` and `aria-modal="true"`. Manual verification in
  Phase 6 covers full keyboard navigation including Escape and Tab
  trap (Phase 6 Phase A).

### payment-method-modal.AC8 (cross-cutting)
- **AC8.1, AC8.2, AC8.3:** unchanged — covered by the rewritten modal
  tests and by Phases 2, 4, 5 server tests.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Remove the project-owned Phase 3 Dialog primitive

**Verifies:** Pre-work for Tasks 3-4. Deleting unused code.

**Files:**
- Delete: `/Users/nick/code/rsss/src/client/components/dialog.ts`
- Delete: `/Users/nick/code/rsss/src/client/components/dialog.css`
- Delete: `/Users/nick/code/rsss/test/dialog.ts`
- Modify: `/Users/nick/code/rsss/test/run-all-tests.mjs` — remove the
  entry that bundles and runs `test/dialog.ts`.

**Pre-conditions:**

Before deleting, confirm there are no callers other than the
payment-method modal:

```bash
grep -rn "from '.*components/dialog" src/ test/ 2>/dev/null
```

Expected: a single hit in
`src/client/components/payment-method-modal.ts:23`. If anything else
imports it, stop and report — that caller would need migrating first.

Also confirm test/dialog.ts is the only consumer of the test file:

```bash
grep -n "test/dialog.ts" test/run-all-tests.mjs
```

Expected: one entry near the bottom of the file.

**Step 1: Delete the three files**

```bash
rm /Users/nick/code/rsss/src/client/components/dialog.ts
rm /Users/nick/code/rsss/src/client/components/dialog.css
rm /Users/nick/code/rsss/test/dialog.ts
```

**Step 2: Remove the runner entry**

Open `/Users/nick/code/rsss/test/run-all-tests.mjs`. Find and delete
the entry that runs `test/dialog.ts`:

```javascript
    [
        'esbuild ./test/dialog.ts --bundle',
        '--loader:.css=text',
        '| tapout'
    ].join(' ')
```

Make sure the preceding entry (whichever it is) still ends with `,` or
not as appropriate — keep the array syntactically valid.

**Step 3: Verify**

The payment-method-modal source still imports `./dialog.js` at this
point; **don't** run typecheck yet. The next task removes that import.

```bash
ls /Users/nick/code/rsss/src/client/components/
# should NOT list dialog.ts or dialog.css
grep -n "test/dialog.ts" /Users/nick/code/rsss/test/run-all-tests.mjs
# should print nothing
```

**Step 4: Commit**

```bash
git add -A src/client/components/dialog.ts \
    src/client/components/dialog.css \
    test/dialog.ts \
    test/run-all-tests.mjs
git commit -m "refactor(dialog): remove project-owned dialog primitive (replaced by @substrate-system/dialog)"
```

Note: `git add -A <path>` is required for the deletions to be staged
when the files no longer exist on disk.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add `@substrate-system/dialog` to `package.json`

**Verifies:** Lock the dependency. The package is already installed in
`node_modules/` (per the user) but may not yet be recorded in
`package.json` / `package-lock.json`.

**Step 1: Confirm installation state**

```bash
node -e "console.log(require('@substrate-system/dialog/package.json').version)"
```

Expected: prints `0.0.30` (or whatever the registry has at execution
time).

```bash
grep -n "@substrate-system/dialog" /Users/nick/code/rsss/package.json
```

If the grep prints nothing, run:

```bash
npm install --save @substrate-system/dialog
```

If the grep already shows a `dependencies` entry, no action is needed
beyond confirming `package-lock.json` is in sync (running
`npm install` with no args is a safe no-op when in sync).

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(billing): pin @substrate-system/dialog dependency"
```

If `git status` shows no staged changes (the dep was already recorded
on disk before this phase started), skip the commit — `git status`
must be clean before the next task. Note that fact in your report.
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Rewrite `payment-method-modal.ts` to use `<modal-window>`

**Verifies:** AC1.1, AC1.2, AC1.3, AC2.3, AC3.3, AC3.4, AC3.6, AC8.1,
AC8.2, AC8.3 — re-implemented atop the new substrate.

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/components/payment-method-modal.ts`
- Modify: `/Users/nick/code/rsss/src/client/components/payment-method-modal.css`
  (drop styles that conflict with the library's defaults; keep
  per-row / per-error / per-element-host rules).

**Reference patterns:**
- `@substrate-system/dialog` README — `<modal-window>` attributes
  (`active`, `closable`, `noclick`, `no-icon`, `close`), methods
  (`open()`, `close()`), and namespaced events (`ModalWindow.event('close')`).
- Existing modal logic (handleAddCard, handleSubmitAdd,
  handleCancelAdd, handleClose) — preserved verbatim; only the JSX
  substrate changes.

**Step 1: Update imports**

Open `/Users/nick/code/rsss/src/client/components/payment-method-modal.ts`.

Replace the local Dialog import:

```typescript
import { Dialog } from './dialog.js'
```

with the library import + side-effect import for auto-registration +
CSS import:

```typescript
import { ModalWindow } from '@substrate-system/dialog'
import '@substrate-system/dialog/css'
```

The `import { ModalWindow }` line both runs the auto-define (so
`<modal-window>` is registered as a custom element) and exposes
`ModalWindow.event('close')` for the listener.

**Step 2: Replace the Dialog JSX**

Find the existing return at the end of `PaymentMethodModal`:

```typescript
    return html`
        <${Dialog}
            open=${open}
            onClose=${handleClose}
            labelledBy=${TITLE_ID}
            describedBy=${addError || globalError ? ERROR_ID : undefined}
            className="payment-method-modal"
        >
            <div class="app-dialog-header">
                <h2 id=${TITLE_ID} class="app-dialog-title">
                    Payment methods
                </h2>
            </div>
            <div class="app-dialog-body">
                ...
            </div>
        </${Dialog}>
    `
```

Replace with:

```typescript
    return html`
        <modal-window
            ref=${modalRef}
            class="payment-method-modal"
            active=${open ? 'true' : 'false'}
            aria-describedby=${
                addError || globalError ? ERROR_ID : undefined
            }
        >
            <h2 id=${TITLE_ID}>Payment methods</h2>
            <div class="payment-method-modal-body">
                ...same body markup as before...
            </div>
        </modal-window>
    `
```

Notes on the substitution:
- The library extracts its `aria-label` from the first heading
  automatically, so we no longer pass `labelledBy`. The `id=${TITLE_ID}`
  remains useful if any sibling code wants to reference it, but the
  modal itself no longer depends on it.
- `aria-describedby` is forwarded by the library to the dialog element
  per its docs.
- The `class="payment-method-modal"` keeps the per-feature CSS hook
  for the new stylesheet rules.
- Drop the `app-dialog-header` and `app-dialog-body` wrappers; they
  were specific to the Phase 3 primitive. The library wraps content
  itself.

**Step 3: Add the ref and event listener**

Above the JSX, add a `useRef` for the modal element. The library
fires `modal-window:close` whenever the modal closes (Escape,
backdrop, programmatic `.close()`, or `active` attribute set to false).
We wire that event to the existing `handleClose` callback.

Add this `useRef` next to the other refs:

```typescript
    const modalRef = useRef<HTMLElement|null>(null)
```

Add this `useEffect` after the existing element-mount effect:

```typescript
    // Forward the modal-window's `close` event to the parent's onClose.
    useEffect(() => {
        const el = modalRef.current
        if (!el) return undefined
        const handle = () => handleClose()
        const evt = ModalWindow.event('close')
        el.addEventListener(evt, handle)
        return () => {
            el.removeEventListener(evt, handle)
        }
    }, [handleClose])
```

**Step 4: Update CSS**

Open `/Users/nick/code/rsss/src/client/components/payment-method-modal.css`.

The current file targets `.payment-method-modal` as a `<dialog>`
descendant; with `<modal-window>` the structure changes. The library
adds `.modal-dialog`, `.modal-overlay`, `.modal-content` classes
internally. Update the stylesheet to:

```css
.payment-method-modal {
    & h2 {
        font-size: 1.125rem;
        font-weight: 600;
        margin: 0 0 1rem 0;
        line-height: 1.3;
    }

    & .payment-method-modal-body {
        font-size: 1rem;
        line-height: 1.5;
    }

    & .pm-list {
        list-style: none;
        padding: 0;
        margin: 0 0 1rem 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    & .pm-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: 0.375rem;
    }

    & .pm-brand-line {
        flex: 1;
        font-size: 1rem;
    }

    & .pm-default-badge {
        font-size: 1rem;
        background: color-mix(
            in srgb,
            var(--color-success) 12%,
            transparent
        );
        color: var(--color-success);
        padding: 0.125rem 0.5rem;
        border-radius: 999px;
    }

    & .pm-error {
        color: var(--color-error);
        margin-top: 0.5rem;
        font-size: 1rem;
        line-height: 1.4;
    }

    & .pm-actions {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
        margin-top: 1rem;
    }

    & .pm-element-host {
        min-height: 16rem;
        margin: 1rem 0;
    }
}
```

(No `app-dialog-*` rules remain; those belonged to the deleted Phase 3
component.)

**Step 5: Verify typecheck + lint + stylelint**

```bash
npm run typecheck && npm run lint && npm run stylelint
```

Expected: zero errors. There's a pre-existing eslint error in
`test/feed-create.ts:81` unrelated to this work — if `npm run lint`
reports only that error, treat lint as passing.

If `npm run typecheck` flags `<modal-window>` as an unknown intrinsic
element, that means the global type registration didn't load. Confirm
the `import { ModalWindow } from '@substrate-system/dialog'` is present
— it triggers the `declare global` block in the package's `.d.ts`.

**Step 6: Commit**

```bash
git add src/client/components/payment-method-modal.ts \
    src/client/components/payment-method-modal.css
git commit -m "refactor(billing): payment-method modal uses @substrate-system/dialog"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Update modal tests for the `<modal-window>` substrate

**Verifies:** Same AC list as Task 3 — the existing tests' intent is
preserved; only the DOM queries and the open/close mechanics change.

**Files:**
- Modify: `/Users/nick/code/rsss/test/payment-method-modal.ts`
- Modify: `/Users/nick/code/rsss/test/run-all-tests.mjs` — the existing
  payment-method-modal runner entry uses `--alias:@stripe/stripe-js=...`;
  add `--loader:.css=text` for the package CSS imports if it isn't
  already present in that entry. Inspect the entry first; only modify
  if needed.

**Step 1: Update DOM queries**

In `test/payment-method-modal.ts`, replace every occurrence of:

```typescript
document.body.querySelector('dialog.app-dialog.payment-method-modal')
```

with:

```typescript
document.body.querySelector('modal-window.payment-method-modal')
```

The type assertion `as HTMLDialogElement` is no longer accurate; use
`as HTMLElement` and gate per-test on whatever specific shape is
needed (e.g., the library's `.open()` / `.close()` if the test
calls them directly).

There are also internal queries — `.pm-list`, `.pm-element-host`,
`.pm-error`, `.pm-default-badge`, `.pm-row`, `.app-dialog-body`,
`.app-dialog-header`. Of those, `.app-dialog-body` and
`.app-dialog-header` no longer exist (we removed those wrappers in
Task 3); update the affected tests to query for `.payment-method-modal-body`
where needed. The other `.pm-*` queries are unchanged because Task 3's
CSS keeps them.

**Step 2: Update open/close mechanics**

The Phase 4 tests opened the modal by setting `open=true` on the
component prop, which the Phase 3 `<Dialog>` mirrored into
`.showModal()`. With `<modal-window>`, setting `open=true` mirrors
into `active="true"`, and the library shows the modal asynchronously
(via its `attributeChangedCallback`). Tests should wait on
observable state — specifically, the modal becoming visible (the
`modal-show` class is added by the library when shown).

Replace assertions of the form:

```typescript
t.equal(dialog.open, true, 'opened via native showModal()')
```

with:

```typescript
await waitFor(() => modal.classList.contains('modal-show'))
t.ok(
    modal.classList.contains('modal-show'),
    'modal is shown'
)
```

For the close-then-reopen sequence (the previously flaky AC3.6 test),
**use the library's API rather than calling `.close()` on a nested
`<dialog>` element**:

```typescript
// Close via the library
modal.close()
await waitFor(() => !modal.classList.contains('modal-show'))
t.ok(
    !modal.classList.contains('modal-show'),
    'modal closed'
)

// Reopen via the harness toggling its `open` state (the prop change
// mirrors into the active="true" attribute, which the library
// observes).
reopen.click()
await waitFor(() => modal.classList.contains('modal-show'))
t.ok(
    modal.classList.contains('modal-show'),
    'modal reopened'
)
await waitFor(() => !!modal.querySelector('.pm-list'))
t.ok(
    modal.querySelector('.pm-list'),
    'reopened in list mode'
)
```

The library's `attributeChangedCallback` is the canonical sync point
— it handles the open/close transitions deterministically, so the
previously fragile Preact-effect race disappears.

**Step 3: Update AC1.1 / AC1.2 assertions**

The AC1.1 test asserted `dialog.open === true`. Replace with checks
that the `<modal-window>` has `role="dialog"`, `aria-modal="true"`,
and the `modal-show` class:

```typescript
await waitFor(() => modal.classList.contains('modal-show'))
t.equal(
    modal.getAttribute('role'),
    'dialog',
    'role=dialog applied by library'
)
t.equal(
    modal.getAttribute('aria-modal'),
    'true',
    'aria-modal=true applied by library'
)
```

These two assertions replace the dropped AC7 tests at the integration
level — they fail fast if the library is misconfigured or absent.

**Step 4: Update describedBy assertion**

The previous test verified that `aria-describedby` is forwarded to
the underlying `<dialog>`. With `<modal-window>` the library forwards
the attribute to the same place — the assertion path is unchanged;
the query target changes from the `<dialog>` to the `<modal-window>`
host:

```typescript
t.equal(
    modal.getAttribute('aria-describedby'),
    ERROR_ID,
    'aria-describedby reflected on the modal-window'
)
```

(Only assert this in tests where an error is actually present; in
those, the modal sets the attribute via Task 3's JSX.)

**Step 5: Run the test in isolation 20×**

```bash
for i in $(seq 1 20); do
    OUT=$(npx esbuild ./test/payment-method-modal.ts --bundle \
        --loader:.css=text \
        --alias:@stripe/stripe-js=./test/stripe-js-stub.ts \
        2>/dev/null | npx tapout 2>&1 | tail -5)
    if echo "$OUT" | grep -q '^# ok$'; then
        echo "Run $i: ok"
    else
        echo "Run $i: FAIL"
        echo "$OUT"
    fi
done
```

Expected: 20/20 runs end with `# ok`. If any run fails, diagnose with
the `writing-good-tests` skill — most likely a missing `waitFor` on
the library's async show/hide cycle.

**Step 6: Run the full suite**

```bash
npm test
```

Expected: no regressions. The full suite includes the modal test and
the rest of the project.

**Step 7: Commit**

```bash
git add test/payment-method-modal.ts test/run-all-tests.mjs
git commit -m "test(billing): payment-method-modal tests target <modal-window>"
```
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Final verification gate

**Step 1: Run lint, stylelint, typecheck, full test suite**

```bash
npm run lint && npm run stylelint && npm run typecheck && npm test
```

Expected: all four succeed (modulo the pre-existing `test/feed-create.ts:81`
lint error, treated as out-of-scope).

**Step 2: Smoke-build the worker**

```bash
npx wrangler deploy --dry-run --outdir=/tmp/wrangler-smoke-1b835f15-p7
```

Expected: dry-run build succeeds.

**Step 3: Grep checks**

```bash
# Confirm Phase 3 primitive is gone.
ls /Users/nick/code/rsss/src/client/components/dialog.ts \
    /Users/nick/code/rsss/src/client/components/dialog.css \
    /Users/nick/code/rsss/test/dialog.ts 2>&1
# Expected: all three "No such file or directory".

# Confirm no stale imports of the deleted module.
grep -rn "components/dialog" \
    /Users/nick/code/rsss/src/ \
    /Users/nick/code/rsss/test/ 2>/dev/null
# Expected: zero matches.

# Confirm the modal uses the library.
grep -n "@substrate-system/dialog" \
    /Users/nick/code/rsss/src/client/components/payment-method-modal.ts
# Expected: two hits (named import + CSS import).
```

**Step 4: 20× stability sanity (re-run after the full suite)**

```bash
for i in $(seq 1 20); do
    OUT=$(npx esbuild ./test/payment-method-modal.ts --bundle \
        --loader:.css=text \
        --alias:@stripe/stripe-js=./test/stripe-js-stub.ts \
        2>/dev/null | npx tapout 2>&1 | tail -5)
    if echo "$OUT" | grep -q '^# ok$'; then
        echo "Run $i: ok"
    else
        echo "Run $i: FAIL"
        echo "$OUT"
        exit 1
    fi
done
```

Expected: 20× `ok`.

**Done when:**
- Phase 3 primitive files are gone (`dialog.ts`, `dialog.css`,
  `test/dialog.ts`).
- No remaining imports reference the deleted module.
- The modal uses `<modal-window>` and the library's CSS.
- AC1.1, AC1.2, AC1.3, AC2.3, AC3.3, AC3.4, AC3.6, AC8.1, AC8.2,
  AC8.3 are covered by passing tests.
- 20× isolated runs of the modal test all pass.
- `npm test` + `wrangler deploy --dry-run` are green.
<!-- END_TASK_5 -->
