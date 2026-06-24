import { html } from 'htm/preact/index.js'
import { type FunctionComponent } from 'preact'
import { CheckBox } from '@substrate-system/check-box'
import {
    type Feed,
    type AppState
} from '../state.js'
import './feed-share-control.css'

export const FeedShareControl:FunctionComponent<{
    state:AppState;
    feed:Feed;
    onToggle:(feedId:number, checked:boolean)=> void;
}> = function FeedShareControl ({ state, feed, onToggle }) {
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

    return html`
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
                onChange=${(ev:Event) => {
                    const checked = (
                        ev.target as HTMLInputElement
                    ).checked
                    onToggle(feed.id, checked)
                }}
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
    `
}
