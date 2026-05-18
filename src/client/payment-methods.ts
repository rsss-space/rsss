/**
 * Global signals for the user's saved Stripe payment methods. Mirrors
 * the shape of the server's GET /api/billing/payment-methods response.
 */
import { type Signal, signal, batch } from '@preact/signals'

export interface PaymentMethodSummary {
    id:string;
    brand:string;
    last4:string;
    expMonth:number;
    expYear:number;
    isDefault:boolean;
}

export const paymentMethods:Signal<PaymentMethodSummary[]> = signal([])
export const defaultMethodId:Signal<string|null> = signal(null)
export const paymentMethodsLoading:Signal<boolean> = signal(false)
export const paymentMethodsError:Signal<string|null> = signal(null)

export function setPaymentMethodsState (
    methods:PaymentMethodSummary[],
    defaultId:string|null
):void {
    batch(() => {
        paymentMethods.value = methods
        defaultMethodId.value = defaultId
    })
}

export function setPaymentMethodsLoading (v:boolean):void {
    paymentMethodsLoading.value = v
}

export function setPaymentMethodsError (msg:string|null):void {
    paymentMethodsError.value = msg
}

export function resetPaymentMethods ():void {
    batch(() => {
        paymentMethods.value = []
        defaultMethodId.value = null
        paymentMethodsLoading.value = false
        paymentMethodsError.value = null
    })
}
