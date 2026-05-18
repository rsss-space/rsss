import { test } from '@substrate-system/tapzero'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { Dialog } from '../src/client/components/dialog.js'

function nextTask ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

async function waitFor (
    predicate:() => boolean,
    maxTurns = 50
):Promise<void> {
    for (let i = 0; i < maxTurns; i++) {
        if (predicate()) return
        await nextTask()
    }
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
            await waitFor(() => dialog.open === true)
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
            await waitFor(() => dialog.open === true)
            t.equal(dialog.open, true, 'dialog initially open')

            // Simulate Escape via the native cancel event +
            // close() chain. The native `close` event is emitted by
            // the browser after `.close()`; waitFor gives it the
            // turns it needs to reach our listener.
            dialog.dispatchEvent(new Event('cancel'))
            dialog.close()
            await waitFor(() => dialog.open === false)
            await waitFor(() => closeCount === 1)

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
            await waitFor(() => dialog.open === true)
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
            await waitFor(() => dialog.open === false)
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
            const dialog = root.querySelector(
                'dialog.app-dialog'
            ) as HTMLDialogElement
            await waitFor(() => {
                const d = root.querySelector(
                    'dialog.app-dialog'
                ) as HTMLDialogElement | null
                return !!d && d.open === true
            })
            t.equal(dialog.open, true, 'dialog open after trigger click')

            dialog.close()
            await waitFor(() => dialog.open === false)
            t.equal(dialog.open, false, 'dialog closed')
            await waitFor(() => document.activeElement === trigger)
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
