import { test } from '@substrate-system/tapzero'
import { html } from 'htm/preact'
import { render } from 'preact'
import { signal } from '@preact/signals'
import { noticeForStatus } from '../src/client/routes/item-reader-notice.js'
import { ArticleNotice } from '../src/client/components/article-notice.js'
import { ItemReader } from '../src/client/routes/item-reader.js'
import {
    type AppState,
    articleFetchError,
    articleFetchingItemId
} from '../src/client/state.js'
import { type Item } from '../src/client/db/types.js'
import '../src/client/components/article-notice.ts'

test('noticeForStatus maps succeeded_partial to info variant', t => {
    const notice = noticeForStatus('succeeded_partial')
    t.ok(notice, 'returns a notice for succeeded_partial')
    t.equal(notice?.variant, 'info', 'variant is info')
    t.equal(notice?.retry, false, 'retry is false')
})

test('noticeForStatus maps failed_too_large to error without retry', t => {
    const notice = noticeForStatus('failed_too_large')
    t.ok(notice, 'returns a notice')
    t.equal(notice?.variant, 'error', 'variant is error')
    t.equal(notice?.retry, false, 'retry is false')
})

test('noticeForStatus maps failed_network to error with retry', t => {
    const notice = noticeForStatus('failed_network')
    t.ok(notice, 'returns a notice')
    t.equal(notice?.variant, 'error', 'variant is error')
    t.equal(notice?.retry, true, 'retry is true')
})

test('noticeForStatus maps failed_status to error with retry', t => {
    const notice = noticeForStatus('failed_status')
    t.ok(notice, 'returns a notice')
    t.equal(notice?.variant, 'error', 'variant is error')
    t.equal(notice?.retry, true, 'retry is true')
})

test('noticeForStatus maps failed_redirect to error without retry', t => {
    const notice = noticeForStatus('failed_redirect')
    t.ok(notice, 'returns a notice')
    t.equal(notice?.variant, 'error', 'variant is error')
    t.equal(notice?.retry, false, 'retry is false')
})

test('noticeForStatus maps failed_non_html to error without retry', t => {
    const notice = noticeForStatus('failed_non_html')
    t.ok(notice, 'returns a notice')
    t.equal(notice?.variant, 'error', 'variant is error')
    t.equal(notice?.retry, false, 'retry is false')
})

test('noticeForStatus maps failed_no_body to error without retry', t => {
    const notice = noticeForStatus('failed_no_body')
    t.ok(notice, 'returns a notice')
    t.equal(notice?.variant, 'error', 'variant is error')
    t.equal(notice?.retry, false, 'retry is false')
})

test('AC3: all seven statuses have distinct title strings', t => {
    const statuses:[
        'succeeded_partial',
        'failed_too_large',
        'failed_network',
        'failed_status',
        'failed_redirect',
        'failed_non_html',
        'failed_no_body'
    ] = [
        'succeeded_partial',
        'failed_too_large',
        'failed_network',
        'failed_status',
        'failed_redirect',
        'failed_non_html',
        'failed_no_body'
    ]

    const titles = statuses.map(status => {
        const notice = noticeForStatus(status)
        return notice?.title ?? ''
    })

    const uniqueTitles = new Set(titles)
    t.equal(
        uniqueTitles.size,
        7,
        'all seven statuses have distinct titles'
    )
})

test('noticeForStatus returns null for succeeded', t => {
    const notice = noticeForStatus('succeeded')
    t.equal(notice, null, 'returns null')
})

test('noticeForStatus returns null for null', t => {
    const notice = noticeForStatus(null)
    t.equal(notice, null, 'returns null')
})

test('noticeForStatus returns null for undefined', t => {
    const notice = noticeForStatus(undefined)
    t.equal(notice, null, 'returns null')
})

test('noticeForStatus returns null for unknown string', t => {
    const notice = noticeForStatus('unknown_status')
    t.equal(notice, null, 'returns null')
})

