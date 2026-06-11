import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { type AppState, State } from '../state.js'
import './profile.css'

interface ProfileSubscription {
    uri:string
    rkey:string
    feedUrl:string
    title:string|null
    siteUrl:string|null
}

interface ProfileData {
    did:string
    handle:string|null
    avatar:string|null
    subscriptions:ProfileSubscription[]
    following:boolean
}

interface ProfileState {
    did:string|null
    loading:boolean
    data:ProfileData|null
    error:string|null
}

const profileState = signal<ProfileState>({
    did: null,
    loading: false,
    data: null,
    error: null
})

async function fetchProfile (did:string):Promise<void> {
    profileState.value = {
        did,
        loading: true,
        data: null,
        error: null
    }
    try {
        const res = await fetch(
            `/api/profile/${encodeURIComponent(did)}`,
            { credentials: 'include' }
        )
        if (!res.ok) {
            const body = await res.json() as { error?:string }
            throw new Error(body.error ?? `${res.status}`)
        }
        const data = await res.json() as ProfileData
        profileState.value = { did, loading: false, data, error: null }
    } catch (err) {
        profileState.value = {
            did,
            loading: false,
            data: null,
            error: err instanceof Error ?
                err.message : 'Failed to load profile'
        }
    }
}

async function toggleFollow (
    targetDid:string,
    currently:boolean
):Promise<void> {
    try {
        if (currently) {
            await fetch(
                `/api/graph/follow/${encodeURIComponent(targetDid)}`,
                { method: 'DELETE', credentials: 'include' }
            )
        } else {
            await fetch('/api/graph/follow', {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ targetDid })
            })
        }
        await fetchProfile(targetDid)
    } catch (err) {
        console.error('Follow/unfollow failed:', err)
    }
}

export const ProfileRoute:FunctionComponent<{
    state:AppState
    params:Record<string, string>
}> = function ProfileRoute ({ state, params }) {
    const did = params.did ?? ''

    useEffect(() => {
        if (did) fetchProfile(did)
    }, [did])

    const ps = profileState.value
    const isStale = ps.did !== did && !ps.loading

    if (ps.loading || isStale) {
        return html`
            <div class="route profile">
                <p class="profile-loading">Loading profile...</p>
            </div>
        `
    }

    if (ps.error) {
        return html`
            <div class="route profile">
                <a href="/" class="back-link">&lt; Back</a>
                <p class="profile-error">${ps.error}</p>
            </div>
        `
    }

    if (!ps.data) {
        return html`
            <div class="route profile">
                <a href="/" class="back-link">&lt; Back</a>
                <p class="profile-empty">Profile not found.</p>
            </div>
        `
    }

    const { data } = ps
    const isOwnProfile = state.user.value?.did === data.did
    const isAuthenticated = state.isAuthenticated.value

    return html`
        <div class="route profile">
            <header class="profile-header">
                <a href="/" class="back-link">&lt; Back</a>

                <div class="profile-identity">
                    ${data.avatar && html`
                        <img
                            class="profile-avatar"
                            src=${data.avatar}
                            alt="avatar"
                        />
                    `}
                    <div class="profile-names">
                        <h1 class="profile-handle">
                            ${data.handle ?? data.did}
                        </h1>
                        ${data.handle && html`
                            <p class="profile-did">${data.did}</p>
                        `}
                    </div>
                </div>

                ${isAuthenticated && !isOwnProfile && html`
                    <button
                        class="btn follow-button"
                        onClick=${() => toggleFollow(data.did, data.following)}
                    >
                        ${data.following ? 'Unfollow' : 'Follow'}
                    </button>
                `}
            </header>

            <section class="profile-subscriptions">
                <h2>Shared Feeds</h2>
                ${data.subscriptions.length === 0 && html`
                    <p class="profile-empty">No shared feeds.</p>
                `}
                <ul class="subscription-list">
                    ${data.subscriptions.map(sub => html`
                        <li class="subscription-item" key=${sub.rkey}>
                            <div class="subscription-info">
                                <span class="subscription-title">
                                    ${sub.title ?? sub.feedUrl}
                                </span>
                                ${sub.siteUrl && html`
                                    <a
                                        class="subscription-site"
                                        href=${sub.siteUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >${sub.siteUrl}</a>
                                `}
                            </div>
                            ${isAuthenticated && html`
                                <button
                                    class="btn subscribe-button"
                                    onClick=${() => State.addFeed(
                                        state, sub.feedUrl
                                    )}
                                >
                                    Add
                                </button>
                            `}
                        </li>
                    `)}
                </ul>
            </section>
        </div>
    `
}
