import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { batch } from '@preact/signals'
import { type AppState } from '../state.js'
import {
    loadSyncStatus,
    deadLetters,
    failedFeeds,
    confirmingKey,
    announcement
} from './sync-status-state.js'
import {
    syncStatus,
    syncError,
    syncDeadLetters
} from '../db/sync-status.js'
import { describeOp } from './sync-status-format.js'
import './sync-status.css'

export const SyncStatusRoute:FunctionComponent<{
    state:AppState
}> = function ({ state }) {
    const pageHeadingRef = useRef<HTMLHeadingElement>(null)
    const headingRef = useRef<HTMLHeadingElement>(null)
    const rowActionRefs = useRef<Map<number, HTMLButtonElement>>(
        new Map()
    )
    const pendingFocusTarget = useRef<HTMLElement|null>(null)

    useEffect(() => {
        if (!state.authLoading.value && !state.isAuthenticated.value) {
            state._setRoute('/login')
        }
    }, [state.authLoading.value, state.isAuthenticated.value])

    useEffect(() => {
        loadSyncStatus(state)
    }, [syncDeadLetters.value])

    useEffect(() => {
        // Focus restoration: only fire after action (when
        // pendingFocusTarget is set), not on initial mount.
        // Move to next row's first action button, or the
        // section heading if list is now empty.
        if (!pendingFocusTarget.current) {
            return
        }

        const target = pendingFocusTarget.current
        pendingFocusTarget.current = null

        if (target && target.ownerDocument.contains(target)) {
            target.focus()
        }
    }, [deadLetters.value.length])

    if (!state.isAuthenticated.value) return null

    // Read signals at component level to ensure preact subscribes
    const currentStatus = syncStatus.value
    const currentError = syncError.value
    const dl = deadLetters.value
    const ff = failedFeeds.value
    const announceText = announcement.value
    const confirming = confirmingKey.value

    const hasProblems =
        currentStatus === 'error' || dl.length > 0 || ff.length > 0

    // Set the focus target BEFORE the action's await. The await
    // removes the row, which re-renders and runs the focus effect;
    // the target must already be set or the effect sees null and
    // never moves focus. Target the next remaining row's action
    // button, or the page heading when the list becomes empty
    // (the section <h2> unmounts when empty, so it cannot receive
    // focus). AC9.3.
    const setPendingFocusFor = (row:typeof dl[0]) => {
        const idx = dl.findIndex(r => r.id === row.id)
        const nextIdx = idx + 1
        if (nextIdx < dl.length) {
            const nextBtn = rowActionRefs.current.get(dl[nextIdx].id)
            pendingFocusTarget.current = nextBtn ?? null
        } else {
            pendingFocusTarget.current = pageHeadingRef.current
        }
    }

    const handleRetry = async (row:typeof dl[0]) => {
        setPendingFocusFor(row)
        await state.retryDeadLetter(state, row.id)
        announcement.value = 'Change retried.'
    }

    const handleDiscardClick = (rowId:number) => {
        confirmingKey.value = 'dl:' + rowId
    }

    const handleCancel = () => {
        confirmingKey.value = null
    }

    const handleConfirmDiscard = async (row:typeof dl[0]) => {
        setPendingFocusFor(row)
        await state.discardDeadLetter(state, row.id)
        batch(() => {
            confirmingKey.value = null
            announcement.value = 'Change discarded.'
        })
    }

    return html`
        <div class="route sync-status">
            <h1
                ref=${pageHeadingRef}
                tabindex="-1"
            >
                Sync Status
            </h1>

            <div
                role="status"
                aria-live="polite"
                class="sync-status-announcements"
            >
                ${announceText}
            </div>

            ${currentStatus === 'error' && html`
                <div class="sync-status-section current-error">
                    <p>${currentError}</p>
                </div>
            `}

            ${!hasProblems && html`
                <div class="empty-state">
                    Everything is syncing smoothly.
                </div>
            `}

            ${dl.length > 0 && html`
                <div class="sync-status-section blocked-changes">
                    <h2
                        ref=${headingRef}
                        tabindex="-1"
                    >
                        Blocked local changes
                    </h2>
                    <ul class="blocked-changes-list">
                        ${dl.map((row) => {
                            const confirmingThis =
                                confirming === 'dl:' + row.id
                            return html`
                                <li
                                    class="blocked-change"
                                    key=${row.client_op_id}
                                >
                                    <p class="op-description">
                                        ${describeOp(row)}
                                    </p>
                                    <div class="op-details">
                                        <div class="attempts">
                                            <span class="label">
                                                Attempts:
                                            </span>
                                            <span
                                                class="value"
                                            >
                                                ${row.attempts}
                                            </span>
                                        </div>
                                        <div class="last-error">
                                            <span class="label">
                                                Error:
                                            </span>
                                            <span
                                                class="error-text"
                                            >
                                                ${row.last_error ??
                                                  'unknown'}
                                            </span>
                                        </div>
                                    </div>
                                    ${!confirmingThis && html`
                                        <div class="actions">
                                            <button
                                                class="retry-btn"
                                                type="button"
                                                ref=${(btn) => {
                                                    if (btn) {
                                                        rowActionRefs
                                                            .current
                                                            .set(row.id,
                                                                btn)
                                                    } else {
                                                        rowActionRefs
                                                            .current
                                                            .delete(
                                                                row.id)
                                                    }
                                                }}
                                                onClick=${() => {
                                                    handleRetry(row)
                                                }}
                                            >
                                                Retry
                                            </button>
                                            <button
                                                class="discard-btn"
                                                type="button"
                                                onClick=${() => {
                                                    handleDiscardClick(
                                                        row.id
                                                    )
                                                }}
                                            >
                                                Discard
                                            </button>
                                        </div>
                                    `}
                                    ${confirmingThis && html`
                                        <div
                                            class="confirm-prompt"
                                        >
                                            <p
                                                class="prompt-message"
                                            >
                                                Are you sure? This
                                                cannot be undone.
                                            </p>
                                            <div
                                                class="confirm-actions"
                                            >
                                                <button
                                                    class="cancel-btn"
                                                    type="button"
                                                    autoFocus
                                                    onClick=${() => {
                                                        handleCancel()
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    class="commit-btn"
                                                    type="button"
                                                    onClick=${() => {
                                                        handleConfirmDiscard(
                                                            row
                                                        )
                                                    }}
                                                >
                                                    Discard
                                                </button>
                                            </div>
                                        </div>
                                    `}
                                </li>
                            `
                        })}
                    </ul>
                </div>
            `}
        </div>
    `
}
