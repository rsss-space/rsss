import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { test } from '@substrate-system/tapzero'
import { FeedBlockedBanner } from '../src/client/components/feed-blocked-banner.js'
import { type AppState, State, type Feed } from '../src/client/state.js'
import { type DeadLetterRow } from '../src/client/db/push-sync.js'

function feed (
    id:number,
    overrides:Partial<Feed> = {}
):Feed {
    return {
        id,
        url: `https://example.com/feed-${id}.xml`,
        title: `Feed ${id}`,
        description: null,
        site_url: null,
        last_fetched: '2026-06-10 00:00:00',
        last_error: null,
        last_status: 200,
        published: 0,
        published_rkey: null,
        published_at: null,
        publish_error: null,
        created_at: '2026-06-10 00:00:00',
        updated_at: '2026-06-10 00:00:00',
        ...overrides
    }
}

function deadLetter (
    op:string,
    overrides:Partial<DeadLetterRow> = {}
):DeadLetterRow {
    return {
        id: 1,
        op,
        target_id: 1,
        payload: '{}',
        client_op_id: 'cid-1',
        client_updated_at: '2026-06-10 00:00:00',
        attempts: 2,
        last_error: 'network error',
        ...overrides
    }
}

function mount (
    state:AppState,
    f:Feed,
    blockedOps:DeadLetterRow[]
):HTMLElement {
    const root = document.createElement('div')
    document.body.appendChild(root)
    render(
        html`<${FeedBlockedBanner}
            state=${state}
            feed=${f}
            blockedOps=${blockedOps}
        />`,
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

test('AC3.1: renders one op row per blocked op',
    async t => {
        const calls:{ name:string; args:unknown[] }[] = []
        const state = {
            retryDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'retryDeadLetter', args: a })
            },
            discardDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'discardDeadLetter', args: a })
            },
            discardBlockedFeedAdd: (...a:unknown[]) => {
                calls.push({ name: 'discardBlockedFeedAdd', args: a })
            }
        } as unknown as AppState

        const f = feed(1)
        const ops = [
            deadLetter('add_feed', { id: 10 }),
            deadLetter('update_item', { id: 20 })
        ]

        const root = mount(state, f, ops)

        try {
            await nextTick()

            const banner = root.querySelector('.feed-blocked-banner')
            t.ok(banner, 'banner is rendered')

            const opRows = root.querySelectorAll('.feed-blocked-op')
            t.equal(opRows.length, 2, 'one op row per blocked op')

            opRows.forEach((row, idx) => {
                const attempts = row.querySelector('.feed-blocked-op-attempts')
                const error = row.querySelector('.feed-blocked-op-error')
                t.ok(attempts, `op ${idx}: attempts container exists`)
                t.ok(error, `op ${idx}: error container exists`)
            })
        } finally {
            unmount(root)
        }
    }
)

test('AC3.2: Retry button calls retryDeadLetter',
    async t => {
        const calls:{ name:string; args:unknown[] }[] = []
        const state = {
            retryDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'retryDeadLetter', args: a })
            },
            discardDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'discardDeadLetter', args: a })
            },
            discardBlockedFeedAdd: (...a:unknown[]) => {
                calls.push({ name: 'discardBlockedFeedAdd', args: a })
            }
        } as unknown as AppState

        const f = feed(1)
        const ops = [deadLetter('update_item', { id: 42 })]

        const root = mount(state, f, ops)

        try {
            await nextTick()

            const retryBtn = root.querySelector(
                '.feed-blocked-op:first-child .feed-blocked-retry'
            ) as HTMLButtonElement | null
            t.ok(retryBtn, 'retry button is rendered')

            retryBtn?.click()

            t.equal(calls.length, 1, 'one action was called')
            t.equal(
                calls[0].name,
                'retryDeadLetter',
                'retryDeadLetter was called'
            )
            t.equal(calls[0].args[1], 42, 'called with op id')
        } finally {
            unmount(root)
        }
    }
)

