import * as Sentry from '@sentry/cloudflare'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import {
    startOAuthFlow,
    exchangeCode,
    createSessionCookie,
    verifySessionCookie,
    destroySessionCookie,
    AT_PROTOCOL_OAUTH_SCOPE,
    type OAuthSession,
    type OAuthState
} from './auth/oauth.js'
import {
    RsssUserDO as RsssUserDOBase,
    type Env as RsssUserDOEnv
} from './durable-objects/index.js'
import { withIsolationHeaders } from './isolation-headers.js'
import {
    BILLING_PLAN_IDS,
    isValidPlanId,
    useLive as billingUseLive,
    getOrCreateCustomer,
    attachCheckout,
    verifySubscription,
    getCustomerPortalUrl,
    getCurrentPeriodEnd,
    getSubscriptionSnapshot,
    cancelSubscription,
    resumeSubscription,
    type BillingPlanId
} from './autumn-billing.js'
import {
    getStripePublishableKey,
    stripeUseLive,
    getStripe,
    getStripeCustomerId,
    isStripeNotFoundError
} from './stripe-billing.js'
import type Stripe from 'stripe'
import {
    sendSubscriptionStarted,
    sendPaymentFailed,
    sendAccountDeletionScheduled
} from './email.js'
import { handleBlurhashQueueBatch } from './blurhash-consumer.js'
import { handleLazyHtmlRequest } from './lazy-html-handler.js'
import { shouldSkipLazyHtml } from './lazy-html.js'
import { buildSentryOptions } from './sentry-options.js'
import { reportError } from './lib/report-error.js'
import {
    createRateLimitMiddleware
} from './middleware/rate-limit.js'
import type { Context, Next } from 'hono'
import type * as BlurhashRuntime from './blurhash-runtime.js'

export interface Env {
    USER_DO:DurableObjectNamespace<RsssUserDOBase>;
    SESSIONS:KVNamespace;
    BLURHASH_KV:KVNamespace;
    HTML_KV?:KVNamespace;
    BLURHASH_QUEUE:Queue;
    ARTICLE_FETCH_QUEUE:Queue;
    ASSETS:Fetcher;
    SESSION_SECRET:string;
    OAUTH_CLIENT_ID?:string;
    AUTUMN_SECRET_KEY?:string;
    AUTUMN_DISABLED?:string;
    STRIPE_SECRET_KEY?:string;
    STRIPE_PUBLISHABLE_KEY?:string;
    RESEND_API_KEY?:string;
    RESEND_DISABLED?:string;
    RESEND_FROM?:string;
    ADMIN_TOKEN?:string;
    APP_ORIGIN?:string;
    NODE_ENV:string;
    SENTRY_DSN?:string;
}

interface CachedBilling {
    planId:string;
    status:'active'|'scheduled'|'none';
    refreshedAt:number;
    currentPeriodEnd:number|null;
    canceledAt:number|null;
}

export interface PaymentMethodSummary {
    id:string;
    brand:string;
    last4:string;
    expMonth:number;
    expYear:number;
    isDefault:boolean;
}

export interface PaymentMethodsPayload {
    methods:PaymentMethodSummary[];
    defaultId:string|null;
}

const BILLING_CACHE_TTL_SECONDS = 600
const DEFAULT_PLAN_ID:BillingPlanId = 'local-first'

function billingCacheKey (did:string):string {
    return `billing:${did}`
}

function pendingEmailKey (did:string):string {
    return `billing_pending_email:${did}`
}

function contactEmailKey (did:string):string {
    return `billing_contact_email:${did}`
}

const PENDING_EMAIL_TTL_SECONDS = 60 * 60 * 24 * 2  // 2 days

async function stashPendingEmail (
    env:Env,
    did:string,
    email:string
):Promise<void> {
    await env.SESSIONS.put(
        pendingEmailKey(did),
        email,
        { expirationTtl: PENDING_EMAIL_TTL_SECONDS }
    )
}

async function stashContactEmail (
    env:Env,
    did:string,
    email:string
):Promise<void> {
    await env.SESSIONS.put(
        contactEmailKey(did),
        email,
        { expirationTtl: PENDING_EMAIL_TTL_SECONDS }
    )
}

async function readContactEmail (
    env:Env,
    did:string
):Promise<string|null> {
    return env.SESSIONS.get(contactEmailKey(did))
}

/**
 * Resolve the user's contact email for billing notifications.
 * Only Autumn-returned customer emails are eligible recipient
 * sources. Request-body email can be stashed for customer binding,
 * but it must not become a notification recipient.
 */
async function resolveContactEmail (
    env:Env,
    did:string
):Promise<string|null> {
    return readContactEmail(env, did)
}

function isProbablyEmail (s:unknown):s is string {
    return typeof s === 'string'
        && s.length > 3
        && s.length < 320
        && /.+@.+\..+/.test(s)
}

async function readCachedBilling (
    env:Env,
    did:string
):Promise<CachedBilling|null> {
    const raw = await env.SESSIONS.get(billingCacheKey(did))
    if (!raw) return null
    try {
        return JSON.parse(raw) as CachedBilling
    } catch {
        return null
    }
}

async function writeCachedBilling (
    env:Env,
    did:string,
    value:CachedBilling
):Promise<void> {
    await env.SESSIONS.put(
        billingCacheKey(did),
        JSON.stringify(value),
        { expirationTtl: BILLING_CACHE_TTL_SECONDS }
    )
}

function isEntitled (b:CachedBilling|null):boolean {
    if (!b) return false
    return b.status === 'active' || b.status === 'scheduled'
}

function canUseDevBillingShortcut (env:Env):boolean {
    return env.NODE_ENV === 'development' && !billingUseLive(env)
}

/**
 * Resolve current entitlement, refreshing from Autumn when there's
 * no cached value. Local dev (no Autumn key) treats the cached value
 * as authoritative -- /api/billing/checkout writes 'active' directly.
 */
async function resolveBilling (
    env:Env,
    did:string,
    planId:BillingPlanId = DEFAULT_PLAN_ID
):Promise<CachedBilling> {
    const cached = await readCachedBilling(env, did)
    if (cached) return cached

    if (!billingUseLive(env)) {
        const fresh:CachedBilling = {
            planId,
            status: 'none',
            refreshedAt: Date.now(),
            currentPeriodEnd: null,
            canceledAt: null
        }
        await writeCachedBilling(env, did, fresh)
        return fresh
    }

    const verified = await verifySubscription(env, did, planId)
    const snapshot = verified ?
        await getSubscriptionSnapshot(env, did, planId) :
        { currentPeriodEnd: null, canceledAt: null }
    const fresh:CachedBilling = {
        planId,
        status: verified ? verified.status : 'none',
        refreshedAt: Date.now(),
        currentPeriodEnd: snapshot.currentPeriodEnd,
        canceledAt: snapshot.canceledAt
    }
    await writeCachedBilling(env, did, fresh)
    return fresh
}

