import { type FunctionComponent } from 'preact'
import { html } from 'htm/preact'
// import Debug from '@substrate-system/debug'
import { type Signal, useSignal } from '@preact/signals'
import './button.css'

// const debug = Debug('rsss:view')

export interface ButtonProps {
    onClick?:(ev:MouseEvent)=>void|Promise<void>;
    class?:string;
    isSpinning?:Signal<boolean>;
    className?:string;
    disabled?:boolean;
    // Forwarded to the real <button> so callers can capture the
    // focusable element (e.g. for focus restoration). Named `btnRef`
    // because Preact strips a plain `ref` from a function component's
    // props rather than forwarding it.
    btnRef?:(el:HTMLButtonElement|null)=>void;
}

export const ButtonPrimary:FunctionComponent<ButtonProps> = function (props) {
    const className = (props.class || props.className || '') + ' btn-primary'

    return Button({ ...props, class: className })
}

export const Button:FunctionComponent<ButtonProps> = function (props) {
    const { isSpinning: _isSpinning, btnRef, ..._props } = props
    const isControlled = Boolean(_isSpinning)
    const isSpinning = _isSpinning || useSignal<boolean>(false)

    const classes = ([
        'btn',
        props.className,
        isSpinning.value ? 'spinning' : '',
        props.class
    ]).filter(Boolean).join(' ').trim()

    async function click (ev:MouseEvent) {
        if (!props.onClick) return
        // The DOM event dispatch discards this async function's
        // promise, so any rejection from `onClick` becomes an
        // unhandled rejection. Swallow it here; callers settle
        // their own application-level error state inside `onClick`.
        if (isControlled) {
            try {
                await props.onClick(ev)
            } catch {
                /* parent owns error handling */
            }
            return
        }
        isSpinning.value = true
        try {
            await props.onClick(ev)
        } catch {
            /* parent owns error handling */
        } finally {
            isSpinning.value = false
        }
    }

    return html`<button
        ...${_props}
        ref=${btnRef}
        onClick=${click}
        disabled=${isSpinning.value || _props.disabled}
        aria-busy=${isSpinning.value}
        class=${classes}
    >
        <span className="btn-content">${props.children}</span>
    </button>`
}
