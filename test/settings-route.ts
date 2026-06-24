import { test } from '@substrate-system/tapzero'
import { signal } from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { SettingsRoute } from '../src/client/routes/settings.js'
import { type AppState, State } from '../src/client/state.js'
import {
    syncSubscriptions,
    pendingSyncSubscriptions,
    storeContent,
    defaultCacheMode,
    defaultMaxSizeBytes,
    defaultMaxAgeSeconds,
    loadLocalFirstSettings
} from '../src/client/local-first-settings.js'
import {
    billingStatus,
    resetBilling,
    type BillingStatus
} from '../src/client/billing-status.js'
import { localFirstSupported } from '../src/client/db/index.js'
import { isLocalFirstActive } from '../src/client/db/sync-status.js'
import {
    feedPolicies,
    _resetFeedPolicies
} from '../src/client/db/feed-cache-policy.js'
import type { Feed } from '../src/client/db/types.js'

interface MinimalState {
    isAuthenticated:ReturnType<typeof signal<boolean>>;
    user:ReturnType<typeof signal<null>>;
    feeds:ReturnType<typeof signal<Feed[]>>;
    _setRoute:(r:string)=> void;
    _routeHistory:string[];
}

type TestCheckBox = HTMLElement & {
    checked:boolean;
    disabled:boolean;
}

function makeState ():MinimalState {
    const history:string[] = []
    return {
        isAuthenticated: signal(true),
        user: signal(null),
        feeds: signal([]),
        _setRoute: (r:string) => { history.push(r) },
        _routeHistory: history
    }
}

function makeFeed (overrides:Partial<Feed> = {}):Feed {
    return {
        id: 1,
        url: 'https://example.com/feed.rss',
        title: 'Example Feed',
        description: null,
        site_url: null,
        last_fetched: null,
        last_error: null,
        last_status: null,
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
        ...overrides
    }
}

function mount (state:MinimalState):HTMLElement {
    const root = document.createElement('div')
    document.body.appendChild(root)
    render(
        html`<${SettingsRoute} state=${state as unknown as AppState} />`,
        root
    )
    return root
}

function unmount (root:HTMLElement):void {
    render(null, root)
    root.remove()
}

function nextTick ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

function waitFor (
    condition:()=> boolean,
    desc:string,
    timeoutMs = 2000
):Promise<void> {
    const start = Date.now()
    return new Promise((resolve, reject) => {
        const check = () => {
            if (condition()) return resolve()
            if (Date.now() - start > timeoutMs) {
                return reject(new Error(`waitFor timeout: ${desc}`))
            }
            setTimeout(check, 10)
        }
        check()
    })
}

function entitledBilling (
    overrides:Partial<BillingStatus> = {}
):BillingStatus {
    return {
        entitled: true,
        planId: 'local-first',
        status: 'active',
        refreshedAt: Date.now(),
        useLive: false,
        currentPeriodEnd: Date.now() + 30 * 86_400_000,
        canceledAt: null,
        contactEmail: 'nichoth@example.com',
        ...overrides
    }
}

test('SettingsRoute applies queued local-first toggle after billing loads',
    async (t) => {
        const originalLoadBillingStatus = State.loadBillingStatus
        State.loadBillingStatus = async () => null
        resetBilling()
        localFirstSupported.value = true
        syncSubscriptions.value = false
        pendingSyncSubscriptions.value = false
        storeContent.value = false
        localStorage.removeItem('rsss.localFirst')

        const root = mount(makeState())
        try {
            await nextTick()
            const box = root.querySelector(
                'check-box[name="sync-subscriptions"]'
            ) as TestCheckBox|null
            t.ok(box, 'renders the sync subscriptions toggle')
            t.equal(box?.disabled, false,
                'toggle is usable while billing is loading')

            if (!box) return

            box.checked = true
            box.dispatchEvent(new Event('change', { bubbles: true }))
            await nextTick()

            t.equal(syncSubscriptions.value, false,
                'local-first is not enabled before billing resolves')
            t.equal(pendingSyncSubscriptions.value, true,
                'toggle intent is queued while billing loads')

            billingStatus.value = entitledBilling()
            await nextTick()

            t.equal(syncSubscriptions.value, true,
                'queued toggle applies when entitlement arrives')
        } finally {
            State.loadBillingStatus = originalLoadBillingStatus
            resetBilling()
            syncSubscriptions.value = false
            pendingSyncSubscriptions.value = false
            storeContent.value = false
            unmount(root)
        }
    }
)

