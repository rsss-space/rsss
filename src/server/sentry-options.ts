// Pure Sentry options builder, shared by the worker (`withSentry`) and the
// Durable Object (`instrumentDurableObjectWithSentry`) so they cannot drift.
// Kept free of `@sentry/*` and `cloudflare:workers` imports so it is
// trivially unit-testable.

// Only ship events to Sentry from deployed envs; local `wrangler dev`
// leaves NODE_ENV unset, which disables the SDK entirely (empty DSN).
export const isSentryEnv = (nodeEnv:string|undefined):boolean => (
    nodeEnv === 'production' || nodeEnv === 'staging'
)

export interface SentryEnvInput {
    NODE_ENV?:string;
    SENTRY_DSN?:string;
}

export interface SentryOptions {
    dsn?:string;
    environment?:string;
    sendDefaultPii:false;
    tracesSampleRate?:number;
}

// Build the Sentry options for an environment. `tracesSampleRate` is added
// ONLY when a DSN is configured (deployed envs); when there is no DSN the
// key is omitted entirely so tracing is fully disabled and no request spans
// are created in dev (omitting the key, not setting it to 0, is what
// actually disables tracing per Sentry's docs).
export function buildSentryOptions (env:SentryEnvInput):SentryOptions {
    const enabled = isSentryEnv(env.NODE_ENV)
    const options:SentryOptions = {
        dsn: enabled ? env.SENTRY_DSN : undefined,
        environment: env.NODE_ENV,
        sendDefaultPii: false,
    }
    if (enabled) {
        options.tracesSampleRate = env.NODE_ENV === 'production' ? 0.2 : 1.0
    }
    return options
}