async function listPaymentMethodsPayload (
    env:Env,
    did:string
):Promise<PaymentMethodsPayload> {
    const stripe = getStripe(env)
    const customerId = await getStripeCustomerId(env, did)
    const [list, customer] = await Promise.all([
        stripe.paymentMethods.list({
            customer: customerId,
            type: 'card'
        }),
        stripe.customers.retrieve(customerId)
    ])
    const defaultId = customer.deleted ?
        null :
        normalizeDefaultId(
            (customer as Stripe.Customer)
                .invoice_settings?.default_payment_method
        )
    const methods:PaymentMethodSummary[] = list.data.map(pm => ({
        id: pm.id,
        brand: pm.card?.brand ?? 'unknown',
        last4: pm.card?.last4 ?? '????',
        expMonth: pm.card?.exp_month ?? 0,
        expYear: pm.card?.exp_year ?? 0,
        isDefault: pm.id === defaultId
    }))
    return { methods, defaultId }
}

function normalizeDefaultId (
    raw:string|Stripe.PaymentMethod|null|undefined
):string|null {
    if (!raw) return null
    if (typeof raw === 'string') return raw
    return raw.id
}

type Variables = {
    session:OAuthSession|null;
}

type AppContext = Context<{
    Bindings:Env;
    Variables:Variables;
}>

const STATE_CHANGING_METHODS = new Set([
    'DELETE',
    'PATCH',
    'POST',
    'PUT'
])

function productionConfigErrors (env:Env):string[] {
    const errors:string[] = []

    if (env.NODE_ENV === 'production' && !env.AUTUMN_SECRET_KEY) {
        errors.push('missing_autumn_secret')
    }

    if (!env.APP_ORIGIN) {
        errors.push('missing_app_origin')
    }

    return errors
}

function isLoopbackHostname (hostname:string):boolean {
    return hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '[::1]'
}

function shouldUseSecureSessionCookie (requestUrl:string):boolean {
    return !isLoopbackHostname(new URL(requestUrl).hostname)
}

function isStateChangingMethod (method:string):boolean {
    return STATE_CHANGING_METHODS.has(method)
}

function isCsrfExemptPath (path:string):boolean {
    return path === '/api/auth/login' ||
        path === '/api/auth/callback' ||
        path === '/api/auth/dev-login' ||
        path === '/api/auth/logout'
}

function generateCsrfToken ():string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const binary = String.fromCharCode(...bytes)
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

function setCsrfCookie (c:AppContext):void {
    setCookie(c, 'csrf_token', generateCsrfToken(), {
        httpOnly: false,
        secure: shouldUseSecureSessionCookie(c.req.url),
        sameSite: 'Lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60
    })
}

export function isAllowedRequestOrigin (
    origin:string,
    _requestUrl:string,
    appOrigin?:string
):boolean {
    return Boolean(appOrigin) && origin === appOrigin
}

export function isCrossOriginStateChange (
    method:string,
    requestUrl:string,
    origin:string|null|undefined,
    fetchSite:string|null|undefined,
    appOrigin?:string
):boolean {
    if (!isStateChangingMethod(method)) return false
    if (!origin && !fetchSite) return true
    if (origin && !isAllowedRequestOrigin(
        origin,
        requestUrl,
        appOrigin
    )) {
        return true
    }
    return fetchSite === 'cross-site'
        || (!origin && fetchSite === 'same-site')
}

export function hasValidCsrfToken (
    cookieHeader:string|null|undefined,
    headerToken:string|null|undefined
):boolean {
    const cookieToken = cookieHeader?.split(';')
        .map(part => part.trim())
        .find(part => part.startsWith('csrf_token='))
        ?.slice('csrf_token='.length)
    return Boolean(cookieToken && headerToken && cookieToken === headerToken)
}

function allowedCorsOrigin (
    origin:string,
    c:Context
):string|null {
    const appContext = c as AppContext
    if (!origin) return null
    const appOrigin = appContext.env.APP_ORIGIN
    return isAllowedRequestOrigin(origin, appContext.req.url, appOrigin) ?
        origin :
        null
}

const rejectCrossOriginStateChanges = async (
    c:AppContext,
    next:Next
) => {
    const origin = c.req.header('origin')
    const fetchSite = c.req.header('sec-fetch-site')
    const appOrigin = c.env.APP_ORIGIN
    const path = new URL(c.req.url).pathname

    if (
        !isCsrfExemptPath(path) &&
        isCrossOriginStateChange(
            c.req.method,
            c.req.url,
            origin,
            fetchSite,
            appOrigin
        )
    ) {
        return c.json({ error: 'Cross-origin request rejected' }, 403)
    }

    if (
        isStateChangingMethod(c.req.method) &&
        !isCsrfExemptPath(path) &&
        !hasValidCsrfToken(
            c.req.header('cookie'),
            c.req.header('x-csrf-token')
        )
    ) {
        return c.json({ error: 'CSRF token mismatch' }, 403)
    }

    await next()
}

const app = new Hono<{ Bindings:Env; Variables:Variables }>()

// Cross-origin isolation headers required for OPFS sync access handles
app.use('*', async (c, next) => {
    await next()
    c.res = withIsolationHeaders(c.res)
})

// CORS for API routes
app.use('/api/*', cors({
    origin: allowedCorsOrigin,
    credentials: true
}))

app.use('*', rejectCrossOriginStateChanges)

// Session middleware
app.use('*', async (c, next) => {
    const sessionCookie = getCookie(c, 'session')

    if (sessionCookie && c.env.SESSION_SECRET) {
        const session = await verifySessionCookie(
            sessionCookie,
            c.env.SESSION_SECRET,
            c.env.SESSIONS
        )
        c.set('session', session)
        if (!session) {
            deleteCookie(c, 'session', { path: '/' })
        }
    } else {
        c.set('session', null)
    }

    await next()
})

/**
 * Health check
 */
app.get('/api/health', (c) => {
    const configErrors = productionConfigErrors(c.env)

    if (configErrors.length > 0) {
        return c.json({
            status: 'error',
            service: 'rsss',
            error: configErrors[0],
            configErrors
        }, 500)
    }

    return c.json({ status: 'ok', service: 'rsss' })
})

