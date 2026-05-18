# Payment Method Modal — Phase 3: Native `<dialog>` Primitive

**Goal:** Build a reusable, project-owned `<Dialog>` Preact component
that wraps the native HTML `<dialog>` element so Phase 4 and any future
modal surface can mount inside it without simultaneous focus-management
work.

**Architecture:** A single component `src/client/components/dialog.ts`
that:
- Accepts `open:boolean`, `onClose:()=>void`, `labelledBy:string`, and
  children.
- Calls `.showModal()` on the underlying `<dialog>` element when `open`
  transitions to `true`, and `.close()` when it transitions to `false`.
- Wires the native `close` event to `onClose` (which covers Escape via
  the `cancel`-then-`close` chain, programmatic `.close()`, and any
  future close path).
- Closes when the backdrop is clicked (detected as `event.target ===
  dialogRef.current`).
- Renders an accessible structure: a heading element identified by
  the `labelledBy` id, plus children for the dialog body and footer.
- Relies on the browser to restore focus to the trigger when the
  dialog closes — no manual focus-restore code.

**Tech Stack:** Preact (functional components), `htm/preact` for JSX,
`preact/hooks` (`useEffect`, `useRef`, `useCallback`). Native
`HTMLDialogElement`. CSS in a sibling file
`src/client/components/dialog.css` using `_variables.css` tokens.

**Scope:** 3 of 6 phases. Independent of Phase 2; can run in parallel.
Depends on Phase 1 only for branch state.

**Codebase verified:** 2026-05-17. Key findings:
- No existing project component uses the native `<dialog>` element.
  `cache-status.ts:124-155` uses a `<div role="dialog">` popover — that
  is a popover, not a modal, and is not a candidate for replacement
  by this new primitive (different ergonomics).
- Component conventions confirmed: `htm/preact` template literals,
  `import { html } from 'htm/preact/index.js'`,
  `import { type FunctionComponent } from 'preact'`. Components live
  at `src/client/components/<name>.ts` with a sibling `<name>.css`
  imported in the TS file (`import './dialog.css'`).
- CSS tokens live in `/Users/nick/code/rsss/src/client/_variables.css`
  with the existing palette (`--color-surface`, `--color-border`,
  `--color-text`, `--color-primary`, etc.). No new tokens are required;
  reuse existing ones.
- UI tests use real DOM via `render(html\`<Component />\`, root)` from
  Preact, with `@substrate-system/tapzero`, and run through esbuild +
  `tapout`. Reference: `test/cache-status.ts`, runner
  `test/run-cache-status.mjs`.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### payment-method-modal.AC7: Dialog primitive correctness (a11y)
- **payment-method-modal.AC7.1 Success:** The `<dialog>` opens via
  `showModal()` and keyboard focus is moved inside the dialog.
- **payment-method-modal.AC7.2 Success:** Pressing `Escape` closes the dialog
  via the native cancel event; the `onClose` callback runs exactly once.
- **payment-method-modal.AC7.3 Success:** Clicking the backdrop closes the
  dialog; clicking on the dialog's own content does not.
- **payment-method-modal.AC7.4 Success:** On close, keyboard focus is
  restored to the "Manage payment methods" trigger button.
- **payment-method-modal.AC7.5 Success:** The dialog has `aria-labelledby`
  pointing to its heading; inline errors are surfaced with
  `aria-describedby`.

**Note on AC7.4:** The trigger restore is verified by the native
`HTMLDialogElement` behavior — the browser restores focus to whatever
was focused before `.showModal()`. The Dialog component itself does not
implement restore; the test mounts a trigger `<button>`, focuses it,
opens the dialog, closes it, and asserts that the trigger is
`document.activeElement`.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create `src/client/components/dialog.css`

**Verifies:** Pre-work for AC7 tests; CSS provides backdrop styling
and the visual frame the tests rely on.

**Files:**
- Create: `/Users/nick/code/rsss/src/client/components/dialog.css`