test('AC3.3: Discard shows confirm before acting',
    async t => {
        const calls:{ name:string; args:unknown[] }[] = []
        const state = {
            retryDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'retryDeadLetter', args: a })
            },
            discardDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'discardDeadLetter', args: a })
            },
            discardBlockedFeedAdd: (...a:unknown[]) => {
                calls.push({ name: 'discardBlockedFeedAdd', args: a })
            }
        } as unknown as AppState

        const f = feed(1)
        const ops = [deadLetter('update_item', { id: 42 })]

        const root = mount(state, f, ops)

        try {
            await nextTick()

            let confirm = root.querySelector('.feed-blocked-confirm')
            t.equal(confirm, null, 'no confirm initially')

            const discardBtn = root.querySelector(
                '.feed-blocked-op:first-child .feed-blocked-discard'
            ) as HTMLButtonElement | null
            t.ok(discardBtn, 'discard button is rendered')

            discardBtn?.click()
            await nextTick()

            confirm = root.querySelector('.feed-blocked-confirm')
            t.ok(confirm, 'confirm prompt appears after discard click')

            t.equal(
                calls.length,
                0,
                'no action called yet'
            )

            const commitBtn = root.querySelector(
                '.feed-blocked-confirm-commit'
            ) as HTMLButtonElement | null
            t.ok(commitBtn, 'confirm commit button exists')

            commitBtn?.click()
            await nextTick()

            t.equal(calls.length, 1, 'action called after confirm')
            t.equal(
                calls[0].name,
                'discardDeadLetter',
                'discardDeadLetter was called'
            )
        } finally {
            unmount(root)
        }
    }
)

test('AC5.3: Discard branches on op type (add_feed)',
    async t => {
        const calls:{ name:string; args:unknown[] }[] = []

        // Save original State.discardBlockedFeedAdd
        const originalDiscardBlockedFeedAdd =
            State.discardBlockedFeedAdd;

        // Stub State.discardBlockedFeedAdd
        // eslint-disable-next-line
        (State.discardBlockedFeedAdd as any) =
            (...a:unknown[]):Promise<void> => {
                calls.push({
                    name: 'discardBlockedFeedAdd',
                    args: a
                })
                return Promise.resolve()
            }

        const state = {
            retryDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'retryDeadLetter', args: a })
            },
            discardDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'discardDeadLetter', args: a })
            }
        } as unknown as AppState

        const f = feed(5)
        const ops = [deadLetter('add_feed', { id: 99, target_id: 5 })]

        const root = mount(state, f, ops)

        try {
            await nextTick()

            const discardBtn = root.querySelector(
                '.feed-blocked-discard'
            ) as HTMLButtonElement | null
            discardBtn?.click()
            await nextTick()

            const commitBtn = root.querySelector(
                '.feed-blocked-confirm-commit'
            ) as HTMLButtonElement | null
            commitBtn?.click()
            await nextTick()

            t.equal(calls.length, 1, 'one action called')
            t.equal(
                calls[0].name,
                'discardBlockedFeedAdd',
                'discardBlockedFeedAdd called for add_feed'
            )
            t.equal(calls[0].args[1], 5, 'called with feed.id')
            t.equal(calls[0].args[2], 99, 'called with op.id')
        } finally {
            unmount(root);
            // eslint-disable-next-line
            (State.discardBlockedFeedAdd as any) =
                originalDiscardBlockedFeedAdd
        }
    }
)

test('AC5.3: Discard branches on op type (update_item)',
    async t => {
        const calls:{ name:string; args:unknown[] }[] = []
        const state = {
            retryDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'retryDeadLetter', args: a })
            },
            discardDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'discardDeadLetter', args: a })
            },
            discardBlockedFeedAdd: (...a:unknown[]) => {
                calls.push({ name: 'discardBlockedFeedAdd', args: a })
            }
        } as unknown as AppState

        const f = feed(1)
        const ops = [deadLetter('update_item', { id: 77 })]

        const root = mount(state, f, ops)

        try {
            await nextTick()

            const discardBtn = root.querySelector(
                '.feed-blocked-discard'
            ) as HTMLButtonElement | null
            discardBtn?.click()
            await nextTick()

            const commitBtn = root.querySelector(
                '.feed-blocked-confirm-commit'
            ) as HTMLButtonElement | null
            commitBtn?.click()
            await nextTick()

            t.equal(calls.length, 1, 'one action called')
            t.equal(
                calls[0].name,
                'discardDeadLetter',
                'discardDeadLetter called for non-add_feed op'
            )
            t.equal(calls[0].args[1], 77, 'called with op.id')
        } finally {
            unmount(root)
        }
    }
)

