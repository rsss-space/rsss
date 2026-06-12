import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { type AppState } from '../state.js'
import './graph.css'

interface GraphData {
    following:string[]
    followers:string[]
    followersCount:number|null
    constellationAvailable:boolean
}

interface GraphState {
    loading:boolean
    data:GraphData|null
    error:string|null
}

const graphState = signal<GraphState>({
    loading: false,
    data: null,
    error: null
})

async function fetchGraph ():Promise<void> {
    graphState.value = { loading: true, data: null, error: null }
    try {
        const res = await fetch('/api/graph', { credentials: 'include' })
        if (!res.ok) {
            const body = await res.json() as { error?:string }
            throw new Error(body.error ?? `${res.status}`)
        }
        const data = await res.json() as GraphData
        graphState.value = { loading: false, data, error: null }
    } catch (err) {
        graphState.value = {
            loading: false,
            data: null,
            error: err instanceof Error ?
                err.message : 'Failed to load graph'
        }
    }
}

export const GraphRoute:FunctionComponent<{
    state:AppState
    params:Record<string, string>
}> = function GraphRoute ({ state }) {
    useEffect(() => {
        if (state.isAuthenticated.value) fetchGraph()
    }, [state.isAuthenticated.value])

    const gs = graphState.value

    if (!state.isAuthenticated.value) {
        return html`
            <div class="route graph">
                <a href="/" class="back-link">&lt; Back</a>
                <p class="graph-unauth">Sign in to see your graph.</p>
            </div>
        `
    }

    if (gs.loading) {
        return html`
            <div class="route graph">
                <p class="graph-loading">Loading...</p>
            </div>
        `
    }

    if (gs.error) {
        return html`
            <div class="route graph">
                <a href="/" class="back-link">&lt; Back</a>
                <p class="graph-error">${gs.error}</p>
            </div>
        `
    }

    if (!gs.data) {
        return html`
            <div class="route graph">
                <a href="/" class="back-link">&lt; Back</a>
            </div>
        `
    }

    const { data } = gs

    return html`
        <div class="route graph">
            <header class="graph-header">
                <a href="/" class="back-link">&lt; Back</a>
                <h1>Your Network</h1>
            </header>

            <section class="graph-section">
                <h2>
                    Following
                    <span class="graph-count">${data.following.length}</span>
                </h2>
                ${data.following.length === 0 && html`
                    <p class="graph-empty">Not following anyone yet.</p>
                `}
                <ul class="graph-list">
                    ${data.following.map(did => html`
                        <li class="graph-item" key=${did}>
                            <a
                                href=${`/profile/${encodeURIComponent(did)}`}
                                class="graph-did"
                            >${did}</a>
                        </li>
                    `)}
                </ul>
            </section>

            <section class="graph-section">
                <h2>
                    Followers
                    ${data.followersCount !== null && html`
                        <span class="graph-count">${data.followersCount}</span>
                    `}
                    ${!data.constellationAvailable && html`
                        <span class="graph-degraded">(counts may be delayed)</span>
                    `}
                </h2>
                ${data.followers.length === 0 && html`
                    <p class="graph-empty">No followers yet.</p>
                `}
                <ul class="graph-list">
                    ${data.followers.map(did => html`
                        <li class="graph-item" key=${did}>
                            <a
                                href=${`/profile/${encodeURIComponent(did)}`}
                                class="graph-did"
                            >${did}</a>
                        </li>
                    `)}
                </ul>
            </section>
        </div>
    `
}
