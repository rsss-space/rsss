import { spawnSync } from 'node:child_process'

const command = [
    'esbuild ./test/report-error.ts --bundle',
    '--alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts',
    '| tapout'
].join(' ')

const result = spawnSync(command, {
    shell: true,
    stdio: 'inherit'
})

process.exit(result.status ?? 1)