test('SettingsRoute renders cache section after local-first section',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        defaultCacheMode.value = 'text_images'
        defaultMaxSizeBytes.value = 50_000_000
        defaultMaxAgeSeconds.value = 30 * 86400

        const root = mount(makeState())
        try {
            await nextTick()
            const section = root.querySelector('.cache-section')
            t.ok(section, 'cache section is rendered')

            const sections = root.querySelectorAll('.settings-section')
            const sectionArr = Array.from(sections)
            const localFirstIdx = sectionArr.findIndex(
                s => s.classList.contains('local-first-section')
            )
            const cacheIdx = sectionArr.findIndex(
                s => s.classList.contains('cache-section')
            )
            const feedsIdx = sectionArr.findIndex(s =>
                s.querySelector('.settings-feeds-list') !== null
            )

            t.ok(
                cacheIdx > localFirstIdx,
                'cache section comes after local-first section'
            )
            t.ok(
                cacheIdx < feedsIdx,
                'cache section comes before feeds section'
            )
        } finally {
            unmount(root)
        }
    }
)

test('SettingsRoute cache section radio group reflects defaultCacheMode',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        defaultCacheMode.value = 'text'

        const root = mount(makeState())
        try {
            await nextTick()
            const textRadio = root.querySelector(
                'input[name="default-cache-mode"][value="text"]'
            ) as HTMLInputElement|null
            const imagesRadio = root.querySelector(
                'input[name="default-cache-mode"][value="text_images"]'
            ) as HTMLInputElement|null

            t.ok(textRadio, 'text-only radio exists')
            t.ok(imagesRadio, 'text-and-images radio exists')
            t.ok(textRadio?.checked, 'text radio is checked when mode is text')
            t.ok(
                !imagesRadio?.checked,
                'images radio is not checked when mode is text'
            )
        } finally {
            defaultCacheMode.value = 'text_images'
            unmount(root)
        }
    }
)

test('SettingsRoute cache section radio change updates signal and saves',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        defaultCacheMode.value = 'text_images'

        const root = mount(makeState())
        try {
            await nextTick()
            const textRadio = root.querySelector(
                'input[name="default-cache-mode"][value="text"]'
            ) as HTMLInputElement|null

            if (!textRadio) {
                t.fail('text radio not found')
                return
            }

            textRadio.checked = true
            textRadio.dispatchEvent(new Event('change', { bubbles: true }))
            await nextTick()

            t.equal(defaultCacheMode.value, 'text',
                'defaultCacheMode signal updated')

            loadLocalFirstSettings()
            t.equal(defaultCacheMode.value, 'text',
                'persisted value reloads as text')
        } finally {
            defaultCacheMode.value = 'text_images'
            localStorage.removeItem('rsss.localFirst')
            unmount(root)
        }
    }
)

test(
    'SettingsRoute cache section size input shows MB and updates signal',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        defaultMaxSizeBytes.value = 50_000_000

        const root = mount(makeState())
        try {
            await nextTick()
            const input = root.querySelector(
                'input[name="default-max-size-mb"]'
            ) as HTMLInputElement|null
            t.ok(input, 'max size MB input exists')
            t.equal(input?.value, '50', 'displays 50 MB for 50_000_000 bytes')

            if (!input) return
            input.value = '10'
            input.dispatchEvent(new Event('change', { bubbles: true }))
            await nextTick()

            t.equal(defaultMaxSizeBytes.value, 10_000_000,
                'signal updated to 10 MB in bytes')
        } finally {
            defaultMaxSizeBytes.value = 50_000_000
            localStorage.removeItem('rsss.localFirst')
            unmount(root)
        }
    }
)

