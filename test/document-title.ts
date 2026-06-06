import { signal } from '@preact/signals'
import { test } from '@substrate-system/tapzero'
import { initDocumentTitle } from '../src/client/document-title.js'

type FeedSyncStatus =
    | 'inactive'
    | 'updates'
    | 'syncing'
    | 'error'
    | 'synced'

test('document title mirrors the pending update count', t => {
    const original = document.title
    document.title = 'BASE TITLE'

    const status = signal<FeedSyncStatus>('synced')
    const counts = signal<Record<string, number>>({})
    const dispose = initDocumentTitle(status, counts)

    t.equal(
        document.title,
        'BASE TITLE',
        'no prefix when there are no updates'
    )

    counts.value = { 1: 4, 2: 2 }
    status.value = 'updates'
    t.equal(
        document.title,
        '(6) BASE TITLE',
        'prefixes the summed count across feeds when updates are available'
    )

    counts.value = { 1: 1 }
    t.equal(
        document.title,
        '(1) BASE TITLE',
        'reflects a single pending update'
    )

    status.value = 'syncing'
    t.equal(
        document.title,
        'BASE TITLE',
        'drops the prefix while a refresh is in progress'
    )

    status.value = 'synced'
    counts.value = {}
    t.equal(
        document.title,
        'BASE TITLE',
        'restores the plain title once synced'
    )

    dispose()
    status.value = 'updates'
    counts.value = { 1: 9 }
    t.equal(
        document.title,
        'BASE TITLE',
        'stops updating the title after dispose'
    )

    document.title = original
})
