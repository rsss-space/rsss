import { spawnSync } from 'node:child_process'

const envName = process.argv[2]
const forwardedArgs = process.argv.slice(3)

if (!['staging', 'production'].includes(envName)) {
    console.error([
        'Usage:',
        'node script/deploy.mjs <staging|production> [...args]'
    ].join(' '))
    process.exit(1)
}

function run (command, args, options = {}) {
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        ...options
    })

    if (result.status !== 0) process.exit(result.status ?? 1)
}

if (envName === 'production') {
    run('node', ['script/predeploy-production.mjs'])
}

run('npm', ['run', 'build'], {
    env: {
        ...process.env,
        NODE_ENV: envName
    }
})

run('npx', [
    'wrangler',
    'deploy',
    '--config',
    'wrangler.jsonc',
    '--env',
    envName,
    ...forwardedArgs
])
