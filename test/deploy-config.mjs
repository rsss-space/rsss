import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(
    new URL('../package.json', import.meta.url),
    'utf8'
))
const wrangler = readFileSync(
    new URL('../wrangler.jsonc', import.meta.url),
    'utf8'
)
const envStart = wrangler.indexOf('"env"')
const topLevelConfig = envStart === -1 ? wrangler : wrangler.slice(0, envStart)
const varsBlock = topLevelConfig.match(
    /"vars"\s*:\s*\{[\s\S]*?\n\t\}/
)?.[0] ?? ''
const queuesBlock = wrangler.match(
    /"queues"\s*:\s*\{[\s\S]*?\n\t\}/
)?.[0] ?? ''
const dlqPattern = [
    /"queue"\s*:\s*"blurhash-jobs"/,
    /[\s\S]*?"dead_letter_queue"\s*:\s*"blurhash-dlq"/
].map((part) => part.source).join('')
const stagingStart = wrangler.indexOf('"staging"')
const productionStart = wrangler.indexOf('"production"')
// Search from the production block so a staging-scoped "observability"
// key does not bound production to an empty slice.
const observabilityStart = wrangler.indexOf('"observability"', productionStart)
const stagingBlock = stagingStart === -1 || productionStart === -1
    ? ''
    : wrangler.slice(stagingStart, productionStart)
const productionBlock = productionStart === -1 || observabilityStart === -1
    ? ''
    : wrangler.slice(productionStart, observabilityStart)

assert.doesNotMatch(
    varsBlock,
    /"NODE_ENV"\s*:/,
    'NODE_ENV must be set per environment, not in top-level vars'
)

assert.doesNotMatch(
    varsBlock,
    /"AUTUMN_SECRET_KEY"\s*:/,
    'AUTUMN_SECRET_KEY must be configured with wrangler secret put, not vars'
)

assert.match(
    wrangler,
    /"env"\s*:\s*\{/,
    'wrangler.jsonc must declare environment-specific blocks'
)

for (const [envName, envBlock, nodeEnv, queueName] of [
    ['staging', stagingBlock, 'staging', 'blurhash-jobs-staging'],
    ['production', productionBlock, 'production', 'blurhash-jobs']
]) {
    assert.notEqual(envBlock, '', `${envName} env block is declared`)
    assert.match(
        envBlock,
        new RegExp(`"NODE_ENV"\\s*:\\s*"${nodeEnv}"`),
        `${envName} sets NODE_ENV=${nodeEnv}`
    )
    assert.match(
        envBlock,
        /"name"\s*:\s*"USER_DO"[\s\S]*?"class_name"\s*:\s*"UserDO"/,
        `${envName} declares USER_DO binding`
    )
    for (const binding of ['SESSIONS', 'BLURHASH_KV', 'HTML_KV']) {
        assert.match(
            envBlock,
            new RegExp(`"binding"\\s*:\\s*"${binding}"`),
            `${envName} declares ${binding}`
        )
        assert.match(
            envBlock,
            new RegExp(
                `"binding"\\s*:\\s*"${binding}"[\\s\\S]*?`
                + '"id"\\s*:\\s*"[^"]+"'
            ),
            `${envName} declares ${binding} namespace id`
        )
    }
    assert.match(
        envBlock,
        new RegExp(
            '"binding"\\s*:\\s*"BLURHASH_QUEUE"[\\s\\S]*?'
            + `"queue"\\s*:\\s*"${queueName}"`
        ),
        `${envName} declares the blurhash queue producer`
    )
}

assert.match(
    packageJson.scripts['deploy:staging'] ?? '',
    /node script\/deploy\.mjs staging/,
    'deploy:staging must use the staging deploy script'
)

assert.match(
    packageJson.scripts['deploy:production'] ?? '',
    /node script\/deploy\.mjs production/,
    'deploy:production must use the production deploy script'
)

assert.match(
    packageJson.scripts['predeploy:production'] ?? '',
    /node script\/predeploy-production\.mjs/,
    'production deploy must run the predeploy production check'
)

const deployScript = readFileSync(
    new URL('../script/deploy.mjs', import.meta.url),
    'utf8'
)

assert.match(
    deployScript,
    /'wrangler',\s*'deploy',[\s\S]*'--config',[\s\S]*'wrangler\.jsonc'/,
    'deploy script must bypass generated Wrangler redirect'
)

assert.match(
    deployScript,
    /'--env',\s*envName/,
    'deploy script must pass the selected Wrangler env'
)

assert.match(
    wrangler,
    /"binding"\s*:\s*"BLURHASH_KV"/,
    'BLURHASH_KV must be declared as a KV namespace binding'
)

assert.match(
    wrangler,
    /"binding"\s*:\s*"HTML_KV"/,
    'HTML_KV must be declared as a KV namespace binding'
)

assert.match(
    wrangler,
    /"binding"\s*:\s*"HTML_KV"[\s\S]*?"id"\s*:\s*"[^"]+"/,
    'HTML_KV must declare a production namespace id'
)

assert.match(
    wrangler,
    /"binding"\s*:\s*"HTML_KV"[\s\S]*?"preview_id"\s*:\s*"[^"]+"/,
    'HTML_KV must declare a preview namespace id'
)

assert.match(
    queuesBlock,
    /"binding"\s*:\s*"BLURHASH_QUEUE"[\s\S]*?"queue"\s*:\s*"blurhash-jobs"/,
    'blurhash-jobs must be bound as the producer queue'
)

assert.match(
    queuesBlock,
    /"queue"\s*:\s*"blurhash-jobs"[\s\S]*?"max_batch_size"\s*:\s*10/,
    'blurhash-jobs consumer must use max_batch_size 10'
)

assert.match(
    queuesBlock,
    /"queue"\s*:\s*"blurhash-jobs"[\s\S]*?"max_batch_timeout"\s*:\s*30/,
    'blurhash-jobs consumer must use max_batch_timeout 30'
)

assert.match(
    queuesBlock,
    /"queue"\s*:\s*"blurhash-jobs"[\s\S]*?"max_retries"\s*:\s*3/,
    'blurhash-jobs consumer must use max_retries 3'
)

assert.match(
    queuesBlock,
    new RegExp(dlqPattern),
    'blurhash-jobs consumer must use blurhash-dlq as the DLQ'
)
