import { html } from 'htm/preact/index.js'
import { type FunctionComponent, type ComponentChildren } from 'preact'
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
