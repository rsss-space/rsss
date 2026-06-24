import { test } from '@substrate-system/tapzero'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { batch } from '@preact/signals'
import { PaymentMethodModal } from
    '../src/client/components/payment-method-modal.js'
import {
    paymentMethods,
    defaultMethodId,
    resetPaymentMethods
} from '../src/client/payment-methods.js'
import { billingStatus } from '../src/client/billing-status.js'
import { State } from '../src/client/state.js'
// Indirect — the alias in run-all-tests.mjs swaps the real package.
import {
    setNextConfirmSetupResult,
    getMountCallCount,
    resetMountCallCount
} from './stripe-js-stub.js'

function nextTask ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

function waitFor (
    predicate:()=> unknown,
    maxTurns:number = 200
):Promise<void> {
    let turns = 0
    return new Promise((resolve, reject) => {
        const check = async () => {
            if (predicate()) {
                resolve()
                return
            }
            turns++
            if (turns >= maxTurns) {
                reject(new Error(
                    `waitFor: condition not met after ${maxTurns} turns`
                ))
                return
            }
            await nextTask()
            check()
        }
        check()
    })
}

function mountRoot () {
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

function seedBilling (useLive:boolean):void {
    batch(() => {
        billingStatus.value = {
            entitled: true,
            planId: 'local-first',
            status: 'active',
            refreshedAt: Date.now(),
            useLive,
            stripePublishableKey: useLive ? 'pk_test_modal' : null
        }
    })
}

function seedMethods ():void {
    batch(() => {
        paymentMethods.value = [
            {
                id: 'pm_visa',
                brand: 'visa',
                last4: '4242',
                expMonth: 12,
                expYear: 2030,
                isDefault: false
            },
            {
                id: 'pm_mc',
                brand: 'mastercard',
                last4: '4444',
                expMonth: 6,
                expYear: 2029,
                isDefault: true
            }
        ]
        defaultMethodId.value = 'pm_mc'
    })
}

function resetState ():void {
    resetPaymentMethods()
    billingStatus.value = null
}

test('AC1.1 / AC1.2: Modal opens via showModal in list mode; URL stays',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            const before = window.location.href

            const Harness = function () {
                const [open, setOpen] = useState(false)
                useEffect(() => { setOpen(true) }, [])
                return html`
                    <${PaymentMethodModal}
                        open=${open}
                        onClose=${() => setOpen(false)}
                    />
                `
            }
            render(html`<${Harness} />`, root)
            await nextTask()

            const modal = document.body.querySelector(
                'modal-window.payment-method-modal'
            ) as HTMLElement
            t.ok(modal, 'modal-window rendered')
            // Wait for the library to add the modal-visible class to
            // the .modal-scroll child when active attribute = "true"
            const modalScroll = modal.querySelector('.modal-scroll')
            await waitFor(() => modalScroll?.classList.contains(
                'modal-visible'
            ), 300)
            // Check the nested dialog element for aria attributes
            const dialog = modal.querySelector('dialog')
            t.equal(
                dialog?.getAttribute('aria-modal'),
                'true',
                'aria-modal=true applied by library'
            )
            // The <dialog> element has implicit role="dialog" in HTML
            const rows = modal.querySelectorAll('.pm-row')
            t.equal(rows.length, 2, 'two methods rendered')
            t.equal(
                window.location.href,
                before,
                'URL unchanged'
            )
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC2.3: The default method row shows a Default badge',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            render(html`
                <${PaymentMethodModal}
                    open=${true}
                    onClose=${() => {}}
                />
            `, root)
            await nextTask()
            const modal = document.body.querySelector(
                'modal-window.payment-method-modal'
            ) as HTMLElement
            const rows = Array.from(
                modal.querySelectorAll('.pm-row')
            )
            const defaultRow = rows.find(r =>
                r.textContent?.includes('4444'))
            const nonDefaultRow = rows.find(r =>
                r.textContent?.includes('4242'))
            t.ok(
                defaultRow?.querySelector('.pm-default-badge'),
                'default row has badge'
            )
            t.equal(
                nonDefaultRow?.querySelector('.pm-default-badge'),
                null,
                'non-default row has no badge'
            )
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC1.3: With useLive=false, Settings does not render the trigger',
    async t => {
        // This is more naturally tested at the settings-route layer
        // (already covered by test/settings-route.ts:629-654). Here
        // we assert that even if a caller mounted the modal with
        // open=true while billing.useLive is false, the user can't
        // start the add-a-card flow because the publishable key is
        // null (handleAddCard surfaces "stripe_unconfigured").
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(false)
            seedMethods()
            render(html`
                <${PaymentMethodModal}
                    open=${true}
                    onClose=${() => {}}
                />
            `, root)
            await nextTask()
            const modal = document.body.querySelector(
                'modal-window.payment-method-modal'
            ) as HTMLElement
            const addBtn = Array.from(
                modal.querySelectorAll('button')
            ).find(b => (b.textContent ?? '').match(/add a card/i))
            t.ok(addBtn, 'Add a card button rendered')
            addBtn?.click()
            // The error appears after Preact re-renders with the error state
            await waitFor(() => {
                const err = modal.querySelector('.pm-error')
                return err && (err.textContent ?? '').includes(
                    'stripe_unconfigured'
                )
            }, 100)
            const err = modal.querySelector(
                '.pm-error'
            ) as HTMLElement|null
            t.ok(err, 'inline error shown')
            const errText = err?.textContent ?? ''
            t.ok(
                errText.includes('stripe_unconfigured'),
                `error code mentions stripe_unconfigured (got: ${errText})`
            )
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC3.3 / AC8.1: Successful confirmSetup refreshes the list',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            resetMountCallCount()
            setNextConfirmSetupResult({})  // success
            let reloadCalls = 0
            const originalLoad = State.loadPaymentMethods
            State.loadPaymentMethods = async () => {
                reloadCalls++
            }
            const originalCreate = State.createSetupIntent
            State.createSetupIntent = async () => 'seti_test_secret'
            try {
                const Harness = function () {
                    const [open, setOpen] = useState(true)
                    return html`
                        <${PaymentMethodModal}
                            open=${open}
                            onClose=${() => setOpen(false)}
                        />
                    `
                }
                render(html`<${Harness} />`, root)
                await nextTask()

                const modal = document.body.querySelector(
                    'modal-window.payment-method-modal'
                ) as HTMLElement
                const addBtn = Array.from(
                    modal.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/add a card/i)
                ) as HTMLButtonElement
                addBtn.click()
                await waitFor(() => !!modal.querySelector(
                    '.pm-element-host'
                ), 100)
                const saveBtn = Array.from(
                    modal.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/save card/i)
                ) as HTMLButtonElement
                t.ok(saveBtn, 'Save card button shown in adding mode')
                saveBtn.click()
                await waitFor(() => !!modal.querySelector(
                    '.pm-list'
                ) || !!modal.querySelector('.pm-error'), 100)
                t.equal(
                    reloadCalls,
                    1,
                    'loadPaymentMethods called once'
                )
                // Verify PaymentElement mounted to the host
                t.ok(
                    getMountCallCount() > 0,
                    'PaymentElement.mount() was invoked on the host'
                )
                // Returned to list mode
                t.ok(
                    modal.querySelector('.pm-list'),
                    'returned to list mode'
                )
            } finally {
                State.loadPaymentMethods = originalLoad
                State.createSetupIntent = originalCreate
            }
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC3.4 / AC8.3: Declined card surfaces error and stays in adding ' +
    'mode', async t => {
    const { root, cleanup } = mountRoot()
    try {
        seedBilling(true)
        seedMethods()
        setNextConfirmSetupResult({
            error: { message: 'Your card was declined.' }
        })
        const originalCreate = State.createSetupIntent
        State.createSetupIntent = async () => 'seti_test_secret'
        try {
            render(html`
                    <${PaymentMethodModal}
                        open=${true}
                        onClose=${() => {}}
                    />
                `, root)
            await nextTask()
            const modal = document.body.querySelector(
                'modal-window.payment-method-modal'
            ) as HTMLElement
            const addBtn = Array.from(
                modal.querySelectorAll('button')
            ).find(b =>
                (b.textContent ?? '').match(/add a card/i)
            ) as HTMLButtonElement
            addBtn.click()
            await waitFor(() => !!modal.querySelector(
                '.pm-element-host'
            ), 100)
            const saveBtn = Array.from(
                modal.querySelectorAll('button')
            ).find(b =>
                (b.textContent ?? '').match(/save card/i)
            ) as HTMLButtonElement
            saveBtn.click()
            await waitFor(() => !!modal.querySelector(
                '.pm-error'
            ), 100)
            const err = modal.querySelector(
                '.pm-error'
            ) as HTMLElement|null
            t.ok(err, 'inline error shown')
            t.ok(
                err?.textContent?.includes(
                    'Your card was declined'),
                'error message preserved'
            )
            // Element host still rendered = still in adding mode.
            t.ok(
                modal.querySelector('.pm-element-host'),
                'still in adding mode (element host present)'
            )
        } finally {
            State.createSetupIntent = originalCreate
        }
    } finally {
        resetState()
        cleanup()
    }
}
)

test('AC3.6: Closing the modal mid-flow resets to list on next open',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            const originalCreate = State.createSetupIntent
            State.createSetupIntent = async () => 'seti_test_secret'
            try {
                const Harness = function () {
                    const [open, setOpen] = useState(true)
                    return html`
                        <${PaymentMethodModal}
                            open=${open}
                            onClose=${() => setOpen(false)}
                        />
                        <button
                            type="button"
                            id="reopen"
                            onClick=${() => setOpen(true)}
                        >
                            reopen
                        </button>
                    `
                }
                render(html`<${Harness} />`, root)
                await nextTask()

                const modal = document.body.querySelector(
                    'modal-window.payment-method-modal'
                ) as HTMLElement
                const addBtn = Array.from(
                    modal.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/add a card/i)
                ) as HTMLButtonElement
                addBtn.click()
                await waitFor(() => !!modal.querySelector(
                    '.pm-element-host'
                ), 100)
                t.ok(
                    modal.querySelector('.pm-element-host'),
                    'now in adding mode'
                )
                // Use the library method via any cast
                const modalLib = modal as any
                modalLib.close()
                const modalScroll = modal.querySelector('.modal-scroll')
                await waitFor(() => !modalScroll?.classList.contains(
                    'modal-visible'
                ), 300)
                t.ok(
                    !modalScroll?.classList.contains('modal-visible'),
                    'modal closed'
                )

                const reopen = root.querySelector(
                    '#reopen'
                ) as HTMLButtonElement
                reopen.click()
                await waitFor(() => modalScroll?.classList.contains(
                    'modal-visible'
                ), 300)
                t.ok(
                    modalScroll?.classList.contains('modal-visible'),
                    'modal reopened'
                )
                await waitFor(() => !!modal.querySelector(
                    '.pm-list'
                ), 300)
                t.ok(
                    modal.querySelector('.pm-list'),
                    'reopened in list mode'
                )
                t.equal(
                    modal.querySelector('.pm-element-host'),
                    null,
                    'element host gone'
                )
            } finally {
                State.createSetupIntent = originalCreate
            }
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC4.1: Clicking Remove enters confirming-remove mode',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            render(html`
                <${PaymentMethodModal}
                    open=${true}
                    onClose=${() => {}}
                />
            `, root)
            await nextTask()
            const dialog = document.body.querySelector(
                'modal-window.payment-method-modal'
            ) as HTMLElement
            // Find the non-default row's Remove button.
            const rows = Array.from(
                dialog.querySelectorAll('.pm-row')
            )
            const nonDefault = rows.find(r =>
                r.textContent?.includes('4242')
            ) as HTMLElement
            const removeBtn = Array.from(
                nonDefault.querySelectorAll('button')
            ).find(b =>
                (b.textContent ?? '').trim() === 'Remove'
            ) as HTMLButtonElement
            t.ok(removeBtn, 'Remove button present on non-default')
            t.equal(removeBtn.disabled, false, 'enabled')
            removeBtn.click()
            await nextTask()
            t.ok(
                dialog.querySelector('.pm-confirm-text'),
                'now in confirming-remove mode'
            )
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC4.3: Remove button is disabled on the default row',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            render(html`
                <${PaymentMethodModal}
                    open=${true}
                    onClose=${() => {}}
                />
            `, root)
            await nextTask()
            const dialog = document.body.querySelector(
                'modal-window.payment-method-modal'
            ) as HTMLElement
            const defaultRow = Array.from(
                dialog.querySelectorAll('.pm-row')
            ).find(r =>
                r.textContent?.includes('4444')
            ) as HTMLElement
            const removeBtn = Array.from(
                defaultRow.querySelectorAll('button')
            ).find(b =>
                (b.textContent ?? '').trim() === 'Remove'
            ) as HTMLButtonElement
            t.ok(removeBtn, 'Remove button rendered on default row')
            t.equal(
                removeBtn.disabled,
                true,
                'disabled on default'
            )
            t.equal(
                removeBtn.title,
                'Set another card as default first.',
                'tooltip set'
            )
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC4.6: Removing the last non-default leaves only the default',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            const originalRemove = State.removePaymentMethod
            State.removePaymentMethod = async (id:string) => {
                // Server-side has already detached; simulate canonical
                // refresh by writing to the signals.
                batch(() => {
                    paymentMethods.value = paymentMethods.value
                        .filter(m => m.id !== id)
                })
            }
            try {
                render(html`
                    <${PaymentMethodModal}
                        open=${true}
                        onClose=${() => {}}
                    />
                `, root)
                await nextTask()
                const dialog = document.body.querySelector(
                    'modal-window.payment-method-modal'
                ) as HTMLElement
                const nonDefault = Array.from(
                    dialog.querySelectorAll('.pm-row')
                ).find(r =>
                    r.textContent?.includes('4242')
                ) as HTMLElement
                const removeBtn = Array.from(
                    nonDefault.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').trim() === 'Remove'
                ) as HTMLButtonElement
                removeBtn.click()
                await nextTask()
                const confirmBtn = Array.from(
                    dialog.querySelectorAll('.pm-actions button')
                ).find(b =>
                    (b.textContent ?? '').match(/^Remove$/)
                ) as HTMLButtonElement
                confirmBtn.click()
                await nextTask()
                await nextTask()
                t.equal(
                    dialog.querySelectorAll('.pm-row').length,
                    1,
                    'one row remains'
                )
                t.ok(
                    dialog.querySelector('.pm-list'),
                    'returned to list mode'
                )
                t.equal(
                    dialog.getAttribute('active'),
                    'true',
                    'modal still active'
                )
            } finally {
                State.removePaymentMethod = originalRemove
            }
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC5.4 + AC5.7: Set as default moves the badge; ' +
    'is not rendered on the current default', async t => {
    const { root, cleanup } = mountRoot()
    try {
        seedBilling(true)
        seedMethods()
        const originalSet = State.setDefaultPaymentMethod
        State.setDefaultPaymentMethod = async (id:string) => {
            batch(() => {
                paymentMethods.value = paymentMethods.value.map(
                    m => ({ ...m, isDefault: m.id === id })
                )
                defaultMethodId.value = id
            })
        }
        try {
            render(html`
                    <${PaymentMethodModal}
                        open=${true}
                        onClose=${() => {}}
                    />
                `, root)
            await nextTask()
            const dialog = document.body.querySelector(
                'modal-window.payment-method-modal'
            ) as HTMLElement
            // AC5.7: The default row should NOT have a
            // "Set as default" button.
            const defaultRow = Array.from(
                dialog.querySelectorAll('.pm-row')
            ).find(r =>
                r.textContent?.includes('4444')
            ) as HTMLElement
            const setOnDefault = Array.from(
                defaultRow.querySelectorAll('button')
            ).find(b =>
                (b.textContent ?? '').match(/set as default/i)
            )
            t.equal(
                setOnDefault,
                undefined,
                'no "Set as default" on default row'
            )
            // Click "Set as default" on visa.
            const visaRow = Array.from(
                dialog.querySelectorAll('.pm-row')
            ).find(r =>
                r.textContent?.includes('4242')
            ) as HTMLElement
            const setBtn = Array.from(
                visaRow.querySelectorAll('button')
            ).find(b =>
                (b.textContent ?? '').match(/set as default/i)
            ) as HTMLButtonElement
            setBtn.click()
            await nextTask()
            await nextTask()
            // Default badge should now be on the visa row.
            const newVisaRow = Array.from(
                dialog.querySelectorAll('.pm-row')
            ).find(r =>
                r.textContent?.includes('4242')
            ) as HTMLElement
            t.ok(
                newVisaRow.querySelector('.pm-default-badge'),
                'visa row now has Default badge'
            )
        } finally {
            State.setDefaultPaymentMethod = originalSet
        }
    } finally {
        resetState()
        cleanup()
    }
}
)

test('AC5.5: Partial-failure surface inline banner (UI smoke)',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            const originalSet = State.setDefaultPaymentMethod
            State.setDefaultPaymentMethod = async () => {
                throw new Error('stripe_error')
            }
            try {
                render(html`
                    <${PaymentMethodModal}
                        open=${true}
                        onClose=${() => {}}
                    />
                `, root)
                await nextTask()
                const dialog = document.body.querySelector(
                    'modal-window.payment-method-modal'
                ) as HTMLElement
                const visaRow = Array.from(
                    dialog.querySelectorAll('.pm-row')
                ).find(r =>
                    r.textContent?.includes('4242')
                ) as HTMLElement
                const setBtn = Array.from(
                    visaRow.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/set as default/i)
                ) as HTMLButtonElement
                setBtn.click()
                await nextTask()
                await nextTask()
                const err = dialog.querySelector('.pm-error')
                t.ok(err, 'inline error shown')
                t.ok(
                    err?.textContent?.match(/stripe_error|partial/),
                    'error code surfaces (stripe_error or partial)'
                )
            } finally {
                State.setDefaultPaymentMethod = originalSet
            }
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC5.5: State.setDefaultPaymentMethod handles 502 partial-failure ' +
    'shape by replacing signals from the body and throwing',
async t => {
    // No State override: exercise the real client action against
    // a stubbed fetch that returns the server's 502
    // partial-failure shape from Task 3.
    seedBilling(true)
    seedMethods()
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
        return new Response(JSON.stringify({
            error: 'stripe_error',
            customerDefaultUpdated: true,
            subscriptionDefaultUpdated: false,
            methods: [
                {
                    id: 'pm_visa',
                    brand: 'visa',
                    last4: '4242',
                    expMonth: 12,
                    expYear: 2030,
                    isDefault: true
                },
                {
                    id: 'pm_mc',
                    brand: 'mastercard',
                    last4: '4444',
                    expMonth: 6,
                    expYear: 2029,
                    isDefault: false
                }
            ],
            defaultId: 'pm_visa'
        }), {
            status: 502,
            headers: { 'content-type': 'application/json' }
        })
    }
    let threw = false
    try {
        await State.setDefaultPaymentMethod('pm_visa')
    } catch (err) {
        threw = true
        t.ok(
            err instanceof Error &&
                    /stripe_error|partial/.test(err.message),
            'throws with partial-failure error code'
        )
    } finally {
        globalThis.fetch = originalFetch
    }
    t.ok(threw, 'action threw')
    // Signals reflect canonical (partial) truth from the body.
    t.equal(
        defaultMethodId.value,
        'pm_visa',
        'defaultMethodId reflects partial state'
    )
    const visa = paymentMethods.value.find(m => m.id === 'pm_visa')
    t.ok(visa?.isDefault, 'visa isDefault flipped')
    resetState()
}
)
