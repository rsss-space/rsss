export interface BodyImageEntry {
    blurhash:string
    width:number
    height:number
}

export type FullContentImageMap = Record<string, BodyImageEntry>

export function parseImageMap (
    json:string|null|undefined
):FullContentImageMap {
    if (!json) return {}
    try {
        const parsed = JSON.parse(json)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as FullContentImageMap
        }
        return {}
    } catch {
        return {}
    }
}

export function mergeFullContentImage (
    existing:string|null|undefined,
    url:string,
    entry:BodyImageEntry
):string {
    const map = parseImageMap(existing)
    map[url] = entry
    return JSON.stringify(map)
}
