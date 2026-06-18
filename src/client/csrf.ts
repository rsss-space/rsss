/**
 * Read the `csrf_token` cookie the server sets (non-httpOnly) and that
 * every state-changing request must echo back in the `X-CSRF-Token`
 * header to pass the server's CSRF check
 * (`rejectCrossOriginStateChanges` in `src/server/index.ts`).
 *
 * Shared by the ky api client (`state.ts`), the remote adapter, and the
 * local-first outbox drain (`db/push-sync.ts`) so all three attach the
 * token the same way.
 */
export function csrfToken ():string|undefined {
    return document.cookie.split(';')
        .map(part => part.trim())
        .find(part => part.startsWith('csrf_token='))
        ?.slice('csrf_token='.length)
}
