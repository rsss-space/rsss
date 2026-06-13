import { html } from 'htm/preact/index.js'
import { type FunctionComponent, Fragment } from 'preact'
import { useState, useCallback, useEffect, useRef } from 'preact/hooks'
import { CheckBox } from '@substrate-system/check-box'
import { ModalWindow } from '@substrate-system/dialog'
import '@substrate-system/dialog/css'
import { CogWheel } from './cog-wheel.js'
import { SidebarItem } from './sidebar-item.js'
import { SidebarFooter } from '../components/sidebar-footer.js'
import { Button } from '../components/button.js'
import { CloseIcon } from '../components/close.js'
import { ELLIPSIS } from '../constants.js'
import { ButtonIcon } from './button-icon.js'
import {
    type Feed,
    type AppState,
    State,
    stripProtocol
} from '../state.js'
import './sidebar.css'
import Debug from '@substrate-system/debug'
const debug = Debug('rsss:view')

type ModalWindowAttrs = preact.JSX.HTMLAttributes<HTMLElement> & {
    active?:string;
    closable?:string;
    'no-icon'?:string|boolean;
    animated?:string;
    noclick?:string|boolean;
    close?:string;
};

declare module 'preact' {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    export namespace JSX {
        interface IntrinsicElements {
            'modal-window':ModalWindowAttrs;
        }
    }
}

