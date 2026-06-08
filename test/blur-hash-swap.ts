import { test } from '@substrate-system/tapzero'
import { addBlurHashPlaceholders } from '../src/client/blur-hash-swap.js'
import { blurhashDecodeSize } from '../src/client/blurhash-decode-size.js'
import type { FullContentImageMap } from '../src/server/full-content-images.js'

const SRC = 'https://example.com/photo.jpg'
const HASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
const MAP:FullContentImageMap = {
    [SRC]: { blurhash: HASH, width: 800, height: 600 }
}

test('addBlurHashPlaceholders - swaps a matched img to blur-hash', t => {
    const html = `<p>hello</p><img src="${SRC}" alt="A photo">`
    const out = addBlurHashPlaceholders(html, MAP)
    const doc = new DOMParser().parseFromString(out, 'text/html')

    const img = doc.querySelector('img')
    t.equal(img, null, 'original img is gone')

    const bh = doc.querySelector('blur-hash')
    t.ok(bh !== null, 'blur-hash element present')
    t.equal(bh?.getAttribute('src'), SRC, 'src preserved')
    t.equal(bh?.getAttribute('alt'), 'A photo', 'alt preserved')
    t.equal(
        bh?.getAttribute('placeholder'),
        HASH,
        'placeholder set to blurhash'
    )
    t.equal(bh?.getAttribute('loading'), 'lazy', 'loading=lazy')
})

test('addBlurHashPlaceholders - sets width/height from blurhashDecodeSize', t => {
    const html = `<img src="${SRC}">`
    const out = addBlurHashPlaceholders(html, MAP)
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const bh = doc.querySelector('blur-hash')

    const expected = blurhashDecodeSize(800, 600)
    t.equal(
        bh?.getAttribute('width'),
        String(expected.width),
        'width from decode size'
    )
    t.equal(
        bh?.getAttribute('height'),
        String(expected.height),
        'height from decode size'
    )
})

test('addBlurHashPlaceholders - sets inline aspect-ratio from real dims', t => {
    const html = `<img src="${SRC}">`
    const out = addBlurHashPlaceholders(html, MAP)
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const bh = doc.querySelector('blur-hash') as HTMLElement|null

    const style = bh?.style.aspectRatio ?? ''
    t.ok(style.includes('800'), 'aspect-ratio contains real width')
    t.ok(style.includes('600'), 'aspect-ratio contains real height')
})

test('addBlurHashPlaceholders - leaves imgs without a hash untouched', t => {
    const unmapped = 'https://example.com/other.jpg'
    const html = `<img src="${unmapped}" alt="other">`
    const out = addBlurHashPlaceholders(html, MAP)
    const doc = new DOMParser().parseFromString(out, 'text/html')

    const img = doc.querySelector('img')
    t.ok(img !== null, 'img element still present')
    t.equal(
        doc.querySelector('blur-hash'),
        null,
        'no blur-hash element'
    )
})

test('addBlurHashPlaceholders - empty map returns input unchanged', t => {
    const html = `<img src="${SRC}">`
    const out = addBlurHashPlaceholders(html, {})
    t.equal(out, html, 'empty map returns input string unchanged')
})

test('addBlurHashPlaceholders - idempotent', t => {
    const html = `<img src="${SRC}" alt="X">`
    const once = addBlurHashPlaceholders(html, MAP)
    const twice = addBlurHashPlaceholders(once, MAP)
    t.equal(twice, once, 'second pass identical to first')
})
