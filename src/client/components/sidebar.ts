import { html } from 'htm/preact/index.js'
import { type FunctionComponent } from 'preact'
import { type AppState } from '../state.js'
import { FeedNav } from './feed-nav.js'

export const Sidebar:FunctionComponent<{
    state:AppState
}> = function ({ state }) {
    return html`
        <aside class="sidebar">
            <${FeedNav} state=${state} />
        </aside>
    `
}
