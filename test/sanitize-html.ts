import { test } from '@substrate-system/tapzero'
import { sanitizeHtml } from '../src/client/util.js'

test('strips publisher save/share controls + their labels', t => {
    const dirty = '<p>Lede.</p>' +
        '<button class="save"><svg></svg>' +
        'SAVE_WIDGET_MARKER</button>' +
        '<p>Body.</p>'
    const clean = sanitizeHtml(dirty)
    t.ok(
        !/<button/i.test(clean),
        'button element is gone'
    )
    t.ok(
        !clean.includes('SAVE_WIDGET_MARKER'),
        'button label text is gone, not re-parented'
    )
})

test('strips form controls', t => {
    const dirty = '<p>x</p>' +
        '<label>L<input type="email"></label>' +
        '<select><option>o</option></select>' +
        '<textarea>t</textarea>'
    const clean = sanitizeHtml(dirty)
    for (const tag of ['input', 'select', 'textarea', 'label']) {
        t.ok(
            !new RegExp('<' + tag + '\\b', 'i').test(clean),
            tag + ' is removed'
        )
    }
})

test('preserves prose, links, and images', t => {
    const dirty = '<h2>Heading</h2>' +
        '<p>Para with <a href="https://ex.com/x">link</a>.</p>' +
        '<img src="https://ex.com/p.jpg" alt="pic">' +
        '<ul><li>one</li></ul>'
    const clean = sanitizeHtml(dirty)
    t.ok(clean.includes('Heading'), 'heading text kept')
    t.ok(
        /href="https:\/\/ex\.com\/x"/.test(clean),
        'link href preserved'
    )
    t.ok(
        /src="https:\/\/ex\.com\/p\.jpg"/.test(clean),
        'image src preserved'
    )
    t.ok(clean.includes('<li>one</li>'), 'list item kept')
})