test(
    'SettingsRoute cache section age input shows days and updates signal',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        defaultMaxAgeSeconds.value = 30 * 86400

        const root = mount(makeState())
        try {
            await nextTick()
            const input = root.querySelector(
                'input[name="default-max-age-days"]'
            ) as HTMLInputElement|null
            t.ok(input, 'max age days input exists')
            t.equal(input?.value, '30', 'displays 30 days for 30*86400 seconds')

            if (!input) return
            input.value = '7'
            input.dispatchEvent(new Event('change', { bubbles: true }))
            await nextTick()

            t.equal(defaultMaxAgeSeconds.value, 7 * 86400,
                'signal updated to 7 days in seconds')
        } finally {
            defaultMaxAgeSeconds.value = 30 * 86400
            localStorage.removeItem('rsss.localFirst')
            unmount(root)
        }
    }
)

test('SettingsRoute cache section save persists on change', async (t) => {
    localStorage.removeItem('rsss.localFirst')
    defaultMaxSizeBytes.value = 50_000_000

    const root = mount(makeState())
    try {
        await nextTick()
        const input = root.querySelector(
            'input[name="default-max-size-mb"]'
        ) as HTMLInputElement|null
        if (!input) {
            t.fail('input not found')
            return
        }
        input.value = '20'
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await nextTick()

        defaultMaxSizeBytes.value = 50_000_000
        loadLocalFirstSettings()
        t.equal(defaultMaxSizeBytes.value, 20_000_000,
            'value persisted to localStorage and reloads')
    } finally {
        defaultMaxSizeBytes.value = 50_000_000
        localStorage.removeItem('rsss.localFirst')
        unmount(root)
    }
})

// 024-gate-cache-on-storage: Cache section gates on isLocalFirstActive

test(
    'Cache section is disabled when isLocalFirstActive is false',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        isLocalFirstActive.value = false

        const root = mount(makeState())
        try {
            await nextTick()
            const section = root.querySelector('.cache-section')
            t.ok(section, 'cache section is rendered')
            t.ok(
                section?.classList.contains('is-disabled'),
                'cache section has is-disabled class'
            )

            const fieldset = root.querySelector(
                'fieldset.cache-mode-group'
            ) as HTMLFieldSetElement|null
            t.ok(fieldset, 'cache-mode-group fieldset exists')
            t.ok(fieldset?.hasAttribute('disabled'),
                'fieldset has disabled attribute')

            const sizeInput = root.querySelector(
                'input[name="default-max-size-mb"]'
            ) as HTMLInputElement|null
            t.ok(sizeInput?.hasAttribute('disabled'),
                'default-max-size-mb has disabled attribute')

            const accountInput = root.querySelector(
                'input[name="account-max-size-mb"]'
            ) as HTMLInputElement|null
            t.ok(accountInput?.hasAttribute('disabled'),
                'account-max-size-mb has disabled attribute')

            const ageInput = root.querySelector(
                'input[name="default-max-age-days"]'
            ) as HTMLInputElement|null
            t.ok(ageInput?.hasAttribute('disabled'),
                'default-max-age-days has disabled attribute')
        } finally {
            isLocalFirstActive.value = false
            unmount(root)
        }
    }
)