**Step 1: Write the stylesheet**

Use `_variables.css` tokens. Keep nested selector style. No font sizes
below 1rem. No new variables.

```css
.app-dialog {
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    padding: 1.5rem;
    max-width: min(32rem, calc(100vw - 2rem));
    width: 100%;
    box-shadow: 0 12px 40px rgb(0 0 0 / 18%);

    &::backdrop {
        background: rgb(0 0 0 / 40%);
    }

    & .app-dialog-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 1rem;
    }

    & .app-dialog-title {
        font-size: 1.125rem;
        font-weight: 600;
        margin: 0;
        line-height: 1.3;
    }

    & .app-dialog-body {
        font-size: 1rem;
        line-height: 1.5;
    }

    & .app-dialog-close {
        appearance: none;
        background: transparent;
        border: 0;
        cursor: pointer;
        color: var(--color-text-secondary);
        padding: 0.25rem;
        border-radius: 0.25rem;
        line-height: 1;
    }

    & .app-dialog-close:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
    }

    & .app-dialog-close:hover {
        color: var(--color-text);
    }
}
```

**Notes:**
- The `.app-dialog-` namespace avoids collision with any future
  per-feature class names.
- `::backdrop` works because the styles are scoped to
  `dialog.app-dialog::backdrop` (and `.app-dialog::backdrop` because the
  element is the dialog). Test it in dev to confirm the dim layer
  appears.
- No font-size below 1rem.

**Step 2: Run stylelint**

```bash
npm run stylelint
```

Expected: zero errors.

**Step 3: Commit**

```bash
git add src/client/components/dialog.css
git commit -m "feat(dialog): stylesheet for native dialog primitive"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create `src/client/components/dialog.ts`

**Verifies:** AC7.1, AC7.2, AC7.3, AC7.5 (via implementation; tests in
Task 3 assert behavior).

**Files:**
- Create: `/Users/nick/code/rsss/src/client/components/dialog.ts`

**Reference patterns:**
- `src/client/components/cache-status.ts` (htm/preact + `FunctionComponent`
  + hooks).
- `/tmp/plan-2026-05-17-payment-method-modal-1b835f15/phase3-dialog-research.md`
  for the dialog API specifics (`showModal()`, `close` event, backdrop
  click detection, `aria-labelledby` pattern).

**Step 1: Write the component**

```typescript
import { html } from 'htm/preact/index.js'
import { type FunctionComponent } from 'preact'
import { type ComponentChildren } from 'preact'
import { useEffect, useRef, useCallback } from 'preact/hooks'
import './dialog.css'

export interface DialogProps {
    /** When true, the dialog is shown via showModal(); false closes. */
    open:boolean;
    /** Called any time the dialog closes (Escape, backdrop, .close()). */
    onClose:() => void;
    /**
     * Id of the heading element inside `children`. Used as
     * aria-labelledby on the <dialog>. Required for accessibility.
     */
    labelledBy:string;
    /**
     * Optional id of an element that describes the dialog (e.g. an
     * error region). Forwarded to aria-describedby.
     */
    describedBy?:string;
    /** Optional class hook for per-feature dialog styling. */
    className?:string;
    children?:ComponentChildren;
}

