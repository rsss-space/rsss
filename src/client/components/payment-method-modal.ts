import { html } from 'htm/preact/index.js'
import { type FunctionComponent } from 'preact'
import {
    useCallback,
    useEffect,
    useRef,
    useState
} from 'preact/hooks'
import {
    loadStripe,
    type Stripe as StripeLib,
    type StripeElements
} from '@stripe/stripe-js'
import { batch } from '@preact/signals'
import { ModalWindow } from '@substrate-system/dialog'
import '@substrate-system/dialog/css'
import { State } from '../state.js'
import {
    paymentMethods,
    defaultMethodId,
    paymentMethodsError,
    type PaymentMethodSummary
} from '../payment-methods.js'
import { billingStatus } from '../billing-status.js'
import './payment-method-modal.css'

type ModalWindowAttrs = preact.JSX.HTMLAttributes<HTMLElement> & {
    active?: string;
    closable?: string;
    'no-icon'?: string | boolean;
    animated?: string;
    noclick?: string | boolean;
    close?: string;
};

declare module 'preact' {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    export namespace JSX {
        interface IntrinsicElements {
            'modal-window': ModalWindowAttrs;
        }
    }
}

type Mode = 'list' | 'adding' | 'confirming-remove'

export interface PaymentMethodModalProps {
    open:boolean;
    onClose:() => void;
}

const TITLE_ID = 'payment-method-modal-title'
const ERROR_ID = 'payment-method-modal-error'

function formatExp (m:number, y:number):string {
    const mm = String(m).padStart(2, '0')
    const yy = String(y).slice(-2)
    return `${mm}/${yy}`
}

function formatBrand (b:string):string {
    if (!b) return 'Card'
    return b.charAt(0).toUpperCase() + b.slice(1)
}

export const PaymentMethodModal:FunctionComponent<
    PaymentMethodModalProps