test(
    'Cache section is enabled when isLocalFirstActive is true',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        isLocalFirstActive.value = true

        const root = mount(makeState())
        try {
            await nextTick()
            const section = root.querySelector('.cache-section')
            t.ok(section, 'cache section is rendered')
            t.ok(
                !section?.classList.contains('is-disabled'),
                'cache section does NOT have is-disabled class'
            )

            const fieldset = root.querySelector(
                'fieldset.cache-mode-group'
            ) as HTMLFieldSetElement|null
            t.ok(fieldset, 'cache-mode-group fieldset exists')
            t.ok(!fieldset?.hasAttribute('disabled'),
                'fieldset is NOT disabled')

            const sizeInput = root.querySelector(
                'input[name="default-max-size-mb"]'
            ) as HTMLInputElement|null
            t.ok(!sizeInput?.hasAttribute('disabled'),
                'default-max-size-mb is NOT disabled')

            const accountInput = root.querySelector(
                'input[name="account-max-size-mb"]'
            ) as HTMLInputElement|null
            t.ok(!accountInput?.hasAttribute('disabled'),
                'account-max-size-mb is NOT disabled')

            const ageInput = root.querySelector(
                'input[name="default-max-age-days"]'
            ) as HTMLInputElement|null
            t.ok(!ageInput?.hasAttribute('disabled'),
                'default-max-age-days is NOT disabled')
        } finally {
            isLocalFirstActive.value = false
            unmount(root)
        }
    }
)

test(
    'Cache section reacts to isLocalFirstActive flipping',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        isLocalFirstActive.value = false

        const root = mount(makeState())
        try {
            await nextTick()
            let section = root.querySelector('.cache-section')
            t.ok(
                section?.classList.contains('is-disabled'),
                'starts disabled'
            )

            isLocalFirstActive.value = true
            await nextTick()
            section = root.querySelector('.cache-section')
            t.ok(
                !section?.classList.contains('is-disabled'),
                'no is-disabled class after flipping true'
            )
            const fieldsetOn = root.querySelector(
                'fieldset.cache-mode-group'
            ) as HTMLFieldSetElement|null
            t.ok(
                !fieldsetOn?.hasAttribute('disabled'),
                'fieldset enabled after flipping true'
            )

            isLocalFirstActive.value = false
            await nextTick()
            section = root.querySelector('.cache-section')
            t.ok(
                section?.classList.contains('is-disabled'),
                'is-disabled class returns after flipping false'
            )
            const fieldsetOff = root.querySelector(
                'fieldset.cache-mode-group'
            ) as HTMLFieldSetElement|null
            t.ok(
                fieldsetOff?.hasAttribute('disabled'),
                'fieldset disabled again after flipping false'
            )
        } finally {
            isLocalFirstActive.value = false
            unmount(root)
        }
    }
)

// US-128: Per-feed cache controls

test('Per-feed row shows effective cache mode with (default) tag', async (t) => {
    const state = makeState()
    state.feeds.value = [makeFeed({ id: 1, title: 'My Feed' })]
    _resetFeedPolicies()
    defaultCacheMode.value = 'text'

    const root = mount(state)
    try {
        await nextTick()
        const item = root.querySelector('.settings-feed-item')
        t.ok(item, 'feed item rendered')
        const modeEl = item?.querySelector('.feed-cache-mode')
        t.ok(modeEl, '.feed-cache-mode element exists')
        t.ok(
            modeEl?.textContent?.includes('(default)'),
            'shows (default) when no override'
        )
        t.ok(
            modeEl?.textContent?.includes('Text only'),
            'shows Text only when defaultCacheMode is text'
        )
    } finally {
        defaultCacheMode.value = 'text_images'
        _resetFeedPolicies()
        unmount(root)
    }
})

test('Per-feed row shows override label without (default) when policy set',
    async (t) => {
        const state = makeState()
        state.feeds.value = [makeFeed({ id: 2, title: 'Override Feed' })]
        feedPolicies.value = {
            2: {
                feed_id: 2,
                cache_mode: 'text_images',
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: null
            }
        }
        defaultCacheMode.value = 'text'

        const root = mount(state)
        try {
            await nextTick()
            const item = root.querySelector('.settings-feed-item')
            const modeEl = item?.querySelector('.feed-cache-mode')
            t.ok(modeEl, '.feed-cache-mode element exists')
            t.ok(
                !modeEl?.textContent?.includes('(default)'),
                'no (default) tag when cache_mode is overridden'
            )
            t.ok(
                modeEl?.textContent?.includes('Text + images'),
                'shows Text + images for text_images override'
            )
        } finally {
            defaultCacheMode.value = 'text_images'
            _resetFeedPolicies()
            unmount(root)
        }
    }
)