/**
 * Resolve the OAuth client_id and redirect_uri for the current request.
 *
 * Production / any deployment with OAUTH_CLIENT_ID set: use the
 * metadata-document flow (client_id is a public HTTPS URL pointing
 * at /oauth/client-metadata.json).
 *
 * Localhost dev: use the AT Protocol "loopback client" pattern.
 * The spec requires client_id to be the literal string
 * `http://localhost` with optional `redirect_uri` and `scope` query
 * params (not a URL pointing to a metadata document), and the
 * redirect_uri must use 127.0.0.1 (or [::1]) -- not `localhost`.
 *
 * Visit the dev server at http://127.0.0.1:PORT so the session
 * cookie lives on the same origin as the OAuth redirect target.
 */
function resolveOAuthClient (
    requestUrl:string,
    envClientId?:string
):{ clientId:string; redirectUri:string } {
    const url = new URL(requestUrl)
    const isLoopback = isLoopbackHostname(url.hostname)

    if (envClientId || !isLoopback) {
        const baseUrl = url.origin
        return {
            clientId: envClientId ||
                `${baseUrl}/oauth/client-metadata.json`,
            redirectUri: `${baseUrl}/oauth/callback`
        }
    }

    const redirectUri = `http://127.0.0.1:${url.port}/oauth/callback`
    const params = new URLSearchParams({
        redirect_uri: redirectUri,
        scope: AT_PROTOCOL_OAUTH_SCOPE
    })
    return {
        clientId: `http://localhost?${params.toString()}`,
        redirectUri
    }
}

/**
 * OAuth client metadata (AT Protocol OAuth discovery)
 */
app.get('/oauth/client-metadata.json', (c) => {
    const baseUrl = new URL(c.req.url).origin

    return c.json({
        client_id: `${baseUrl}/oauth/client-metadata.json`,
        client_name: 'rsss',
        client_uri: baseUrl,
        logo_uri: `${baseUrl}/logo.png`,
        tos_uri: `${baseUrl}/terms`,
        policy_uri: `${baseUrl}/privacy`,
        redirect_uris: [
            `${baseUrl}/oauth/callback`
        ],
        scope: AT_PROTOCOL_OAUTH_SCOPE,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'web',
        dpop_bound_access_tokens: true
    })
})

/**
 * Get current user info
 */
app.get('/api/me', (c) => {
    const session = c.get('session')

    if (!session) {
        return c.json({ authenticated: false }, 401)
    }

    return c.json({
        authenticated: true,
        did: session.did,
        handle: session.handle,
        avatar: session.avatar
    })
})

const authLoginIpRateLimit = createRateLimitMiddleware<Env, Variables>({
    bucketSize: 10,
    windowSeconds: 60,
    prefix: 'edge:auth-login-ip',
    key: (c) => {
        const ip = c.req.header('cf-connecting-ip')?.trim()
        return ip ? `ip:${ip}` : null
    }
})

async function authLoginHandleKey (c:Context<{
    Bindings:Env;
    Variables:Variables
}>):Promise<string|null> {
    try {
        const body = await c.req.raw.clone().json() as {
            handle?:unknown;
        }
        if (typeof body.handle !== 'string') return null

        const handle = body.handle.trim().toLowerCase()
        return handle ? `handle:${handle}` : null
    } catch {
        return null
    }
}

const authLoginHandleRateLimit = createRateLimitMiddleware<Env, Variables>({
    bucketSize: 10,
    windowSeconds: 60,
    prefix: 'edge:auth-login-handle',
    key: authLoginHandleKey
})

/**
 * Start OAuth login flow
 */
app.post(
    '/api/auth/login',
    authLoginIpRateLimit,
    authLoginHandleRateLimit,
    async (c) => {
        try {
            const body = await c.req.json<{ handle: string }>()

            if (!body.handle) {
                return c.json({ error: 'Handle is required' }, 400)
            }

            const { clientId, redirectUri } = resolveOAuthClient(
                c.req.url,
                c.env.OAUTH_CLIENT_ID
            )

            const { authUrl, state } = await startOAuthFlow(
                body.handle,
                clientId,
                redirectUri,
                '/'
            )

            // Store state in KV with 10 minute expiry
            const stateKey = `oauth:${state.nonce}`
            await c.env.SESSIONS.put(stateKey, JSON.stringify(state), {
                expirationTtl: 600
            })

            return c.json({ authUrl, state: state.nonce })
        } catch (err) {
            reportError(err, 'auth', {
                route: '/api/auth/login'
            })
            return c.json({
                error: err instanceof Error ?
                    err.message :
                    'Failed to start OAuth'
            }, 500)
        }
    }
)

/**
 * OAuth callback -- API endpoint.
 * The SPA handles the /oauth/callback route client-side
 * and POSTs the params here, because Cloudflare's
 * SPA fallback intercepts GET /oauth/callback before
 * the Worker runs.
 */
app.post('/api/auth/callback', async (c) => {
    // If already authenticated, no need to process
    // the callback again -- state is likely expired.
    const existing = c.get('session')
    if (existing) {
        return c.json({ success: true, returnTo: '/' })
    }

    const body = await c.req.json<{
        code?:string;
        state?:string;
        iss?:string;
        error?:string;
        error_description?:string;
    }>()

    if (body.error) {
        return c.json({
            error: body.error_description || body.error
        }, 400)
    }

    if (!body.code) {
        return c.json({
            error: 'No authorization code'
        }, 400)
    }

    const nonce = body.state || ''

    try {
        const stateKey = `oauth:${nonce}`
        const storedStateJson = await c.env.SESSIONS.get(
            stateKey
        )

        if (!storedStateJson) {
            reportError(
                new Error('OAuth state not found in KV'),
                'auth',
                { stateKey }
            )
            return c.json({
                error: 'Invalid or expired OAuth state'
                    + ' -- please try logging in again'
            }, 400)
        }

        const storedState = JSON.parse(
            storedStateJson
        ) as OAuthState

        if (!body.iss) {
            return c.json({
                error: 'Missing issuer'
            }, 400)
        }

        const { clientId, redirectUri } = resolveOAuthClient(
            c.req.url,
            c.env.OAUTH_CLIENT_ID
        )

        const session = await exchangeCode(
            body.code,
            storedState,
            clientId,
            redirectUri,
            body.iss
        )

        // Delete the used state
        await c.env.SESSIONS.delete(stateKey)

        // Track this user in KV for admin tools
        await c.env.SESSIONS.put(
            `user:${session.did}`,
            session.handle
        )

        // Create session cookie
        const sessionCookie = await createSessionCookie(
            session,
            c.env.SESSION_SECRET,
            c.env.SESSIONS
        )

        setCookie(c, 'session', sessionCookie, {
            httpOnly: true,
            secure: shouldUseSecureSessionCookie(c.req.url),
            sameSite: 'Lax',
            path: '/',
            maxAge: 30 * 24 * 60 * 60 // 30 days
        })
        setCsrfCookie(c)

        return c.json({
            success: true,
            returnTo: storedState.returnTo || '/'
        })
    } catch (err) {
        reportError(err, 'auth', {
            route: '/api/auth/callback'
        })
        return c.json({
            error: err instanceof Error ?
                err.message :
                'Authentication failed'
        }, 500)
    }
})

