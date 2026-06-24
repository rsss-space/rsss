/**
 * Debounced derived signal for the refresh-in-progress indicator.
 *
 * Exposes `displayedRefreshInProgress` (a `ReadonlySignal<boolean>`)
 * that mirrors the raw `refreshInProgress` signal from `state.ts`
 * with two flicker-preventing filters:
 *
 * - **Show-delay (SHOW_DELAY_MS = 300):** the displayed signal does
 *   not become `true` until the raw signal has been continuously
 *   `true` for at least 300 ms. Prevents the UI from flashing
 *   "updating…" on operations that complete instantly.
 *
 * - **Minimum-visible (MIN_VISIBLE_MS = 500):** once the displayed
 *   signal becomes `true`, it stays `true` for at least 500 ms even
 *   if the raw signal clears sooner. Prevents the UI from blinking
 *   when the raw signal oscillates.
 *
 * Driven by a 5-state machine (IDLE, PENDING_SHOW,
 * SHOWN_MIN_VISIBLE, SHOWN_MIN_PENDING_CLEAR, SHOWN). Call `init`
 * once per AppState (the factory does this automatically). Call
 * `_resetForTest` between tests that construct multiple AppStates.
 */

import {
    signal,
    computed,
    effect,
    type ReadonlySignal,
} from '@preact/signals'

export const SHOW_DELAY_MS = 300
export const MIN_VISIBLE_MS = 500

type ClockHooks = {
    setTimeout:(
        cb:()=> void,
        ms:number,
    )=> ReturnType<typeof setTimeout>
    clearTimeout:(
        handle:ReturnType<typeof setTimeout>,
    )=> void
}

let _clock:ClockHooks = {
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (handle) => clearTimeout(handle),
}

export function _setClockForTest (clock?:ClockHooks):void {
    _clock = clock ?? {
        setTimeout: (cb, ms) => setTimeout(cb, ms),
        clearTimeout: (handle) => clearTimeout(handle),
    }
}

type State =
    | 'IDLE'
    | 'PENDING_SHOW'
    | 'SHOWN_MIN_VISIBLE'
    | 'SHOWN_MIN_PENDING_CLEAR'
    | 'SHOWN'

let _state:State = 'IDLE'
let _showTimer:ReturnType<typeof setTimeout>|null = null
let _minVisibleTimer:ReturnType<typeof setTimeout>|null = null
let _lastObservedRaw:boolean = false

const _internalSignal = signal<boolean>(false)

export const displayedRefreshInProgress:ReadonlySignal<boolean> =
    computed<boolean>(() => _internalSignal.value)

function handleRawChange (raw:boolean):void {
    _lastObservedRaw = raw

    if (raw === true) {
        switch (_state) {
            case 'IDLE':
                _state = 'PENDING_SHOW'
                _showTimer = _clock.setTimeout(() => {
                    _showTimer = null
                    _internalSignal.value = true
                    _state = 'SHOWN_MIN_VISIBLE'
                    _minVisibleTimer = _clock.setTimeout(() => {
                        _minVisibleTimer = null
                        if (_lastObservedRaw === false) {
                            _internalSignal.value = false
                            _state = 'IDLE'
                        } else {
                            _state = 'SHOWN'
                        }
                    }, MIN_VISIBLE_MS)
                }, SHOW_DELAY_MS)
                break
            case 'PENDING_SHOW':
                // no-op (timer running)
                break
            case 'SHOWN_MIN_VISIBLE':
                // no-op
                break
            case 'SHOWN_MIN_PENDING_CLEAR':
                _state = 'SHOWN_MIN_VISIBLE'
                break
            case 'SHOWN':
                // no-op
                break
        }
    } else {
        // raw === false
        switch (_state) {
            case 'IDLE':
                // no-op
                break
            case 'PENDING_SHOW':
                if (_showTimer !== null) {
                    _clock.clearTimeout(_showTimer)
                    _showTimer = null
                }
                _state = 'IDLE'
                break
            case 'SHOWN_MIN_VISIBLE':
                _state = 'SHOWN_MIN_PENDING_CLEAR'
                break
            case 'SHOWN_MIN_PENDING_CLEAR':
                // no-op (already pending)
                break
            case 'SHOWN':
                _internalSignal.value = false
                _state = 'IDLE'
                break
        }
    }
}

let _disposeEffect:(()=> void)|null = null
let _currentRawSignal:ReadonlySignal<boolean>|null = null

export function init (rawSignal:ReadonlySignal<boolean>):void {
    if (_currentRawSignal === rawSignal) return
    if (_disposeEffect !== null) {
        _disposeEffect()
        _disposeEffect = null
    }
    _currentRawSignal = rawSignal
    // Reset the state machine to a known IDLE baseline so the new
    // raw signal starts from a clean slate without inheriting
    // any timers or shown state from the previous subscription.
    if (_showTimer !== null) {
        _clock.clearTimeout(_showTimer)
        _showTimer = null
    }
    if (_minVisibleTimer !== null) {
        _clock.clearTimeout(_minVisibleTimer)
        _minVisibleTimer = null
    }
    _state = 'IDLE'
    _lastObservedRaw = false
    _internalSignal.value = false
    _disposeEffect = effect(() => {
        const v = rawSignal.value
        handleRawChange(v)
    })
}

export function _resetForTest ():void {
    if (_disposeEffect !== null) {
        _disposeEffect()
        _disposeEffect = null
    }
    _currentRawSignal = null
    if (_showTimer !== null) {
        _clock.clearTimeout(_showTimer)
        _showTimer = null
    }
    if (_minVisibleTimer !== null) {
        _clock.clearTimeout(_minVisibleTimer)
        _minVisibleTimer = null
    }
    _internalSignal.value = false
    _state = 'IDLE'
    _lastObservedRaw = false
    _setClockForTest()
}