test('Per-feed details element contains cache controls', async (t) => {
    const state = makeState()
    state.feeds.value = [makeFeed({ id: 3 })]
    _resetFeedPolicies()

    const root = mount(state)
    try {
        await nextTick()
        const host = root.querySelector(
            '.settings-feed-item .feed-cache-controls'
        )
        t.ok(host, '.feed-cache-controls host exists')
        t.equal(
            host?.tagName.toLowerCase(),
            'details-summary',
            'host is a <details-summary>'
        )
        t.equal(
            host?.getAttribute('duration'),
            '200',
            'host duration attribute is 200 (non-reduced default)'
        )

        const innerDetails = host?.querySelectorAll(':scope > details')
        t.equal(
            innerDetails?.length,
            1,
            'exactly one inner <details>'
        )
        const details = innerDetails?.[0] as HTMLDetailsElement|undefined

        const content = details?.querySelector(
            ':scope > .details-content'
        )
        t.ok(content, '.details-content wrapper present')

        const select = content?.querySelector(
            'select[name="feed-cache-mode-3"]'
        ) as HTMLSelectElement|null
        t.ok(select, 'cache mode select exists in .details-content')

        const opts = select ?
            Array.from(select.options).map(o => o.value) :
            []
        t.ok(opts.includes(''), 'has Use default option (value="")')
        t.ok(opts.includes('text'), 'has text option')
        t.ok(opts.includes('text_images'), 'has text_images option')

        const sizeInput = content?.querySelector(
            'input[name="feed-max-size-3"]'
        )
        t.ok(sizeInput, 'max size input exists in .details-content')

        const ageInput = content?.querySelector(
            'input[name="feed-max-age-3"]'
        )
        t.ok(ageInput, 'max age input exists in .details-content')

        const clear = content?.querySelector('button.btn-clear-cache')
        t.ok(clear, '.btn-clear-cache button exists in .details-content')
    } finally {
        _resetFeedPolicies()
        unmount(root)
    }
})

// 027-disable-cache-settings-link: per-feed control gates on caching

test(
    'per-feed cache control is disabled when isLocalFirstActive is false',
    async (t) => {
        const state = makeState()
        state.feeds.value = [makeFeed({ id: 7 })]
        _resetFeedPolicies()
        isLocalFirstActive.value = false

        const root = mount(state)
        try {
            await nextTick()
            const host = root.querySelector(
                '.settings-feed-item .feed-cache-controls'
            )
            t.ok(host, 'feed-cache-controls host exists')
            t.equal(
                host?.tagName.toLowerCase(),
                'details-summary',
                'host is a <details-summary>'
            )
            t.ok(
                host?.classList.contains('is-disabled'),
                'host has is-disabled class'
            )

            const details = root.querySelector(
                '.feed-cache-controls details'
            ) as HTMLDetailsElement|null
            t.ok(details, 'inner <details> exists')
            t.equal(details?.open, false, 'inner details is collapsed')

            const summary = details?.querySelector('summary')
            t.equal(
                summary?.getAttribute('aria-disabled'),
                'true',
                'summary has aria-disabled="true"'
            )
            t.equal(
                summary?.getAttribute('tabindex'),
                '-1',
                'summary has tabindex="-1"'
            )
        } finally {
            isLocalFirstActive.value = false
            _resetFeedPolicies()
            unmount(root)
        }
    }
)

