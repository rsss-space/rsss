import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const wrangler = readFileSync(
    new URL('../wrangler.jsonc', import.meta.url),
    'utf8'
)
const productionStart = wrangler.indexOf('"production"')
const observabilityStart = wrangler.indexOf('"observability"')
const productionBlock = productionStart === -1 || observabilityStart === -1
    ? ''
    : wrangler.slice(productionStart, observabilityStart)

assert.notEqual(
    productionBlock,
    '',
    'wrangler.jsonc must declare env.production before production deploy'
)

assert.match(
    productionBlock,
    /"NODE_ENV"\s*:\s*"production"/,
    'env.production must set NODE_ENV=production before production deploy'
)
