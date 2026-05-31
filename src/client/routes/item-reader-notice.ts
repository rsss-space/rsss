export type NoticeVariant = 'info'|'error'

export interface ReaderNotice {
    variant:NoticeVariant;
    title:string;
    body?:string;
    retry:boolean;
}

export function noticeForStatus (
    status:string|null|undefined
):ReaderNotice|null {
    switch (status) {
        case 'succeeded_partial': return {
            variant: 'info',
            retry: false,
            title: 'This page was too large to download in full.',
            body: 'We\'ve shown the part we could read.'
        }
        case 'failed_too_large': return {
            variant: 'error',
            retry: false,
            // Framed "show in full", not "download": this status is also
            // reached when the page downloaded but the extracted body
            // exceeded the content cap (see Phase 1 A2).
            title: 'This article is too large to show in full.',
            body: 'We couldn\'t pull a readable version from this page.'
        }
        case 'failed_network': return {
            variant: 'error',
            retry: true,
            title: 'We couldn\'t reach the publisher.'
        }
        case 'failed_status': return {
            variant: 'error',
            retry: true,
            title: 'The publisher\'s site returned an error.'
        }
        case 'failed_redirect': return {
            variant: 'error',
            retry: false,
            title: 'This link redirected too many times.'
        }
        case 'failed_non_html': return {
            variant: 'error',
            retry: false,
            title: 'This link isn\'t a readable article page.'
        }
        case 'failed_no_body': return {
            variant: 'error',
            retry: false,
            title: 'We couldn\'t find the article text on this page.'
        }
        default: return null
    }
}
