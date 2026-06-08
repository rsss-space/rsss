import { spawnSync } from 'node:child_process'

const commands = [
    // --- static / node-only checks ---
    'node test/dead-code.mjs',
    'node test/deploy-config.mjs',
    'node test/durable-object-parseint-static.mjs',
    'node test/routes-oauth-callback-static.mjs',
    'node test/feeds-route-static.mjs',
    'node test/sidebar-static.mjs',
    'node test/header-feeds-link-static.mjs',
    'node test/server-routing-static.mjs',
    'node test/sync-invariant-static.mjs',
    'node test/article-fetch-not-in-refresh.mjs',
    'node test/local-first-a11y-static.mjs',
    'node test/local-first-opfs-persistence-static.mjs',
    'node test/local-first-docs.mjs',
    'node test/vite-build-inputs.mjs',
    'node test/shell-html.mjs',
    'node test/vite-isolation-headers.mjs',
    'node test/isolation-headers-static.mjs',
    'node test/run-all-coverage.mjs',

    // --- consolidated browser tests: one esbuild bundle, one tapout
    // (one headless-browser spawn for the whole set). Running these as
    // ~35 separate `esbuild | tapout` commands meant ~35 browser spawns,
    // which under memory pressure got tapout SIGKILLed (exit 137). See
    // test/browser-tests.ts for the file list; the command (with the
    // wasm loader and `-t`, since the merged bundle outlasts tapout's
    // 10s default) lives in package.json as test:browser.
    'npm run test:browser',

    // --- browser tests kept separate: they mutate shared singletons
    // (the `State` singleton, `globalThis.fetch`, bootstrap / tab-lock /
    // OPFS globals) and fail or hang when sharing a browser context with
    // their neighbours, so each gets its own bundle. ---
    'npm run test:adapter-factory',
    'npm run test:resolve-convergence-signal-refresh',
    'npm run test:bootstrap',
    'npm run test:api-router',
    'npm run test:sentry-wiring',

    // --- node-platform tests (esbuild -> node -> tap-spec) ---
    [
        'esbuild ./test/fetch-full-endpoint.ts --bundle',
        '--platform=node --format=esm',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/store-full-content-endpoint.ts --bundle',
        '--platform=node --format=esm',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/article-fetch-consumer.ts --bundle',
        '--platform=node --format=esm',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/extract-image-urls.ts --bundle',
        '--platform=node --format=esm',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/blurhash-target-routing.ts --bundle',
        '--platform=node --format=esm',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/session-record.ts --bundle --platform=node',
        '--format=esm',
        '--external:./src/server/blurhash-runtime.js',
        '--external:stripe',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/logout.ts --bundle --platform=node',
        '--format=esm',
        '--external:./src/server/blurhash-runtime.js',
        '--external:stripe',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/account-deletion.ts --bundle --platform=node',
        '--format=esm',
        '--external:./src/server/blurhash-runtime.js',
        '--external:stripe',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/account-deletion-alarm.ts --bundle',
        '--platform=node --format=esm',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/state-refresh-audit.ts --bundle',
        '--platform=node --format=esm',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/live-channel-client.ts --bundle',
        '--platform=node --format=esm',
        '| node --input-type=module | tap-spec'
    ].join(' '),

    // --- remaining node / npm-run tests ---
    'npm run test:report-error',
    'npm run test:server-import-shape',
    'npm run test:lazy-html-handler',
    'node test/run-lazy-html-routing.mjs',
    [
        'esbuild ./test/billing-management.ts --bundle',
        '--platform=node --format=esm',
        '--external:stripe',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '--loader:.wasm=dataurl',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/stripe-billing.ts --bundle',
        '--platform=node --format=esm',
        '--banner:js="import { createRequire } from ' +
        '\'node:module\'; const require = ' +
        'createRequire(import.meta.url);"',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/payment-methods.ts --bundle',
        '--platform=node --format=esm',
        '--external:stripe',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '--loader:.wasm=dataurl',
        '| node --input-type=module | tap-spec'
    ].join(' '),

    // --- the existing combined browser bundle ---
    [
        'esbuild ./test/index.ts --bundle',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '--alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts',
        '--loader:.css=text',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),

    'node test/paint-cache-slow-billing.mjs'
]

for (const command of commands) {
    const result = spawnSync(command, {
        shell: true,
        stdio: 'inherit'
    })

    if (result.status !== 0) {
        process.exit(result.status ?? 1)
    }
}