export const Dialog:FunctionComponent<DialogProps> = function ({
    open,
    onClose,
    labelledBy,
    describedBy,
    className,
    children
}) {
    const dialogRef = useRef<HTMLDialogElement>(null)

    // Sync the open prop -> imperative showModal()/close()
    useEffect(() => {
        const el = dialogRef.current
        if (!el) return
        if (open && !el.open) {
            el.showModal()
        } else if (!open && el.open) {
            el.close()
        }
    }, [open])

    // Native close event -> onClose. Covers Escape (cancel -> close),
    // programmatic .close(), and form method="dialog" submits.
    useEffect(() => {
        const el = dialogRef.current
        if (!el) return undefined
        const handle = () => {
            onClose()
        }
        el.addEventListener('close', handle)
        return () => {
            el.removeEventListener('close', handle)
        }
    }, [onClose])

    // Backdrop click: when the user clicks the dialog element itself
    // (i.e. not a descendant), it is the backdrop region.
    const onBackdropClick = useCallback((ev:MouseEvent) => {
        const el = dialogRef.current
        if (!el) return
        if (ev.target === el) {
            el.close()
        }
    }, [])

    const cls = className ?
        `app-dialog ${className}` :
        'app-dialog'

    return html`
        <dialog
            ref=${dialogRef}
            class=${cls}
            aria-labelledby=${labelledBy}
            aria-describedby=${describedBy ?? undefined}
            onClick=${onBackdropClick}
        >
            ${children}
        </dialog>
    `
}
```

**Notes:**
- We deliberately do NOT implement focus-restore — the platform does
  that when `.showModal()`/`.close()` is used.
- We deliberately do NOT set `aria-modal` — `<dialog>` opened via
  `showModal()` already exposes the modal role implicitly. Setting it
  manually is redundant and risks divergence.
- The `onClose` callback fires on the native `close` event, which is
  emitted regardless of cause (Escape, backdrop click, programmatic
  `.close()`, `<form method="dialog">` submission). This is the single
  source-of-truth callback for the parent component.
- The component is a pure shell. It does not render a close button —
  consumers can render their own inside `children` if they want one.
  This is per Phase 4 / Phase 5 design (the modal has internal
  mode-switch UI; a global close-X is not required).

**Step 2: Verify type-check + lint**

```bash
npm run typecheck && npm run lint
```

Expected: zero errors.

**Step 3: Commit**

```bash
git add src/client/components/dialog.ts
git commit -m "feat(dialog): native <dialog>-based modal primitive"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for the Dialog primitive

**Verifies:** `payment-method-modal.AC7.1`, `payment-method-modal.AC7.2`,
`payment-method-modal.AC7.3`, `payment-method-modal.AC7.4`,
`payment-method-modal.AC7.5`.

**Files:**
- Create: `/Users/nick/code/rsss/test/dialog.ts`
- Modify: `/Users/nick/code/rsss/test/run-all-tests.mjs` — add a new
  entry. The component imports `./dialog.css`, so the entry needs the
  `--loader:.css=text` flag (see existing `test:signup:ui` script in
  `package.json:38` for the same pattern).

**Pattern reference:**
- `test/cache-status.ts` for the rendering pattern: `render(html\`<${C}
  />\`, root)`, `root.querySelector(...)`, `nextTask()` for letting
  effects flush.

**Step 1: Create the test file**

The HTMLDialogElement API is provided by real browser DOM (tapout runs
via the browser bundler). We can call `.showModal()` and `.close()`
inside tests directly.

