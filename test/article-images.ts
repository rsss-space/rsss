import { test } from '@substrate-system/tapzero'
import { addImageLoadingHints } from '../src/client/util.js'

test('addImageLoadingHints - adds loading + decoding to an img', t => {
    const out = addImageLoadingHints('<p>hi</p><img src="https://x/a.jpg">')
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const img = doc.querySelector('img')
    t.equal(img?.getAttribute('loading'), 'lazy', 'loading is lazy')
    t.equal(img?.getAttribute('decoding'), 'async', 'decoding is async')
})

test('addImageLoadingHints - preserves existing attributes', t => {
    const out = addImageLoadingHints(
        '<img src="https://x/a.jpg" width="640" height="480" alt="cat">'
    )
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const img = doc.querySelector('img')
    t.equal(img?.getAttribute('src'), 'https://x/a.jpg', 'src kept')
    t.equal(img?.getAttribute('width'), '640', 'width kept')
    t.equal(img?.getAttribute('height'), '480', 'height kept')
    t.equal(img?.getAttribute('alt'), 'cat', 'alt kept')
})

test('addImageLoadingHints - applies to multiple images', t => {
    const out = addImageLoadingHints(
        '<img src="a.jpg"><p>x</p><img src="b.jpg">'
    )
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const imgs = doc.querySelectorAll('img')
    t.equal(imgs.length, 2, 'two images present')
    imgs.forEach((img) => {
        t.equal(img.getAttribute('loading'), 'lazy', 'each img is lazy')
        t.equal(img.getAttribute('decoding'), 'async', 'each is async')
    })
})

test('addImageLoadingHints - no images returns input unchanged', t => {
    const input = '<p>no images here</p>'
    t.equal(addImageLoadingHints(input), input, 'returned unchanged')
})

test('addImageLoadingHints - empty string returns empty string', t => {
    t.equal(addImageLoadingHints(''), '', 'empty stays empty')
})

test('addImageLoadingHints - idempotent', t => {
    const once = addImageLoadingHints('<img src="a.jpg">')
    const twice = addImageLoadingHints(once)
    t.equal(twice, once, 'second pass identical to first')
})
