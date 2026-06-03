// Test stub for @stripe/stripe-js. The mode is controlled by a
// queryable function `setNextConfirmSetupResult` so individual
// tests can inject success / failure outcomes.

type ConfirmResult = { error?:{ message:string } }

let nextResult:ConfirmResult = {}
let mountCallCount = 0

export function setNextConfirmSetupResult (r:ConfirmResult):void {
    nextResult = r
}

export function getMountCallCount ():number {
    return mountCallCount
}

export function resetMountCallCount ():void {
    mountCallCount = 0
}

export async function loadStripe (_pk:string) {
    return {
        elements: (_opts:{ clientSecret:string }) => {
            return {
                create: (_type:string) => ({
                    mount: (_node:Element) => {
                        mountCallCount++
                    },
                    unmount: () => {}
                }),
                getElement: (_type:string) => ({
                    unmount: () => {}
                })
            }
        },
        confirmSetup: async (_args:unknown) => {
            return nextResult
        }
    }
}

// Type re-exports to satisfy the modal component's imports under the
// test bundle. The shapes are intentionally loose; the modal only
// uses a few methods.
export type Stripe = unknown
export type StripeElements = unknown
