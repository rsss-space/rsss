import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const header = readFileSync(
    new URL('../src/client/components/header.ts', import.meta.url),
    'utf8'
)

// Isolate the mobile-nav-menu container so assertions are scoped to it.
// NB: the container's closing </div> in header.ts is indented 8 spaces.
const menuBlock = header.match(
    /class="mobile-nav-menu[\s\S]*?\n {8}<\/div>/
)?.[0] ?? header

test('mobile-nav-menu block is isolated (regex guard)', () => {
    // Guard: if the isolation regex ever stops matching and falls back to
    // the whole file, the AC1.3 co-location check below becomes meaningless.
    assert.notEqual(menuBlock, header, 'isolated the mobile menu container')
})

test('mobile menu links to /feeds (AC1.1)', () => {
    assert.match(menuBlock, /href="\/feeds"/)
})

test('Feeds link sits with About and Logout in the mobile menu (AC1.3)',
    () => {
        assert.match(menuBlock, /href="\/about"/)
        assert.match(menuBlock, /href="\/feeds"/)
        assert.match(menuBlock, /handleLogout/)
    }
)
