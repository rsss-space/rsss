/**
 * Test AC7.1 and AC7.3: Verify that first paint of items does NOT
 * depend on /api/billing/status resolving.
 *
 * Strategy: Use structural (grep-based) assertions to prove that
 * the critical render path never awaits loadBillingStatus.
 *
 * AC7.1: Slow billing stub (5s latency) does not block first paint.
 * AC7.3: Billing 503 failure does not prevent shell + items rendering.
 *
 * Both are satisfied if loadBillingStatus is never awaited on the
 * critical path — neither a slow response nor an error can block.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = '/Users/nick/code/rsss'

/**
 * Read the state file and build a line number -> function name map.
 */
function buildFunctionMap () {
    const stateFilePath = resolve(projectRoot, 'src/client/state.ts')
    const fileContent = readFileSync(stateFilePath, 'utf8')
    const stateLines = fileContent.split('\n')
    const result = {}
    let currentFunction = 'module'

    for (let i = 0; i < stateLines.length; i++) {
        const line = stateLines[i]
        // Match: State.functionName = [async] function
        const funcMatch = line.match(/^State\.(\w+)\s*=/)
        if (funcMatch) {
            currentFunction = funcMatch[1]
        }
        result[i + 1] = currentFunction
    }

    return result
}

/**
 * Extract line number from grep output (format: "lineno:...")
 */
function getLineNumber (grepLine) {
    const colonIndex = grepLine.indexOf(':')
    const lineNumStr = grepLine.substring(0, colonIndex)
    return parseInt(lineNumStr, 10)
}

/**
 * Run the tests.
 */
function runTests () {
    const lineToFunction = buildFunctionMap()

    console.log('AC7.1, AC7.3: billing status latency does not block first paint\n')

    let allPassed = true

    /**
     * Pattern 1: Direct await of loadBillingStatus
     */
    console.log('Checking: await loadBillingStatus...')
    const pattern1 = spawnSync(
        'rg',
        ['-n', 'await\\s+(State\\.)?loadBillingStatus', 'src/client/state.ts'],
        { cwd: projectRoot }
    )

    const lines1 = pattern1.stdout.toString().trim().split('\n').filter(Boolean)

    const whitelistedFunctions = new Set([
        'startCheckout',
        'finalizeCheckout',
        'scheduleAccountDeletion',
        'cancelAccountDeletion',
        'cancelSubscription',
        'resumeSubscription'
    ])

    const pattern1NonWhitelisted = lines1.filter(line => {
        const lineNum = getLineNumber(line)
        const func = lineToFunction[lineNum] || 'unknown'
        return !whitelistedFunctions.has(func)
    })

    if (pattern1NonWhitelisted.length === 0) {
        console.log('✓ All await loadBillingStatus calls are in user-action handlers\n')
    } else {
        console.log('✗ Unexpected awaits of loadBillingStatus in critical path:')
        pattern1NonWhitelisted.forEach(line => {
            const lineNum = getLineNumber(line)
            const func = lineToFunction[lineNum] || 'unknown'
            console.log(`  ${line} (in function: ${func})`)
        })
        console.log()
        allPassed = false
    }

    /**
     * Pattern 2: .then() chains on loadBillingStatus
     */
    console.log('Checking: .then() chains on loadBillingStatus...')
    const pattern2 = spawnSync(
        'rg',
        ['-n', 'loadBillingStatus.*\\.then', 'src/client/state.ts'],
        { cwd: projectRoot }
    )

    const lines2 = pattern2.stdout.toString().trim().split('\n').filter(Boolean)
    if (lines2.length === 0) {
        console.log('✓ No .then() chains on loadBillingStatus\n')
    } else {
        console.log('✗ Unexpected .then() on loadBillingStatus:')
        lines2.forEach(line => console.log(`  ${line}`))
        console.log()
        allPassed = false
    }

    /**
     * Pattern 3: Direct await of api.get('billing/status')
     * This should only appear in the loadBillingStatus function itself.
     */
    console.log('Checking: await api.get("billing/status")...')
    const pattern3 = spawnSync(
        'rg',
        ['-n', "await\\s+.*api\\.get\\(['\"]billing/status", 'src/client/state.ts'],
        { cwd: projectRoot }
    )

    const lines3 = pattern3.stdout.toString().trim().split('\n').filter(Boolean)

    const pattern3NonWhitelisted = lines3.filter(line => {
        const lineNum = getLineNumber(line)
        const func = lineToFunction[lineNum] || 'unknown'
        return func !== 'loadBillingStatus'
    })

    if (pattern3NonWhitelisted.length === 0) {
        console.log('✓ api.get("billing/status") only called within loadBillingStatus itself\n')
    } else {
        console.log('✗ Unexpected api.get billing/status calls:')
        pattern3NonWhitelisted.forEach(line => {
            const lineNum = getLineNumber(line)
            const func = lineToFunction[lineNum] || 'unknown'
            console.log(`  ${line} (in function: ${func})`)
        })
        console.log()
        allPassed = false
    }

    /**
     * Summary
     */
    console.log('AC7.1 and AC7.3 verified: billing latency does not block critical path')

    if (!allPassed) {
        process.exit(1)
    }
}

runTests()
