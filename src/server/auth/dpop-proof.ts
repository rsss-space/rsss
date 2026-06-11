export interface CreateDPoPProofJwtOptions {
    privateKeyJwk:JsonWebKey
    method:string
    url:string
    accessTokenHash?:string
    nonce?:string
}

function base64UrlEncode (buffer:Uint8Array):string {
    const base64 = btoa(String.fromCharCode(...buffer))

    return base64
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

async function sha256Base64Url (value:string):Promise<string> {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(value)
    )

    return base64UrlEncode(new Uint8Array(digest))
}

function createJti ():string {
    return crypto.randomUUID()
}

function publicJwkFromPrivate (privateKeyJwk:JsonWebKey):JsonWebKey {
    return {
        kty: privateKeyJwk.kty,
        crv: privateKeyJwk.crv,
        x: privateKeyJwk.x,
        y: privateKeyJwk.y
    }
}

function normalizeHtu (url:string):string {
    const parsed = new URL(url)
    parsed.search = ''
    parsed.hash = ''

    return parsed.href
}

export async function createAccessTokenHash (
    accessToken:string
):Promise<string> {
    return await sha256Base64Url(accessToken)
}

export async function createDPoPProofJwt (
    options:CreateDPoPProofJwtOptions
):Promise<string> {
    const publicJwk = publicJwkFromPrivate(options.privateKeyJwk)
    const privateKey = await crypto.subtle.importKey(
        'jwk',
        options.privateKeyJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    )
    const header = {
        typ: 'dpop+jwt',
        alg: 'ES256',
        jwk: publicJwk
    }
    const payload:Record<string, number | string> = {
        jti: createJti(),
        htm: options.method.toUpperCase(),
        htu: normalizeHtu(options.url),
        iat: Math.floor(Date.now() / 1000)
    }

    if (options.accessTokenHash) {
        payload.ath = options.accessTokenHash
    }

    if (options.nonce) {
        payload.nonce = options.nonce
    }

    const encoder = new TextEncoder()
    const headerB64 = base64UrlEncode(
        encoder.encode(JSON.stringify(header))
    )
    const payloadB64 = base64UrlEncode(
        encoder.encode(JSON.stringify(payload))
    )
    const signingInput = `${headerB64}.${payloadB64}`
    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        privateKey,
        encoder.encode(signingInput)
    )

    return [
        headerB64,
        payloadB64,
        base64UrlEncode(new Uint8Array(signature))
    ].join('.')
}