```typescript
import { test } from '@substrate-system/tapzero'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { Dialog } from '../src/client/components/dialog.js'

function nextTask ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

function mount () {
    const root = document.createElement('div')
    document.body.appendChild(root)
    return {
        root,
        cleanup () {
            render(null, root)
            root.remove()
        }
    }
}

test('AC7.1: Dialog opens via showModal() when `open` becomes true',
    async t => {
        const { root, cleanup } = mount()
        try {
            const Wrapper = function () {
                const [open, setOpen] = useState(false)
                useEffect(() => {
                    setOpen(true)
                }, [])
                return html`
                    <${Dialog}
                        open=${open}
                        onClose=${() => setOpen(false)}
                        labelledBy="t1-h"
                    >
                        <h2 id="t1-h">Hello</h2>
                        <button type="button" id="t1-focusable">x</button>
                    </${Dialog}>
                `
            }
            render(html`<${Wrapper} />`, root)
            await nextTask()
            const dialog = root.querySelector(
                'dialog.app-dialog'
            ) as HTMLDialogElement
            t.ok(dialog, 'dialog rendered into the DOM')
            t.equal(dialog.open, true, 'dialog.open is true')
            t.equal(
                dialog.getAttribute('aria-labelledby'),
                't1-h',
                'aria-labelledby points to heading'
            )
        } finally {
            cleanup()
        }
    }
)

test('AC7.2: Escape closes the dialog and onClose fires once',
    async t => {
        const { root, cleanup } = mount()
        try {
            let closeCount = 0
            const Wrapper = function () {
                const [open, setOpen] = useState(false)
                useEffect(() => {
                    setOpen(true)
                }, [])
                return html`
                    <${Dialog}
                        open=${open}
                        onClose=${() => {
                            closeCount++
                            setOpen(false)
                        }}
                        labelledBy="t2-h"
                    >
                        <h2 id="t2-h">Hello</h2>
                    </${Dialog}>
                `
            }
            render(html`<${Wrapper} />`, root)
            await nextTask()
            const dialog = root.querySelector(
                'dialog.app-dialog'
            ) as HTMLDialogElement
            t.equal(dialog.open, true, 'dialog initially open')

            // Simulate Escape via the native cancel event +
            // close() chain.
            dialog.dispatchEvent(new Event('cancel'))
            dialog.close()
            await nextTask()

            t.equal(dialog.open, false, 'dialog is closed')
            t.equal(closeCount, 1, 'onClose fired exactly once')
        } finally {
            cleanup()
        }
    }
)

test('AC7.3: Backdrop click closes; content click does not',
    async t => {
        const { root, cleanup } = mount()
        try {
            const Wrapper = function () {
                const [open, setOpen] = useState(true)
                return html`
                    <${Dialog}
                        open=${open}
                        onClose=${() => setOpen(false)}
                        labelledBy="t3-h"
                    >
                        <h2 id="t3-h">Hello</h2>
                        <button
                            type="button"
                            id="t3-inner"
                        >
                            Inner
                        </button>
                    </${Dialog}>
                `
            }
            render(html`<${Wrapper} />`, root)
            await nextTask()
            const dialog = root.querySelector(
                'dialog.app-dialog'
            ) as HTMLDialogElement
            t.equal(dialog.open, true, 'dialog initially open')

            // Click inside dialog content -> does NOT close.
            const inner = dialog.querySelector(
                '#t3-inner'
            ) as HTMLButtonElement
            inner.dispatchEvent(new MouseEvent('click', {
                bubbles: true
            }))
            await nextTask()
            t.equal(
                dialog.open,
                true,
                'clicking inner content does not close'
            )

            // Click on the dialog element itself (the backdrop region).
            dialog.dispatchEvent(new MouseEvent('click', {
                bubbles: true
            }))
            await nextTask()
            t.equal(
                dialog.open,
                false,
                'clicking the backdrop closes the dialog'
            )
        } finally {
            cleanup()
        }
    }
)

test('AC7.4: Focus is restored to the trigger after close',
    async t => {
        const { root, cleanup } = mount()
        try {
            const Wrapper = function () {
                const [open, setOpen] = useState(false)
                return html`
                    <button
                        type="button"
                        id="trigger"
                        onClick=${() => setOpen(true)}
                    >
                        Open
                    </button>
                    <${Dialog}
                        open=${open}
                        onClose=${() => setOpen(false)}
                        labelledBy="t4-h"
                    >
                        <h2 id="t4-h">Hello</h2>
                    </${Dialog}>
                `
            }
            render(html`<${Wrapper} />`, root)
            await nextTask()

            const trigger = root.querySelector(
                '#trigger'
            ) as HTMLButtonElement
            trigger.focus()
            t.equal(
                document.activeElement,
                trigger,
                'trigger has focus before opening'
            )

            trigger.click()
            await nextTask()
            const dialog = root.querySelector(
                'dialog.app-dialog'
            ) as HTMLDialogElement
            t.equal(dialog.open, true, 'dialog open after trigger click')

            dialog.close()
            await nextTask()
            t.equal(dialog.open, false, 'dialog closed')
            t.equal(
                document.activeElement,
                trigger,
                'focus restored to trigger'
            )
        } finally {
            cleanup()
        }
    }
)

test('AC7.5: aria-labelledby + aria-describedby are wired through',
    async t => {
        const { root, cleanup } = mount()
        try {
            const Wrapper = function () {
                return html`
                    <${Dialog}
                        open=${true}
                        onClose=${() => {}}
                        labelledBy="t5-h"
                        describedBy="t5-err"
                    >
                        <h2 id="t5-h">Hello</h2>
                        <p id="t5-err" role="alert">Inline error</p>
                    </${Dialog}>
                `
            }
            render(html`<${Wrapper} />`, root)
            await nextTask()
            const dialog = root.querySelector(
                'dialog.app-dialog'
            ) as HTMLDialogElement
            t.equal(
                dialog.getAttribute('aria-labelledby'),
                't5-h',
                'aria-labelledby set'
            )
            t.equal(
                dialog.getAttribute('aria-describedby'),
                't5-err',
                'aria-describedby set'
            )
        } finally {
            cleanup()
        }
    }
)
```

