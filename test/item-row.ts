import { signal } from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { test } from '@substrate-system/tapzero'
import { ItemRow } from '../src/client/components/item-row.js'
import { type AppState, type Item } from '../src/client/state.js'

function rowState ():AppState {
    return {
        items: signal([]),
        route: signal('/'),
        _setRoute: () => {}
    } as unknown as AppState
}

function item (
    overrides:Partial<Item> = {}
):Item {
    return {
        id: 1,
        feed_id: 1,
        guid: 'guid-1',
        title: 'Thumbnail story',
        link: 'https://example.com/story',
        description: 'Story summary',
        content: null,
        author: null,
        pub_date: null,
        thumbnail_url: null,
        is_read: 0,
        is_starred: 0,
        created_at: '2024-01-01 00:00:00',
        updated_at: '2024-01-01 00:00:00',
        feed_title: 'Example Feed',
        ...overrides
    }
}

function renderRow (row:Item):HTMLDivElement {
    const body = document.querySelector('body') as HTMLElement
    const root = document.createElement('div')
    body.appendChild(root)
    render(html`<${ItemRow} item=${row} state=${rowState()} />`, root)
    return root
}

test('ItemRow renders a decorative thumbnail before item text', t => {
    const root = renderRow(item({
        og_image_url: 'https://cdn.example.com/thumb.jpg',
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        image_width: 1200,
        image_height: 630
    }))

    try {
        const link = root.querySelector('.item-link') as HTMLAnchorElement
        const thumbnail = link.querySelector(
            'blur-hash.item-thumbnail'
        ) as HTMLElement

        t.ok(thumbnail, 'renders blur hash thumbnail')
        t.equal(
            link.firstElementChild,
            thumbnail,
            'places thumbnail before the item body'
        )
        if (thumbnail) {
            t.equal(
                thumbnail.nextElementSibling?.className,
                'item-main',
                'keeps item text after thumbnail'
            )
            t.equal(
                thumbnail.getAttribute('src'),
                'https://cdn.example.com/thumb.jpg',
                'uses the OG image URL'
            )
            t.equal(
                thumbnail.getAttribute('placeholder'),
                'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
            )
            // The blur-hash element decodes its placeholder at the
            // width/height it is given, on the main thread, in
            // connectedCallback. Decoding at the original image size
            // (e.g. 1200x630) blocks the main thread for hundreds of
            // ms per row; across a list this is multi-second jank.
            // The thumbnail only displays at 80px (CSS-scaled), so the
            // decode resolution must be bounded small, not the source
            // dimensions.
            const decodeW = parseInt(
                thumbnail.getAttribute('width') ?? '',
                10
            )
            const decodeH = parseInt(
                thumbnail.getAttribute('height') ?? '',
                10
            )
            t.ok(
                decodeW >= 1 && decodeW <= 64,
                'decodes at a small bounded width, not the source width'
            )
            t.ok(
                decodeH >= 1 && decodeH <= 64,
                'decodes at a small bounded height, not the source height'
            )
            t.ok(
                Math.abs((decodeW / decodeH) - (1200 / 630)) < 0.3,
                'preserves the source aspect ratio'
            )
            t.equal(thumbnail.getAttribute('loading'), 'lazy')
            t.equal(thumbnail.getAttribute('alt'), 'Thumbnail story')
        }
    } finally {
        render(null, root)
        root.remove()
    }
})

test('ItemRow falls back to a plain image while blurhash is pending', t => {
    const root = renderRow(item({
        og_image_url: 'https://cdn.example.com/pending.jpg',
        blurhash: null,
        image_width: null,
        image_height: null
    }))

    try {
        const thumbnail = root.querySelector(
            'img.item-thumbnail'
        ) as HTMLImageElement|null
        const blurHash = root.querySelector('blur-hash')

        t.equal(blurHash, null, 'does not render blur-hash without metadata')
        t.ok(thumbnail, 'renders fallback image')
        t.equal(
            thumbnail?.getAttribute('src'),
            'https://cdn.example.com/pending.jpg',
            'uses the OG image URL'
        )
        t.equal(thumbnail?.getAttribute('loading'), 'lazy')
        t.equal(thumbnail?.getAttribute('decoding'), 'async')
        t.equal(thumbnail?.getAttribute('referrerpolicy'), 'no-referrer')
        t.equal(thumbnail?.getAttribute('alt'), 'Thumbnail story')
    } finally {
        render(null, root)
        root.remove()
    }
})

