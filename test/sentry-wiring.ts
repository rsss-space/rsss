import { test } from '@substrate-system/tapzero'
// Importing the server entry evaluates the module, which runs
// `Sentry.withSentry(...)` and `Sentry.instrumentDurableObjectWithSentry(...)`
// at top level. Under the esbuild `@sentry/cloudflare` alias those are the
// stub's capturing versions, so the real getSentryOptions / getDOSentryOptions
// callbacks land in the slots below. The smoke test references both bindings.
import worker, { RsssUserDO } from '../src/server/index.js'
import {
    getWorkerSentryOptionsCallback,
    getDOSentryOptionsCallback
} from './sentry-cloudflare-stub.js'

// A syntactically valid, live-looking DSN. The point of the dev/unset rows is
// that suppression holds even when a real DSN is present (FR-007).
const DSN = 'https://public@o0.ingest.sentry.io/0'

type Env = { NODE_ENV?:string; SENTRY_DSN?:string }
type Opts = Record<string, unknown>

function callWorker (env:Env):Opts {
    const cb = getWorkerSentryOptionsCallback()
    if (!cb) throw new Error('worker Sentry callback not captured')
    return cb(env) as Opts
}

function callDO (env:Env):Opts {
    const cb = getDOSentryOptionsCallback()
    if (!cb) throw new Error('DO Sentry callback not captured')
    return cb(env) as Opts
}

test('worker and DO are wired to a Sentry options callback', t => {
    t.ok(worker, 'worker default export loaded')
    t.ok(RsssUserDO, 'RsssUserDO export loaded')
    const workerCb = getWorkerSentryOptionsCallback()
    const doCb = getDOSentryOptionsCallback()
    t.equal(typeof workerCb, 'function', 'worker callback captured')
    t.equal(typeof doCb, 'function', 'DO callback captured')
})

// --- User Story 1: local errors never reach the dashboard ---

test('US1: worker yields no DSN in development (FR-001, FR-004, FR-007)',
    t => {
        const opts = callWorker({ NODE_ENV: 'development', SENTRY_DSN: DSN })
        t.equal(opts.dsn, undefined, 'no DSN in dev even with SENTRY_DSN set')
        t.equal('tracesSampleRate' in opts, false, 'tracesSampleRate omitted')
    })

test('US1: DO yields no DSN in development (FR-002, FR-003)', t => {
    const opts = callDO({ NODE_ENV: 'development', SENTRY_DSN: DSN })
    t.equal(opts.dsn, undefined, 'no DSN in dev for the DO')
    t.equal('tracesSampleRate' in opts, false, 'tracesSampleRate omitted')
})

test('US1: unset NODE_ENV suppresses on worker and DO', t => {
    const w = callWorker({ SENTRY_DSN: DSN })
    const d = callDO({ SENTRY_DSN: DSN })
    t.equal(w.dsn, undefined, 'worker: no DSN when NODE_ENV unset')
    t.equal('tracesSampleRate' in w, false, 'worker: no tracesSampleRate')
    t.equal(d.dsn, undefined, 'DO: no DSN when NODE_ENV unset')
    t.equal('tracesSampleRate' in d, false, 'DO: no tracesSampleRate')
})

// --- User Story 2: deployed environments keep reporting ---

test('US2: worker reports with DSN in production and staging (FR-005)', t => {
    const prod = callWorker({ NODE_ENV: 'production', SENTRY_DSN: DSN })
    t.equal(prod.dsn, DSN, 'production keeps the DSN')
    t.equal(prod.tracesSampleRate, 0.2, 'production sample rate 0.2')
    const staging = callWorker({ NODE_ENV: 'staging', SENTRY_DSN: DSN })
    t.equal(staging.dsn, DSN, 'staging keeps the DSN')
    t.equal(staging.tracesSampleRate, 1.0, 'staging sample rate 1.0')
})

test('US2: DO reports with DSN in production and staging (FR-003, FR-005)',
    t => {
        const prod = callDO({ NODE_ENV: 'production', SENTRY_DSN: DSN })
        t.equal(prod.dsn, DSN, 'production keeps the DSN')
        t.equal(prod.tracesSampleRate, 0.2, 'production sample rate 0.2')
        const staging = callDO({ NODE_ENV: 'staging', SENTRY_DSN: DSN })
        t.equal(staging.dsn, DSN, 'staging keeps the DSN')
        t.equal(staging.tracesSampleRate, 1.0, 'staging sample rate 1.0')
    })

test('US2: worker and DO options never drift across envs', t => {
    const envs:Env[] = [
        { NODE_ENV: 'production', SENTRY_DSN: DSN },
        { NODE_ENV: 'staging', SENTRY_DSN: DSN },
        { NODE_ENV: 'development', SENTRY_DSN: DSN },
        { SENTRY_DSN: DSN }
    ]
    for (const env of envs) {
        t.deepEqual(
            callWorker(env),
            callDO(env),
            `worker and DO agree for ${env.NODE_ENV ?? 'unset'}`
        )
    }
})
