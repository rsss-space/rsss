import { blurhashDecodeSize } from './blurhash-decode-size.js'
import type { FullContentImageMap } from '../server/full-content-images.js'

export function addBlurHashPlaceholders (
    html:string,
    imageMap:FullContentImageMap
):string {
    if (!html) return html
    if (Object.keys(imageMap).length === 0) return html

    const doc = new DOMParser().parseFromString(html, 'text/html')
    const imgs = doc.body.querySelectorAll('img')
    if (imgs.length === 0) return html

    let changed = false
    imgs.forEach((img) => {
        const src = img.getAttribute('src') ?? ''
        const entry = imageMap[src]
        if (!entry) return

        const bh = doc.createElement('blur-hash')
        bh.setAttribute('src', src)
        const alt = img.getAttribute('alt')
        if (alt !== null) bh.setAttribute('alt', alt)
        bh.setAttribute('placeholder', entry.blurhash)
        const decodeSize = blurhashDecodeSize(entry.width, entry.height)
        bh.setAttribute('width', String(decodeSize.width))
        bh.setAttribute('height', String(decodeSize.height))
        bh.setAttribute('loading', 'lazy')
        bh.style.aspectRatio = `${entry.width} / ${entry.height}`

        img.parentNode?.replaceChild(bh, img)
        changed = true
    })

    return changed ? doc.body.innerHTML : html
}