/**
 * Logout
 */
app.post('/api/auth/logout', async (c) => {
    const cookie = getCookie(c, 'session')
    if (cookie && c.env.SESSION_SECRET) {
        await destroySessionCookie(
            cookie,
            c.env.SESSION_SECRET,
            c.env.SESSIONS
        )
    }
    deleteCookie(c, 'session', { path: '/' })
    deleteCookie(c, 'csrf_token', { path: '/' })
    return c.json({ success: true })
})

app.get('/logout', (c) => {
    return c.text('Method Not Allowed', 405)
})

const requireAuth = async (c:Context<{
    Bindings:Env;
    Variables:Variables
}>, next:Next) => {
    const session = c.get('session')

    if (!session) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    await next()
}

const didRateLimit = createRateLimitMiddleware<Env, Variables>({
    bucketSize: 30,
    windowSeconds: 60,
    prefix: 'edge:did',
    key: (c) => c.get('session')?.did ?? null
})

const requireEntitlement = async (c:Context<{
    Bindings:Env;
    Variables:Variables
}>, next:Next) => {
    const session = c.get('session')

    if (!session) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    try {
        const billing = await resolveBilling(c.env, session.did)
        if (!isEntitled(billing)) {
            return c.json({ error: 'Payment required' }, 402)
        }
    } catch (err) {
        reportError(err, 'billing', {
            operation: 'requireEntitlement'
        })
        return c.json({
            error: 'billing_unavailable'
        }, 503)
    }

    await next()
}

const adminRateLimit = createRateLimitMiddleware<Env, Variables>({
    bucketSize: 30,
    windowSeconds: 60,
    prefix: 'edge:admin',
    key: (c) => {
        const session = c.get('session')
        if (session) return session.did

        const header = c.req.header('authorization') || ''
        const match = header.match(/^Bearer\s+(.+)$/i)
        return match ? `admin:${match[1]}` : null
    }
})

/**
 * Constant-time comparison for admin token verification.
 * Avoids early exit on mismatch to prevent timing leaks.
 */
function timingSafeEqual (a:string, b:string):boolean {
    if (a.length !== b.length) return false
    let result = 0
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
}

/**
 * Require an admin bearer token. Reads from `ADMIN_TOKEN` secret;
 * if unset, all admin routes return 503 (closed by default).
 */
const requireAdmin = async (c:Context<{
    Bindings:Env;
    Variables:Variables
}>, next:Next) => {
    const expected = c.env.ADMIN_TOKEN
    if (!expected) {
        return c.json({
            error: 'admin_disabled'
        }, 503)
    }

    const header = c.req.header('authorization') || ''
    const match = header.match(/^Bearer\s+(.+)$/i)
    const provided = match ? match[1] : ''

    if (!provided || !timingSafeEqual(provided, expected)) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    await next()
}

/**
 * Get the user's Durable Object
 */
function getRsssUserDO (
    env:Env,
    did:string
):DurableObjectStub<RsssUserDOBase> {
    // Use the DID as the DO name for consistent routing
    const id = env.USER_DO.idFromName(did)
    return env.USER_DO.get(id)
}

/**
 * Development mode: mock authentication for testing.
 * Must be before the /api/* catch-all.
 */
app.post('/api/auth/dev-login', async (c) => {
    // Only allow in development mode
    if (c.env.NODE_ENV !== 'development') {
        return c.notFound()
    }

    if (!isLoopbackHostname(new URL(c.req.url).hostname)) {
        return c.json(
            { error: 'Not allowed on non-loopback host' },
            403
        )
    }

    if (!c.env.SESSION_SECRET) {
        return c.json(
            { error: 'SESSION_SECRET is not configured' },
            500
        )
    }

    const body = await c.req.json<{
        did?:string;
        handle?:string
    }>()

    const session:OAuthSession = {
        did: body.did || 'did:plc:test123',
        handle: body.handle || 'test.bsky.social'
    }

    const sessionCookie = await createSessionCookie(
        session, c.env.SESSION_SECRET, c.env.SESSIONS
    )

    // Track this user in KV for admin tools
    await c.env.SESSIONS.put(
        `user:${session.did}`,
        session.handle
    )

    setCookie(c, 'session', sessionCookie, {
        httpOnly: true,
        secure: shouldUseSecureSessionCookie(c.req.url),
        sameSite: 'Lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60
    })
    setCsrfCookie(c)

    return c.json({ success: true, session })
})

app.use('/api/billing/*', requireAuth, didRateLimit)

/**
 * Billing: get current entitlement.
 * Returns cached value if fresh; refreshes from Autumn on miss.
 */
app.get('/api/billing/status', requireAuth, async (c) => {
    const session = c.get('session')!
    try {
        const billing = await resolveBilling(c.env, session.did)
        const pendingDeletion = await readPendingDeletion(
            c.env,
            session.did
        )
        const contactEmail = await readContactEmail(
            c.env,
            session.did
        )
        return c.json({
            entitled: isEntitled(billing),
            planId: billing.planId,
            status: billing.status,
            refreshedAt: billing.refreshedAt,
            useLive: billingUseLive(c.env),
            pendingDeletion,
            currentPeriodEnd: billing.currentPeriodEnd,
            canceledAt: billing.canceledAt,
            contactEmail,
            stripePublishableKey: getStripePublishableKey(c.env)
        })
    } catch (err) {
        reportError(err, 'billing', {
            route: '/api/billing/status'
        })
        return c.json({
            error: 'billing_unavailable'
        }, 503)
    }
})

app.get(
    '/api/billing/payment-methods',
    requireAuth,
    async (c) => {
        const session = c.get('session')!
        if (!stripeUseLive(c.env)) {
            return c.json({ error: 'stripe_unconfigured' }, 503)
        }
        try {
            const payload = await listPaymentMethodsPayload(
                c.env,
                session.did
            )
            return c.json(payload)
        } catch (err) {
            reportError(err, 'billing', {
                route: '/api/billing/payment-methods'
            })
            return c.json({ error: 'stripe_error' }, 502)
        }
    }
)

