import { test } from '@substrate-system/tapzero'
import { signal } from '@preact/signals'
import {
    displayedRefreshInProgress,
    init,
    SHOW_DELAY_MS,
    MIN_VISIBLE_MS,
    _resetForTest,
} from '../src/client/displayed-refresh-in-progress.js'

function sleep (ms:number):Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

test(
    'AC2.1: raw stays true past show-delay -> displayed becomes true',
    async (t) => {
        _resetForTest()
        const raw = signal<boolean>(false)
        init(raw)

        raw.value = true
        await sleep(50)
        t.equal(
            displayedRefreshInProgress.value,
            false,
            'displayed still false at 50ms (before show-delay)',
        )

        await sleep(SHOW_DELAY_MS)
        t.equal(
            displayedRefreshInProgress.value,
            true,
            'displayed true after show-delay elapsed',
        )

        _resetForTest()
    },
)

test(
    'AC2.2: raw flips true -> false before show-delay -> displayed never true',
    async (t) => {
        _resetForTest()
        const raw = signal<boolean>(false)
        init(raw)

        raw.value = true
        await sleep(100)
        t.equal(
            displayedRefreshInProgress.value,
            false,
            'displayed still false at 100ms (< SHOW_DELAY_MS)',
        )

        raw.value = false
        await sleep(SHOW_DELAY_MS + 50)
        t.equal(
            displayedRefreshInProgress.value,
            false,
            'displayed never goes true (350ms total, past where it would have)',
        )

        _resetForTest()
    },
)

test(
    'AC2.3: once displayed true, stays true for at least MIN_VISIBLE_MS',
    async (t) => {
        _resetForTest()
        const raw = signal<boolean>(false)
        init(raw)

        raw.value = true
        await sleep(SHOW_DELAY_MS + 50)
        t.equal(
            displayedRefreshInProgress.value,
            true,
            'displayed becomes true after show-delay (350ms)',
        )

        await sleep(100)
        raw.value = false
        t.equal(
            displayedRefreshInProgress.value,
            true,
            'displayed still true immediately after raw goes false',
        )

        await sleep(100)
        t.equal(
            displayedRefreshInProgress.value,
            true,
            'displayed still true at 200ms into min-visible (450ms total)',
        )

        await sleep(400)
        t.equal(
            displayedRefreshInProgress.value,
            false,
            'displayed false after min-visible elapsed (900ms total)',
        )

        _resetForTest()
    },
)

test(
    'AC2.4: raw re-acquires inside min-visible window -> displayed stays true',
    async (t) => {
        _resetForTest()
        const raw = signal<boolean>(false)
        init(raw)

        raw.value = true
        await sleep(SHOW_DELAY_MS + 50)
        t.equal(
            displayedRefreshInProgress.value,
            true,
            'displayed true after show-delay (350ms)',
        )

        raw.value = false
        await sleep(50)
        t.equal(
            displayedRefreshInProgress.value,
            true,
            'displayed still true 50ms after raw cleared (50ms into min-visible)',
        )

        raw.value = true
        await sleep(SHOW_DELAY_MS + 100)
        t.equal(
            displayedRefreshInProgress.value,
            true,
            'displayed still true after re-acquire past min-visible',
        )

        raw.value = false
        await sleep(10)
        t.equal(
            displayedRefreshInProgress.value,
            false,
            'displayed immediately false (min-visible already elapsed)',
        )

        _resetForTest()
    },
)

test(
    'Rapid flips (true/false/true/false) never show displayed',
    async (t) => {
        _resetForTest()
        const raw = signal<boolean>(false)
        init(raw)

        raw.value = true
        await sleep(100)
        raw.value = false
        await sleep(100)
        raw.value = true
        await sleep(100)
        raw.value = false

        t.equal(
            displayedRefreshInProgress.value,
            false,
            'displayed never went true (all flips within SHOW_DELAY_MS)',
        )

        await sleep(SHOW_DELAY_MS + 50)
        t.equal(
            displayedRefreshInProgress.value,
            false,
            'displayed still false after 350ms from start',
        )

        _resetForTest()
    },
)

test(
    'After full cycle, raw goes true again -> re-enters PENDING_SHOW',
    async (t) => {
        _resetForTest()
        const raw = signal<boolean>(false)
        init(raw)

        // First cycle
        raw.value = true
        await sleep(SHOW_DELAY_MS + 50)
        t.equal(displayedRefreshInProgress.value, true, 'first cycle: displayed true')

        raw.value = false
        await sleep(MIN_VISIBLE_MS + 50)
        t.equal(
            displayedRefreshInProgress.value,
            false,
            'first cycle: displayed false after min-visible',
        )

        // Second cycle
        raw.value = true
        await sleep(50)
        t.equal(
            displayedRefreshInProgress.value,
            false,
            'second cycle: displayed still false at 50ms',
        )

        await sleep(SHOW_DELAY_MS)
        t.equal(
            displayedRefreshInProgress.value,
            true,
            'second cycle: displayed true after show-delay',
        )

        _resetForTest()
    },
)
