import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const routes = readFileSync(
    new URL('../src/client/routes/index.ts', import.meta.url),
    'utf8'
)
const feedsRouteFile = readFileSync(
    new URL('../src/client/routes/feeds.ts', import.meta.url),
    'utf8'
)
const feedsCss = readFileSync(
    new URL('../src/client/routes/feeds.css', import.meta.url),
    'utf8'
)

// Isolate the /feeds registration block.
const feedsBlock = routes.match(
    /router\.addRoute\('\/feeds', \(\) => \{[\s\S]*?\n {4}\}\)/
)?.[0] ?? ''

test('/feeds route is registered', () => {
    assert.ok(feedsBlock, '/feeds route block exists')
})

test('/feeds returns FeedsRoute when authenticated (AC2.1)', () => {
    assert.match(feedsBlock, /return FeedsRoute/)
})

test('/feeds guards via _setRoute(/login) when not authed (AC2.2/AC2.3)',
    () => {
        assert.match(
            feedsBlock,
            /!state\.authLoading\.value && !state\.isAuthenticated\.value/
        )
        assert.match(feedsBlock, /_setRoute\('\/login'\)/)
    }
)

test('FeedsRoute renders shared FeedNav in .route.feeds (AC3.1)', () => {
    assert.match(feedsRouteFile, /\bFeedNav\b/)
    assert.match(feedsRouteFile, /class="route feeds"/)
})

test('/feeds page has no display:none breakpoint rule (AC3.4)', () => {
    assert.doesNotMatch(feedsCss, /display\s*:\s*none/)
})
