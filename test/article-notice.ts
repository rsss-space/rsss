import { test } from '@substrate-system/tapzero'
import { html } from 'htm/preact'
import { render } from 'preact'
import { noticeForStatus } from '../src/client/routes/item-reader-notice.js'
import { ArticleNotice } from '../src/client/components/article-notice.js'
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
