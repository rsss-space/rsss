import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const feedNavSource = readFileSync(
    new URL('../src/client/components/feed-nav.ts', import.meta.url),
    'utf8'
)

const sidebarSource = readFileSync(
    new URL('../src/client/components/sidebar.ts', import.meta.url),
    'utf8'
)

test('feed-nav add-feed input is read through namedItem', () => {
    assert.match(
        feedNavSource,
        /els\.namedItem\(\s*'new-feed-url'\s*\) as HTMLInputElement/
    )
    assert.doesNotMatch(feedNavSource, /els\[['"]new-feed-url['"]\]/)
})

test('feed-nav empty-state shows feedsError when set, ' +
    'otherwise No feeds yet', () => {
    // Error branch: when feedsError is set the empty state surfaces it.
    assert.match(
        feedNavSource,
        /feedsError\.value\s*\?[\s\S]+Couldn/
    )
    // Empty branch: when there's no error the original copy still wins.
    assert.match(feedNavSource, /No feeds yet/)
})

test('feed-nav destructures feedsError from state', () => {
    assert.match(feedNavSource, /feedsError,/)
})

test('Sidebar renders the shared FeedNav', () => {
    assert.match(sidebarSource, /\bFeedNav\b/)
    assert.match(sidebarSource, /class="sidebar"/)
})