app.delete(
    '/api/billing/payment-methods/:id',
    requireAuth,
    async (c) => {
        const session = c.get('session')!
        const id = c.req.param('id')
        if (!stripeUseLive(c.env)) {
            return c.json({ error: 'stripe_unconfigured' }, 503)
        }
        try {
            const stripe = getStripe(c.env)
            const customerId = await getStripeCustomerId(
                c.env,
                session.did
            )
            // Defense-in-depth: refuse to detach the current default.
            const customer = await stripe.customers.retrieve(customerId)
            if (customer.deleted) {
                return c.json({ error: 'stripe_error' }, 502)
            }
            const currentDefault = (
                customer as Stripe.Customer
            ).invoice_settings?.default_payment_method
            const defaultId = typeof currentDefault === 'string' ?
                currentDefault :
                currentDefault?.id ?? null
            if (defaultId === id) {
                return c.json({
                    error: 'cannot_remove_default'
                }, 409)
            }
            try {
                await stripe.paymentMethods.detach(id)
            } catch (err) {
                if (isStripeNotFoundError(err)) {
                    return c.json({
                        error: 'payment_method_not_found'
                    }, 404)
                }
                throw err
            }
            const payload = await listPaymentMethodsPayload(
                c.env,
                session.did
            )
            return c.json(payload)
        } catch (err) {
            reportError(err, 'billing', {
                route: '/api/billing/payment-methods/:id',
                method: 'DELETE'
            })
            return c.json({ error: 'stripe_error' }, 502)
        }
    }
)

app.post(
    '/api/billing/payment-methods/:id/default',
    requireAuth,
    async (c) => {
        const session = c.get('session')!
        const id = c.req.param('id')
        if (!stripeUseLive(c.env)) {
            return c.json({ error: 'stripe_unconfigured' }, 503)
        }
        const stripe = getStripe(c.env)
        let customerId:string
        try {
            customerId = await getStripeCustomerId(c.env, session.did)
        } catch (err) {
            reportError(err, 'billing', {
                route: '/api/billing/payment-methods/:id/default',
                step: 'getStripeCustomerId'
            })
            return c.json({ error: 'stripe_error' }, 502)
        }

        // Step 1: customer-level default.
        let customerDefaultUpdated = false
        try {
            await stripe.customers.update(customerId, {
                invoice_settings: { default_payment_method: id }
            })
            customerDefaultUpdated = true
        } catch (err) {
            if (isStripeNotFoundError(err)) {
                return c.json({
                    error: 'payment_method_not_found'
                }, 404)
            }
            reportError(err, 'billing', {
                route: '/api/billing/payment-methods/:id/default',
                step: 'customers.update'
            })
            return c.json({ error: 'stripe_error' }, 502)
        }

        // Step 2: subscription-level default (best-effort).
        let subscriptionDefaultUpdated = false
        try {
            const subs = await stripe.subscriptions.list({
                customer: customerId,
                status: 'active',
                limit: 1
            })
            const sub = subs.data[0]
            if (sub) {
                await stripe.subscriptions.update(sub.id, {
                    default_payment_method: id
                })
                subscriptionDefaultUpdated = true
            } else {
                // No active subscription — nothing to update at the
                // subscription level. Treat as success.
                subscriptionDefaultUpdated = true
            }
        } catch (err) {
            reportError(err, 'billing', {
                route: '/api/billing/payment-methods/:id/default',
                step: 'subscriptions.update'
            })
            // Partial failure: customer updated, subscription not.
            // Return 502 with both states so the client can render
            // a precise inline banner.
            let payload
            try {
                payload = await listPaymentMethodsPayload(
                    c.env,
                    session.did
                )
            } catch (payloadErr) {
                reportError(payloadErr, 'billing', {
                    route: '/api/billing/payment-methods/:id/default',
                    step: 'listPaymentMethodsPayload.partial'
                })
                // If we can't refresh the list in a partial-failure
                // scenario, return 502 with the states we know,
                // omitting the methods list.
                return c.json({
                    error: 'stripe_error',
                    customerDefaultUpdated,
                    subscriptionDefaultUpdated,
                    methods: [],
                    defaultId: null
                }, 502)
            }
            return c.json({
                error: 'stripe_error',
                customerDefaultUpdated,
                subscriptionDefaultUpdated,
                methods: payload.methods,
                defaultId: payload.defaultId
            }, 502)
        }

        // Both succeeded: return canonical refreshed list.
        let payload
        try {
            payload = await listPaymentMethodsPayload(
                c.env,
                session.did
            )
        } catch (err) {
            reportError(err, 'billing', {
                route: '/api/billing/payment-methods/:id/default',
                step: 'listPaymentMethodsPayload.success'
            })
            // After customer + subscription updates succeeded,
            // if we can't fetch the canonical list, return 502.
            // Client will refetch on next render.
            return c.json({ error: 'stripe_error' }, 502)
        }
        return c.json(payload)
    }
)

async function readPendingDeletion (
    env:Env,
    did:string
):Promise<{ scheduledFor:number }|null> {
    try {
        const stub = getRsssUserDO(env, did)
        const res = await stub.fetch(
            new Request(
                'http://do/internal/account/deletion',
                { method: 'GET' }
            )
        )
        if (!res.ok) return null
        const body = await res.json() as {
            pendingDeletion?:{ scheduledFor:number }|null
        }
        return body.pendingDeletion ?? null
    } catch (err) {
        reportError(err, 'account', {
            operation: 'readPendingDeletion'
        })
        return null
    }
}

/**
 * Schedule deletion of the authenticated user's account.
 * For active subscriptions, deletion is scheduled for the end of
 * the current billing period. Otherwise (free tier or no live
 * billing), deletion runs immediately.
 */
app.post('/api/account/delete', requireAuth, async (c) => {
    const session = c.get('session')!

    let scheduledFor = Date.now()
    if (billingUseLive(c.env)) {
        try {
            const periodEnd = await getCurrentPeriodEnd(
                c.env,
                session.did
            )
            if (periodEnd && periodEnd > Date.now()) {
                scheduledFor = periodEnd
            }
        } catch (err) {
            reportError(err, 'billing', {
                operation: 'getCurrentPeriodEnd'
            })
        }
    }

    const stub = getRsssUserDO(c.env, session.did)
    const res = await stub.fetch(
        new Request(
            'http://do/internal/account/deletion',
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    scheduledFor,
                    did: session.did
                })
            }
        )
    )
    if (!res.ok) {
        reportError(
            new Error('account/delete: DO returned non-ok status'),
            'account',
            { status: res.status }
        )
        return c.json({
            error: 'deletion_unavailable'
        }, 503)
    }

    // Send confirmation email best-effort. Use the contact email
    // we recorded during checkout, if any.
    try {
        const to = await readContactEmail(c.env, session.did)
        if (to) {
            const baseUrl = new URL(c.req.url).origin
            await sendAccountDeletionScheduled(
                c.env,
                c.env.SESSIONS,
                {
                    to,
                    did: session.did,
                    handle: session.handle,
                    scheduledFor,
                    baseUrl
                },
                c.executionCtx
            )
        }
    } catch (err) {
        reportError(err, 'email', {
            route: '/api/account/delete'
        })
    }

    return c.json({ scheduledFor })
})

