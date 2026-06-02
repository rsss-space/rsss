import { spawnSync } from 'node:child_process'

const commands = [
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
    'esbuild ./test/tab-coordination.ts --bundle | tapout',
    'esbuild ./test/sentry-options.ts --bundle | tapout',
    'esbuild ./test/schedule-idle.ts --bundle | tapout',
    'esbuild ./test/refresh-refcount.ts --bundle | tapout',
    'esbuild ./test/track-refresh.ts --bundle | tapout',
    'esbuild ./test/displayed-refresh-in-progress.ts --bundle | tapout',
    'esbuild ./test/displayed-refresh-integration.ts --bundle | tapout',
    [
        'esbuild ./test/updating-pill-lifecycle.ts --bundle',
        '--loader:.css=text',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/article-notice.ts --bundle',
        '--loader:.css=text',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    'esbuild ./test/paint-cache.ts --bundle | tapout',
    'esbuild ./test/paint-cache-bootstrap.ts --bundle | tapout',
    'esbuild ./test/paint-cache-cleanup.ts --bundle | tapout',
    'esbuild ./test/settings-nav-instant.ts --bundle | tapout',
    'esbuild ./test/cache-status-coalesce.ts --bundle | tapout',
    [
        'esbuild ./test/settings-stale-async-writes.ts --bundle',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/adapter-factory.ts --bundle',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    'esbuild ./test/sync-billing-recovery.ts --bundle | tapout',
    'esbuild ./test/article-detect.ts --bundle | tapout',
    'esbuild ./test/publisher-link.ts --bundle | tapout',
    'esbuild ./test/article-extract.ts --bundle | tapout',
    'esbuild ./test/article-fetch.ts --bundle | tapout',
    'esbuild ./test/item-reader-render-state.ts --bundle | tapout',
    'esbuild ./test/feed-reader-render-state.ts --bundle --loader:.css=text | tapout',
    [
        'esbuild ./test/fetch-full-endpoint.ts --bundle',
        '--platform=node --format=esm',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/sqlite-init.ts --bundle',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/local-adapter.ts --bundle',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/pull-sync.ts --bundle',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/push-sync.ts --bundle',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/feed-resolve-state.ts --bundle',
        '--loader:.wasm=dataurl',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/resolve-convergence-signal-refresh.ts --bundle',
        '--loader:.wasm=dataurl',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/add-feed-acquire.ts --bundle',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/background-sync-acquire.ts --bundle',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/resolve-convergence-trackrefresh.ts --bundle',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/bootstrap.ts --bundle',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/cache-status.ts --bundle',
        '--loader:.css=text',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    'esbuild ./test/local-first-settings.ts --bundle | tapout',
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
    'npm run test:lazy-html',
    'npm run test:report-error',
    'npm run test:server-import-shape',
    'npm run test:lazy-html-handler',
    'node test/run-lazy-html-routing.mjs',
    'npm run test:initial-feed',
    [
        'esbuild ./test/feed-reader-pending-updates.ts --bundle',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '--alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts',
        '--loader:.css=text',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
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
    [
        'esbuild ./test/index.ts --bundle',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '--alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts',
        '--loader:.css=text',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/settings-route.ts --bundle',
        '--loader:.css=text',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/feed-reader-cache-disclosure.ts --bundle',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '--alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts',
        '--loader:.css=text',
        '--loader:.wasm=dataurl',
        '| tapout'
    ].join(' '),
    [
        'esbuild ./test/payment-method-modal.ts --bundle',
        '--loader:.css=text',
        '--alias:@stripe/stripe-js=./test/stripe-js-stub.ts',
        '--alias:@stripe/stripe-js/pure=./test/stripe-js-stub.ts',
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
