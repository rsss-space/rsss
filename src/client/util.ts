import DOMPurify from 'dompurify'

export function stripHtml (html:string):string {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function decodeEntities (html:string):string {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return doc.documentElement.textContent
}

export function formatDate (dateStr:string|null):string {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`

    return date.toLocaleDateString()
}

// Article bodies are publisher HTML injected verbatim via
// dangerouslySetInnerHTML. Publisher chrome ships interactive controls
// ("Save this story" bookmark widgets, share bars, inline subscribe
// forms) that have no place in a reader. DOMPurify's `html` profile
// keeps these tags, and merely forbidding a tag re-parents its children
// (KEEP_CONTENT defaults true) -- so a forbidden <button> would leave
// its "Save this story" label behind. Remove the whole node instead.
const STRIPPED_CONTROL_TAGS = new Set([
    'button',
    'input',
    'select',
    'textarea',
    'label'
])

DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (STRIPPED_CONTROL_TAGS.has(data.tagName)) {
        node.parentNode?.removeChild(node)
    }
})

export function sanitizeHtml (html:string):string {
    return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['style', 'form'],
        FORBID_ATTR: ['style']
    })
}

export function formatBytes (n:number):string {
    if (n === 0) return '0 B'
    if (n < 1_000) return `${n} B`
    if (n < 1_000_000) return `${(n / 1_000).toFixed(1)} KB`
    return `${(n / 1_000_000).toFixed(1)} MB`
}

/**
 * Get the closes parent element matching the given selector.
 *
 * @param el Element to start from
 * @param s Selector for an element
 * @returns {HTMLElement|null} The closes parent element that matches.
 */
export function match (el:HTMLElement, s:string):HTMLElement|null {
    if (!el.matches) el = el.parentElement!
    return el.matches(s) ? el : el.closest(s)
}