/**
 * Cancel a pending account deletion.
 */
app.delete('/api/account/delete', requireAuth, async (c) => {
    const session = c.get('session')!
    const stub = getRsssUserDO(c.env, session.did)
    const res = await stub.fetch(
        new Request(
            'http://do/internal/account/deletion',
            { method: 'DELETE' }
        )
    )
    if (!res.ok) {
        return c.json({
            error: 'cancellation_failed'
        }, 503)
    }
    return c.json({ ok: true })
})

/**
 * Billing: start checkout for a plan.
 * In live mode, returns an Autumn-hosted checkout URL.
 * In dev mode (no Autumn key), marks the user entitled directly
 * so the rest of the flow can be exercised without a real card.
 */
app.post('/api/billing/checkout', requireAuth, async (c) => {
    const session = c.get('session')!
    const body = await c.req.json<{
        planId?:string
        email?:string
    }>().catch(() => ({
        planId: undefined,
        email: undefined
    }))

    const planId = body.planId ?? DEFAULT_PLAN_ID
    if (!isValidPlanId(planId)) {
        return c.json({
            error: 'invalid_plan_id',
            allowed: BILLING_PLAN_IDS
        }, 400)
    }

    const email = isProbablyEmail(body.email) ? body.email : null
    if (email) {
        await stashPendingEmail(c.env, session.did, email)
    }

    // Dev mode: no Autumn -- mark entitled directly. Triggering
    // the success email here exercises the full Resend path
    // without a real card.
    if (!billingUseLive(c.env)) {
        if (!canUseDevBillingShortcut(c.env)) {
            return c.json({
                error: 'billing_unavailable'
            }, 503)
        }

        const billing:CachedBilling = {
            planId,
            status: 'active',
            refreshedAt: Date.now(),
            currentPeriodEnd: null,
            canceledAt: null
        }
        await writeCachedBilling(c.env, session.did, billing)

        const to = await resolveContactEmail(c.env, session.did)
        if (to) {
            try {
                const baseUrl = new URL(c.req.url).origin
                await sendSubscriptionStarted(
                    c.env,
                    c.env.SESSIONS,
                    {
                        to,
                        did: session.did,
                        planId,
                        baseUrl,
                        handle: session.handle
                    }
                )
            } catch (err) {
                reportError(err, 'email', {
                    route: '/api/billing/checkout',
                    mode: 'dev'
                })
            }
        }

        return c.json({
            paymentUrl: null,
            status: 'entitled',
            planId
        })
    }

    try {
        const customer = await getOrCreateCustomer(
            c.env,
            session.did,
            session.handle,
            email ?? undefined
        )
        if (customer.email) {
            await stashContactEmail(
                c.env,
                session.did,
                customer.email
            )
        }
        const baseUrl = new URL(c.req.url).origin
        const successUrl =
            `${baseUrl}/payment-success?checkout=return`
        const { paymentUrl } = await attachCheckout(
            c.env,
            session.did,
            planId,
            successUrl
        )
        return c.json({
            paymentUrl,
            status: 'payment_pending',
            planId
        })
    } catch (err) {
        reportError(err, 'billing', {
            route: '/api/billing/checkout'
        })
        return c.json({
            error: 'billing_unavailable'
        }, 503)
    }
})

/**
 * Billing: finalize checkout after Autumn redirect.
 * Re-fetches the customer and asserts an active subscription.
 * Caches the entitlement on success.
 */
app.post(
    '/api/billing/checkout/return',
    requireAuth,
    async (c) => {
        const session = c.get('session')!
        const body = await c.req.json<{
            planId?:string
        }>().catch(() => ({ planId: undefined }))

        const planId = body.planId ?? DEFAULT_PLAN_ID
        if (!isValidPlanId(planId)) {
            return c.json({
                error: 'invalid_plan_id'
            }, 400)
        }

        // Dev mode: there is no Autumn round-trip, just confirm
        // whatever's already cached.
        if (!billingUseLive(c.env)) {
            if (!canUseDevBillingShortcut(c.env)) {
                return c.json({
                    error: 'billing_unavailable'
                }, 503)
            }

            const cached = await readCachedBilling(
                c.env,
                session.did
            )
            if (cached && isEntitled(cached)) {
                return c.json({
                    status: 'entitled',
                    planId: cached.planId
                })
            }
            return c.json({
                error: 'payment_incomplete'
            }, 402)
        }

        try {
            const verified = await verifySubscription(
                c.env,
                session.did,
                planId
            )
            if (!verified) {
                return c.json({
                    error: 'payment_incomplete'
                }, 402)
            }
            const snapshot = await getSubscriptionSnapshot(
                c.env,
                session.did,
                planId
            )
            const billing:CachedBilling = {
                planId: verified.planId,
                status: verified.status,
                refreshedAt: Date.now(),
                currentPeriodEnd: snapshot.currentPeriodEnd,
                canceledAt: snapshot.canceledAt
            }
            await writeCachedBilling(
                c.env,
                session.did,
                billing
            )

            // Best-effort welcome email; failures shouldn't block
            // the entitlement response.
            try {
                const to = await resolveContactEmail(
                    c.env,
                    session.did
                )
                if (to) {
                    const baseUrl = new URL(c.req.url).origin
                    await sendSubscriptionStarted(
                        c.env,
                        c.env.SESSIONS,
                        {
                            to,
                            did: session.did,
                            planId: verified.planId,
                            baseUrl,
                            handle: session.handle
                        },
                        c.executionCtx
                    )
                }
            } catch (err) {
                reportError(err, 'email', {
                    route: '/api/billing/checkout/return'
                })
            }

            return c.json({
                status: 'entitled',
                planId: verified.planId
            })
        } catch (err) {
            reportError(err, 'billing', {
                route: '/api/billing/checkout/return'
            })
            return c.json({
                error: 'billing_unavailable'
            }, 503)
        }
    }
)

/**
 * Billing: client-driven failure signal. Called by the
 * /payment-success page after finalizeCheckout retries are
 * exhausted without confirming a subscription. Sends the
 * "payment didn't go through" email (idempotently).
 */
