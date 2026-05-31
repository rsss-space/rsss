import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import {
    publisherLinkLabel,
    publisherLinkHref
} from '../../shared/publisher-link.js'
import { type ReaderNotice } from '../routes/item-reader-notice.js'

const InfoIcon:FunctionComponent = function () {
    return html`<svg viewBox="0 0 24 24" fill="none" width="20"
        height="20"><circle cx="12" cy="12" r="9" stroke="currentColor"
        stroke-width="2" /><path d="M12 11v5M12 7.5v.5"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round" /></svg>`
}

const WarningIcon:FunctionComponent = function () {
    return html`<svg viewBox="0 0 24 24" fill="none" width="20"
        height="20"><path d="M12 4 2.5 20h19L12 4Z" stroke="currentColor"
        stroke-width="2" stroke-linejoin="round" /><path d="M12 10v4M12 17v.5"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round" /></svg>`
}

export const ArticleNotice:FunctionComponent<{
    notice:ReaderNotice;
    link:string|null;
    onRetry:() => void;
}> = function ({ notice, link, onRetry }) {
    const label = link ? publisherLinkLabel(link) : null
    const href = link ? publisherLinkHref(link) : null
    const Icon = notice.variant === 'info' ? InfoIcon : WarningIcon
    return html`
        <div class="article-notice ${notice.variant}">
            <span class="article-notice-icon" aria-hidden="true">
                <${Icon} />
            </span>
            <div class="article-notice-content">
                <p class="article-notice-title">${notice.title}</p>
                ${notice.body && html`
                    <p class="article-notice-body">${notice.body}</p>
                `}
                <div class="article-notice-actions">
                    ${notice.retry && html`
                        <button
                            type="button"
                            class="btn btn-small article-notice-retry"
                            onClick=${onRetry}
                        >Retry</button>
                    `}
                    ${label && href && html`
                        <a
                            class="article-notice-cta"
                            href=${href}
                            target="_blank"
                            rel="noopener noreferrer"
                        >${label}</a>
                    `}
                </div>
            </div>
        </div>
    `
}
