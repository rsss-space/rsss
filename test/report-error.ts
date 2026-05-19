import { test } from '@substrate-system/tapzero'
import { reportError } from '../src/server/lib/report-error.js'
import {
    getCapturedExceptions,
    resetCapturedExceptions
} from './sentry-cloudflare-stub.js'

test('reportError captures exceptions with area tag and context', t => {
    resetCapturedExceptions()
    const originalError = console.error
    const logged:unknown[][] = []
    console.error = (...args:unknown[]) => {
        logged.push(args)
    }

    try {
        const err = new Error('payment failed')
        const context = { route: '/api/billing/status', status: 503 }

        reportError(err, 'billing', context)

        const captured = getCapturedExceptions()
        t.equal(captured.length, 1, 'captures one exception')
        t.equal(captured[0].err, err, 'passes the original error')
        t.deepEqual(captured[0].options, {
            tags: { area: 'billing' },
            extra: context
        }, 'passes Sentry area tag and extra context')
        t.equal(logged.length, 1, 'logs the error once')
        t.equal(logged[0][0], '[billing]', 'prefixes console log by area')
        t.equal(logged[0][1], err, 'logs the original error object')
    } finally {
        console.error = originalError
        resetCapturedExceptions()
    }
})