app.post(
    '/api/billing/checkout/failed',
    requireAuth,
    async (c) => {
        const session = c.get('session')!
        const body = await c.req.json<{
            planId?:string
            email?:string
        }>().catch(() => ({
            planId: undefined,
            email: undefined
        }))

        const planId = body.planId ?? DEFAULT_PLAN_ID
        if (!isValidPlanId(planId)) {
            return c.json({
                error: 'invalid_plan_id'
            }, 400)
        }

        // Stash the email in case the client supplied a fresh one.
        if (isProbablyEmail(body.email)) {
            await stashPendingEmail(
                c.env,
                session.did,
                body.email
            )
        }

        let to:string|null = null
        try {
            to = await resolveContactEmail(c.env, session.did)
        } catch (err) {
            reportError(err, 'email', {
                route: '/api/billing/checkout/failed',
                step: 'resolveContactEmail'
            })
        }

        if (!to) {
            return c.json({
                emailed: false,
                reason: 'no_contact_email'
            })
        }

        try {
            const baseUrl = new URL(c.req.url).origin
            const result = await sendPaymentFailed(
                c.env,
                c.env.SESSIONS,
                {
                    to,
                    did: session.did,
                    planId,
                    handle: session.handle,
                    signupUrl: `${baseUrl}/signup`
                },
                c.executionCtx
            )
            return c.json({
                emailed: result.sent,
                deduped: result.deduped
            })
        } catch (err) {
            reportError(err, 'email', {
                route: '/api/billing/checkout/failed',
                step: 'sendPaymentFailed'
            })
            return c.json({
                error: 'email_failed'
            }, 503)
        }
    }
)

/**
 * Billing: open the Autumn-hosted customer portal.
 * Used for cancelling, updating payment method, etc.
 */
app.post('/api/billing/portal', requireAuth, async (c) => {
    const session = c.get('session')!

    if (!billingUseLive(c.env)) {
        return c.json({
            error: 'portal_unavailable_in_dev'
        }, 503)
    }

    try {
        const baseUrl = new URL(c.req.url).origin
        const url = await getCustomerPortalUrl(
            c.env,
            session.did,
            `${baseUrl}/settings`
        )
        return c.json({ url })
    } catch (err) {
        reportError(err, 'billing', {
            route: '/api/billing/portal'
        })
        return c.json({
            error: 'billing_unavailable'
        }, 503)
    }
})

/**
 * Schedule cancellation of the user's subscription at the end of
 * the current billing period. In dev mode (no Autumn key) we
 * mutate the cached billing entry directly so the client UI can
 * be exercised without Autumn.
 */
app.post('/api/billing/cancel', requireAuth, async (c) => {
    const session = c.get('session')!
    const planId:BillingPlanId = DEFAULT_PLAN_ID

    if (!billingUseLive(c.env)) {
        const cached = await readCachedBilling(
            c.env,
            session.did
        )
        if (!cached || !isEntitled(cached)) {
            return c.json({
                error: 'no_active_subscription'
            }, 409)
        }
        const now = Date.now()
        // 30-day synthetic period so the UI has a date to show.
        const periodEnd = now + 30 * 24 * 60 * 60 * 1000
        const updated:CachedBilling = {
            ...cached,
            canceledAt: now,
            currentPeriodEnd: cached.currentPeriodEnd ?? periodEnd
        }
        await writeCachedBilling(c.env, session.did, updated)
        return c.json({
            ok: true,
            canceledAt: updated.canceledAt,
            currentPeriodEnd: updated.currentPeriodEnd
        })
    }

    try {
        const cached = await readCachedBilling(
            c.env,
            session.did
        )
        if (!cached || !isEntitled(cached)) {
            return c.json({
                error: 'no_active_subscription'
            }, 409)
        }
        const snapshot = await cancelSubscription(
            c.env,
            session.did,
            planId
        )
        const updated:CachedBilling = {
            planId,
            status: cached.status,
            refreshedAt: Date.now(),
            currentPeriodEnd: snapshot.currentPeriodEnd,
            canceledAt: snapshot.canceledAt ?? Date.now()
        }
        await writeCachedBilling(c.env, session.did, updated)
        return c.json({
            ok: true,
            canceledAt: updated.canceledAt,
            currentPeriodEnd: updated.currentPeriodEnd
        })
    } catch (err) {
        reportError(err, 'billing', {
            route: '/api/billing/cancel'
        })
        return c.json({
            error: 'billing_unavailable'
        }, 503)
    }
})

/**
 * Reverse a scheduled cancellation.
 */
app.post('/api/billing/resume', requireAuth, async (c) => {
    const session = c.get('session')!
    const planId:BillingPlanId = DEFAULT_PLAN_ID

    if (!billingUseLive(c.env)) {
        const cached = await readCachedBilling(
            c.env,
            session.did
        )
        if (!cached || !isEntitled(cached)) {
            return c.json({
                error: 'no_active_subscription'
            }, 409)
        }
        const updated:CachedBilling = {
            ...cached,
            canceledAt: null
        }
        await writeCachedBilling(c.env, session.did, updated)
        return c.json({ ok: true })
    }

    try {
        const cached = await readCachedBilling(c.env, session.did)
        if (!cached || !isEntitled(cached)) {
            return c.json({
                error: 'no_active_subscription'
            }, 409)
        }
        const snapshot = await resumeSubscription(
            c.env,
            session.did,
            planId
        )
        const updated:CachedBilling = {
            planId,
            status: cached.status,
            refreshedAt: Date.now(),
            currentPeriodEnd: snapshot.currentPeriodEnd,
            canceledAt: snapshot.canceledAt
        }
        await writeCachedBilling(c.env, session.did, updated)
        return c.json({ ok: true })
    } catch (err) {
        reportError(err, 'billing', {
            route: '/api/billing/resume'
        })
        return c.json({
            error: 'billing_unavailable'
        }, 503)
    }
})

/**
 * Create a Stripe SetupIntent-backed URL the user can visit to add
 * or update their payment method. Replaces the kitchen-sink
 * `openCustomerPortal` flow for in-app card updates.
 */
app.post(
    '/api/billing/payment-methods/setup-intent',
    requireAuth,
    async (c) => {
        const session = c.get('session')!
        if (!stripeUseLive(c.env)) {
            return c.json({ error: 'stripe_unconfigured' }, 503)
        }
        try {
            const stripe = getStripe(c.env)
            const customerId = await getStripeCustomerId(
                c.env,
                session.did
            )
            const intent = await stripe.setupIntents.create({
                customer: customerId,
                usage: 'off_session',
                automatic_payment_methods: { enabled: true }
            })
            return c.json({ clientSecret: intent.client_secret })
        } catch (err) {
            reportError(err, 'billing', {
                route: '/api/billing/payment-methods/setup-intent'
            })
            return c.json({ error: 'stripe_error' }, 502)
        }
    }
)

export const dataRouter = new Hono<{
    Bindings:Env;
    Variables:Variables
}>()

dataRouter.use('*', requireAuth)
dataRouter.use('/feeds/refresh', didRateLimit)
dataRouter.use('/feeds/:id/refresh', didRateLimit)
dataRouter.use('/items/:id/fetch-full', didRateLimit)

/**
 * Local-first sync infrastructure (`/api/sync`) is paid-only.
 * Server-first storage (feeds, items) is free; non-paying users
 * hit the user's Durable Object directly.
 */