export const FeedNav:FunctionComponent<{
    state:AppState
}> = function ({ state }) {
    const {
        feedsLoading,
        feedsError,
        feeds,
        route,
        counts,
    } = state
    const [showAddFeed, setShowAddFeed] = useState(false)
    const [addingFeed, setAddingFeed] = useState(false)
    const [addFeedError, setAddFeedError] = useState<
        string|null
    >(null)
    const [consentFeedId, setConsentFeedId] = useState<
        number|null
    >(null)
    const consentModalRef = useRef<HTMLElement|null>(null)

    async function handleDeleteFeed (feed:Feed) {
        if (confirm(
            `Delete "${feed.title || feed.url}"?`
        )) {
            debug('deleting feed', feed.id)
            await State.deleteFeed(state, feed.id)
            debug(
                'done deleting it...',
                'feed ID: ' + feed.id
            )
        }
    }

    async function handleShareFeed (
        ev:Event,
        feed:Feed
    ):Promise<void> {
        const checked = (ev.target as HTMLInputElement).checked
        if (checked) {
            setConsentFeedId(feed.id)
            return
        }
        await State.toggleFeedPublished(state, feed.id, false)
    }

    function handleConsentCancel ():void {
        setConsentFeedId(null)
    }

    async function handleConsentConfirm ():Promise<void> {
        const id = consentFeedId
        if (id == null) return
        setConsentFeedId(null)
        await State.toggleFeedPublished(state, id, true)
    }

    useEffect(() => {
        const el = consentModalRef.current
        if (!el) return
        const evt = ModalWindow.event('close')
        const handler = () => setConsentFeedId(null)
        el.addEventListener(evt, handler)
        return () => el.removeEventListener(evt, handler)
    }, [consentFeedId])

    const handleAddFeed = useCallback(async (
        ev:MouseEvent
    ) => {
        ev.preventDefault()
        const form = ev.target as HTMLFormElement
        const els = form.elements
        const input = els.namedItem(
            'new-feed-url'
        ) as HTMLInputElement
        const newFeedUrl = input.value
        if (!newFeedUrl.trim()) return
        debug('adding a new feed...', newFeedUrl)

        setAddingFeed(true)
        setAddFeedError(null)

        try {
            const result = await State.addFeed(
                state,
                newFeedUrl.trim()
            )
            debug('done adding feed...', result)

            input.value = ''
            setShowAddFeed(false)
        } catch (_err) {
            const err = _err as Error
            setAddFeedError(
                (err as Error).message ||
                'Failed to add feed'
            )
        }

        setAddingFeed(false)
    }, [])

    const allFeeds = !route.value.startsWith('/feed/')

    return html`
        <${Fragment}>
            <div class="sidebar-section">
                <${SidebarItem} state=${state} starred=${false}>
                    All Items
                <//>
                <${SidebarItem} state=${state} starred=${true}>
                    Starred
                <//>
            </div>

            <div class="sidebar-section">
                <div class="sidebar-header">
                    <h3>Feeds</h3>
                    <div class="feeds-controls">
                        <a class="cog-wheel" href="/settings">
                            <${CogWheel} />
                        </a>
                        <${ButtonIcon}
                            class="btn btn-icon"
                            onClick=${() => setShowAddFeed(
                                !showAddFeed
                            )}
                            title="Add feed"
                        >
                            +
                        <//>
                    </div>
                </div>

                ${showAddFeed && html`
                    <form
                        class="add-feed-form"
                        onSubmit=${handleAddFeed}
                    >
                        <input
                            type="url"
                            id="new-feed-url"
                            name="new-feed-url"
                            placeholder="https://example.com/feed.xml"
                            disabled=${addingFeed}
                        />
                        <${Button} type="submit">
                            ${addingFeed ? '...' : 'Add'}
                        <//>
                        ${addFeedError && html`<div
                            class="form-error"
                        >
                            ${addFeedError}
                        </div>`}
                    </form>
                `}

                <div class="feeds-list">
                    <div class="sidebar-item feed-item${
                        allFeeds ? ' active' : ''
                    }">
                        <div class="feed-item-row">
                            <span class="badge feed-unread-count">
                                ${counts.value.unread}
                            </span>
                            <a class="feed-select" href="/">
                                All Feeds
                            </a>
                        </div>
                    </div>

                    ${feedsLoading.value &&
                        feeds.value.length === 0 && html`
                        <div class="loading-text">
                            Loading feeds...
                        </div>
                    `}

                    ${feeds.value.map(feed => {
                        const feedPath = stripProtocol(feed.url)
                        const isActive = route.value === `/feed/${feedPath}`
                        const feedUnread = counts.value
                            .perFeed[String(feed.id)] ?? 0
                        const pending = (state
                            .feedUpdateCounts.value[String(feed.id)] ?? 0)
                        const publishKey = String(feed.id)
                        const publishPending = Boolean(
                            state.feedPublishInProgress
                                .value[publishKey]
                        )
                        const publishError = (
                            state.feedPublishErrors
                                .value[publishKey] ??
                            feed.publish_error ??
                            null
                        )
                        const isPublished = feed.published === 1
                        const publishStatus = publishPending ?
                            'Sharing...' :
                            publishError ?
                                `Failed: ${publishError}` :
                                isPublished ? 'Published' : ''
                        const publishStatusClass = publishError ?
                            ' error' :
                            ''
                        const isResolving = (
                            feed.last_fetched === null && !feed.last_error
                        )
                        const hasFailed = (
                            feed.last_fetched === null && !!feed.last_error
                        )
                        const stateClass = hasFailed ?
                            ' failed' :
                            isResolving ? ' resolving' : ''
                        return html`
                            <div class="sidebar-item feed-item ${
                                    isActive ? 'active' : ''
                                }${stateClass}"
                                key=${feed.id}
                            >
                                <div class="feed-item-row">
                                    <span class="badge feed-unread-count">
                                        ${feedUnread}
                                    </span>
                                    ${pending > 0 ? `(${pending}) ` : ''}
                                    ${isResolving && html`
                                        <span
                                            class="feed-spinner"
                                            aria-label="Resolving feed"
                                            role="status"
                                        ></span>
                                    `}
                                    <a
                                        class="feed-select"
                                        href="/feed/${feedPath}"
                                    >
                                        ${feed.title || feed.url}
                                    </a>
                                    ${hasFailed && html`
                                        <span class="feed-failed-label">
                                            Failed to fetch
                                        </span>
                                    `}

                            <div class="item-controls">
                                ${hasFailed && html`
                                    <tool-tip
                                        content="Retry fetching feed"
                                        delay="500"
                                    >
                                        <button
                                            type="button"
                                            class="btn-retry"
                                            onClick=${() => (
                                                State.retryResolveFeed(
                                                    state,
                                                    String(feed.id)
                                                )
                                            )}
                                            aria-label="Retry fetching feed"
                                        >
                                            ↻
                                        </button>
                                    </tool-tip>
                                `}
                                <tool-tip
                                    content="Delete feed"
                                    delay="500"
                                >
                                    <button
                                        class="btn-delete"
                                        onClick=${() => handleDeleteFeed(feed)}
                                        aria-label="Delete feed"
                                    >
                                        <${CloseIcon} />
                                    </button>
                                </tool-tip>
                            </div>
                                </div>

                                <div class="feed-share-control">
                                    <${CheckBox.TAG}
                                        name=${`share-feed-${feed.id}`}
                                        aria-describedby=${
                                            `share-feed-${feed.id}-status`
                                        }
                                        checked=${
                                            isPublished || undefined
                                        }
                                        disabled=${
                                            publishPending || undefined
                                        }
                                        onChange=${(ev:Event) => (
                                            handleShareFeed(ev, feed)
                                        )}
                                    >
                                        Share to Bluesky
                                    <//>
                                    <span
                                        class=${'feed-share-state' +
                                            publishStatusClass}
                                        id=${`share-feed-${feed.id}-status`}
                                        role="status"
                                        aria-live="polite"
                                    >
                                        ${publishStatus}
                                    </span>
                                </div>
                            </div>
                    `
                        })}

                    ${((!feedsLoading.value &&
                        feeds.value.length === 0) &&
                        html`
                            <div class="empty-state">
                                ${feedsError.value ?
                                    html`Couldn${'’'}t load feeds: ${
                                        feedsError.value
                                    }` :
                                    html`No feeds yet${ELLIPSIS}`}
                            </div>
                        `)
}
                </div>
            </div>

            <${SidebarFooter} state=${state} />

            ${consentFeedId != null && html`
                <modal-window
                    ref=${consentModalRef}
                    class="publish-consent-modal"
                    active="true"
                    closable="true"
                    aria-labelledby="publish-consent-title"
                    aria-describedby="publish-consent-body"
                >
                    <h2 id="publish-consent-title">
                        Share to Bluesky network
                    </h2>
                    <div
                        id="publish-consent-body"
                        class="publish-consent-body"
                    >
                        <p>Before sharing, note that:</p>
                        <ul>
                            <li>
                                Records are written to your own
                                personal data server (PDS)
                            </li>
                            <li>
                                Subscriptions are public on the
                                AT Protocol network
                            </li>
                            <li>
                                Shared subscriptions do not appear
                                in your Bluesky timeline
                            </li>
                            <li>You can remove them at any time</li>
                        </ul>
                    </div>
                    <div class="publish-consent-actions">
                        <button
                            type="button"
                            class="consent-cancel"
                            onClick=${handleConsentCancel}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            class="consent-confirm"
                            onClick=${handleConsentConfirm}
                        >
                            Share
                        </button>
                    </div>
                </modal-window>
            `}
        <//>
    `
}
