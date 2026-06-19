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
import { describeOp, isFetchFailed, isPublishFailed } from './sync-status-format.js'
import { getBootstrappedDb, getLocalDb } from '../db/index.js'
import { runSync } from '../db/sync.js'
import './sync-status.css'

export const SyncStatusRoute:FunctionComponent<{
    state:AppState
}> = function ({ state }) {
    const pageHeadingRef = useRef<HTMLHeadingElement>(null)
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

    // Feed actions
    const handleRetryFetch = async (feed:typeof ff[0]) => {
        await state.refreshFeed(state, String(feed.id))
        // Follow-up sync + reload
        const did = state.user.value?.did
        const db = did ? (getBootstrappedDb() ?? getLocalDb(did)) : null
        if (db) {
            await runSync(db)
            await loadSyncStatus(state)
        }
        announcement.value = 'Feed retry in progress.'
    }

    const handleRetryShare = async (feed:typeof ff[0]) => {
        await state.toggleFeedPublished(state, feed.id, true)
        // Follow-up sync + reload
        const did = state.user.value?.did
        const db = did ? (getBootstrappedDb() ?? getLocalDb(did)) : null
        if (db) {
            await runSync(db)
            await loadSyncStatus(state)
        }
        announcement.value = 'Share retry in progress.'
    }

    const handleUnsubscribeClick = (feedId:number) => {
        confirmingKey.value = 'feed:' + feedId
    }

    const handleConfirmUnsubscribe = async (feed:typeof ff[0]) => {
        await state.deleteFeed(state, feed.id)
        await loadSyncStatus(state)
        batch(() => {
            confirmingKey.value = null
            announcement.value = 'Feed removed.'
        })
    }

    const offline = syncStatus.value === 'offline'
    const fetchFeeds = ff.filter(isFetchFailed)
    const publishFeeds = ff.filter(isPublishFailed)

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

            ${fetchFeeds.length > 0 && html`
                <div class="sync-status-section feeds-fetch-failed">
                    <h2 tabindex="-1">Feeds that couldn't fetch</h2>
                    <ul class="feeds-list">
                        ${fetchFeeds.map((feed) => {
                            return html`
                                <li
                                    class="failed-feed"
                                    key=${feed.id}
                                >
                                    <p class="feed-name">
                                        ${feed.title || feed.url}
                                    </p>
                                    <p class="feed-error">
                                        ${feed.last_error ||
                                          (feed.last_status ?
                                            `HTTP ${feed.last_status}` :
                                            'Unknown error')}
                                    </p>
                                    <div class="actions">
                                        <button
                                            type="button"
                                            disabled=${offline}
                                            onClick=${() => {
                                                handleRetryFetch(feed)
                                            }}
                                        >
                                            Retry fetch
                                        </button>
                                        <button
                                            type="button"
                                            onClick=${() => {
                                                handleUnsubscribeClick(
                                                    feed.id
                                                )
                                            }}
                                        >
                                            Unsubscribe
                                        </button>
                                    </div>
                                    ${confirmingKey.value ===
                                      'feed:' + feed.id && html`
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
                                                        confirmingKey.value =
                                                            null
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    class="commit-btn"
                                                    type="button"
                                                    onClick=${() => {
                                                        handleConfirmUnsubscribe(feed)
                                                    }}
                                                >
                                                    Unsubscribe
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

            ${publishFeeds.length > 0 && html`
                <div class="sync-status-section feeds-publish-failed">
                    <h2 tabindex="-1">
                        Feeds that couldn't share to Bluesky
                    </h2>
                    <ul class="feeds-list">
                        ${publishFeeds.map((feed) => {
                            const isReauth =
                                feed.publish_error === 'reauth_required'
                            return html`
                                <li
                                    class="failed-feed"
                                    key=${feed.id}
                                >
                                    <p class="feed-name">
                                        ${feed.title || feed.url}
                                    </p>
                                    <p class="feed-error">
                                        ${feed.publish_error}
                                    </p>
                                    <div class="actions">
                                        ${isReauth && html`
                                            <a
                                                class="reauth-link"
                                                href="/login"
                                            >
                                                Sign in again
                                            </a>
                                        `}
                                        ${!isReauth && html`
                                            <button
                                                type="button"
                                                disabled=${offline}
                                                onClick=${() => {
                                                    handleRetryShare(feed)
                                                }}
                                            >
                                                Retry share
                                            </button>
                                        `}
                                        <button
                                            type="button"
                                            onClick=${() => {
                                                handleUnsubscribeClick(
                                                    feed.id
                                                )
                                            }}
                                        >
                                            Unsubscribe
                                        </button>
                                    </div>
                                    ${confirmingKey.value ===
                                      'feed:' + feed.id && html`
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
                                                        confirmingKey.value =
                                                            null
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    class="commit-btn"
                                                    type="button"
                                                    onClick=${() => {
                                                        handleConfirmUnsubscribe(feed)
                                                    }}
                                                >
                                                    Unsubscribe
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

            ${dl.length > 0 && html`
                <div class="sync-status-section blocked-changes">
                    <h2>Blocked local changes</h2>
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
