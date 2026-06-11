import { test } from '@substrate-system/tapzero'
import { fakeResult } from './sql-fake.js'

test('AC2.1: fakeResult([]).one() throws', (t) => {
    const fake = fakeResult([])
    try {
        fake.one()
        t.fail('Expected one() to throw on empty result set')
    } catch (e) {
        t.ok(e instanceof Error, 'Threw an error')
        t.ok(
            (e as Error).message.includes('exactly one row'),
            'Error mentions exactly one row'
        )
    }
})

test('AC2.2: fakeResult([a, b]).one() throws', (t) => {
    const fake = fakeResult([{ id: 1 }, { id: 2 }])
    try {
        fake.one()
        t.fail('Expected one() to throw on multiple rows')
    } catch (e) {
        t.ok(e instanceof Error, 'Threw an error')
        t.ok(
            (e as Error).message.includes('exactly one row'),
            'Error mentions exactly one row'
        )
    }
})

test('fakeResult([a]).one() returns a', (t) => {
    const row = { id: 1, name: 'test' }
    const fake = fakeResult([row])
    const result = fake.one()
    t.deepEqual(result, row, 'Returned the single row')
})

test('fakeResult([]).toArray() is []', (t) => {
    const fake = fakeResult([])
    const result = fake.toArray()
    t.deepEqual(result, [], 'Returned empty array')
})

test('fakeResult([a, b]).toArray() returns all rows', (t) => {
    const rows = [{ id: 1 }, { id: 2 }]
    const fake = fakeResult(rows)
    const result = fake.toArray()
    t.deepEqual(result, rows, 'Returned all rows')
})