> = function ({ open, onClose }) {
    const [mode, setMode] = useState<Mode>('list')
    const [setupSecret, setSetupSecret] = useState<string|null>(null)
    const [addError, setAddError] = useState<string|null>(null)
    const [adding, setAdding] = useState(false)
    const stripeRef = useRef<StripeLib|null>(null)
    const elementsRef = useRef<StripeElements|null>(null)
    const elementHostRef = useRef<HTMLDivElement|null>(null)
    const modalRef = useRef<HTMLElement|null>(null)

    // Reset modal-scoped state whenever the dialog closes.
    const handleClose = useCallback(() => {
        batch(() => {
            // Modal-local signals: clear them so a re-open starts
            // clean.
        })
        setMode('list')
        setSetupSecret(null)
        setAddError(null)
        setAdding(false)
        const el = elementsRef.current
        if (el) {
            try {
                // Unmount the payment element to detach event
                // listeners.
                const pmEl = el.getElement('payment')
                if (pmEl) pmEl.unmount()
            } catch {
                // Best-effort cleanup.
            }
        }
        elementsRef.current = null
        onClose()
    }, [onClose])

    // Begin add-a-card flow: fetch a SetupIntent client_secret,
    // initialise Stripe Elements, mount PaymentElement.
    const handleAddCard = useCallback(async () => {
        const pk = billingStatus.value?.stripePublishableKey
        if (!pk) {
            setAddError('stripe_unconfigured')
            return
        }
        setMode('adding')
        setAddError(null)
        try {
            const secret = await State.createSetupIntent()
            setSetupSecret(secret)
            const stripeLib = await loadStripe(pk)
            if (!stripeLib) {
                setAddError('failed_to_load_stripe_js')
                return
            }
            stripeRef.current = stripeLib
            const elements = stripeLib.elements({
                clientSecret: secret
            })
            elementsRef.current = elements
            // The element mounts in a useEffect below once the
            // host node is on screen (mode === 'adding').
        } catch (err) {
            setAddError(err instanceof Error ?
                err.message :
                'setup_intent_failed')
            setMode('list')
        }
    }, [])

    // Once `mode === 'adding'` AND the host node exists AND the
    // elements instance exists, mount the payment element.
    useEffect(() => {
        if (mode !== 'adding') return
        const host = elementHostRef.current
        const elements = elementsRef.current
        if (!host || !elements) return
        const pm = elements.create('payment')
        pm.mount(host)
        return () => {
            try {
                pm.unmount()
            } catch {
                // Best-effort cleanup.
            }
        }
    }, [mode, setupSecret])

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

    const handleSubmitAdd = useCallback(async () => {
        const stripeLib = stripeRef.current
        const elements = elementsRef.current
        if (!stripeLib || !elements) return
        setAdding(true)
        setAddError(null)
        try {
            const origin = window.location.origin
            const { error } = await stripeLib.confirmSetup({
                elements,
                confirmParams: {
                    return_url: `${origin}/settings`
                },
                redirect: 'if_required'
            })
            if (error) {
                setAddError(error.message || 'card_declined')
                setAdding(false)
                return
            }
            // Success: refresh canonical list (AC3.3, AC8.1), drop
            // back to list mode.
            await State.loadPaymentMethods()
            batch(() => {
                // Phase 2 setters already use batch() internally;
                // wrapping here keeps modal-local resets atomic.
            })
            setMode('list')
            setSetupSecret(null)
            setAdding(false)
        } catch (err) {
            setAddError(err instanceof Error ?
                err.message :
                'confirm_failed')
            setAdding(false)
        }
    }, [])

    const handleCancelAdd = useCallback(() => {
        setMode('list')
        setSetupSecret(null)
        setAddError(null)
        const el = elementsRef.current
        if (el) {
            try {
                const pmEl = el.getElement('payment')
                if (pmEl) pmEl.unmount()
            } catch {
                // Best-effort.
            }
        }
        elementsRef.current = null
    }, [])

    const methods = paymentMethods.value
    const defaultId = defaultMethodId.value
    const globalError = paymentMethodsError.value

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
                ${mode === 'list' && html`
                    <ul class="pm-list">
                        ${methods.map((m) => html`
                            <${Row}
                                method=${m}
                                isDefault=${m.id === defaultId}
                            />
                        `)}
                    </ul>
                    ${(addError || globalError) && html`
                        <p
                            id=${ERROR_ID}
                            class="pm-error"
                            role="alert"
                        >
                            ${addError || globalError}
                        </p>
                    `}
                    <div class="pm-actions">
                        <button
                            type="button"
                            class="btn-link"
                            onClick=${handleAddCard}
                        >
                            Add a card
                        </button>
                    </div>
                `}
                ${mode === 'adding' && html`
                    <div
                        class="pm-element-host"
                        ref=${elementHostRef}
                    ></div>
                    ${addError && html`
                        <p
                            id=${ERROR_ID}
                            class="pm-error"
                            role="alert"
                        >
                            ${addError}
                        </p>
                    `}
                    <div class="pm-actions">
                        <button
                            type="button"
                            class="btn-link"
                            onClick=${handleCancelAdd}
                            disabled=${adding || undefined}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            class="btn-link"
                            onClick=${handleSubmitAdd}
                            disabled=${adding || undefined}
                        >
                            ${adding ? 'Adding...' : 'Save card'}
                        </button>
                    </div>
                `}
            </div>
        </modal-window>
    `
}

const Row:FunctionComponent<{
    method:PaymentMethodSummary;
    isDefault:boolean;
}> = function ({ method, isDefault }) {
    return html`
        <li class="pm-row">
            <span class="pm-brand-line">
                ${formatBrand(method.brand)} ending in ${method.last4}
                <span class="pm-exp">
                    (${formatExp(method.expMonth, method.expYear)})
                </span>
            </span>
            ${isDefault && html`
                <span class="pm-default-badge">Default</span>
            `}
        </li>
    `
}
