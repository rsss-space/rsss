import { test } from '@substrate-system/tapzero'
import {
    createAccessTokenHash,
    createDPoPProofJwt
} from '../src/server/auth/dpop-proof.js'
import { generateDPoPKeyPair } from '../src/server/auth/oauth.js'

interface JwtHeader {
    typ:string
    alg:string
    jwk:JsonWebKey
}

interface JwtPayload {
    htm:string
    htu:string
    jti:string
    iat:number
    ath?:string
    nonce?:string
}

function base64UrlDecode (value:string):Uint8Array<ArrayBuffer> {
    const padded = value + '='.repeat((4 - value.length % 4) % 4)
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }

    return bytes
}

function decodeJson<T> (value:string):T {
    return JSON.parse(
        new TextDecoder().decode(base64UrlDecode(value))
    ) as T
}

test('DPoP proof signs persisted JWK and carries request claims',
    async t => {
        const keyPair = await generateDPoPKeyPair()
        const privateJwk = await crypto.subtle.exportKey(
            'jwk',
            keyPair.privateKey
        )
        const ath = await createAccessTokenHash('access-token')
        const before = Math.floor(Date.now() / 1000)

        const jwt = await createDPoPProofJwt({
            privateKeyJwk: privateJwk,
            method: 'post',
            url: 'https://pds.example/xrpc/com.atproto.repo.putRecord' +
                '?ignored=true#frag',
            accessTokenHash: ath,
            nonce: 'nonce-123'
        })

        const parts = jwt.split('.')
        t.equal(parts.length, 3, 'JWT has three segments')
        const [headerPart, payloadPart, signaturePart] = parts
        if (!headerPart || !payloadPart || !signaturePart) return

        const header = decodeJson<JwtHeader>(headerPart)
        const payload = decodeJson<JwtPayload>(payloadPart)
        const after = Math.floor(Date.now() / 1000)

        t.equal(header.typ, 'dpop+jwt')
        t.equal(header.alg, 'ES256')
        t.equal(header.jwk.kty, 'EC')
        t.equal(header.jwk.crv, 'P-256')
        t.equal(typeof header.jwk.x, 'string')
        t.equal(typeof header.jwk.y, 'string')
        t.equal('d' in header.jwk, false)

        t.equal(payload.htm, 'POST')
        t.equal(
            payload.htu,
            'https://pds.example/xrpc/com.atproto.repo.putRecord'
        )
        t.equal(payload.ath, ath)
        t.equal(payload.nonce, 'nonce-123')
        t.equal(typeof payload.jti, 'string')
        t.equal(payload.jti.length > 0, true)
        t.equal(payload.iat >= before, true)
        t.equal(payload.iat <= after, true)

        const publicKey = await crypto.subtle.importKey(
            'jwk',
            header.jwk,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
        )
        const signature = base64UrlDecode(signaturePart)
        const signed = new TextEncoder().encode(
            `${headerPart}.${payloadPart}`
        )
        const verified = await crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            publicKey,
            signature,
            signed
        )

        t.equal(verified, true, 'signature verifies with header public JWK')
    })

test('DPoP proof omits optional claims when not provided', async t => {
    const keyPair = await generateDPoPKeyPair()
    const privateJwk = await crypto.subtle.exportKey(
        'jwk',
        keyPair.privateKey
    )

    const jwt = await createDPoPProofJwt({
        privateKeyJwk: privateJwk,
        method: 'GET',
        url: 'https://pds.example/xrpc/app.bsky.actor.getProfile'
    })
    const payloadPart = jwt.split('.')[1]
    if (!payloadPart) return

    const payload = decodeJson<JwtPayload>(payloadPart)

    t.equal('ath' in payload, false)
    t.equal('nonce' in payload, false)
})
