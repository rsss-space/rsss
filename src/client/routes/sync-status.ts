import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
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
    const headingRef = useRef<HTMLHeadingElement>(null)
    const nextActionBtnRef = useRef<HTMLButtonElement>(null)
    const [confirmingId, setConfirmingId] = useState<number|null>(null)

    useEffect(() => {
        if (!state.authLoading.value && !state.isAuthenticated.value) {
            state._setRoute('/login')
        }
    }, [state.authLoading.value, state.isAuthenticated.value])

    useEffect(() => {
        loadSyncStatus(state)
    }, [syncDeadLetters.value])

    useEffect(() => {
        // Focus restoration: move to next row's first action button,
        // or the section heading if list is empty
        const dl = deadLetters.value
        if (dl.length === 0 && headingRef.current) {
            headingRef.current.focus()
        } else if (nextActionBtnRef.current) {
            nextActionBtnRef.current.focus()
        }
    }, [deadLetters.value.length])

    if (!state.isAuthenticated.value) return null

    // Read signals at component level to ensure preact subscribes
    const currentStatus = syncStatus.value
    const currentError = syncError.value
    const dl = deadLetters.value
    const ff = failedFeeds.value
    const announceText = announcement.value

    const hasProblems =
        currentStatus === 'error' || dl.length > 0 || ff.length > 0

    const handleRetry = async (row:typeof dl[0]) => {
        await state.retryDeadLetter(state, row.id)
        batch(() => {
            announcement.value = 'Change retried.'
        })
    }

    const handleDiscardClick = (rowId:number) => {
        setConfirmingId(rowId)
    }

    const handleCancel = () => {
        setConfirmingId(null)
    }

    const handleConfirmDiscard = async (row:typeof dl[0]) => {
        await state.discardDeadLetter(state, row.id)
        batch(() => {
            announcement.value = 'Change discarded.'
        })
        setConfirmingId(null)
    }

    return html`
        <div class="route sync-status">
            <h1>Sync Status</h1>

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
                        ${dl.map((row, idx) => {
                            const confirmingThis =
                                confirmingId === row.id
                            const isFirstRow = idx === 0
                            return html`
                                <li
                                    class="blocked-change"
                                    key=${'row-' + row.id + '-' +
                                        (confirmingId === row.id ?
                                            'confirming' :
                                            'normal')}
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
                                                ref=${isFirstRow ?
                                                    nextActionBtnRef :
                                                    undefined}
                                                onClick=${async () => {
                                                    await handleRetry(
                                                        row
                                                    )
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
                                                    ref=${isFirstRow ?
                                                        nextActionBtnRef :
                                                        undefined}
                                                    onClick=${() => {
                                                        handleCancel()
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    class="commit-btn"
                                                    type="button"
                                                    onClick=${async () => {
                                                        await handleConfirmDiscard(
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
