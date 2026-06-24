// Stub for @sentry/cloudflare used when bundling worker code into
// browser test bundles. The real SDK imports node:async_hooks, which
// esbuild can't resolve without --platform=node. These no-op pass-
// throughs preserve the runtime shape of the wrapped handlers and DO
// class without pulling in Node built-ins.

// Capture the options callback each wrapper is given so wiring tests can
// invoke the *real* getSentryOptions / getDOSentryOptions across envs. The
// wrappers still pass the handler / class straight through, so every other
// consumer is unaffected by the capture.
export type SentryOptionsCallback = (env:unknown)=> unknown

let workerSentryOptionsCallback:SentryOptionsCallback|undefined
let doSentryOptionsCallback:SentryOptionsCallback|undefined

export function withSentry<T> (
    optionsCallback:SentryOptionsCallback,
    handler:T
):T {
    workerSentryOptionsCallback = optionsCallback
    return handler
}

export function instrumentDurableObjectWithSentry<T> (
    optionsCallback:SentryOptionsCallback,
    DurableObjectClass:T
):T {
    doSentryOptionsCallback = optionsCallback
    return DurableObjectClass
}

export function getWorkerSentryOptionsCallback ()
   :SentryOptionsCallback|undefined {
    return workerSentryOptionsCallback
}

export function getDOSentryOptionsCallback ()
   :SentryOptionsCallback|undefined {
    return doSentryOptionsCallback
}

export function resetCapturedSentryCallbacks ():void {
    workerSentryOptionsCallback = undefined
    doSentryOptionsCallback = undefined
}

export function instrumentD1WithSentry<T> (binding:T):T {
    return binding
}

export function instrumentWorkflowWithSentry<T> (
    _optionsCallback:unknown,
    WorkflowClass:T
):T {
    return WorkflowClass
}

export function sentryPagesPlugin (_optionsCallback:unknown):unknown {
    return () => undefined
}

export interface CapturedException {
    err:unknown;
    options?:unknown;
}

const capturedExceptions:CapturedException[] = []

export function captureException (
    err:unknown,
    options?:unknown
):void {
    capturedExceptions.push({ err, options })
}

export function getCapturedExceptions ():CapturedException[] {
    return capturedExceptions
}

export function resetCapturedExceptions ():void {
    capturedExceptions.length = 0
}

export function captureMessage (_msg:unknown):void {}
export function setUser (_user:unknown):void {}
export function setTag (_key:string, _value:unknown):void {}
export function setContext (_name:string, _ctx:unknown):void {}
export function addBreadcrumb (_crumb:unknown):void {}
export function startSpan<T> (_opts:unknown, fn:()=> T):T {
    return fn()
}
