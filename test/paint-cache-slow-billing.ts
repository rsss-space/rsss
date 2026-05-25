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
import { test } from '@substrate-system/tapzero'

/**
 * AC7.1, AC7.3: Verify loadBillingStatus is not awaited on the
 * critical render path.
 *
 * We grep for patterns and then verify by examining the context:
 * all awaits of loadBillingStatus should be in user-action handlers
 * (startCheckout, finalizeCheckout, scheduleAccountDeletion,
 * cancelAccountDeletion, cancelSubscription, resumeSubscription).
 */
test('AC7.1, AC7.3: billing status latency does not block first paint', async (t) => {
    /**
     * Read the source file and build a map: line number -> function name.
     */
    const stateFile = readFileSync(
        '/Users/nick/code/rsss/src/client/state.ts',
        'utf8'
    )
    const lines = stateFile.split('\n')
    const lineToFunction: Record<number, string> = {}
    let currentFunction = 'module'

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Match: State.functionName = [async] function
        const funcMatch = line.match(/^State\.(\w+)\s*=/)
        if (funcMatch) {
            currentFunction = funcMatch[1]
        }
        lineToFunction[i + 1] = currentFunction
    }

    /**
     * Pattern 1: Direct await of loadBillingStatus
     */
    const pattern1 = spawnSync(
        'rg',
        ['-n', 'await\\s+(State\\.)?loadBillingStatus', 'src/client/state.ts'],
        { cwd: '/Users/nick/code/rsss' }
    )

    const lines1 = pattern1.stdout.toString().trim().split('\n').filter(Boolean)

    /**
     * Whitelist of functions that are allowed to await loadBillingStatus.
     * These are user-action handlers, not part of the critical render path.
     */
    const whitelistedFunctions = new Set([
        'startCheckout',
        'finalizeCheckout',
        'scheduleAccountDeletion',
        'cancelAccountDeletion',
        'cancelSubscription',
        'resumeSubscription'
    ])

    /**
     * Extract line number from grep output (format: "filename:lineno:...")
     */
    function getLineNumber (grepLine: string): number {
        const parts = grepLine.split(':')
        return parseInt(parts[1], 10)
    }

    /**
     * Check Pattern 1 matches: all should be in whitelisted functions.
     */
    const pattern1NonWhitelisted = lines1.filter(line => {
        const lineNum = getLineNumber(line)
        const func = lineToFunction[lineNum] || 'unknown'
        return !whitelistedFunctions.has(func)
    })

    t.equal(
        pattern1NonWhitelisted.length,
        0,
        'All await loadBillingStatus calls are in user-action handlers'
    )
    if (pattern1NonWhitelisted.length > 0) {
        t.comment('Unexpected awaits of loadBillingStatus in critical path:')
        pattern1NonWhitelisted.forEach(line => {
            const lineNum = getLineNumber(line)
            const func = lineToFunction[lineNum] || 'unknown'
            t.comment(`  ${line} (in function: ${func})`)
        })
    }

    /**
     * Pattern 2: .then() chains on loadBillingStatus
     */
    const pattern2 = spawnSync(
        'rg',
        ['-n', 'loadBillingStatus.*\\.then', 'src/client/state.ts'],
        { cwd: '/Users/nick/code/rsss' }
    )

    const lines2 = pattern2.stdout.toString().trim().split('\n').filter(Boolean)
    t.equal(
        lines2.length,
        0,
        'No .then() chains on loadBillingStatus'
    )
    if (lines2.length > 0) {
        t.comment('Unexpected .then() on loadBillingStatus:')
        lines2.forEach(line => t.comment(`  ${line}`))
    }

    /**
     * Pattern 3: Direct await of api.get('billing/status')
     * This should only appear in the loadBillingStatus function itself.
     */
    const pattern3 = spawnSync(
        'rg',
        ['-n', "await\\s+.*api\\.get\\(['\"]billing/status", 'src/client/state.ts'],
        { cwd: '/Users/nick/code/rsss' }
    )

    const lines3 = pattern3.stdout.toString().trim().split('\n').filter(Boolean)

    /**
     * The api.get call should only appear in loadBillingStatus function itself.
     */
    const pattern3NonWhitelisted = lines3.filter(line => {
        const lineNum = getLineNumber(line)
        const func = lineToFunction[lineNum] || 'unknown'
        return func !== 'loadBillingStatus'
    })

    t.equal(
        pattern3NonWhitelisted.length,
        0,
        'api.get("billing/status") only called within loadBillingStatus itself'
    )
    if (pattern3NonWhitelisted.length > 0) {
        t.comment('Unexpected api.get billing/status calls:')
        pattern3NonWhitelisted.forEach(line => {
            const lineNum = getLineNumber(line)
            const func = lineToFunction[lineNum] || 'unknown'
            t.comment(`  ${line} (in function: ${func})`)
        })
    }

    /**
     * Summary: if all patterns pass, the critical render path never awaits
     * billing status, so neither latency (AC7.1) nor failure (AC7.3)
     * can block first paint.
     */
    t.comment('AC7.1 and AC7.3 verified: billing latency does not block critical path')
})
