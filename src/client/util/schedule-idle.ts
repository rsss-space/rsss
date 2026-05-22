export type IdleHandle = {
    kind:'idle'|'timeout'
    id:number
}

export interface ScheduleIdleOptions {
    timeout?:number
}

const DEFAULT_TIMEOUT_MS = 200

interface IdleWindow {
    requestIdleCallback?:(
        cb:() => void,
        opts?:{ timeout?:number }
    ) => number
    cancelIdleCallback?:(id:number) => void
}

function getWin ():IdleWindow|null {
    if (typeof window === 'undefined') return null
    return window as unknown as IdleWindow
}

export function scheduleIdle (
    fn:() => void,
    opts?:ScheduleIdleOptions
):IdleHandle {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS
    const win = getWin()
    const rIC = win?.requestIdleCallback
    if (typeof rIC === 'function') {
        const id = rIC.call(win, () => { fn() }, { timeout })
        return { kind: 'idle', id }
    }
    const id = setTimeout(() => { fn() }, 0) as unknown as number
    return { kind: 'timeout', id }
}

export function cancelIdle (handle:IdleHandle|null):void {
    if (handle === null) return
    if (handle.kind === 'idle') {
        const win = getWin()
        const cIC = win?.cancelIdleCallback
        if (typeof cIC === 'function') cIC.call(win, handle.id)
        return
    }
    clearTimeout(handle.id as unknown as ReturnType<typeof setTimeout>)
}
