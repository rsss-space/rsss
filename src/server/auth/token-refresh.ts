import { createDPoPProofJwt } from './dpop-proof.js'
import type { OAuthCredentialRecord } from './oauth.js'

export interface OAuthRefreshFailure {
    code:'reauth_required'
    status?:number
    message:string
}

export type OAuthRefreshResult =
    | { ok:true; credentials:OAuthCredentialRecord }
    | { ok:false; error:OAuthRefreshFailure }

export interface RefreshOAuthCredentialsDeps {
    fetch?:typeof fetch
    now?:()=> number
    persistCredentials:(credentials:OAuthCredentialRecord)=> Promise<void>
}

interface TokenResponseBody {
    access_token?:unknown
    refresh_token?:unknown
    token_type?:unknown
    expires_in?:unknown
    error?:unknown
}

interface TokenAttemptResult {
    response:Response
    body:TokenResponseBody
}

const REAUTH_REQUIRED:OAuthRefreshFailure['code'] = 'reauth_required'

function createReauthFailure (
    status:number | undefined,
    message:string
):OAuthRefreshResult {
    return {
        ok: false,
        error: {
            code: REAUTH_REQUIRED,
            status,
            message
        }
    }
}

async function readTokenBody (response:Response):Promise<TokenResponseBody> {
    try {
        return await response.json<TokenResponseBody>()
    } catch {
        return {}
    }
}

function createRefreshBody (refreshToken:string):URLSearchParams {
    const body = new URLSearchParams()
    body.set('grant_type', 'refresh_token')
    body.set('refresh_token', refreshToken)

    return body
}

function isNonceChallenge (
    result:TokenAttemptResult
):boolean {
    return !result.response.ok && result.body.error === 'use_dpop_nonce'
}

async function requestRefreshToken (
    credentials:OAuthCredentialRecord,
    fetcher:typeof fetch,
    nonce?:string
):Promise<TokenAttemptResult> {
    const proof = await createDPoPProofJwt({
        privateKeyJwk: credentials.dpopPrivateKeyJwk,
        method: 'POST',
        url: credentials.tokenEndpoint,
        nonce
    })
    const response = await fetcher(credentials.tokenEndpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            DPoP: proof
        },
        body: createRefreshBody(credentials.refreshToken)
    })

    return {
        response,
        body: await readTokenBody(response)
    }
}

function createRotatedCredentials (
    credentials:OAuthCredentialRecord,
    body:TokenResponseBody,
    now:number
):OAuthCredentialRecord | null {
    if (typeof body.access_token !== 'string') return null
    if (typeof body.refresh_token !== 'string') return null

    const rotated:OAuthCredentialRecord = {
        ...credentials,
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        updatedAt: new Date(now).toISOString()
    }

    if (typeof body.token_type === 'string') {
        rotated.tokenType = body.token_type
    }

    if (
        typeof body.expires_in === 'number' &&
        Number.isFinite(body.expires_in)
    ) {
        rotated.accessTokenExpiresAt = now + body.expires_in * 1000
    }

    return rotated
}

export async function refreshOAuthCredentials (
    credentials:OAuthCredentialRecord,
    deps:RefreshOAuthCredentialsDeps
):Promise<OAuthRefreshResult> {
    const fetcher = deps.fetch ?? fetch
    const now = deps.now ?? Date.now
    let attempt = await requestRefreshToken(credentials, fetcher)

    if (isNonceChallenge(attempt)) {
        const nonce = attempt.response.headers.get('DPoP-Nonce')
        if (!nonce) {
            return createReauthFailure(
                attempt.response.status,
                'Authorization server requested DPoP nonce without header'
            )
        }

        attempt = await requestRefreshToken(credentials, fetcher, nonce)
    }

    if (!attempt.response.ok) {
        return createReauthFailure(
            attempt.response.status,
            'OAuth token refresh failed'
        )
    }

    const rotated = createRotatedCredentials(
        credentials,
        attempt.body,
        now()
    )
    if (!rotated) {
        return createReauthFailure(
            attempt.response.status,
            'OAuth token refresh response was incomplete'
        )
    }

    await deps.persistCredentials(rotated)

    return {
        ok: true,
        credentials: rotated
    }
}
