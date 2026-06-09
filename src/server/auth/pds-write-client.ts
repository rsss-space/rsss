import {
    createAccessTokenHash,
    createDPoPProofJwt
} from './dpop-proof.js'
import type { OAuthCredentialRecord } from './oauth.js'
import {
    refreshOAuthCredentials,
    type OAuthRefreshFailure
} from './token-refresh.js'
import { reportError as defaultReportError } from
    '../lib/report-error.js'

type PdsWriteOperation =
    | 'com.atproto.repo.putRecord'
    | 'com.atproto.repo.createRecord'
    | 'com.atproto.repo.deleteRecord'

export interface PutRecordInput {
    repo?:string
    collection:string
    rkey:string
    record:unknown
    validate?:boolean
    swapRecord?:string
    swapCommit?:string
}

export interface CreateRecordInput {
    repo?:string
    collection:string
    record:unknown
    rkey?:string
    validate?:boolean
    swapCommit?:string
}

export interface DeleteRecordInput {
    repo?:string
    collection:string
    rkey:string
    swapRecord?:string
    swapCommit?:string
}

export interface PdsWriteFailure {
    code:'reauth_required'|'pds_write_failed'
    status?:number
    message:string
}

export type PdsWriteResult =
    | {
        ok:true
        credentials:OAuthCredentialRecord
        body:unknown
    }
    | {
        ok:false
        credentials:OAuthCredentialRecord
        error:PdsWriteFailure
    }

export interface PdsWriteClientDeps {
    fetch?:typeof fetch
    now?:() => number
    persistCredentials:(credentials:OAuthCredentialRecord) => Promise<void>
    reportError?:(
        err:unknown,
        area:string,
        context?:Record<string, unknown>
    ) => void
}

interface PdsAttemptResult {
    response:Response
    body:Record<string, unknown>
}

interface WriteRequest {
    operation:PdsWriteOperation
    collection:string
    body:Record<string, unknown>
}

function pdsUrl (
    credentials:OAuthCredentialRecord,
    operation:PdsWriteOperation
):string {
    const base = credentials.pdsEndpoint.endsWith('/') ?
        credentials.pdsEndpoint :
        `${credentials.pdsEndpoint}/`

    return new URL(`xrpc/${operation}`, base).href
}

function addOptional (
    body:Record<string, unknown>,
    key:string,
    value:unknown
):void {
    if (value !== undefined) body[key] = value
}

function bodyForPutRecord (
    credentials:OAuthCredentialRecord,
    input:PutRecordInput
):Record<string, unknown> {
    const body:Record<string, unknown> = {
        repo: input.repo ?? credentials.did,
        collection: input.collection,
        rkey: input.rkey,
        record: input.record
    }

    addOptional(body, 'validate', input.validate)
    addOptional(body, 'swapRecord', input.swapRecord)
    addOptional(body, 'swapCommit', input.swapCommit)

    return body
}

function bodyForCreateRecord (
    credentials:OAuthCredentialRecord,
    input:CreateRecordInput
):Record<string, unknown> {
    const body:Record<string, unknown> = {
        repo: input.repo ?? credentials.did,
        collection: input.collection,
        record: input.record
    }

    addOptional(body, 'rkey', input.rkey)
    addOptional(body, 'validate', input.validate)
    addOptional(body, 'swapCommit', input.swapCommit)

    return body
}

function bodyForDeleteRecord (
    credentials:OAuthCredentialRecord,
    input:DeleteRecordInput
):Record<string, unknown> {
    const body:Record<string, unknown> = {
        repo: input.repo ?? credentials.did,
        collection: input.collection,
        rkey: input.rkey
    }

    addOptional(body, 'swapRecord', input.swapRecord)
    addOptional(body, 'swapCommit', input.swapCommit)

    return body
}

function isRecord (value:unknown):value is Record<string, unknown> {
    return typeof value === 'object' && value !== null &&
        !Array.isArray(value)
}

async function readJsonObject (
    response:Response
):Promise<Record<string, unknown>> {
    try {
        const body = await response.json<unknown>()
        return isRecord(body) ? body : {}
    } catch {
        return {}
    }
}

function tokenType (credentials:OAuthCredentialRecord):string {
    return credentials.tokenType ?? 'DPoP'
}

async function createHeaders (
    credentials:OAuthCredentialRecord,
    url:string,
    nonce?:string
):Promise<Headers> {
    const accessTokenHash = await createAccessTokenHash(
        credentials.accessToken
    )
    const proof = await createDPoPProofJwt({
        privateKeyJwk: credentials.dpopPrivateKeyJwk,
        method: 'POST',
        url,
        accessTokenHash,
        nonce
    })

    return new Headers({
        authorization: `${tokenType(credentials)} ${credentials.accessToken}`,
        'content-type': 'application/json',
        DPoP: proof
    })
}

async function requestPdsWrite (
    credentials:OAuthCredentialRecord,
    request:WriteRequest,
    fetcher:typeof fetch,
    nonce?:string
):Promise<PdsAttemptResult> {
    const url = pdsUrl(credentials, request.operation)
    const response = await fetcher(url, {
        method: 'POST',
        headers: await createHeaders(credentials, url, nonce),
        body: JSON.stringify(request.body)
    })

    return {
        response,
        body: await readJsonObject(response)
    }
}

function responseError (attempt:PdsAttemptResult):string|undefined {
    return typeof attempt.body.error === 'string' ?
        attempt.body.error :
        undefined
}

function responseMessage (attempt:PdsAttemptResult):string|undefined {
    return typeof attempt.body.message === 'string' ?
        attempt.body.message :
        undefined
}