test(
    'per-feed cache control is enabled when isLocalFirstActive is true',
    async (t) => {
        const state = makeState()
        state.feeds.value = [makeFeed({ id: 8 })]
        _resetFeedPolicies()
        isLocalFirstActive.value = true

        const root = mount(state)
        try {
            await nextTick()
            const host = root.querySelector(
                '.settings-feed-item .feed-cache-controls'
            )
            t.ok(host, 'feed-cache-controls host exists')
            t.equal(
                host?.tagName.toLowerCase(),
                'details-summary',
                'host is a <details-summary>'
            )
            t.ok(
                !host?.classList.contains('is-disabled'),
                'host does NOT have is-disabled class'
            )

            const details = root.querySelector(
                '.feed-cache-controls details'
            ) as HTMLDetailsElement|null
            t.ok(details, 'inner <details> exists')

            const summary = details?.querySelector('summary')
            t.ok(
                !summary?.hasAttribute('aria-disabled'),
                'summary has no aria-disabled attribute'
            )
            t.ok(
                summary?.getAttribute('tabindex') !== '-1',
                'summary is not removed from tab order'
            )

            if (details) details.open = true
            t.equal(details?.open, true, 'disclosure toggles open')
        } finally {
            isLocalFirstActive.value = false
            _resetFeedPolicies()
            unmount(root)
        }
    }
)

test(
    'per-feed cache control toggles disabled state when ' +
        'isLocalFirstActive flips',
    async (t) => {
        const state = makeState()
        state.feeds.value = [makeFeed({ id: 9 })]
        _resetFeedPolicies()
        isLocalFirstActive.value = true

        const root = mount(state)
        try {
            await nextTick()
            const host = root.querySelector(
                '.settings-feed-item .feed-cache-controls'
            )
            t.ok(host, 'feed-cache-controls host exists')
            t.equal(
                host?.tagName.toLowerCase(),
                'details-summary',
                'host is a <details-summary>'
            )
            t.ok(
                !host?.classList.contains('is-disabled'),
                'starts enabled (no is-disabled class)'
            )

            const details = root.querySelector(
                '.feed-cache-controls details'
            ) as HTMLDetailsElement|null
            t.ok(details, 'inner <details> exists')

            isLocalFirstActive.value = false
            await nextTick()
            t.ok(
                host?.classList.contains('is-disabled'),
                'host gains is-disabled after flipping false'
            )
            t.equal(
                details?.open,
                false,
                'inner details collapses after flipping false'
            )
            const summaryOff = details?.querySelector('summary')
            t.equal(
                summaryOff?.getAttribute('aria-disabled'),
                'true',
                'summary gains aria-disabled after flipping false'
            )
            t.equal(
                summaryOff?.getAttribute('tabindex'),
                '-1',
                'summary gains tabindex="-1" after flipping false'
            )

            isLocalFirstActive.value = true
            await nextTick()
            t.ok(
                !host?.classList.contains('is-disabled'),
                'host loses is-disabled after flipping back true'
            )
            const summaryOn = details?.querySelector('summary')
            t.ok(
                !summaryOn?.hasAttribute('aria-disabled'),
                'summary loses aria-disabled after flipping back true'
            )

            const sameHost = root.querySelector(
                '.settings-feed-item .feed-cache-controls'
            )
            t.equal(
                sameHost,
                host,
                'updates in place (same host instance, no re-mount)'
            )
        } finally {
            isLocalFirstActive.value = false
            _resetFeedPolicies()
            unmount(root)
        }
    }
)

// 031-animate-cache-settings: web-component disclosure behavior

test(
    'Per-feed inner details toggles open then closed (open=false)',
    async (t) => {
        const state = makeState()
        state.feeds.value = [makeFeed({ id: 30 })]
        _resetFeedPolicies()
        isLocalFirstActive.value = true

        const root = mount(state)
        try {
            await nextTick()
            const details = root.querySelector(
                '.feed-cache-controls details'
            ) as HTMLDetailsElement|null
            t.ok(details, 'inner <details> exists')

            if (details) details.open = true
            t.equal(details?.open, true, 'opens when set')

            if (details) details.open = false
            t.equal(
                details?.open,
                false,
                'closed again leaves open === false'
            )
        } finally {
            isLocalFirstActive.value = false
            _resetFeedPolicies()
            unmount(root)
        }
    }
)

