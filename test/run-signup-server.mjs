import { spawnSync } from 'node:child_process'

const command = [
    'npx esbuild ./test/signup.ts --bundle',
    '--platform=node --format=esm',
    '--loader:.wasm=dataurl',
    '--banner:js="import { createRequire } from \'module\';',
    'const require = createRequire(import.meta.url);"',
    '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
    '| node --input-type=module | npx tap-spec'
].join(' ')

const result = spawnSync(command, {
    shell: true,
    stdio: 'inherit'
})

process.exit(result.status ?? 1)
