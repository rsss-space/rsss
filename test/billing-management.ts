/**
 * Server-side integration tests for the in-app subscription-
 * management endpoints introduced by the settings panel redesign.
 *
 * Drives the real Hono app from `src/server/index.ts`. Uses the
 * shared signup-helpers utilities (in-memory KV stub, fetch
 * interceptor, executionCtx) so we don't need a real Autumn
 * account.
 */
import { test } from '@substrate-system/tapzero'
import app from '../src/server/index.js'
import {
    makeEnv,
    makeSession,
    executionCtx,
    TEST_CSRF_TOKEN
} from './signup-helpers.js'

function authedHeaders (cookieHeader:string):Record<string, string> {
    return {
        'content-type': 'application/json',
        cookie: cookieHeader,
        'x-csrf-token': TEST_CSRF_TOKEN,
        'sec-fetch-site': 'same-origin'
    }
}

test(
    'GET /api/billing/status includes currentPeriodEnd and ' +
    'canceledAt fields',
    async t => {
        const env = makeEnv({ NODE_ENV: 'test' })
        const { cookieHeader } = await makeSession(env)

        const res = await app.request(
            'http://127.0.0.1/api/billing/status',
            { method: 'GET', headers: authedHeaders(cookieHeader) },
            env,
            executionCtx
        )
        const body = await res.json() as Record<string, unknown>

        t.equal(res.status, 200, 'returns 200')
        t.equal(body.entitled, false, 'free user is not entitled')
        t.ok(
            'currentPeriodEnd' in body,
            'response includes currentPeriodEnd'
        )
        t.ok(
            'canceledAt' in body,
            'response includes canceledAt'
        )
        t.equal(
            body.currentPeriodEnd,
            null,
            'free user has null currentPeriodEnd'
        )
        t.equal(
            body.canceledAt,
            null,
            'free user has null canceledAt'
        )
    }
)
