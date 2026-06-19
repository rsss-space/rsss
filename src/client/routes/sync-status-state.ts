import { signal, batch, type Signal } from '@preact/signals'
import { getBootstrappedDb, getLocalDb } from '../db/index.js'
import {
    listDeadLetterOutbox,
    type DeadLetterRow
} from '../db/push-sync.js'
import { listFailedFeeds, type Feed } from '../db/local-adapter.js'
import { type AppState } from '../state.js'

export const deadLetters:Signal<DeadLetterRow[]> = signal([])
export const failedFeeds:Signal<Feed[]> = signal([])
export const loading:Signal<boolean> = signal(false)
export const confirmingKey:Signal<string|null> = signal(null)
export const announcement:Signal<string> = signal('')

export async function loadSyncStatus (state:AppState):Promise<void> {
    const did = state.user.value?.did
    const db = did ? (getBootstrappedDb() ?? getLocalDb(did)) : null

    if (!db) {
        batch(() => {
            deadLetters.value = []
            failedFeeds.value = []
            loading.value = false
        })
        return
    }

    batch(() => {
        loading.value = true
    })

    try {
        const [deadLettersData, failedFeedsData] = await Promise.all([
            listDeadLetterOutbox(db),
            listFailedFeeds(db)
        ])

        batch(() => {
            deadLetters.value = deadLettersData
            failedFeeds.value = failedFeedsData
            loading.value = false
        })
    } catch {
        batch(() => {
            loading.value = false
        })
    }
}
