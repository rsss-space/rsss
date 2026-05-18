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
import { setNextConfirmSetupResult } from './stripe-js-stub.js'

function nextTask ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

function waitFor (
    predicate:() => unknown,
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

            const dialog = document.body.querySelector(
                'dialog.app-dialog.payment-method-modal'
            ) as HTMLDialogElement
            t.ok(dialog, 'modal dialog rendered')
            await waitFor(() => dialog.open === true, 200)
            t.equal(
                dialog.open,
                true,
                'opened via native showModal()'
            )
            const rows = dialog.querySelectorAll('.pm-row')
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
            const dialog = document.body.querySelector(
                'dialog.app-dialog.payment-method-modal'
            ) as HTMLDialogElement
            const rows = Array.from(
                dialog.querySelectorAll('.pm-row')
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
            const dialog = document.body.querySelector(
                'dialog.app-dialog.payment-method-modal'
            ) as HTMLDialogElement
            const addBtn = Array.from(
                dialog.querySelectorAll('button')
            ).find(b => (b.textContent ?? '').match(/add a card/i))
            t.ok(addBtn, 'Add a card button rendered')
            addBtn?.click()
            // The error appears after Preact re-renders with the error state
            await waitFor(() => {
                const err = dialog.querySelector('.pm-error')
                return err && (err.textContent ?? '').includes(
                    'stripe_unconfigured'
                )
            }, 100)
            const err = dialog.querySelector(
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

                const dialog = document.body.querySelector(
                    'dialog.app-dialog.payment-method-modal'
                ) as HTMLDialogElement
                const addBtn = Array.from(
                    dialog.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/add a card/i)
                ) as HTMLButtonElement
                addBtn.click()
                await waitFor(() => !!dialog.querySelector(
                    '.pm-element-host'
                ), 100)
                const saveBtn = Array.from(
                    dialog.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/save card/i)
                ) as HTMLButtonElement
                t.ok(saveBtn, 'Save card button shown in adding mode')
                saveBtn.click()
                await waitFor(() => !!dialog.querySelector(
                    '.pm-list'
                ) || !!dialog.querySelector('.pm-error'), 100)
                t.equal(
                    reloadCalls,
                    1,
                    'loadPaymentMethods called once'
                )
                // Returned to list mode
                t.ok(
                    dialog.querySelector('.pm-list'),
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
            const dialog = document.body.querySelector(
                'dialog.app-dialog.payment-method-modal'
            ) as HTMLDialogElement
            const addBtn = Array.from(
                dialog.querySelectorAll('button')
            ).find(b =>
                (b.textContent ?? '').match(/add a card/i)
            ) as HTMLButtonElement
            addBtn.click()
            await waitFor(() => !!dialog.querySelector(
                '.pm-element-host'
            ), 100)
            const saveBtn = Array.from(
                dialog.querySelectorAll('button')
            ).find(b =>
                (b.textContent ?? '').match(/save card/i)
            ) as HTMLButtonElement
            saveBtn.click()
            await waitFor(() => !!dialog.querySelector(
                '.pm-error'
            ), 100)
            const err = dialog.querySelector(
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
                dialog.querySelector('.pm-element-host'),
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

                const dialog = document.body.querySelector(
                    'dialog.app-dialog.payment-method-modal'
                ) as HTMLDialogElement
                const addBtn = Array.from(
                    dialog.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/add a card/i)
                ) as HTMLButtonElement
                addBtn.click()
                await waitFor(() => !!dialog.querySelector(
                    '.pm-element-host'
                ), 100)
                t.ok(
                    dialog.querySelector('.pm-element-host'),
                    'now in adding mode'
                )
                dialog.close()
                await nextTask()
                await nextTask()
                t.equal(dialog.open, false, 'modal closed')

                const reopen = root.querySelector(
                    '#reopen'
                ) as HTMLButtonElement
                reopen.click()
                await nextTask()
                await nextTask()
                await waitFor(() => dialog.open === true, 300)
                await waitFor(() => !!dialog.querySelector(
                    '.pm-list'
                ), 300)
                t.equal(dialog.open, true, 'reopened')
                t.ok(
                    dialog.querySelector('.pm-list'),
                    'reopened in list mode'
                )
                t.equal(
                    dialog.querySelector('.pm-element-host'),
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