test('AC4: info notice renders with info class and warning palette', t => {
    const notice = noticeForStatus('succeeded_partial')
    const body = document.querySelector('body') as HTMLElement
    const root = document.createElement('div')
    body.appendChild(root)

    try {
        const onRetry = () => {}
        render(html`
            <${ArticleNotice}
                notice=${notice}
                link="https://example.com"
                onRetry=${onRetry}
            />
        `, root)

        const noticeEl = root.querySelector('.article-notice')
        t.ok(noticeEl, 'renders article-notice element')
        t.ok(
            noticeEl?.classList.contains('info'),
            'has info class for warning palette'
        )
        t.equal(
            noticeEl?.classList.contains('error'),
            false,
            'does not have error class'
        )

        const cta = root.querySelector('.article-notice-cta')
        t.ok(cta, 'renders publisher CTA link')
        t.ok(cta?.getAttribute('href'), 'CTA has non-empty href')
    } finally {
        render(null, root)
        root.remove()
    }
})

test(
    'AC3: error notice with retry has both CTA and Retry button',
    t => {
        const notice = noticeForStatus('failed_network')
        const body = document.querySelector('body') as HTMLElement
        const root = document.createElement('div')
        body.appendChild(root)

        try {
            let retryInvoked = false
            const onRetry = () => { retryInvoked = true }
            render(html`
                <${ArticleNotice}
                    notice=${notice}
                    link="https://example.com"
                    onRetry=${onRetry}
                />
            `, root)

            const cta = root.querySelector('.article-notice-cta')
            t.ok(cta, 'CTA link exists')

            const retryBtn = root.querySelector('.article-notice-retry')
            t.ok(retryBtn, 'Retry button exists')

            if (retryBtn) {
                (retryBtn as HTMLButtonElement).click()
                t.ok(retryInvoked, 'clicking Retry invokes onRetry callback')
            }
        } finally {
            render(null, root)
            root.remove()
        }
    }
)

test('AC3: error notice without retry lacks Retry button', t => {
    const notice = noticeForStatus('failed_redirect')
    const body = document.querySelector('body') as HTMLElement
    const root = document.createElement('div')
    body.appendChild(root)

    try {
        const onRetry = () => {}
        render(html`
            <${ArticleNotice}
                notice=${notice}
                link="https://example.com"
                onRetry=${onRetry}
            />
        `, root)

        const cta = root.querySelector('.article-notice-cta')
        t.ok(cta, 'CTA link exists')

        const retryBtn = root.querySelector('.article-notice-retry')
        t.equal(retryBtn, null, 'Retry button is absent')
    } finally {
        render(null, root)
        root.remove()
    }
})

test('AC6: icon is decorative with aria-hidden', t => {
    const notice = noticeForStatus('succeeded_partial')
    const body = document.querySelector('body') as HTMLElement
    const root = document.createElement('div')
    body.appendChild(root)

    try {
        const onRetry = () => {}
        render(html`
            <${ArticleNotice}
                notice=${notice}
                link="https://example.com"
                onRetry=${onRetry}
            />
        `, root)

        const iconWrapper = root.querySelector('.article-notice-icon')
        t.equal(
            iconWrapper?.getAttribute('aria-hidden'),
            'true',
            'icon wrapper has aria-hidden="true"'
        )

        const title = root.querySelector('.article-notice-title')
        t.ok(title, 'title element exists')
    } finally {
        render(null, root)
        root.remove()
    }
})

// Reader placement tests

function fakeItemReaderState ():AppState {
    return {
        route: signal('/'),
        routeItem: signal(null),
        routeItemLoading: signal(false),
        items: signal([]),
        _setRoute: () => {}
    } as unknown as AppState
}

function fakeItem (overrides:Partial<Item> = {}):Item {
    return {
        id: 1,
        feed_id: 1,
        guid: 'test-guid',
        title: 'Test Article',
        link: 'https://example.com/article',
        description: 'Article description',
        content: 'Article content',
        author: null,
        pub_date: null,
        thumbnail_url: null,
        is_read: 0,
        is_starred: 0,
        created_at: '2024-01-01 00:00:00',
        updated_at: '2024-01-01 00:00:00',
        feed_title: 'Test Feed',
        full_content: null,
        full_content_status: null,
        ...overrides
    }
}

