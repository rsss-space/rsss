import { html } from 'htm/preact'
import { useCallback } from 'preact/hooks'
import { type FunctionComponent } from 'preact'
import { useComputed } from '@preact/signals'
import { State, type AppState } from '../state'
import './sidebar-item.css'

export const SidebarItem:FunctionComponent<{
    state:AppState,
    starred:boolean  // two options -- starred, or all items
}> = function (props) {
    const { state, starred } = props
    const { showStarredOnly, showUnreadOnly, counts, route } = state

    const isActive = useComputed<boolean>(() => {
        if (route.value.startsWith('/feed/')) return false
        return starred === showStarredOnly.value
    })

    const onClick = useCallback(() => {
        if (starred) {
            State.showStarred(state)
        } else {
            State.showAll(state)
        }
    }, [starred, state])

    return html`<a
        href="/"
        data-view=${starred ? 'starred' : 'all'}
        class="sidebar-item ${isActive.value ? 'active' : ''}"
        onClick=${onClick}
    >
        <span>${props.children}</span>
        <span class="badge">
            ${starred ?
                counts.value.starred :
                (showUnreadOnly.value ?
                    counts.value.unread :
                    counts.value.total)}
        </span>
    </a>`
}