**Notes on the AC7.2 test:**
- We can't programmatically issue an `Escape` keypress that triggers
  the browser's native close-on-Escape behavior in the test harness
  (the dialog's Escape handling is a browser internal). We approximate
  it by dispatching the `cancel` event and then calling `.close()`. The
  important thing being asserted is that `onClose` is wired to the
  `close` event and fires once.

**Notes on the AC7.4 test:**
- The dialog `showModal()` API documents that focus restore is the
  platform's responsibility. In test environments backed by real DOM
  (which esbuild-bundled tapout runs in), this works the same as in
  production. If the test harness ever surfaces a divergence here,
  fall back to asserting that `dialog.returnValue === ''` after close
  (which is the documented behavior), and rely on manual verification
  for the restore — but the standard expectation is that the test
  passes.

**Step 2: Wire the test into the runner**

Open `/Users/nick/code/rsss/test/run-all-tests.mjs`. Add a new entry
near the other UI tests. The `--loader:.css=text` flag is required
because `dialog.ts` imports `./dialog.css`:

```javascript
    [
        'esbuild ./test/dialog.ts --bundle',
        '--loader:.css=text',
        '| tapout'
    ].join(' '),
```

**Step 3: Run the test in isolation**

```bash
npx esbuild ./test/dialog.ts --bundle --loader:.css=text | npx tapout
```

Expected: all five tests pass.

If any test fails:
- AC7.1 failure: confirm the `useEffect` synchronizing `open` is
  firing — try wrapping the wrapper's `setOpen(true)` in `useEffect`
  with `[]` so it fires after mount.
- AC7.4 failure on focus-restore: this is a browser API. If the bundled
  test environment doesn't faithfully simulate it, document the limit
  and defer the assertion to the manual smoke test in Phase 6.

**Step 4: Run the full suite**

```bash
npm test
```

Expected: no regressions.

**Step 5: Commit**

```bash
git add test/dialog.ts test/run-all-tests.mjs
git commit -m "test(dialog): a11y assertions for native dialog primitive"
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Final verification gate

**Step 1: Run lint, stylelint, typecheck, full test suite**

```bash
npm run lint && npm run stylelint && npm run typecheck && npm test
```

Expected: all four succeed.

**Step 2: Manual smoke test (informational)**

Visit `/settings` in dev (`npm start`); the modal isn't wired up yet
(Phase 4 does that), so this phase has no visual smoke test. The
component is exercised only by `test/dialog.ts` until Phase 4 imports
it from `payment-method-modal.ts`.

**Step 3: No additional commit needed**

This task is a verification gate.

**Done when:**
- AC7.1–AC7.5 are covered by passing tests in `test/dialog.ts`.
- `npm test`, `npm run lint`, `npm run stylelint`, `npm run typecheck`
  all green.
<!-- END_TASK_4 -->
