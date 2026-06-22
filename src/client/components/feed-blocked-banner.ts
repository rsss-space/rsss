import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useState } from 'preact/hooks'
import { type AppState, State } from '../state.js'
import { type Feed } from '../db/types.js'
import { type DeadLetterRow } from '../db/push-sync.js'
import { describeOp } from '../routes/sync-status-format.js'
import { WarningIcon } from './article-notice.js'
import './feed-blocked-banner.css'

export interface FeedBlockedBannerProps {
    state:AppState
    feed:Feed
    blockedOps:DeadLetterRow[]
}

export const FeedBlockedBanner:FunctionComponent<
    FeedBlockedBannerProps
> = function ({ state, feed, blockedOps }) {
    const [confirmId, setConfirmId] = useState<number|null>(null)

    function handleConfirmCommit (op:DeadLetterRow):void {
        if (op.op === 'add_feed') {
            state.discardBlockedFeedAdd(state, feed.id, op.id)
        } else {
            state.discardDeadLetter(state, op.id)
        }
        setConfirmId(null)
    }

    // Case A: blockedOps.length > 0
    if (blockedOps.length > 0) {
        return html`
            <div class="feed-blocked-banner">
                <span class="feed-blocked-icon" aria-hidden="true">
                    <${WarningIcon} />
                </span>
                <div class="feed-blocked-content">
                    ${blockedOps.map(op => html`
                        <div class="feed-blocked-op" key=${op.id}>
                            <div class="feed-blocked-op-description">
                                ${describeOp(op)}
                            </div>
                            <div class="feed-blocked-op-attempts">
                                Attempts: ${op.attempts}
                            </div>
                            <div class="feed-blocked-op-error">
                                ${op.last_error ?? 'Unknown error'}
                            </div>
                            <div class="feed-blocked-actions">
                                <button
                                    type="button"
                                    class="btn btn-small btn-primary feed-blocked-retry"
                                    onClick=${() =>
                                        state.retryDeadLetter(
                                            state,
                                            op.id
                                        )}
                                >Retry</button>
                                ${confirmId === op.id ?
                                    html`
                                        <div class="feed-blocked-confirm">
                                            <div
                                                class="feed-blocked-confirm-message"
                                            >
                                                Are you sure? This
                                                cannot be undone.
                                            </div>
                                            <div
                                                class="feed-blocked-confirm-actions"
                                            >
                                                <button
                                                    type="button"
                                                    class="btn btn-small feed-blocked-confirm-cancel"
                                                    onClick=${() =>
                                                        setConfirmId(
                                                            null
                                                        )}
                                                >Cancel</button>
                                                <button
                                                    type="button"
                                                    class="btn btn-small btn-primary feed-blocked-confirm-commit"
                                                    onClick=${() =>
                                                        handleConfirmCommit(
                                                            op
                                                        )}
                                                >Confirm</button>
                                            </div>
                                        </div>
                                    ` :
                                    html`
                                        <button
                                            type="button"
                                            class="btn btn-small feed-blocked-discard"
                                            onClick=${() =>
                                                setConfirmId(op.id)}
                                        >Discard</button>
                                    `
                                }
                            </div>
                        </div>
                    `)}
                </div>
            </div>
        `
    }

    // Case B: blockedOps.length === 0, failed fetch
    if (feed.last_fetched === null && feed.last_error !== null) {
        return html`
            <div class="feed-blocked-banner">
                <span class="feed-blocked-icon" aria-hidden="true">
                    <${WarningIcon} />
                </span>
                <div class="feed-blocked-content">
                    <div class="feed-blocked-op">
                        <div class="feed-blocked-op-description">
                            Feed fetch failed
                        </div>
                        <div class="feed-blocked-op-error">
                            ${feed.last_error ?? 'Unknown error'}
                        </div>
                        <div class="feed-blocked-actions">
                            <button
                                type="button"
                                class="btn btn-small btn-primary feed-blocked-retry"
                                onClick=${() =>
                                    State.retryResolveFeed(
                                        state,
                                        String(feed.id)
                                    )}
                            >Retry</button>
                        </div>
                    </div>
                </div>
            </div>
        `
    }

    // Neither condition met - render nothing
    return null
}