test(
    'Per-feed disclosure does not carry open across a fresh mount',
    async (t) => {
        const state = makeState()
        state.feeds.value = [makeFeed({
            id: 31,
            url: 'https://a31.example.com/feed.rss'
        })]
        _resetFeedPolicies()
        isLocalFirstActive.value = true

        const rootA = mount(state)
        try {
            await nextTick()
            const detailsA = rootA.querySelector(
                '.feed-cache-controls details'
            ) as HTMLDetailsElement|null
            t.ok(detailsA, 'feed A renders an inner <details>')
            if (detailsA) detailsA.open = true
            unmount(rootA)

            state.feeds.value = [makeFeed({
                id: 32,
                url: 'https://b32.example.com/feed.rss'
            })]
            const rootB = mount(state)
            try {
                await nextTick()
                const detailsB = rootB.querySelector(
                    '.feed-cache-controls details'
                ) as HTMLDetailsElement|null
                t.ok(detailsB, 'feed B renders an inner <details>')
                t.equal(
                    detailsB?.hasAttribute('open'),
                    false,
                    'fresh disclosure has no open attribute'
                )
            } finally {
                unmount(rootB)
            }
        } finally {
            isLocalFirstActive.value = false
            _resetFeedPolicies()
        }
    }
)

test(
    'Per-feed disclosure duration honors prefers-reduced-motion',
    async (t) => {
        const state = makeState()
        state.feeds.value = [makeFeed({ id: 33 })]
        _resetFeedPolicies()
        isLocalFirstActive.value = true

        const originalMatchMedia = window.matchMedia
        const makeMatchMedia = (reduce:boolean) =>
            ((query:string) => ({
                matches: query.includes('prefers-reduced-motion') ?
                    reduce :
                    false,
                media: query,
                onchange: null,
                addEventListener: () => {},
                removeEventListener: () => {},
                addListener: () => {},
                removeListener: () => {},
                dispatchEvent: () => false
            })) as unknown as typeof window.matchMedia

        try {
            window.matchMedia = makeMatchMedia(true)
            const rootReduced = mount(state)
            try {
                await waitFor(
                    () => rootReduced.querySelector(
                        '.feed-cache-controls'
                    )?.getAttribute('duration') === '0',
                    'duration becomes "0" under reduced motion'
                )
                const host = rootReduced.querySelector(
                    '.feed-cache-controls'
                )
                t.equal(
                    host?.getAttribute('duration'),
                    '0',
                    'duration is "0" when reduced motion matches'
                )
            } finally {
                unmount(rootReduced)
            }

            window.matchMedia = makeMatchMedia(false)
            const rootNormal = mount(state)
            try {
                await nextTick()
                await nextTick()
                const host = rootNormal.querySelector(
                    '.feed-cache-controls'
                )
                t.equal(
                    host?.getAttribute('duration'),
                    '200',
                    'duration is "200" when reduced motion does not match'
                )
            } finally {
                unmount(rootNormal)
            }
        } finally {
            window.matchMedia = originalMatchMedia
            isLocalFirstActive.value = false
            _resetFeedPolicies()
        }
    }
)

test(
    'Changing per-feed cache mode select updates feedPolicies signal',
    async (t) => {
        const state = makeState()
        state.feeds.value = [makeFeed({ id: 4, title: 'Signal Test' })]
        _resetFeedPolicies()
        defaultCacheMode.value = 'text_images'

        const root = mount(state)
        try {
            await nextTick()
            const select = root.querySelector(
                'select[name="feed-cache-mode-4"]'
            ) as HTMLSelectElement|null
            t.ok(select, 'cache mode select exists')
            if (!select) return

            select.value = 'text'
            select.dispatchEvent(new Event('change', { bubbles: true }))
            await nextTick()

            t.equal(
                feedPolicies.value[4]?.cache_mode,
                'text',
                'feedPolicies updated for feed 4'
            )
        } finally {
            defaultCacheMode.value = 'text_images'
            _resetFeedPolicies()
            unmount(root)
        }
    }
)