test('ItemRow does not reserve image DOM without an OG image URL', t => {
    const root = renderRow(item({
        thumbnail_url: 'https://cdn.example.com/legacy.jpg',
        og_image_url: ''
    }))

    try {
        const link = root.querySelector('.item-link') as HTMLAnchorElement

        t.equal(
            root.querySelector('.item-thumbnail'),
            null,
            'does not render a placeholder image'
        )
        t.equal(
            link.firstElementChild?.className,
            'item-main',
            'keeps the original first child for rows without thumbnails'
        )
    } finally {
        render(null, root)
        root.remove()
    }
})

test('ItemRow renders the excerpt as a full-width link below the row', t => {
    const root = renderRow(item({
        link: 'https://example.com/story',
        description: 'Story summary',
        og_image_url: 'https://cdn.example.com/thumb.jpg'
    }))

    try {
        const link = root.querySelector('.item-link') as HTMLAnchorElement
        const excerptLink = root.querySelector(
            'a.item-excerpt-link'
        ) as HTMLAnchorElement|null

        t.ok(excerptLink, 'renders the excerpt as its own link')
        t.equal(
            excerptLink?.getAttribute('href'),
            '/post/example.com/story',
            'excerpt link points at the article route'
        )
        t.equal(
            link.contains(excerptLink),
            false,
            'excerpt link is a sibling of the main link, not nested in it'
        )
        t.ok(
            excerptLink?.querySelector('.item-excerpt'),
            'excerpt text lives inside the excerpt link'
        )
        t.equal(
            link.querySelector('.item-excerpt'),
            null,
            'excerpt no longer sits inside the main link column'
        )
    } finally {
        render(null, root)
        root.remove()
    }
})

test('ItemRow shows the article source URL beneath the feed title', t => {
    const link = 'https://example.com/a/b'
    const root = renderRow(item({ link }))

    try {
        const url = root.querySelector('.item-url')
        t.ok(url, 'renders an .item-url element when the item has a link')
        t.ok(
            url?.textContent?.includes(link),
            'the .item-url text reflects the item link'
        )
    } finally {
        render(null, root)
        root.remove()
    }
})

test('ItemRow omits the source URL when the item has no link', t => {
    const nullRoot = renderRow(item({ link: null }))
    try {
        t.equal(
            nullRoot.querySelector('.item-url'),
            null,
            'renders no .item-url element for a null link'
        )
    } finally {
        render(null, nullRoot)
        nullRoot.remove()
    }

    const blankRoot = renderRow(item({ link: '   ' }))
    try {
        t.equal(
            blankRoot.querySelector('.item-url'),
            null,
            'renders no .item-url element for a whitespace-only link'
        )
    } finally {
        render(null, blankRoot)
        blankRoot.remove()
    }
})

test('ItemRow removes a fallback image after the image fails', async t => {
    const root = renderRow(item({
        og_image_url: 'data:image/png;base64,not-valid'
    }))

    try {
        const thumbnail = root.querySelector(
            '.item-thumbnail'
        ) as HTMLImageElement

        t.ok(thumbnail, 'starts with thumbnail image')
        const startedAt = Date.now()

        while (
            root.querySelector('.item-thumbnail') &&
            Date.now() - startedAt < 1000
        ) {
            await new Promise(resolve => setTimeout(resolve, 20))
        }

        t.equal(
            root.querySelector('.item-thumbnail'),
            null,
            'removes the broken thumbnail'
        )
    } finally {
        render(null, root)
        root.remove()
    }
})
