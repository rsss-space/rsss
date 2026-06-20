import { rsssLexicons } from './index.js'

const byCollection = new Map<string, typeof rsssLexicons[number]>(
    rsssLexicons.map((doc) => [doc.id, doc])
)

export function isValidRecord (
    collection:string,
    record:unknown
):boolean {
    const doc = byCollection.get(collection)
    if (!doc) return false  // unknown collection -> drop

    if (typeof record !== 'object' || record === null ||
        Array.isArray(record)
    ) {
        return false
    }
    const rec = record as Record<string, unknown>

    // $type, when present, must name this collection.
    if ('$type' in rec && rec.$type !== collection) return false

    const { required, properties } = doc.defs.main.record

    // Required fields must be present and well-typed (non-empty string).
    for (const field of required) {
        const value = rec[field]
        if (typeof value !== 'string' || value.length === 0) return false
    }

    // Declared properties present must match their declared type (all
    // space.rsss.* properties are strings today). Unknown/extra keys are
    // tolerated — the lexicon's property set is not exhaustive of a record.
    for (const [key, prop] of Object.entries(properties)) {
        if (key in rec && rec[key] !== undefined &&
            prop.type === 'string' && typeof rec[key] !== 'string'
        ) {
            return false
        }
    }

    return true
}
