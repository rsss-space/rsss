import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')

const runner = read('./run-all-tests.mjs')
// Browser suites run either inside the consolidated browser-tests bundle
// (one tapout/browser spawn) or as their own bundle. The actual
// esbuild|tapout commands live in package.json `test:*` scripts (project
// convention); the runner invokes them via `npm run`. Resolve the runner
// into the full wiring text -- the runner plus the body of every npm
// script it runs -- so a suite counts as wired into npm test whether it
// is named inline, run via a script, or imported into the bundle.
const bundle = read('./browser-tests.ts')
const scripts = JSON.parse(read('../package.json')).scripts || {}

function resolveScripts (text, seen = new Set()) {
    let out = text
    for (const [, name] of text.matchAll(/npm run ([\w:-]+)/g)) {
        if (seen.has(name) || !scripts[name]) continue
        seen.add(name)
        out += '\n' + resolveScripts(scripts[name], seen)
    }
    return out
}

const wiring = resolveScripts(runner)

const runsSuite = (suite) => (
    new RegExp(`test/${suite}\\.ts`).test(wiring) ||
    new RegExp(`['"]\\./${suite}\\.js['"]`).test(bundle)
)

const requiredSuites = [
    'adapter-factory',
    'bootstrap',
    'initial-feed',
    'lazy-html',
    'local-adapter',
    'local-first-settings',
    'pull-sync',
    'push-sync',
    'sqlite-init',
    'tab-coordination'
]

const requiredScriptCommands = [
    'test:browser',
    'test:lazy-html-handler',
    'test:report-error'
]

const wasmSuites = [
    'bootstrap',
    'local-adapter',
    'pull-sync',
    'push-sync',
    'sqlite-init'
]

assert.match(
    runner,
    /node test\/run-all-coverage\.mjs/,
    'npm test runs the test runner coverage guard'
)

// The consolidated bundle must get the SQLite wasm data-URL loader so the
// suites folded into it can open the on-device database.
assert.match(
    scripts['test:browser'] ?? '',
    /browser-tests\.ts[\s\S]*?--loader:\.wasm=dataurl/,
    'test:browser bundles browser-tests.ts with the wasm data URL loader'
)

for (const suite of requiredSuites) {
    assert.ok(runsSuite(suite), `npm test runs test/${suite}.ts`)
}

for (const command of requiredScriptCommands) {
    assert.match(
        runner,
        new RegExp(`npm run ${command}`),
        `npm test runs ${command}`
    )
}

for (const suite of wasmSuites) {
    const ownCommand = new RegExp(
        `test/${suite}\\.ts[\\s\\S]*?--loader:\\.wasm=dataurl`
    ).test(wiring)
    const inBundle = new RegExp(`['"]\\./${suite}\\.js['"]`).test(bundle)
    assert.ok(
        ownCommand || inBundle,
        `npm test gives test/${suite}.ts the wasm data URL loader`
    )
}
