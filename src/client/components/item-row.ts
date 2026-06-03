import { type FunctionComponent } from 'preact'
import { useCallback, useEffect, useState } from 'preact/hooks'
import { html } from 'htm/preact'
import { BlurHash } from '@substrate-system/blur-hash'
import { decodeEntities, formatDate, stripHtml } from '../util.js'
import { MailOpened } from './mail-opened.js'
import '@substrate-system/tool-tip'
import {
    State,
    itemToRoute,
    type AppState,
    type Item,
} from '../state.js'
import './item-row.css'
import '@substrate-system/icons/css'
import { define } from '@substrate-system/icons/new-tab'
import { Mail } from './mail.js'
define()
BlurHash.define()

function isValidImageSize (value:number|null|undefined):value is number {
    return typeof value === 'number' &&
        Number.isFinite(value) &&
        value > 0
}

// The <blur-hash> element decodes its placeholder synchronously in
// connectedCallback at the width/height it is given. The thumbnail is
// only ever shown at 80px (the canvas is CSS-scaled to fill), so the
// decode resolution should be bounded small. Decoding at the source
// image dimensions (often ~1200x800) is ~150x more pixels than are
// displayed and blocks the main thread for hundreds of ms per row --
// across a list of items this is multi-second jank on every mount.
export const BLURHASH_DECODE_MAX = 32

export function blurhashDecodeSize (
    width:number,
    height:number
):{ width:number; height:number } {
    if (width >= height) {
        return {
            width: BLURHASH_DECODE_MAX,
            height: Math.max(
                1,
                Math.round(BLURHASH_DECODE_MAX * height / width)
            )
        }
    }
    return {
        width: Math.max(
            1,
            Math.round(BLURHASH_DECODE_MAX * width / height)
        ),
        height: BLURHASH_DECODE_MAX
    }
}

export const ItemRow:FunctionComponent<{
    item:Item
    state:AppState
}> = function ItemRow ({ item, state }) {
    const isUnread = !item.is_read
    const isStarred = !!item.is_starred
    const [hiddenThumbnail, setHiddenThumbnail] = useState(false)
    const imageUrl = item.og_image_url?.trim()
    const sourceUrl = item.link?.trim()
    const imageWidth = item.image_width
    const imageHeight = item.image_height
    const hasBlurHash = Boolean(
        item.blurhash &&
        isValidImageSize(imageWidth) &&
        isValidImageSize(imageHeight)
    )
    const decodeSize = (
        isValidImageSize(imageWidth) && isValidImageSize(imageHeight)
    ) ?
        blurhashDecodeSize(imageWidth, imageHeight) :
        null
    const showThumbnail = Boolean(
        imageUrl && !hiddenThumbnail
    )
    const imageAlt = item.title ?
        decodeEntities(item.title + '') :
        'Article image'

    useEffect(() => {
        setHiddenThumbnail(false)
    }, [imageUrl])

    const toggleRead = useCallback((ev:MouseEvent) => {
        ev.preventDefault()
        State.toggleItemRead(state, item.id, !item.is_read)
    }, [])

    const handleStar = useCallback(async (
        ev:MouseEvent
    ) => {
        ev.stopPropagation()
        await State.toggleItemStarred(
            state,
            item.id,
            !isStarred
        )
    }, [])

    const handleThumbnailError = useCallback(() => {
        setHiddenThumbnail(true)
    }, [])

    const route = itemToRoute(item)
    return html`
        <div class="item-row ${isUnread ? 'unread' : ''}">
            <div class="item-top">
            <a
                class="item-link ${showThumbnail ?
                    'with-thumbnail' :
                    ''}"
                href=${route}
            >
                ${showThumbnail && html`
                    ${hasBlurHash ?
                        html`
                            <blur-hash
                                class="item-thumbnail"
                                placeholder=${item.blurhash}
                                src=${imageUrl}
                                width=${decodeSize?.width}
                                height=${decodeSize?.height}
                                alt=${imageAlt}
                                loading="lazy"
                            ></blur-hash>
                        ` :
                        html`
                            <img
                                class="item-thumbnail"
                                src=${imageUrl}
                                loading="lazy"
                                decoding="async"
                                referrerpolicy="no-referrer"
                                alt=${imageAlt}
                                onError=${handleThumbnailError}
                            />
                        `
                    }
                `}
                <div class="item-main">
                    <h3 class="item-title">
                        ${item.title ?
                            decodeEntities(item.title + '') :
                            '(No title)'
                        }
                    </h3>
                    <div class="item-meta">
                        ${sourceUrl && html`
                            <span class="item-url" title=${sourceUrl}>
                                ${sourceUrl}
                            </span>
                        `}
                        <span class="item-feed">
                            ${item.feed_title}
                        </span>
                        ${item.pub_date && html`
                            <time class="item-date" datetime="${
                                new Date(item.pub_date)
                                    .toISOString()
                                    .split('T')
                                    .shift()
                            }">
                                ${formatDate(item.pub_date)}
                            </time>
                        `}
                    </div>
                </div>
            </a>

            <div class="item-controls">
                <div class="item-actions">
                    <a
                        href="${item.link}"
                        target="_blank"
                        class="icon"
                    >
                        <new-tab></new-tab>
                        <span class="visually-hidden">
                            New Tab
                        </span>
                    </a>
                    <button
                        class="btn-star ${isStarred ?
                            'starred' :
                            ''}"
                        onClick=${handleStar}
                        title=${isStarred ? 'Unstar' : 'Star'}
                    >
                        ${isStarred ? '\u2605' : '\u2606'}
                        <span class="visually-hidden">
                            star
                        </span>
                    </button>

                    <button
                        class="icon"
                        onClick=${toggleRead}
                    >
                        ${item.is_read ?
                            html`
                                <tool-tip
                                    content="Mark unread"
                                    delay="500"
                                    placement="left"
                                >
                                    <${MailOpened} />
                                </tool-tip>
                                <span class="visually-hidden">
                                    Mark as unread
                                </span>
                            ` :
                            html`
                                <tool-tip
                                    content="Mark as read"
                                    delay="500"
                                    placement="left-start"
                                >
                                    <${Mail} />
                                </tool-tip>
                                <span class="visually-hidden">
                                    Mark as read
                                </span>
                            `
                        }
                    </button>
                </div>
            </div>
            </div>

            ${item.description && html`
                <a class="item-excerpt-link" href=${route}>
                    <p class="item-excerpt">
                        ${stripHtml(
                            item.description
                        ).slice(0, 200)}
                    </p>
                </a>
            `}
        </div>
    `
}
