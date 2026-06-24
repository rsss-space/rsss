import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { batch } from '@preact/signals'
import '@substrate-system/button'
import { type AppState } from '../state.js'
import {
    loadSyncStatus,
    failedFeeds,
    confirmingKey,
    announcement
} from './sync-status-state.js'
import {
    deadLetterRows,
    syncStatus,
    syncError,
    syncDeadLetters
} from '../db/sync-status.js'
import {
    describeOp,
    isFetchFailed,
    isPublishFailed
} from './sync-status-format.js'
import { getBootstrappedDb, getLocalDb } from '../db/index.js'
import { runSync } from '../db/sync.js'
import { ButtonPrimary } from '../components/button.js'
import './sync-status.css'

// A single action button, rendered through the `@substrate-system/button`
// web component using its client/SSR pattern: we provide the inner
// `<button>` ourselves so Preact fully owns the real, focusable element.
// That keeps the focus ref and structural class names on the control that
// actually receives focus and clicks, and lets the web component enhance
// it (keyboard handling, styling) without re-rendering over Preact.
const ActionButton:FunctionComponent<{
    text:string;
    label?:string;
    className?:string;
    disabled?:boolean;
    autoFocus?:boolean;
    describedBy?:string;
    onClick:()=> void;
    btnRef?:(el:HTMLButtonElement|null)=> void;
}> = function ({
    text,
    label,
    className,
    disabled,
    autoFocus,
    describedBy,
    onClick,
    btnRef
}) {
    return html`
        <substrate-button>
            <button
                class=${className || undefined}
                type="button"
                aria-label=${label || undefined}
                aria-describedby=${describedBy || undefined}
                disabled=${disabled || undefined}
                autofocus=${autoFocus || undefined}
                ref=${btnRef || undefined}
                onClick=${onClick}
            >
                <span class="btn-content">${text}</span>
            </button>
        </substrate-button>
    `
}

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
        // Focus restoration: only fire after an action removes a
        // row (when pendingFocusTarget is set), not on initial
        // mount. Fires on either list shrinking (dead-letters or
        // failed feeds). Dead-letter actions target the next row's
        // action button or the page heading; feed actions target
        // the page heading (a simplification of the next-row rule,
        // since the two failed-feed sections + dual membership make
        // precise next-row targeting impractical and no AC requires
        // it — the goal is only to not strand focus on a removed
        // element).
        if (!pendingFocusTarget.current) {
            return
        }

        const target = pendingFocusTarget.current
        pendingFocusTarget.current = null

        if (target && target.ownerDocument.contains(target)) {
            target.focus()
        }
    }, [deadLetterRows.value.length, failedFeeds.value.length])

    if (!state.isAuthenticated.value) return null

    // Read signals at component level to ensure preact subscribes
    const currentStatus = syncStatus.value
    const currentError = syncError.value
    const dl = deadLetterRows.value
    const ff = failedFeeds.value
    const announceText = announcement.value
    const confirming = confirmingKey.value

    // Feed-refresh (the "fetch updates" path) reports its failures on
    // `state.feedSyncStatus` / `feedSyncError`, separate from push-sync's
    // `syncError`. Surface it here so the "sync failed" pill has a real
    // detail page to link to.
    const feedRefreshError = state.feedSyncStatus.value === 'error' ?
        state.feedSyncError.value :
        null

    const hasProblems =
        currentStatus === 'error' || dl.length > 0 || ff.length > 0 ||
        feedRefreshError !== null

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

    // Feed actions. Set the focus target before the await so the
    // post-removal re-render (driven by failedFeeds shrinking)
    // moves focus to the page heading instead of stranding it on
    // the removed row's button. If the row stays (e.g. a failed
    // retry), failedFeeds is unchanged and focus is left in place.
    const handleRetryFetch = async (feed:typeof ff[0]) => {
        pendingFocusTarget.current = pageHeadingRef.current
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
        pendingFocusTarget.current = pageHeadingRef.current
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

    const handleUnsubCommit = async (feed:typeof ff[0]) => {
        pendingFocusTarget.current = pageHeadingRef.current
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

    // One-line aggregate summary across categories — orientation
    // before the per-category detail below.
    const summaryParts:string[] = []
    if (fetchFeeds.length > 0) {
        summaryParts.push(
            `${fetchFeeds.length} ` +
            `${fetchFeeds.length === 1 ? 'feed' : 'feeds'} not fetching`
        )
    }
    if (publishFeeds.length > 0) {
        summaryParts.push(
            `${publishFeeds.length} ` +
            `${publishFeeds.length === 1 ? 'feed' : 'feeds'} not sharing`
        )
    }
    if (dl.length > 0) {
        summaryParts.push(
            `${dl.length} blocked ` +
            `${dl.length === 1 ? 'change' : 'changes'}`
        )
    }

    // The shared confirm prompt for a failed feed (fetch + share
    // sections both use it). Cancel takes focus; the destructive
    // commit is described by the irreversibility warning.
    const renderFeedConfirm = (feed:typeof ff[0], feedLabel:string) => {
        const msgId = 'confirm-msg-feed-' + feed.id
        return html`
            <div class="confirm-prompt">
                <p class="prompt-message" id=${msgId}>
                    Are you sure? This cannot be undone.
                </p>
                <div class="confirm-actions">
                    <${ActionButton}
                        className="cancel-btn"
                        text="Cancel"
                        autoFocus=${true}
                        onClick=${handleCancel}
                    />
                    <${ActionButton}
                        className="commit-btn"
                        text="Unsubscribe"
                        label=${`Unsubscribe from ${feedLabel}`}
                        describedBy=${msgId}
                        onClick=${() => handleUnsubCommit(feed)}
                    />
                </div>
            </div>
        `
    }

    return html`
        <div class="route sync-status">
            <h1
                ref=${pageHeadingRef}
                tabindex="-1"
            >
                Sync Status
            </h1>

            ${hasProblems && summaryParts.length > 0 && html`
                <p class="sync-summary">
                    ${summaryParts.join(' · ')}
                </p>
            `}

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

            ${feedRefreshError && html`
                <div class="sync-status-section feed-refresh-error">
                    <h2>Feed refresh failed</h2>
                    <p>${feedRefreshError}</p>
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
                            const feedLabel = feed.title || feed.url
                            return html`
                                <li
                                    class="failed-feed"
                                    key=${feed.id}
                                >
                                    <p class="feed-name">
                                        ${feedLabel}
                                    </p>
                                    <p class="feed-error">
                                        ${feed.last_error ||
                                          (feed.last_status ?
                                            `HTTP ${feed.last_status}` :
                                            'Unknown error')}
                                    </p>
                                    <div class="actions">
                                        <${ButtonPrimary}
                                            className="retry-fetch-btn"
                                            aria-label=${'Retry fetch ' +
                                                feedLabel}
                                            disabled=${offline}
                                            onClick=${() => {
                                                handleRetryFetch(feed)
                                            }}
                                        >Retry fetch<//>
                                        <${ActionButton}
                                            className="unsub-btn"
                                            text="Unsubscribe"
                                            label=${'Unsubscribe from ' +
                                                feedLabel}
                                            onClick=${() => {
                                                handleUnsubscribeClick(
                                                    feed.id
                                                )
                                            }}
                                        />
                                    </div>
                                    ${confirming === 'feed:' + feed.id &&
                                      renderFeedConfirm(feed, feedLabel)}
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
                            const feedLabel = feed.title || feed.url
                            const isReauth =
                                feed.publish_error === 'reauth_required'
                            return html`
                                <li
                                    class="failed-feed"
                                    key=${feed.id}
                                >
                                    <p class="feed-name">
                                        ${feedLabel}
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
                                            <${ButtonPrimary}
                                                className="retry-share-btn"
                                                aria-label=${'Retry share ' +
                                                    feedLabel +
                                                    ' to Bluesky'}
                                                disabled=${offline}
                                                onClick=${() => {
                                                    handleRetryShare(feed)
                                                }}
                                            >Retry share<//>
                                        `}
                                        <${ActionButton}
                                            className="unsub-btn"
                                            text="Unsubscribe"
                                            label=${'Unsubscribe from ' +
                                                feedLabel}
                                            onClick=${() => {
                                                handleUnsubscribeClick(
                                                    feed.id
                                                )
                                            }}
                                        />
                                    </div>
                                    ${confirming === 'feed:' + feed.id &&
                                      renderFeedConfirm(feed, feedLabel)}
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
                            const opText = describeOp(row)
                            const msgId = 'confirm-msg-dl-' + row.id
                            return html`
                                <li
                                    class="blocked-change"
                                    key=${row.client_op_id}
                                >
                                    <p class="op-description">
                                        ${opText}
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
                                            <${ButtonPrimary}
                                                className="retry-btn"
                                                aria-label=${'Retry ' + opText}
                                                btnRef=${(btn) => {
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
                                            >Retry<//>
                                            <${ActionButton}
                                                className="discard-btn"
                                                text="Discard"
                                                label=${'Discard ' +
                                                    opText}
                                                onClick=${() => {
                                                    handleDiscardClick(
                                                        row.id
                                                    )
                                                }}
                                            />
                                        </div>
                                    `}
                                    ${confirmingThis && html`
                                        <div
                                            class="confirm-prompt"
                                        >
                                            <p
                                                class="prompt-message"
                                                id=${msgId}
                                            >
                                                Are you sure? This
                                                cannot be undone.
                                            </p>
                                            <div
                                                class="confirm-actions"
                                            >
                                                <${ActionButton}
                                                    className="cancel-btn"
                                                    text="Cancel"
                                                    autoFocus=${true}
                                                    onClick=${handleCancel}
                                                />
                                                <${ActionButton}
                                                    className="commit-btn"
                                                    text="Discard"
                                                    label=${'Discard ' +
                                                        opText}
                                                    describedBy=${msgId}
                                                    onClick=${() => {
                                                        handleConfirmDiscard(
                                                            row
                                                        )
                                                    }}
                                                />
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
