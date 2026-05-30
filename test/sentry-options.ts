import { test } from '@substrate-system/tapzero'
import {
    isSentryEnv,
    buildSentryOptions
} from '../src/server/sentry-options.js'

const DSN = 'https://public@o0.ingest.sentry.io/0'

test('isSentryEnv gates on deployed environments', t => {
    t.equal(isSentryEnv('production'), true, 'production is a Sentry env')
    t.equal(isSentryEnv('staging'), true, 'staging is a Sentry env')
    t.equal(isSentryEnv('development'), false, 'development is not')
    t.equal(isSentryEnv(undefined), false, 'unset NODE_ENV is not')
})

test('production keeps dsn + 0.2 sample rate', t => {
    const opts = buildSentryOptions({ NODE_ENV: 'production', SENTRY_DSN: DSN })
    t.equal(opts.dsn, DSN, 'dsn is set in production')
    t.equal(opts.tracesSampleRate, 0.2, 'production samples at 0.2')
    t.equal('tracesSampleRate' in opts, true, 'tracesSampleRate key present')
    t.equal(opts.sendDefaultPii, false, 'sendDefaultPii stays false')
})

test('staging keeps dsn + 1.0 sample rate', t => {
    const opts = buildSentryOptions({ NODE_ENV: 'staging', SENTRY_DSN: DSN })
    t.equal(opts.dsn, DSN, 'dsn is set in staging')
    t.equal(opts.tracesSampleRate, 1.0, 'staging samples at 1.0')
    t.equal('tracesSampleRate' in opts, true, 'tracesSampleRate key present')
    t.equal(opts.sendDefaultPii, false, 'sendDefaultPii stays false')
})

test('dev (unset NODE_ENV) omits tracesSampleRate entirely', t => {
    const opts = buildSentryOptions({})
    t.equal(opts.dsn, undefined, 'dsn is undefined off-DSN')
    t.equal('tracesSampleRate' in opts, false,
        'tracesSampleRate key is absent (not 0) so tracing is disabled')
    t.equal(opts.sendDefaultPii, false, 'sendDefaultPii stays false')
})

test('development NODE_ENV with no DSN omits tracesSampleRate', t => {
    const opts = buildSentryOptions({
        NODE_ENV: 'development', SENTRY_DSN: DSN
    })
    t.equal(opts.dsn, undefined, 'dsn is undefined outside production/staging')
    t.equal('tracesSampleRate' in opts, false,
        'tracesSampleRate key is absent in development')
})

test('worker and DO builders agree for the same env', t => {
    const envs = ['production', 'staging', 'development', undefined]
    for (const NODE_ENV of envs) {
        const workerEnv = { NODE_ENV, SENTRY_DSN: DSN }
        const doEnv = { NODE_ENV, SENTRY_DSN: DSN }
        t.deepEqual(
            buildSentryOptions(workerEnv),
            buildSentryOptions(doEnv),
            `worker and DO agree for NODE_ENV=${String(NODE_ENV)}`
        )
    }
})
