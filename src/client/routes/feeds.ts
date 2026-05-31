import { html } from 'htm/preact/index.js'
import { type FunctionComponent } from 'preact'
import { type AppState } from '../state.js'
import { FeedNav } from '../components/feed-nav.js'
import './feeds.css'

export const FeedsRoute:FunctionComponent<{
    state:AppState
}> = function FeedsRoute ({ state }) {
    return html`
        <section class="route feeds">
            <${FeedNav} state=${state} />
        </section>
    `
}
