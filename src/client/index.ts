// Sentry must initialize before any other code runs.
import './instrument.js'

import { html } from 'htm/preact'
import { type FunctionComponent, render } from 'preact'
import { useComputed, effect } from '@preact/signals'
import {
    State,
    type AppState,
    hydratePaintCache
} from './state.js'
import { getStoredDid } from './paint-cache.js'
import Router from './routes/index.js'
import { NotFound } from './not-found.js'
import { Header } from './components/header.js'
import { OAuthCallbackLoader } from './components/oauth-loader.js'
import '@substrate-system/details-summary'
import './style.css'

const state = State()
const router = Router(state)

// Synchronous: must run before render() so the first paint sees the cached snapshot.
hydratePaintCache(state, getStoredDid())

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        state.cleanup()
    })
}

/**
 * TEMPORARY nav-perf instrumentation (DEV only). Measures the time from
 * a route-signal change to the next painted frame, and reports any long
 * tasks (>50ms) that block the main thread in between. Remove once the
 * settings -> home lag is diagnosed.
 */
if (import.meta.env.DEV) {
    let navStart = 0
    let prevRoute = state.route.peek()
    let pending = false

    effect(() => {
        const r = state.route.value
        if (r === prevRoute) return
        const from = prevRoute
        prevRoute = r
        navStart = performance.now()
        pending = true
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!pending) return
            pending = false
            const dt = performance.now() - navStart
            // eslint-disable-next-line no-console
            console.log(
                `[nav-perf] ${from} -> ${r}: next paint in ` +
                `${dt.toFixed(0)}ms`
            )
        }))
    })

    if ('PerformanceObserver' in window) {
        try {
            const obs = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.duration < 50) continue
                    // eslint-disable-next-line no-console
                    console.log(
                        `[nav-perf] longtask ${entry.duration.toFixed(0)}ms` +
                        ` @ +${(entry.startTime - navStart).toFixed(0)}ms` +
                        ' after last route change'
                    )
                }
            })
            obs.observe({ entryTypes: ['longtask'] })
        } catch {
            // longtask not supported in this browser; ignore.
        }
    }
}

/**
 * Debug logging
 */
if (import.meta.env.DEV || import.meta.env.MODE === 'staging') {
    // @ts-expect-error DEV env
    window.state = state
    localStorage.setItem('DEBUG', 'rsss,rsss:*')
} else {
    localStorage.removeItem('DEBUG')
}

/**
 * Main app
 */
export const App:FunctionComponent<{
    state:AppState
}> = function App ({ state }) {
    const route = useComputed(() => state.route.value)

    const match = useComputed(() => {
        return router.match(route.value)
    })

    if (!match.value || !match.value.action) {
        return html`<${NotFound} />`
    }

    if (state.oauthInFlight.value) {
        return html`<${OAuthCallbackLoader} />`
    }

    const ChildNode = match.value.action(match.value, route.value)
    const { params, splats } = match.value
    if (!ChildNode) return html`<${NotFound} />`

    return html`
        <${Header} state=${state} />
        <${ChildNode} state=${state} params=${params} splats=${splats} />
        <footer>
            <nav class="footer-links" aria-label="Footer">
                <a href="/terms">Terms</a>
                <a href="/privacy">Privacy</a>
            </nav>
        </footer>
    `
}

render(html`<${App} state=${state} />`, document.getElementById('root')!)
