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
    const [elements, setElements] = useState<StripeElements|null>(null)
    const [addError, setAddError] = useState<string|null>(null)
    const [adding, setAdding] = useState(false)
    const [removeCandidate, setRemoveCandidate] = useState<string|null>(
        null
    )
    const [rowPending, setRowPending] = useState<Record<string, boolean>>(
        {}
    )
    const [opError, setOpError] = useState<string|null>(null)
    const stripeRef = useRef<StripeLib|null>(null)
    const elementsRef = useRef<StripeElements|null>(null)
    const elementHostRef = useRef<HTMLDivElement|null>(null)
    const modalRef = useRef<HTMLElement|null>(null)
    const prevOpenRef = useRef<boolean>(open)

    // Helper to reset internal state (shared by handleClose and
    // parent-driven close detection).
    const resetState = useCallback(() => {
        setMode('list')
        setElements(null)
        setAddError(null)
        setAdding(false)
        setRemoveCandidate(null)
        setRowPending({})
        setOpError(null)
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
    }, [])

    // Reset modal-scoped state whenever the dialog closes via user
    // action (Escape, backdrop, .close()). Updating prevOpenRef here
    // pre-empts the parent-driven effect so resetState() only runs once.
    const handleClose = useCallback(() => {
        resetState()
        prevOpenRef.current = false
        onClose()
    }, [resetState, onClose])

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
            const stripeLib = await loadStripe(pk)
            if (!stripeLib) {
                setAddError('failed_to_load_stripe_js')
                return
            }
            stripeRef.current = stripeLib
            const els = stripeLib.elements({
                clientSecret: secret
            })
            elementsRef.current = els
            setElements(els)
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
    }, [mode, elements])

    // Detect parent-driven close (open prop transitioned from true to
    // false) and reset internal state without calling onClose() to
    // avoid loops.
    useEffect(() => {
        if (prevOpenRef.current && !open) {
            resetState()
        }
        prevOpenRef.current = open
    }, [open, resetState])

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
            setMode('list')
            setElements(null)
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
        setElements(null)
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

    const handleAskRemove = useCallback((id:string) => {
        setRemoveCandidate(id)
        setOpError(null)
        setMode('confirming-remove')
    }, [])

    const handleCancelRemove = useCallback(() => {
        setRemoveCandidate(null)
        setOpError(null)
        setMode('list')
    }, [])

    const handleConfirmRemove = useCallback(async () => {
        const id = removeCandidate
        if (!id) return
        setRowPending(s => ({ ...s, [id]: true }))
        setOpError(null)
        try {
            await State.removePaymentMethod(id)
            setRemoveCandidate(null)
            setMode('list')
        } catch (err) {
            setOpError(err instanceof Error ?
                err.message :
                'remove_failed')
        } finally {
            setRowPending(s => {
                const copy = { ...s }
                delete copy[id]
                return copy
            })
        }
    }, [removeCandidate])

    const handleSetDefault = useCallback(async (id:string) => {
        setRowPending(s => ({ ...s, [id]: true }))
        setOpError(null)
        try {
            await State.setDefaultPaymentMethod(id)
        } catch (err) {
            setOpError(err instanceof Error ?
                err.message :
                'set_default_failed')
        } finally {
            setRowPending(s => {
                const copy = { ...s }
                delete copy[id]
                return copy
            })
        }
    }, [])

    const methods = paymentMethods.value
    const defaultId = defaultMethodId.value
    const globalError = paymentMethodsError.value

    const describedBy = mode === 'list' ?
        ((opError || addError || globalError) ? ERROR_ID : undefined) :
        mode === 'confirming-remove' ?
            (opError ? ERROR_ID : undefined) :
            (addError ? ERROR_ID : undefined)

    return html`
        <modal-window
            ref=${modalRef}
            class="payment-method-modal"
            active=${open ? 'true' : 'false'}
            aria-describedby=${describedBy}
        >
            <h2 id=${TITLE_ID}>Payment methods</h2>
            <div class="payment-method-modal-body">
                ${mode === 'list' && html`
                    <ul class="pm-list">
                        ${methods.map((m) => html`
                            <${Row}
                                method=${m}
                                isDefault=${m.id === defaultId}
                                pending=${Boolean(rowPending[m.id])}
                                onRemove=${handleAskRemove}
                                onSetDefault=${handleSetDefault}
                            />
                        `)}
                    </ul>
                    ${(opError || addError || globalError) && html`
                        <p
                            id=${ERROR_ID}
                            class="pm-error"
                            role="alert"
                        >
                            ${opError ?? addError ?? globalError}
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
                ${mode === 'confirming-remove' && html`
                    <p class="pm-confirm-text">
                        Remove this card?
                    </p>
                    ${opError && html`
                        <p
                            id=${ERROR_ID}
                            class="pm-error"
                            role="alert"
                        >
                            ${opError}
                        </p>
                    `}
                    <div class="pm-actions">
                        <button
                            type="button"
                            class="btn-link"
                            onClick=${handleCancelRemove}
                            disabled=${removeCandidate ?
                                Boolean(rowPending[removeCandidate]) :
                                false}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            class="btn-link"
                            onClick=${handleConfirmRemove}
                            disabled=${removeCandidate ?
                                Boolean(rowPending[removeCandidate]) :
                                false}
                        >
                            ${removeCandidate && rowPending[removeCandidate] ?
                                'Removing...' :
                                'Remove'}
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
    pending:boolean;
    onRemove:(id:string) => void;
    onSetDefault:(id:string) => void;
}> = function ({
    method, isDefault, pending, onRemove, onSetDefault
}) {
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
            <div class="pm-row-actions">
                ${!isDefault && html`
                    <button
                        type="button"
                        class="btn-link"
                        onClick=${() => onSetDefault(method.id)}
                        disabled=${pending || undefined}
                    >
                        ${pending ? 'Working...' : 'Set as default'}
                    </button>
                `}
                <button
                    type="button"
                    class="btn-link"
                    onClick=${() => onRemove(method.id)}
                    disabled=${isDefault || pending || undefined}
                    title=${isDefault ?
                        'Set another card as default first.' :
                        undefined}
                >
                    Remove
                </button>
            </div>
        </li>
    `
}
