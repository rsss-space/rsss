// Sentry must initialize before any other code runs.
import './sentry.js'
import { html } from 'htm/preact'
import { type FunctionComponent, render } from 'preact'
import { useComputed } from '@preact/signals'
import { State, type AppState, hydratePaintCache } from './state.js'
import { seedDebugIfAbsent } from './debug-seed.js'
import { getStoredDid } from './paint-cache.js'
import Router from './routes/index.js'
import { NotFound } from './not-found.js'
import { Header } from './components/header.js'
import { OAuthCallbackLoader } from './components/oauth-loader.js'
import './style.css'

const state = State()
const router = Router(state)

// must run before render() so the first paint sees the cached snapshot.
hydratePaintCache(state, getStoredDid())

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        state.cleanup()
    })
}

if (import.meta.env.DEV) {
    // @ts-expect-error dev
    window.unregister = async () => {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map(r => r.unregister()))
        console.log('SW unregistered')
    }
}

/**
 * Debug logging
 */
if (import.meta.env.DEV || import.meta.env.MODE === 'staging') {
    // @ts-expect-error DEV env
    window.state = state
    seedDebugIfAbsent()
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
