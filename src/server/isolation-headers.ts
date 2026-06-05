const COOP = 'Cross-Origin-Opener-Policy'
const COEP = 'Cross-Origin-Embedder-Policy'

export function withIsolationHeaders (response:Response):Response {
    // WebSocket upgrades (status 101) and other non-body responses carry
    // status codes the Response constructor rejects (it allows only
    // 200-599). Reconstructing a 101 also drops the attached `webSocket`,
    // breaking the upgrade. Leave any such response untouched -- COOP/COEP
    // are meaningless on it anyway.
    if (response.status < 200 || response.status > 599) {
        return response
    }

    const ct = response.headers.get('content-type') ?? ''
    if (
        !ct.includes('text/html') &&
        !ct.includes('javascript') &&
        ct !== ''
    ) {
        return response
    }

    const next = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    })

    next.headers.set(COOP, 'same-origin')
    // `credentialless` keeps cross-origin isolation while allowing embeds.
    // Browser cross-origin image subresource requests omit auth cookies.
    next.headers.set(COEP, 'credentialless')

    return next
}
