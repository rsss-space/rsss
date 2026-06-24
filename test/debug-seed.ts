import { test } from '@substrate-system/tapzero'
import { seedDebugIfAbsent } from '../src/client/debug-seed.js'

test('seedDebugIfAbsent: seeds default when DEBUG is absent', t => {
    localStorage.removeItem('DEBUG')
    seedDebugIfAbsent()
    t.equal(
        localStorage.getItem('DEBUG'),
        'rsss,rsss:*',
        'sets default value when key is absent'
    )
    localStorage.removeItem('DEBUG')
})

test('seedDebugIfAbsent: preserves an existing user-set value', t => {
    localStorage.setItem('DEBUG', 'my-app:*')
    seedDebugIfAbsent()
    t.equal(
        localStorage.getItem('DEBUG'),
        'my-app:*',
        'does not overwrite a user-set DEBUG value'
    )
    localStorage.removeItem('DEBUG')
})

test('seedDebugIfAbsent: does not set DEBUG when value is empty string', t => {
    localStorage.setItem('DEBUG', '')
    seedDebugIfAbsent()
    t.equal(
        localStorage.getItem('DEBUG'),
        '',
        'treats empty string as a present value and does not overwrite'
    )
    localStorage.removeItem('DEBUG')
})
