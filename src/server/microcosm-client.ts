const CONSTELLATION_DEFAULT = 'https://constellation.microcosm.blue'
const SLINGSHOT_DEFAULT = 'https://slingshot.microcosm.blue'

export const RSSS_USER_AGENT = 'rsss/1.0 (https://rsss.space)'

export interface MicrocosmServiceError {
    code:'service_unavailable'
    message:string
    status?:number
}

function serviceError (
    message:string,
    status?:number
):MicrocosmServiceError {
    return { code: 'service_unavailable', message, status }
}

function baseUrl (url:string):string {
    return url.endsWith('/') ? url.slice(0, -1) : url
}

async function getJson (
    url:string,
    fetcher:typeof fetch
):Promise<{ ok:true; body:unknown } | { ok:false; status?:number; message:string }> {
    try {
        const response = await fetcher(url, {
            method: 'GET',
            headers: { 'user-agent': RSSS_USER_AGENT }
        })

        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                message: `HTTP ${response.status}`
            }
        }

        const body = await response.json<unknown>()
        return { ok: true, body }
    } catch (err) {
        return {
            ok: false,
            message: err instanceof Error ? err.message : 'Unknown error'
        }
    }
}

// ---- Constellation ----

export interface BacklinkRecord {
    uri:string
    cid:string
    value:unknown
}

export interface BacklinksResult {
    backlinks:BacklinkRecord[]
    cursor?:string
}

export interface BacklinksCountResult {
    count:number
}

export interface DistinctResult {
    subjects:string[]
    cursor?:string
}

interface BacklinksParams {
    collection:string
    path:string
    subject:string
    limit?:number
    cursor?:string
}

export interface ConstellationClient {
    getBacklinks(
        params:BacklinksParams
    ):Promise<BacklinksResult | MicrocosmServiceError>
    getBacklinksCount(
        params:Omit<BacklinksParams, 'limit' | 'cursor'>
    ):Promise<BacklinksCountResult | MicrocosmServiceError>
    getDistinct(
        params:Omit<BacklinksParams, 'limit' | 'cursor'>
    ):Promise<DistinctResult | MicrocosmServiceError>
}

export interface ConstellationClientOptions {
    baseUrl?:string
    fetch?:typeof fetch
}

function constellationUrl (
    base:string,
    endpoint:string,
    params:Record<string, string | number | undefined>
):string {
    const url = new URL(`${baseUrl(base)}/xrpc/${endpoint}`)
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
            url.searchParams.set(key, String(value))
        }
    }
    return url.href
}

export function createConstellationClient (
    opts:ConstellationClientOptions = {}
):ConstellationClient {
    const base = opts.baseUrl ?? CONSTELLATION_DEFAULT
    const fetcher = opts.fetch ?? fetch

    async function getBacklinks (
        params:BacklinksParams
    ):Promise<BacklinksResult | MicrocosmServiceError> {
        const url = constellationUrl(
            base,
            'blue.microcosm.constellation.getBacklinks',
            {
                collection: params.collection,
                path: params.path,
                subject: params.subject,
                limit: params.limit,
                cursor: params.cursor
            }
        )
        const result = await getJson(url, fetcher)
        if (!result.ok) {
            return serviceError(result.message, result.status)
        }
        const body = result.body as Record<string, unknown>
        return {
            backlinks: (body.backlinks as BacklinkRecord[] | undefined) ?? [],
            cursor: body.cursor as string | undefined
        }
    }

    async function getBacklinksCount (
        params:Omit<BacklinksParams, 'limit' | 'cursor'>
    ):Promise<BacklinksCountResult | MicrocosmServiceError> {
        const url = constellationUrl(
            base,
            'blue.microcosm.constellation.getBacklinksCount',
            {
                collection: params.collection,
                path: params.path,
                subject: params.subject
            }
        )
        const result = await getJson(url, fetcher)
        if (!result.ok) {
            return serviceError(result.message, result.status)
        }
        const body = result.body as Record<string, unknown>
        return { count: (body.count as number | undefined) ?? 0 }
    }

    async function getDistinct (
        params:Omit<BacklinksParams, 'limit' | 'cursor'>
    ):Promise<DistinctResult | MicrocosmServiceError> {
        const url = constellationUrl(
            base,
            'blue.microcosm.constellation.getDistinct',
            {
                collection: params.collection,
                path: params.path,
                subject: params.subject
            }
        )
        const result = await getJson(url, fetcher)
        if (!result.ok) {
            return serviceError(result.message, result.status)
        }
        const body = result.body as Record<string, unknown>
        return {
            subjects: (body.subjects as string[] | undefined) ?? [],
            cursor: body.cursor as string | undefined
        }
    }

    return { getBacklinks, getBacklinksCount, getDistinct }
}

