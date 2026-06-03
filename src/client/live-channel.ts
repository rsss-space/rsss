/**
 * Build the WebSocket URL for the live channel from a location-like
 * object. https -> wss, everything else -> ws.
 */
export function liveChannelSocketUrl (
    loc:{ protocol:string; host:string }
):string {
    const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${scheme}//${loc.host}/api/ws`
}

/**
 * Parse a raw live-channel frame into a { event, data } envelope.
 * Returns null for keepalive pongs, malformed JSON, or any frame
 * without a string `event` field.
 */
export function parseLiveMessage (
    raw:string
):{ event:string; data:unknown }|null {
    let parsed:unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.event !== 'string') return null
    return { event: obj.event, data: obj.data }
}