test('AC4.1: Case B (failed feed) shows Retry only',
    async t => {
        const calls:{ name:string; args:unknown[] }[] = []
        const state = {
            retryDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'retryDeadLetter', args: a })
            },
            discardDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'discardDeadLetter', args: a })
            },
            discardBlockedFeedAdd: (...a:unknown[]) => {
                calls.push({ name: 'discardBlockedFeedAdd', args: a })
            }
        } as unknown as AppState

        const f = feed(1, {
            last_fetched: null,
            last_error: 'fetch timeout'
        })

        const root = mount(state, f, [])

        try {
            await nextTick()

            const banner = root.querySelector('.feed-blocked-banner')
            t.ok(banner, 'banner is rendered for failed feed')

            const retryBtn = root.querySelector('.feed-blocked-retry')
            t.ok(retryBtn, 'retry button is present')

            const discardBtn = root.querySelector('.feed-blocked-discard')
            t.equal(discardBtn, null, 'no discard button for failed feed')
        } finally {
            unmount(root)
        }
    }
)

test('AC4.2: Case B Retry calls retryResolveFeed',
    async t => {
        const calls:{ name:string; args:unknown[] }[] = []

        // Save and stub State.retryResolveFeed
        const originalRetryResolveFeed =
            State.retryResolveFeed;

        // eslint-disable-next-line
        (State.retryResolveFeed as any) =
            (...a:unknown[]):Promise<void> => {
                calls.push({
                    name: 'retryResolveFeed',
                    args: a
                })
                return Promise.resolve()
            }

        const state = {
            retryDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'retryDeadLetter', args: a })
            },
            discardDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'discardDeadLetter', args: a })
            }
        } as unknown as AppState

        const f = feed(3, {
            last_fetched: null,
            last_error: 'connection refused'
        })

        const root = mount(state, f, [])

        try {
            await nextTick()

            const retryBtn = root.querySelector(
                '.feed-blocked-retry'
            ) as HTMLButtonElement | null
            t.ok(retryBtn, 'retry button is present')

            retryBtn?.click()
            await nextTick()

            t.equal(calls.length, 1, 'one action called')
            t.equal(
                calls[0].name,
                'retryResolveFeed',
                'retryResolveFeed was called'
            )
        } finally {
            unmount(root);
            // eslint-disable-next-line
            (State.retryResolveFeed as any) =
                originalRetryResolveFeed
        }
    }
)

test('AC4.3: Precedence: blocked ops beat failed feed',
    async t => {
        const calls:{ name:string; args:unknown[] }[] = []
        const state = {
            retryDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'retryDeadLetter', args: a })
            },
            discardDeadLetter: (...a:unknown[]) => {
                calls.push({ name: 'discardDeadLetter', args: a })
            },
            discardBlockedFeedAdd: (...a:unknown[]) => {
                calls.push({ name: 'discardBlockedFeedAdd', args: a })
            }
        } as unknown as AppState

        const f = feed(1, {
            last_fetched: '2026-06-10 00:00:00',
            last_error: 'stale error'
        })

        const ops = [deadLetter('update_item', { id: 50 })]

        const root = mount(state, f, ops)

        try {
            await nextTick()

            const opRows = root.querySelectorAll('.feed-blocked-op')
            t.equal(opRows.length, 1, 'Case A: op rows present')

            const discardBtn = root.querySelector('.feed-blocked-discard')
            t.ok(discardBtn, 'Case A: discard button present')
        } finally {
            unmount(root)
        }
    }
)
