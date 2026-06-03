import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import stripJsonComments from 'strip-json-comments'

/**
 * Guard rails for `wrangler deploy --env production`.
 *
 * Named environments do NOT inherit top-level config, so production
 * must declare its own bindings and vars. We parse wrangler.jsonc as
 * JSONC (string-aware comment stripping keeps `//` inside URLs intact)
 * and assert on the structured config rather than scanning raw text,
 * which is brittle to key ordering between env blocks.
 */
const raw = readFileSync(
    new URL('../wrangler.jsonc', import.meta.url),
    'utf8'
)

let config
try {
    config = JSON.parse(stripJsonComments(raw))
} catch (err) {
    assert.fail(`wrangler.jsonc is not valid JSONC: ${err.message}`)
}

const production = config?.env?.production

assert.ok(
    production,
    'wrangler.jsonc must declare env.production before production deploy'
)

assert.equal(
    production?.vars?.NODE_ENV,
    'production',
    'env.production must set NODE_ENV=production before production deploy'
)
