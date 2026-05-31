import { test } from '@substrate-system/tapzero'
import { noticeForStatus } from '../src/client/routes/item-reader-notice.js'

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