dataRouter.use('/sync', requireEntitlement)
dataRouter.use('/sync/*', requireEntitlement)

export function isWebSocketUpgrade (headers:Headers):boolean {
    return headers.get('Upgrade')?.toLowerCase() === 'websocket'
}

function buildDoProxyHeaders (headers:Headers):Headers {
    const forwarded = new Headers()

    headers.forEach((value, name) => {
        const normalized = name.toLowerCase()

        if (
            normalized === 'content-type' ||
            normalized === 'cookie' ||
            normalized.startsWith('x-rsss-')
        ) {
            forwarded.set(name, value)
        }
    })

    return forwarded
}

/**
 * Proxy requests to user's Durable Object.
 * All data routes under /api go to the user's DO.
 */
dataRouter.all('*', async (c) => {
    const session = c.get('session')!
    const stub = getRsssUserDO(c.env, session.did)

    // WebSocket upgrades cannot go through buildDoProxyHeaders (it
    // strips Upgrade/Connection) and must return the DO's 101 response
    // verbatim so the attached `webSocket` survives. Forward the raw
    // request (preserving Sec-WebSocket-* and Cookie) with the /api
    // mount prefix stripped from the path.
    if (isWebSocketUpgrade(c.req.raw.headers)) {
        const url = new URL(c.req.url)
        const wsPath = url.pathname.replace(/^\/api/, '') || '/'
        const doUrl = new URL(wsPath, 'http://do')
        doUrl.search = url.search
        return stub.fetch(new Request(doUrl.toString(), c.req.raw))
    }

    // Build the request URL for the DO. The dataRouter is mounted at
    // /api via app.route, but Hono does not strip the mount prefix
    // from c.req.url, so we strip it here before forwarding.
    const url = new URL(c.req.url)
    const doPath = url.pathname.replace(/^\/api/, '') || '/'
    const doUrl = new URL(doPath, 'http://do')
    doUrl.search = url.search

    console.log(
        `[proxy] ${c.req.method} ${doPath}` +
        ` -> DO(${session.did})`
    )

    const proxyInit:RequestInit & { duplex?:'half' } = {
        method: c.req.method,
        headers: buildDoProxyHeaders(c.req.raw.headers)
    }
    if (c.req.raw.body) {
        proxyInit.body = c.req.raw.body
        proxyInit.duplex = 'half'
    }

    // Forward the request to the DO
    const response = await stub.fetch(
        new Request(doUrl.toString(), proxyInit)
    )

    console.log(
        `[proxy] DO responded ${response.status}`
    )

    return response
})

app.route('/api', dataRouter)

app.use('/admin/*', requireAdmin, adminRateLimit)

/**
 * Admin: list all tracked users.
 * Requires ADMIN_TOKEN bearer header.
 */
app.get('/admin/users', requireAdmin, async (c) => {
    const result = await c.env.SESSIONS.list({
        prefix: 'user:'
    })
    const users = await Promise.all(
        result.keys.map(async (key) => {
            const did = key.name.replace('user:', '')
            const handle = await c.env.SESSIONS.get(
                key.name
            )
            return { did, handle }
        })
    )
    return c.json({ users })
})

/**
 * Admin: refresh all feeds for all tracked users.
 * Accepts optional `dids` array in body to refresh
 * specific users only.
 * Requires ADMIN_TOKEN bearer header.
 */
app.post('/admin/refresh-all', requireAdmin, async (c) => {
    let dids:string[]

    // Check if specific DIDs were provided
    const body = await c.req.json<{
        dids?:string[]
    }>().catch(() => ({ dids: undefined }))

    if (body.dids && body.dids.length > 0) {
        dids = body.dids
    } else {
        // List all tracked users from KV
        const result = await c.env.SESSIONS.list({
            prefix: 'user:'
        })
        dids = result.keys.map(
            (key) => key.name.replace('user:', '')
        )
    }

    if (dids.length === 0) {
        return c.json({
            error: 'No users found. Log in first.',
            results: []
        }, 404)
    }

    const results:Record<string, unknown>[] = []
    for (const did of dids) {
        try {
            const stub = getRsssUserDO(c.env, did)
            const res = await stub.fetch(
                new Request(
                    'http://do/feeds/refresh',
                    { method: 'POST' }
                )
            )
            const data = await res.json() as Record<
                string, unknown
            >
            const handle = await c.env.SESSIONS.get(
                `user:${did}`
            )
            results.push({
                did,
                handle,
                success: true,
                ...data
            })
        } catch (err) {
            results.push({
                did,
                success: false,
                error: err instanceof Error
                    ? err.message
                    : 'Unknown error'
            })
        }
    }

    return c.json({ results })
})

/**
 * Serve static assets (Preact frontend)
 */
app.all('*', (c) => {
    if (!c.env?.ASSETS) {
        // In dev mode, let Vite handle static assets
        return c.notFound()
    }

    if (shouldSkipLazyHtml({ dev: c.env.NODE_ENV === 'development' })) {
        return c.env.ASSETS.fetch(c.req.raw)
    }

    const session = c.get('session')
    const did = session?.did

    if (did && c.env.HTML_KV && c.env.USER_DO) {
        return handleLazyHtmlRequest({
            did,
            kv: c.env.HTML_KV,
            doStub: getRsssUserDO(c.env, did),
            assets: c.env.ASSETS,
            request: c.req.raw
        })
    }

    return c.env.ASSETS.fetch(c.req.raw)
})

const worker = Object.assign(app, {
    async queue (batch:MessageBatch<unknown>, env:Env):Promise<void> {
        if (batch.queue.startsWith('article-fetch-jobs')) {
            const {
                handleArticleFetchQueueBatch,
                createArticleFetchConsumerDeps
            } = await import('./article-fetch-consumer.js')
            await handleArticleFetchQueueBatch(
                batch,
                env,
                createArticleFetchConsumerDeps()
            )
        } else {
            const runtime = await import(
                './blurhash-runtime.js'
            ) as typeof BlurhashRuntime
            await handleBlurhashQueueBatch(
                batch,
                env,
                runtime.createBlurhashConsumerDeps()
            )
        }
    }
})

const getSentryOptions = (env:Env) => buildSentryOptions(env)

// DO has its own narrower Env type; same builder so the two cannot drift.
const getDOSentryOptions = (env:RsssUserDOEnv) => buildSentryOptions(env)

// Wrap RsssUserDO so unhandled errors and storage/RPC spans flow to Sentry.
// Wrangler resolves the class by export name — keep this named `RsssUserDO`.
export const RsssUserDO = Sentry.instrumentDurableObjectWithSentry(
    getDOSentryOptions,
    RsssUserDOBase
)

// Wrap the worker so fetch and queue handlers report to Sentry.
export default Sentry.withSentry(getSentryOptions, worker)