test(
    'Selecting Use default clears cache_mode override in feedPolicies',
    async (t) => {
        const state = makeState()
        state.feeds.value = [makeFeed({ id: 5 })]
        feedPolicies.value = {
            5: {
                feed_id: 5,
                cache_mode: 'text',
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: null
            }
        }

        const root = mount(state)
        try {
            await nextTick()
            const select = root.querySelector(
                'select[name="feed-cache-mode-5"]'
            ) as HTMLSelectElement|null
            t.ok(select, 'cache mode select exists')
            if (!select) return

            select.value = ''
            select.dispatchEvent(new Event('change', { bubbles: true }))
            await nextTick()

            t.equal(
                feedPolicies.value[5]?.cache_mode ?? null,
                null,
                'cache_mode cleared to null on Use default'
            )
        } finally {
            _resetFeedPolicies()
            unmount(root)
        }
    }
)

test(
    'SettingsRoute renders active subscription panel',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        billingStatus.value = entitledBilling()

        const root = mount(makeState())
        try {
            await nextTick()
            const section = root.querySelector(
                '.subscription-section'
            )
            t.ok(section, 'subscription section is rendered')

            t.ok(
                Array.from(
                    section?.querySelectorAll('button.btn-link') ?? []
                ).some(b => (b.textContent ?? '').match(/cancel/i)),
                'cancel button is rendered'
            )
            t.ok(
                !Array.from(
                    section?.querySelectorAll('button.btn-link') ?? []
                ).some(b => (b.textContent ?? '').match(/resume/i)),
                'resume button is not rendered while subscription active'
            )
            t.ok(
                !section?.querySelector('.btn-manage'),
                'old Manage subscription button is gone'
            )
        } finally {
            resetBilling()
            unmount(root)
        }
    }
)

test(
    'SettingsRoute renders resume button when cancellation scheduled',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        billingStatus.value = entitledBilling({
            canceledAt: Date.now() - 1000
        })

        const root = mount(makeState())
        try {
            await nextTick()
            const section = root.querySelector(
                '.subscription-section'
            )
            const buttons = Array.from(
                section?.querySelectorAll('button.btn-link') ?? []
            )
            t.ok(
                buttons.some(b => (b.textContent ?? '')
                    .match(/resume/i)),
                'resume button is rendered'
            )
            t.ok(
                !buttons.some(b => (b.textContent ?? '')
                    .match(/^cancel /i)),
                'cancel button is not rendered'
            )
        } finally {
            resetBilling()
            unmount(root)
        }
    }
)

test(
    'SettingsRoute cancel button calls State.cancelSubscription',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        billingStatus.value = entitledBilling()

        const originalCancel = State.cancelSubscription
        const originalConfirm = window.confirm
        let called = false
        State.cancelSubscription = async () => { called = true }
        window.confirm = () => true

        const root = mount(makeState())
        try {
            await nextTick()
            const section = root.querySelector(
                '.subscription-section'
            )
            const cancelBtn = Array.from(
                section?.querySelectorAll('button.btn-link') ?? []
            ).find(b => (b.textContent ?? '').match(/cancel/i)) as
                HTMLButtonElement|undefined

            t.ok(cancelBtn, 'cancel button found')
            cancelBtn?.click()
            await nextTick()
            t.ok(called, 'State.cancelSubscription was invoked')
        } finally {
            State.cancelSubscription = originalCancel
            window.confirm = originalConfirm
            resetBilling()
            unmount(root)
        }
    }
)

test(
    'SettingsRoute hides Update payment method when useLive=false',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        billingStatus.value = entitledBilling({ useLive: false })

        const root = mount(makeState())
        try {
            await nextTick()
            const section = root.querySelector(
                '.subscription-section'
            )
            const buttons = Array.from(
                section?.querySelectorAll('button.btn-link') ?? []
            )
            t.ok(
                !buttons.some(b => (b.textContent ?? '')
                    .match(/payment method/i)),
                'no payment-method link in dev mode'
            )
        } finally {
            resetBilling()
            unmount(root)
        }
    }
)
