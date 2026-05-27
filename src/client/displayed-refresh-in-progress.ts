import {
    signal,
    computed,
    effect,
    type Signal,
    type ReadonlySignal,
} from '@preact/signals'

export const SHOW_DELAY_MS = 300
export const MIN_VISIBLE_MS = 500

type ClockHooks = {
    setTimeout:(
        cb:() => void,
        ms:number,
    ) => ReturnType<typeof setTimeout>
    clearTimeout:(
        handle:ReturnType<typeof setTimeout>,
    ) => void
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
                _clock.clearTimeout(_showTimer!)
                _showTimer = null
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

let _initialized = false
let _disposeEffect:(() => void)|null = null

export function init (rawSignal:Signal<boolean>):void {
    if (_initialized) return
    _initialized = true
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
    _initialized = false
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
