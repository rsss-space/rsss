import { test } from '@substrate-system/tapzero'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { batch } from '@preact/signals'
import { SyncStatus } from '../src/client/components/sync-status.js'
import {
    syncStatus,
    syncError,
    syncDeadLetters,
    isLocalFirstActive
} from '../src/client/db/sync-status.js'
import { billingStatus } from '../src/client/billing-status.js'

function nextTask ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

function mountRoot () {
    const root = document.createElement('div')
    document.body.appendChild(root)
    return {
        root,
        cleanup () {
            render(null, root)
            root.remove()
        }
    }
}

function resetSignals ():void {
    batch(() => {
        syncStatus.value = 'idle'
        syncError.value = null
        syncDeadLetters.value = 0
        isLocalFirstActive.value = false
        billingStatus.value = null
    })
}

test('sync-status-detail.AC1.1: warning state renders link to /sync-status',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            batch(() => {
                billingStatus.value = {
                    entitled: true,
                    planId: 'test-plan',
                    status: 'active',
                    refreshedAt: Date.now(),
                    useLive: false
                }
                isLocalFirstActive.value = true
                syncStatus.value = 'warning'
                syncDeadLetters.value = 2
                syncError.value = null
            })

            render(html`<${SyncStatus} />`, root)
            await nextTask()

            const link = document.querySelector('a[href="/sync-status"]')
            t.ok(link, 'a[href="/sync-status"] exists')

            const statusSpan = link?.querySelector('[role="status"]')
            t.ok(statusSpan, 'role="status" span exists inside link')

            const tooltip = document.querySelector('tool-tip')
            t.ok(tooltip, 'tool-tip wrapper is present')
        } finally {
            resetSignals()
            cleanup()
        }
    }
)

test('sync-status-detail.AC1.2: error state renders link to /sync-status',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            batch(() => {
                billingStatus.value = {
                    entitled: true,
                    planId: 'test-plan',
                    status: 'active',
                    refreshedAt: Date.now(),
                    useLive: false
                }
                isLocalFirstActive.value = true
                syncStatus.value = 'error'
                syncError.value = 'boom-sentinel'
                syncDeadLetters.value = 0
            })

            render(html`<${SyncStatus} />`, root)
            await nextTask()

            const link = document.querySelector('a[href="/sync-status"]')
            t.ok(link, 'a[href="/sync-status"] exists in error state')

            const statusSpan = link?.querySelector('[role="status"]')
            t.ok(statusSpan, 'role="status" span exists inside link')

            const tooltip = document.querySelector('tool-tip')
            t.ok(tooltip, 'tool-tip wrapper is present in error state')
        } finally {
            resetSignals()
            cleanup()
        }
    }
)

test('sync-status-detail.AC1.3: idle state does not render link',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            batch(() => {
                billingStatus.value = {
                    entitled: true,
                    planId: 'test-plan',
                    status: 'active',
                    refreshedAt: Date.now(),
                    useLive: false
                }
                isLocalFirstActive.value = true
                syncStatus.value = 'idle'
                syncError.value = null
                syncDeadLetters.value = 0
            })

            render(html`<${SyncStatus} />`, root)
            await nextTask()

            const link = document.querySelector('a[href="/sync-status"]')
            t.equal(link, null, 'no a[href="/sync-status"] in idle state')

            const statusSpan = document.querySelector('[role="status"]')
            t.ok(statusSpan, 'role="status" span still exists')
        } finally {
            resetSignals()
            cleanup()
        }
    }
)

test('sync-status-detail.AC1.3: syncing state does not render link',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            batch(() => {
                billingStatus.value = {
                    entitled: true,
                    planId: 'test-plan',
                    status: 'active',
                    refreshedAt: Date.now(),
                    useLive: false
                }
                isLocalFirstActive.value = true
                syncStatus.value = 'syncing'
                syncError.value = null
                syncDeadLetters.value = 0
            })

            render(html`<${SyncStatus} />`, root)
            await nextTask()

            const link = document.querySelector('a[href="/sync-status"]')
            t.equal(link, null, 'no a[href="/sync-status"] in syncing state')

            const statusSpan = document.querySelector('[role="status"]')
            t.ok(statusSpan, 'role="status" span still exists')
        } finally {
            resetSignals()
            cleanup()
        }
    }
)

test('sync-status-detail.AC1.3: offline state does not render link',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            batch(() => {
                billingStatus.value = {
                    entitled: true,
                    planId: 'test-plan',
                    status: 'active',
                    refreshedAt: Date.now(),
                    useLive: false
                }
                isLocalFirstActive.value = true
                syncStatus.value = 'offline'
                syncError.value = null
                syncDeadLetters.value = 0
            })

            render(html`<${SyncStatus} />`, root)
            await nextTask()

            const link = document.querySelector('a[href="/sync-status"]')
            t.equal(link, null, 'no a[href="/sync-status"] in offline state')

            const statusSpan = document.querySelector('[role="status"]')
            t.ok(statusSpan, 'role="status" span still exists')
        } finally {
            resetSignals()
            cleanup()
        }
    }
)
