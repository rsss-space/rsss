import { test } from '@substrate-system/tapzero'
import { extractImageUrls } from '../src/server/extract-image-urls.js'

test('extractImageUrls finds absolute http(s) image srcs', t => {
    const html = `
        <p>Some text</p>
        <img src="https://example.com/photo.jpg" alt="photo">
        <img src="http://cdn.example.com/banner.png">
    `
    const result = extractImageUrls(html)
    t.equal(result.length, 2, 'finds two images')
    t.equal(result[0], 'https://example.com/photo.jpg', 'first url')
    t.equal(result[1], 'http://cdn.example.com/banner.png', 'second url')
})

test('extractImageUrls deduplicates repeated srcs', t => {
    const html = `
        <img src="https://example.com/pic.jpg">
        <img src="https://example.com/pic.jpg">
        <img src="https://example.com/other.jpg">
    `
    const result = extractImageUrls(html)
    t.equal(result.length, 2, 'deduped to 2')
    t.equal(result[0], 'https://example.com/pic.jpg', 'first url')
    t.equal(result[1], 'https://example.com/other.jpg', 'second url')
})

test('extractImageUrls skips non-http srcs', t => {
    const html = `
        <img src="data:image/png;base64,abc123">
        <img src="/relative/image.jpg">
        <img src="//protocol-relative.com/img.jpg">
        <img src="https://valid.com/keep.png">
    `
    const result = extractImageUrls(html)
    t.equal(result.length, 1, 'only one valid url')
    t.equal(result[0], 'https://valid.com/keep.png', 'kept https url')
})

test('extractImageUrls returns empty array when no images', t => {
    t.deepEqual(extractImageUrls('<p>No images here</p>'), [], 'no images')
    t.deepEqual(extractImageUrls(''), [], 'empty string')
})
