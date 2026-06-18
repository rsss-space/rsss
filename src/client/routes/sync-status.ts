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

    const hasProblems = currentStatus === 'error' || dl.length > 0 || ff.length > 0

    return html`
        <div class="route sync-status">
            <h1>Sync Status</h1>

            <div role="status" aria-live="polite" class="sync-status-announcements"></div>

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
        </div>
    `
}
