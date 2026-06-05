import { test } from '@substrate-system/tapzero'
import { withIsolationHeaders } from '../src/server/isolation-headers.js'

test('asset responses receive isolation headers without mutating immutable',
    async (t) => {
        let res:Response|null = null
        let err:unknown = null

        try {
            const fetched = await fetch('data:text/html,<html></html>')
            res = withIsolationHeaders(fetched)
        } catch (caught) {
            err = caught
        }

        t.equal(err, null, 'does not throw for immutable asset responses')
        t.equal(
            res?.headers.get('Cross-Origin-Opener-Policy'),
            'same-origin',
            'sets COOP header'
        )
        t.equal(
            res?.headers.get('Cross-Origin-Embedder-Policy'),
            'credentialless',
            'sets iframe-compatible COEP header'
        )
    }
)

test('image responses do not receive document isolation headers',
    async (t) => {
        const fetched = await fetch('data:image/png;base64,')
        const res = withIsolationHeaders(fetched)

        t.equal(
            res.headers.get('Cross-Origin-Embedder-Policy'),
            null,
            'image response is left to document credentialless policy'
        )
    }
)

test('websocket upgrade (status 101) passes through untouched',
    (t) => {
        // A real WebSocket upgrade response has status 101 and an empty
        // content-type. Reconstructing it with `new Response(body, {
        // status: 101 })` throws RangeError (codes must be 200-599) and
        // would drop the attached `webSocket`, so it must pass through.
        const upgrade = {
            status: 101,
            statusText: 'Switching Protocols',
            headers: new Headers(),
            body: null
        } as unknown as Response

        let err:unknown = null
        let res:Response|null = null
        try {
            res = withIsolationHeaders(upgrade)
        } catch (caught) {
            err = caught
        }

        t.equal(err, null, 'does not throw on a 101 upgrade response')
        t.equal(res, upgrade, 'returns the upgrade response unmodified')
        t.equal(
            res?.headers.get('Cross-Origin-Opener-Policy'),
            null,
            'does not add COOP to an upgrade response'
        )
    }
)