test(
    'AC7 + AC4: notice and body order; succeeded_partial item',
    t => {
        const body = document.querySelector('body') as HTMLElement
        const root = document.createElement('div')
        body.appendChild(root)

        try {
            articleFetchError.value = null
            articleFetchingItemId.value = null

            const state = fakeItemReaderState()
            const item = fakeItem({
                full_content_status: 'succeeded_partial',
                full_content: 'Full article content here'
            })
            state.routeItem.value = item
            state.route.value = '/post/example.com/article'

            render(html`
                <${ItemReader} state=${state} splats=${[]} />
            `, root)

            const notice = root.querySelector('.article-notice')
            const articleBody = root.querySelector(
                '.article-body'
            ) as HTMLElement
            t.ok(notice, 'renders article-notice element')
            t.ok(articleBody, 'renders article-body element')
            t.ok(
                notice?.classList.contains('info'),
                'notice has info class for partial success'
            )

            t.ok(
                notice &&
                notice.compareDocumentPosition(articleBody) &
                Node.DOCUMENT_POSITION_FOLLOWING,
                'notice precedes body in DOM order'
            )
        } finally {
            render(null, root)
            root.remove()
        }
    }
)

test(
    'AC7 fallback: notice and body order; failed_network',
    t => {
        const body = document.querySelector('body') as HTMLElement
        const root = document.createElement('div')
        body.appendChild(root)

        try {
            articleFetchError.value = null
            articleFetchingItemId.value = null

            const state = fakeItemReaderState()
            const item = fakeItem({
                full_content_status: 'failed_network',
                content: 'Fallback summary content',
                full_content: null
            })
            state.routeItem.value = item
            state.route.value = '/post/example.com/article'

            render(html`
                <${ItemReader} state=${state} splats=${[]} />
            `, root)

            const notice = root.querySelector('.article-notice')
            const articleBody = root.querySelector(
                '.article-body'
            ) as HTMLElement
            t.ok(notice, 'renders article-notice element')
            t.ok(
                notice?.classList.contains('error'),
                'notice has error class for network failure'
            )
            t.ok(articleBody, 'renders article-body element')
            t.ok(
                articleBody?.innerHTML.length > 0,
                'body contains fallback content'
            )

            t.ok(
                notice &&
                notice.compareDocumentPosition(articleBody) &
                Node.DOCUMENT_POSITION_FOLLOWING,
                'notice precedes body in DOM order'
            )
        } finally {
            render(null, root)
            root.remove()
        }
    }
)

test(
    'CTA collapse: notice hides bottom publisher link',
    t => {
        const body = document.querySelector('body') as HTMLElement
        const root = document.createElement('div')
        body.appendChild(root)

        try {
            articleFetchError.value = null
            articleFetchingItemId.value = null

            const state = fakeItemReaderState()
            const item = fakeItem({
                full_content_status: 'succeeded_partial',
                full_content: 'Full article',
                link: 'https://example.com/article'
            })
            state.routeItem.value = item
            state.route.value = '/post/example.com/article'

            render(html`
                <${ItemReader} state=${state} splats=${[]} />
            `, root)

            const publisherLink = root.querySelector(
                '.article-publisher-link'
            )
            t.equal(
                publisherLink,
                null,
                'bottom publisher link is absent when notice exists'
            )
        } finally {
            render(null, root)
            root.remove()
        }
    }
)

test(
    'CTA collapse: succeeded item shows bottom link',
    t => {
        const body = document.querySelector('body') as HTMLElement
        const root = document.createElement('div')
        body.appendChild(root)

        try {
            articleFetchError.value = null
            articleFetchingItemId.value = null

            const state = fakeItemReaderState()
            const item = fakeItem({
                full_content_status: 'succeeded',
                content: 'Article content',
                link: 'https://example.com/article'
            })
            state.routeItem.value = item
            state.route.value = '/post/example.com/article'

            render(html`
                <${ItemReader} state=${state} splats=${[]} />
            `, root)

            const publisherLink = root.querySelector(
                '.article-publisher-link'
            )
            t.ok(
                publisherLink,
                'bottom publisher link is present when no notice exists'
            )
        } finally {
            render(null, root)
            root.remove()
        }
    }
)
