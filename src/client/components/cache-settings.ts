import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useEffect, useState, useRef } from 'preact/hooks'
import { DetailsSummary } from '@substrate-system/details-summary'
import { CheckBox } from '@substrate-system/check-box'
import { type AppState } from '../state.js'
import {
    type CacheMode,
    storeContent,
    setSyncSubscriptions,
    saveLocalFirstSettings,
    defaultMaxSizeBytes,
    defaultMaxAgeSeconds,
    defaultCacheSizeHint,
    defaultCacheAgeHint
} from '../local-first-settings.js'
import {
    feedPolicies,
    loadFeedPolicies,
    upsertFeedCachePolicy,
    isContentCachedForPolicy,
    type FeedCachePolicyRow
} from '../db/feed-cache-policy.js'
import {
    getBootstrappedDb,
    getLocalDb,
    clearFeedCache,
    localFirstSupported,
    bootstrapLocalDb,
    bootstrapInProgress,
    type Feed
} from '../db/index.js'
import { isLocalFirstActive } from '../db/sync-status.js'
import { billingStatus } from '../billing-status.js'
import { loadStorageUsage } from '../db/storage-usage.js'
import { AMP } from '../constants.js'

export const CacheSettings:FunctionComponent<{
    state:AppState;
    selectedFeed:Feed;
}> = function CacheSettings ({ state, selectedFeed }) {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
    const pendingContentDid = useRef<string|null>(null)

    function confirmTerminalBootstrapReset (
        message:string
    ):boolean {
        return confirm([
            `Setup failed: ${message}`,
            '',
            'Reset local storage on this device and turn off ' +
            'local storage?'
        ].join('\n'))
    }

    function confirmLowStorageBootstrap (
        message:string
    ):boolean {
        return confirm([
            message,
            '',
            'Continue setting up local storage anyway?'
        ].join('\n'))
    }

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
        setPrefersReducedMotion(mq.matches)
        const onChange = (ev:MediaQueryListEvent) => {
            setPrefersReducedMotion(ev.matches)
        }
        mq.addEventListener('change', onChange)
        return () => {
            mq.removeEventListener('change', onChange)
        }
    }, [])

    useEffect(() => {
        const db = getDb()
        if (!db) return
        loadFeedPolicies(db, [selectedFeed.id]).catch(() => {})
    }, [selectedFeed.id])

    function getDb () {
        const did = state.user.value?.did
        return did ?
            (getBootstrappedDb() ?? getLocalDb(did)) :
            null
    }

    async function saveFeedPolicy (
        patch:Partial<FeedCachePolicyRow>
    ):Promise<void> {
        const feedId = selectedFeed.id
        const current = feedPolicies.value[feedId] ?? null
        const updated:FeedCachePolicyRow = {
            feed_id: feedId,
            cache_mode: current?.cache_mode ?? null,
            max_size_bytes: current?.max_size_bytes ?? null,
            max_age_seconds: current?.max_age_seconds ?? null,
            content_enabled: current?.content_enabled ?? null,
            ...patch
        }
        feedPolicies.value = { ...feedPolicies.value, [feedId]: updated }
        const db = getDb()
        if (!db) return
        try {
            await upsertFeedCachePolicy(db, feedId, updated)
        } catch (err) {
            console.error(
                '[cache-settings] feed policy save failed',
                err instanceof Error ? err.message : ''
            )
        }
    }

    function handleCacheModeChange (ev:Event) {
        const val = (ev.target as HTMLSelectElement).value
        const mode = (val === 'text' || val === 'text_images') ?
            val as CacheMode :
            null
        saveFeedPolicy({ cache_mode: mode })
    }

    function handleMaxSizeChange (ev:Event) {
        const raw = (ev.target as HTMLInputElement).value.trim()
        const mb = raw === '' ? null : parseFloat(raw)
        const bytes = (mb !== null && isFinite(mb) && mb >= 1) ?
            Math.round(mb * 1_000_000) :
            null
        saveFeedPolicy({ max_size_bytes: bytes })
    }

    function handleMaxAgeChange (ev:Event) {
        const raw = (ev.target as HTMLInputElement).value.trim()
        const days = raw === '' ? null : parseFloat(raw)
        const secs = (days !== null && isFinite(days) && days >= 1) ?
            Math.round(days * 86400) :
            null
        saveFeedPolicy({ max_age_seconds: secs })
    }

    async function handleClearCache (e:Event) {
        e.preventDefault()
        const label = selectedFeed.title || selectedFeed.url
        if (!confirm(
            `Clear cached content for "${label}"? ` +
            'This will free space but article content will need ' +
            'to be re-fetched.'
        )) return
        const db = getDb()
        if (!db) return
        try {
            await clearFeedCache(db, selectedFeed.id)
            const ids = state.feeds.value.map(f => f.id)
            await loadStorageUsage(db, ids)
        } catch (err) {
            console.error(
                '[cache-settings] clear feed cache failed',
                err instanceof Error ? err.message : ''
            )
        }
    }

    function handleContentToggle (ev:Event) {
        const checked = (ev.target as HTMLInputElement).checked
        const override = (checked === storeContent.value) ?
            null :
            (checked ? 1 : 0)
        if (checked && !isLocalFirstActive.value) {
            enableWithBootstrap()
            return
        }
        saveFeedPolicy({ content_enabled: override })
    }

    async function enableWithBootstrap ():Promise<void> {
        const did = state.user.value?.did
        if (!did) return
        const prev = feedPolicies.value[selectedFeed.id]
            ?.content_enabled ?? null
        // optimistic in-memory override (DB write no-ops: no db yet)
        saveFeedPolicy({ content_enabled: 1 })
        const result = setSyncSubscriptions(true)
        saveLocalFirstSettings()
        if (result === 'blocked') {
            saveFeedPolicy({ content_enabled: prev })
            return
        }
        if (result === 'pending') {
            pendingContentDid.current = did
            return
        }
        // 'applied'
        try {
            await bootstrapLocalDb(did, fetch, {
                confirmTerminalReset:
                    confirmTerminalBootstrapReset,
                confirmLowStorage: confirmLowStorageBootstrap
            })
        } catch (_err) {
            saveFeedPolicy({ content_enabled: prev })
            return
        }
        if (getDb()) {
            saveFeedPolicy({ content_enabled: 1 })
        } else {
            saveFeedPolicy({ content_enabled: prev })
        }
    }

    useEffect(() => {
        const did = pendingContentDid.current
        if (!did) return
        if (billingStatus.value === null) return  // still loading
        pendingContentDid.current = null
        if (billingStatus.value.entitled) {
            enableWithBootstrap()
        }
    }, [billingStatus.value])

    const policy = feedPolicies.value[selectedFeed.id] ?? null
    const sizeVal = policy?.max_size_bytes != null ?
        String(Math.round(policy.max_size_bytes / 1_000_000)) :
        ''
    const ageVal = policy?.max_age_seconds != null ?
        String(Math.round(policy.max_age_seconds / 86400)) :
        ''
    // Read the account-default signals here, in the render body, so the hint
    // re-renders when the account default changes (reactivity, FR-004).
    const sizeHint = defaultCacheSizeHint(defaultMaxSizeBytes.value)
    const ageHint = defaultCacheAgeHint(defaultMaxAgeSeconds.value)
    const effectiveContent = isContentCachedForPolicy(policy)
    const billing = billingStatus.value
    const isEntitled = Boolean(billing?.entitled)
    const isBillingLoaded = billing !== null
    const supported = localFirstSupported.value
    const unentitled = isBillingLoaded && !isEntitled
    const contentDisabled = unentitled || !supported ||
        bootstrapInProgress.value
    const fieldsId = `feed-cache-fields-${selectedFeed.id}`
    const planHintId = `feed-cache-plan-hint-${selectedFeed.id}`

    return html`
        <${DetailsSummary.TAG}
            class="feed-cache-controls"
            key=${selectedFeed.id}
            duration=${prefersReducedMotion ? '0' : undefined}
        >
            <details>
                <summary>Cache Settings</summary>
                <div class="details-content">
                    <${CheckBox.TAG}
                        name=${`feed-cache-content-${selectedFeed.id}`}
                        checked=${effectiveContent || undefined}
                        disabled=${contentDisabled || undefined}
                        aria-controls=${fieldsId}
                        aria-describedby=${unentitled ? planHintId : undefined}
                        onChange=${handleContentToggle}
                    >
                        Cache this feed
                    <//>
                    ${unentitled ? html`
                        <p id=${planHintId} class="cache-plan-hint">
                            Caching to this device requires a paid plan.
                        </p>
                    ` : null}
                    <fieldset
                        id=${fieldsId}
                        disabled=${!effectiveContent}
                    >
                        <div class="feed-cache-form">
                            <label class="cache-field-label">
                                Cache mode
                                <select
                                    name=${`feed-cache-mode-${selectedFeed.id}`}
                                    onChange=${handleCacheModeChange}
                                >
                                    <option
                                        value=""
                                        selected=${policy?.cache_mode == null}
                                    >
                                        Use default
                                    </option>
                                    <option
                                        value="text"
                                        selected=${policy?.cache_mode === 'text'}
                                    >
                                        Text only
                                    </option>
                                    <option
                                        value="text_images"
                                        selected=${
                                            policy?.cache_mode === 'text_images'
                                        }
                                    >
                                        Text ${AMP} images
                                    </option>
                                </select>
                            </label>
                            <label class="cache-field-label">
                                Max size (${sizeHint})
                                <input
                                    type="number"
                                    name=${`feed-max-size-${selectedFeed.id}`}
                                    min="1"
                                    value=${sizeVal}
                                    placeholder="default"
                                    onChange=${handleMaxSizeChange}
                                />
                            </label>
                            <label class="cache-field-label">
                                Keep for (${ageHint})
                                <input
                                    type="number"
                                    name=${`feed-max-age-${selectedFeed.id}`}
                                    min="1"
                                    value=${ageVal}
                                    placeholder="default"
                                    onChange=${handleMaxAgeChange}
                                />
                            </label>
                        </div>
                    </fieldset>
                    <button
                        class="btn-clear-cache"
                        onClick=${handleClearCache}
                    >
                        Clear cache
                    </button>
                </div>
            </details>
        <//>
    `
}