// ---- Slingshot ----

export interface SlingshotRecord {
    uri:string
    cid:string
    value:unknown
}

export interface IdentityResult {
    did:string
    handle?:string
    didDoc?:unknown
}

export interface ListRecordsResult {
    records:SlingshotRecord[]
    cursor?:string
}

interface GetRecordParams {
    repo:string
    collection:string
    rkey:string
}

interface ResolveIdentityParams {
    did?:string
    handle?:string
}

interface ListRecordsParams {
    repo:string
    collection:string
    limit?:number
    cursor?:string
}

export interface SlingshotClient {
    getRecord(
        params:GetRecordParams
    ):Promise<SlingshotRecord | MicrocosmServiceError>
    resolveIdentity(
        params:ResolveIdentityParams
    ):Promise<IdentityResult | MicrocosmServiceError>
    listRecords(
        params:ListRecordsParams
    ):Promise<ListRecordsResult | MicrocosmServiceError>
}

export interface SlingshotClientOptions {
    baseUrl?:string
    fetch?:typeof fetch
}

function slingshotUrl (
    base:string,
    endpoint:string,
    params:Record<string, string | undefined>
):string {
    const url = new URL(`${baseUrl(base)}/xrpc/${endpoint}`)
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
            url.searchParams.set(key, value)
        }
    }
    return url.href
}

export function createSlingshotClient (
    opts:SlingshotClientOptions = {}
):SlingshotClient {
    const base = opts.baseUrl ?? SLINGSHOT_DEFAULT
    const fetcher = opts.fetch ?? fetch

    async function getRecord (
        params:GetRecordParams
    ):Promise<SlingshotRecord | MicrocosmServiceError> {
        const url = slingshotUrl(
            base,
            'com.atproto.repo.getRecord',
            {
                repo: params.repo,
                collection: params.collection,
                rkey: params.rkey
            }
        )
        const result = await getJson(url, fetcher)
        if (!result.ok) {
            return serviceError(result.message, result.status)
        }
        const body = result.body as Record<string, unknown>
        return {
            uri: (body.uri as string | undefined) ?? '',
            cid: (body.cid as string | undefined) ?? '',
            value: body.value
        }
    }

    async function resolveIdentity (
        params:ResolveIdentityParams
    ):Promise<IdentityResult | MicrocosmServiceError> {
        const url = slingshotUrl(
            base,
            'com.atproto.identity.resolveIdentity',
            { did: params.did, handle: params.handle }
        )
        const result = await getJson(url, fetcher)
        if (!result.ok) {
            return serviceError(result.message, result.status)
        }
        const body = result.body as Record<string, unknown>
        return {
            did: (body.did as string | undefined) ?? '',
            handle: body.handle as string | undefined,
            didDoc: body.didDoc
        }
    }

    async function listRecords (
        params:ListRecordsParams
    ):Promise<ListRecordsResult | MicrocosmServiceError> {
        const urlParams:Record<string, string | undefined> = {
            repo: params.repo,
            collection: params.collection
        }
        if (params.limit !== undefined) {
            urlParams.limit = String(params.limit)
        }
        if (params.cursor !== undefined) {
            urlParams.cursor = params.cursor
        }
        const url = slingshotUrl(
            base,
            'com.atproto.repo.listRecords',
            urlParams
        )
        const result = await getJson(url, fetcher)
        if (!result.ok) {
            return serviceError(result.message, result.status)
        }
        const body = result.body as Record<string, unknown>
        return {
            records: (body.records as SlingshotRecord[] | undefined) ?? [],
            cursor: body.cursor as string | undefined
        }
    }

    return { getRecord, resolveIdentity, listRecords }
}