function isNonceChallenge (attempt:PdsAttemptResult):boolean {
    return !attempt.response.ok && (
        responseError(attempt) === 'use_dpop_nonce' ||
        attempt.response.headers.has('DPoP-Nonce')
    )
}

function isExpiredToken (attempt:PdsAttemptResult):boolean {
    const error = responseError(attempt)?.toLowerCase() ?? ''

    return error.includes('expired') || error === 'invalid_token'
}

function isAuthFailure (attempt:PdsAttemptResult):boolean {
    return attempt.response.status === 401 || isExpiredToken(attempt)
}

async function requestWithNonceRetry (
    credentials:OAuthCredentialRecord,
    request:WriteRequest,
    fetcher:typeof fetch
):Promise<PdsAttemptResult> {
    const attempt = await requestPdsWrite(credentials, request, fetcher)

    if (!isNonceChallenge(attempt)) return attempt

    const nonce = attempt.response.headers.get('DPoP-Nonce')
    if (!nonce) return attempt

    return await requestPdsWrite(credentials, request, fetcher, nonce)
}

function reportFailure (
    deps:PdsWriteClientDeps,
    request:WriteRequest,
    error:PdsWriteFailure,
    attempt?:PdsAttemptResult
):void {
    const reporter = deps.reportError ?? defaultReportError
    reporter(
        new Error(error.message),
        'atproto',
        {
            operation: request.operation,
            collection: request.collection,
            code: error.code,
            status: error.status,
            error: attempt ? responseError(attempt) : undefined,
            message: attempt ? responseMessage(attempt) : undefined
        }
    )
}

function reauthFailureFromRefresh (
    error:OAuthRefreshFailure
):PdsWriteFailure {
    return {
        code: 'reauth_required',
        status: error.status,
        message: error.message
    }
}

function reauthFailureFromAttempt (
    attempt:PdsAttemptResult
):PdsWriteFailure {
    return {
        code: 'reauth_required',
        status: attempt.response.status,
        message: responseMessage(attempt) ?? 'Reconnect your AT Protocol account'
    }
}

function writeFailureFromAttempt (
    attempt:PdsAttemptResult
):PdsWriteFailure {
    return {
        code: 'pds_write_failed',
        status: attempt.response.status,
        message: responseMessage(attempt) ?? 'AT Protocol PDS write failed'
    }
}

async function refreshCredentials (
    credentials:OAuthCredentialRecord,
    deps:PdsWriteClientDeps,
    fetcher:typeof fetch
):Promise<
    | { ok:true; credentials:OAuthCredentialRecord }
    | { ok:false; error:PdsWriteFailure }
> {
    const result = await refreshOAuthCredentials(credentials, {
        fetch: fetcher,
        now: deps.now,
        persistCredentials: deps.persistCredentials
    })

    if (result.ok) {
        return {
            ok: true,
            credentials: result.credentials
        }
    }

    return {
        ok: false,
        error: reauthFailureFromRefresh(result.error)
    }
}

async function writeRecord (
    credentials:OAuthCredentialRecord,
    request:WriteRequest,
    deps:PdsWriteClientDeps
):Promise<PdsWriteResult> {
    const fetcher = deps.fetch ?? fetch
    let activeCredentials = credentials
    let attempt = await requestWithNonceRetry(
        activeCredentials,
        request,
        fetcher
    )

    if (attempt.response.ok) {
        return {
            ok: true,
            credentials: activeCredentials,
            body: attempt.body
        }
    }

    if (isAuthFailure(attempt)) {
        const refresh = await refreshCredentials(
            activeCredentials,
            deps,
            fetcher
        )

        if (!refresh.ok) {
            reportFailure(deps, request, refresh.error, attempt)
            return {
                ok: false,
                credentials: activeCredentials,
                error: refresh.error
            }
        }

        activeCredentials = refresh.credentials
        attempt = await requestWithNonceRetry(
            activeCredentials,
            request,
            fetcher
        )

        if (attempt.response.ok) {
            return {
                ok: true,
                credentials: activeCredentials,
                body: attempt.body
            }
        }
    }

    const error = isAuthFailure(attempt) ?
        reauthFailureFromAttempt(attempt) :
        writeFailureFromAttempt(attempt)

    reportFailure(deps, request, error, attempt)

    return {
        ok: false,
        credentials: activeCredentials,
        error
    }
}

export async function putRecord (
    credentials:OAuthCredentialRecord,
    input:PutRecordInput,
    deps:PdsWriteClientDeps
):Promise<PdsWriteResult> {
    return await writeRecord(credentials, {
        operation: 'com.atproto.repo.putRecord',
        collection: input.collection,
        body: bodyForPutRecord(credentials, input)
    }, deps)
}

export async function createRecord (
    credentials:OAuthCredentialRecord,
    input:CreateRecordInput,
    deps:PdsWriteClientDeps
):Promise<PdsWriteResult> {
    return await writeRecord(credentials, {
        operation: 'com.atproto.repo.createRecord',
        collection: input.collection,
        body: bodyForCreateRecord(credentials, input)
    }, deps)
}

export async function deleteRecord (
    credentials:OAuthCredentialRecord,
    input:DeleteRecordInput,
    deps:PdsWriteClientDeps
):Promise<PdsWriteResult> {
    return await writeRecord(credentials, {
        operation: 'com.atproto.repo.deleteRecord',
        collection: input.collection,
        body: bodyForDeleteRecord(credentials, input)
    }, deps)
}
