import { test } from '@substrate-system/tapzero'

// Consolidated browser-test bundle.
//
// Every test here previously ran as its own `esbuild ... | tapout`
// command in run-all-tests.mjs, which meant one headless-browser spawn
// per file (~35 of them). That much browser churn under memory pressure
// was getting tapout SIGKILLed (exit 137). Importing them into a single
// bundle means one browser spawn for the whole set.
//
// NOT included here, and intentionally kept as their own tapout runs in
// run-all-tests.mjs:
//   - Tests already imported by ./index.ts (updating-pill-lifecycle,
//     feed-reader-pending-updates, feed-reader-cache-disclosure,
//     settings-route) -- index.ts is their bundle.
//   - adapter-factory, resolve-convergence-signal-refresh, bootstrap --
//     these mutate shared singletons (the `State` singleton,
//     `globalThis.fetch`, bootstrap/tab-lock/OPFS globals) and fail or
//     hang when they share a browser context with their neighbors.
//   - The Node-platform tests (piped to `node | tap-spec`) and the
//     static `node test/*.mjs` checks -- not browser tests.
import './tab-coordination.js'
import './sentry-options.js'
import './schedule-idle.js'
import './refresh-refcount.js'
import './track-refresh.js'
import './displayed-refresh-in-progress.js'
import './displayed-refresh-integration.js'
import './article-notice.js'
import './sanitize-html.js'
import './paint-cache.js'
import './paint-cache-bootstrap.js'
import './paint-cache-cleanup.js'
import './settings-nav-instant.js'
import './cache-status-coalesce.js'
import './settings-stale-async-writes.js'
import './sync-billing-recovery.js'
import './article-detect.js'
import './article-images.js'
import './publisher-link.js'
import './article-extract.js'
import './article-fetch.js'
import './item-reader-render-state.js'
import './feed-reader-render-state.js'
import './sqlite-init.js'
import './local-adapter.js'
import './pull-sync.js'
import './push-sync.js'
import './feed-resolve-state.js'
import './add-feed-acquire.js'
import './background-sync-acquire.js'
import './resolve-convergence-trackrefresh.js'
import './cache-status.js'
import './local-first-settings.js'
import './lazy-html.js'
import './initial-feed.js'
import './payment-method-modal.js'
import './article-fetch-job.js'
import './article-prefetch-eligible.js'
import './sync-status-format.js'
import './blocked-ops.js'
import './full-content-images.js'
import './blur-hash-swap.js'
import './atproto-lexicons.js'
import './subscription-rkey.js'
import './image-cache.js'
import './feed-share-toggle.js'
import './feed-share-control.js'
import './feed-nav.js'
import './feed-nav-warning.js'
import './publish-consent-modal.js'
import './retry-discard-dead-letter.js'
import './remove-local-feed-row.js'
import './discard-blocked-feed-add.js'
import './sync-status-route.js'
import './sync-status-feeds.js'
import './sync-status-header.js'
import './feed-blocked-banner.js'
import './feed-reader-blocked-banner.js'
import './debug-seed.js'

test('all done', () => {
    if (window) {
        // @ts-expect-error tests
        window.testsFinished = true
    }
})
