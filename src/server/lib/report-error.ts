import * as Sentry from '@sentry/cloudflare'

export function reportError (
    err:unknown,
    area:string,
    context?:Record<string, unknown>
):void {
    Sentry.captureException(err, {
        tags: { area },
        extra: context
    })

    if (context) {
        console.error(`[${area}]`, err, context)
        return
    }

    console.error(`[${area}]`, err)
}
