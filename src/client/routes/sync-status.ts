import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useEffect } from 'preact/hooks'
import { type AppState } from '../state.js'
import {
    loadSyncStatus,
    deadLetters,
    failedFeeds
} from './sync-status-state.js'
import { syncStatus, syncError, syncDeadLetters } from '../db/sync-status.js'
import { describeOp } from './sync-status-format.js'
import './sync-status.css'

export const SyncStatusRoute:FunctionComponent<{
    state:AppState
}> = function ({ state }) {
    useEffect(() => {
        if (!state.authLoading.value && !state.isAuthenticated.value) {
            state._setRoute('/login')
        }
    }, [state.authLoading.value, state.isAuthenticated.value])

    useEffect(() => {
        loadSyncStatus(state)
    }, [syncDeadLetters.value])

    if (!state.isAuthenticated.value) return null

    const currentStatus = syncStatus.value
    const currentError = syncError.value
    const dl = deadLetters.value
    const ff = failedFeeds.value

    const hasProblems =
        currentStatus === 'error' || dl.length > 0 || ff.length > 0

    return html`
        <div class="route sync-status">
            <h1>Sync Status</h1>

            <div
                role="status"
                aria-live="polite"
                class="sync-status-announcements"
            ></div>

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
                    <h2 tabindex="-1">Blocked local changes</h2>
                    <ul class="blocked-changes-list">
                        ${dl.map(row => html`
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
                                        <span class="value">
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
                                <div class="actions">
                                    <button
                                        class="retry-btn"
                                        type="button"
                                    >
                                        Retry
                                    </button>
                                    <button
                                        class="discard-btn"
                                        type="button"
                                    >
                                        Discard
                                    </button>
                                </div>
                            </li>
                        `)}
                    </ul>
                </div>
            `}
        </div>
    `
}
