import { test } from '@substrate-system/tapzero'
import {
    parseImageMap,
    mergeFullContentImage
} from '../src/server/full-content-images.js'

test('full-content-images - merge into null produces a map with one entry',
    t => {
        const result = mergeFullContentImage(
            null,
            'https://example.com/img.jpg',
            { blurhash: 'LEHV6n', width: 400, height: 300 }
        )
        const map = parseImageMap(result)
        t.equal(
            map['https://example.com/img.jpg'].blurhash,
            'LEHV6n',
            'blurhash stored'
        )
        t.equal(map['https://example.com/img.jpg'].width, 400, 'width stored')
        t.equal(map['https://example.com/img.jpg'].height, 300, 'height stored')
    }
)

test('full-content-images - merge does not clobber existing entries', t => {
    const first = mergeFullContentImage(
        null,
        'https://example.com/a.jpg',
        { blurhash: 'AAAA', width: 100, height: 100 }
    )
    const second = mergeFullContentImage(
        first,
        'https://example.com/b.jpg',
        { blurhash: 'BBBB', width: 200, height: 200 }
    )
    const map = parseImageMap(second)
    t.equal(map['https://example.com/a.jpg'].blurhash, 'AAAA', 'first entry intact')
    t.equal(map['https://example.com/b.jpg'].blurhash, 'BBBB', 'second entry present')
})

test('full-content-images - corrupt prior JSON resets to a fresh map', t => {
    const result = mergeFullContentImage(
        'not valid json{{{',
        'https://example.com/img.jpg',
        { blurhash: 'CCCC', width: 50, height: 50 }
    )
    const map = parseImageMap(result)
    const keys = Object.keys(map)
    t.equal(keys.length, 1, 'only one entry after corrupt reset')
    t.equal(
        map['https://example.com/img.jpg'].blurhash,
        'CCCC',
        'new entry present'
    )
})
