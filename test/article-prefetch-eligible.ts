import { test } from '@substrate-system/tapzero'
import { isPrefetchEligible } from '../src/server/article-prefetch-eligible.js'

test('isPrefetchEligible - summary-only item is eligible', t => {
    const item = {
        link: 'https://example.com/article',
        content: 'Short body',
        description: null,
        full_content: null
    }
    t.ok(isPrefetchEligible(item), 'summary-only item with link is eligible')
})

test('isPrefetchEligible - no link is not eligible', t => {
    const item = {
        link: null,
        content: 'Short body',
        description: null,
        full_content: null
    }
    t.equal(
        isPrefetchEligible(item),
        false,
        'item without link is not eligible'
    )
})

test('isPrefetchEligible - long feed body is not eligible', t => {
    const item = {
        link: 'https://example.com/article',
        content: 'a'.repeat(2000),
        description: null,
        full_content: null
    }
    t.equal(
        isPrefetchEligible(item),
        false,
        'item with long body is not eligible'
    )
})

test('isPrefetchEligible - already has full_content is not eligible', t => {
    const item = {
        link: 'https://example.com/article',
        content: 'Short body',
        description: null,
        full_content: '<p>Full article content</p>'
    }
    t.equal(
        isPrefetchEligible(item),
        false,
        'item with full_content already stored is not eligible'
    )
})
