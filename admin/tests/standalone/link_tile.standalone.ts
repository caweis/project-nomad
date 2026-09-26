/**
 * Standalone checks for home-screen link tiles: URL normalization, the icon set
 * and the color palette.
 *
 *   node --experimental-strip-types tests/standalone/link_tile.standalone.ts
 *
 * Ported from upstream's link_tile.spec.ts (2c73139b, c83a1917, 2085a526) and
 * custom_url.spec.ts (ce60e063), which are node:test and would register nothing
 * under this fork's Japa glob.
 *
 * The URL rules matter beyond tidiness. normalizeCustomUrl restricting the result
 * to http(s) is the only thing stopping a `javascript:` or `data:` URL being stored
 * and later rendered into an href on the home screen, so the rejection cases are a
 * security boundary rather than input hygiene.
 *
 * The Tabler check needs node_modules, as the validator checks do.
 */
import assert from 'node:assert/strict'
import * as TablerIcons from '@tabler/icons-react'
import {
  CUSTOM_URL_MAX_LENGTH,
  CUSTOM_URL_MESSAGES,
  checkCustomUrl,
  normalizeCustomUrl,
} from '../../util/custom_url.ts'
import {
  DEFAULT_LINK_TILE_ICON,
  LINK_TILE_ICONS,
  isLinkTileIcon,
} from '../../constants/link_tile_icons.ts'
import {
  DEFAULT_LINK_TILE_COLOR,
  LINK_TILE_COLORS,
  LINK_TILE_COLOR_IDS,
  linkTileColor,
} from '../../constants/link_tile_colors.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── URL normalization ──
check('a bare host:port gains http, which is what most LAN devices need', () => {
  assert.equal(normalizeCustomUrl('192.168.1.50:8080'), 'http://192.168.1.50:8080/')
  assert.equal(normalizeCustomUrl('nas.local'), 'http://nas.local/')
})

check('an explicit https scheme is preserved rather than downgraded', () => {
  assert.equal(normalizeCustomUrl('https://nas.local'), 'https://nas.local/')
  assert.equal(normalizeCustomUrl('https://nas.local:9443'), 'https://nas.local:9443/')
})

check('a path, a query string and a port all survive', () => {
  assert.equal(normalizeCustomUrl('192.168.1.50:8080/admin'), 'http://192.168.1.50:8080/admin')
  assert.equal(
    normalizeCustomUrl('https://nas.local/ui/dashboard'),
    'https://nas.local/ui/dashboard'
  )
  assert.equal(
    normalizeCustomUrl('http://10.0.0.5:3000/app?tab=media'),
    'http://10.0.0.5:3000/app?tab=media'
  )
})

check('surrounding whitespace is trimmed', () => {
  assert.equal(normalizeCustomUrl('   192.168.1.50:8080   '), 'http://192.168.1.50:8080/')
})

check('empty input is null, so a tile that goes nowhere is refused', () => {
  assert.equal(normalizeCustomUrl(''), null)
  assert.equal(normalizeCustomUrl('   '), null)
  assert.equal(normalizeCustomUrl(null), null)
  assert.equal(normalizeCustomUrl(undefined), null)
})

check('script-bearing schemes are rejected, which is the XSS boundary', () => {
  assert.equal(normalizeCustomUrl('javascript:alert(1)'), null)
  assert.equal(normalizeCustomUrl('JAVASCRIPT:alert(1)'), null)
  assert.equal(normalizeCustomUrl('  javascript:alert(1)'), null)
  assert.equal(normalizeCustomUrl('data:text/html,<script>alert(1)</script>'), null)
  assert.equal(normalizeCustomUrl('vbscript:msgbox'), null)
})

check('file: and ftp: become harmless http URLs rather than being rejected', () => {
  // Documenting shared behavior, not endorsing it: both end up pointing at a host
  // named "file" or "ftp", which goes nowhere and cannot execute anything.
  assert.equal(normalizeCustomUrl('file:///etc/passwd'), 'http://file///etc/passwd')
  assert.equal(normalizeCustomUrl('ftp://example.com'), 'http://ftp//example.com')
})

check('a scheme in mixed case is recognized, not double-prefixed', () => {
  assert.equal(normalizeCustomUrl('HTTPS://nas.local'), 'https://nas.local/')
})

check('a normalized URL longer than services.custom_url is refused (upstream ce60e063)', () => {
  // The limit applies after normalization: a bare host gains "http://" and a
  // trailing slash, so an input that fits as typed may not fit as stored.
  assert.equal(CUSTOM_URL_MAX_LENGTH, 255)
  assert.equal(normalizeCustomUrl(`https://${'a'.repeat(247)}`), null)
  assert.equal(normalizeCustomUrl(`https://${'a'.repeat(246)}`)?.length, 255)
  // 250 characters typed fits the column; "http://" and the trailing "/" make
  // it 258 as stored, which does not.
  assert.equal(normalizeCustomUrl('a'.repeat(250)), null, 'fits as typed, not as stored')
})

check('a refused URL says why, so a long one is not called invalid', () => {
  assert.deepEqual(checkCustomUrl('nas.local'), { href: 'http://nas.local/', problem: null })
  assert.deepEqual(checkCustomUrl('   '), { href: null, problem: 'empty' })
  assert.deepEqual(checkCustomUrl('javascript:alert(1)'), { href: null, problem: 'invalid' })
  assert.deepEqual(checkCustomUrl('http://'), { href: null, problem: 'invalid' })
  assert.deepEqual(checkCustomUrl(`https://nas.local/${'a'.repeat(300)}`), {
    href: null,
    problem: 'too_long',
  })
  // The form and the server both show these, so each must name its own fix.
  assert.match(CUSTOM_URL_MESSAGES.too_long, /too long/)
  assert.ok(CUSTOM_URL_MESSAGES.too_long.includes(String(CUSTOM_URL_MAX_LENGTH)))
  assert.match(CUSTOM_URL_MESSAGES.invalid, /valid URL/)
})

// ── Icons ──
check('the icon set is exactly 36, so the picker fills a 6x6 grid', () => {
  assert.equal(LINK_TILE_ICONS.length, 36)
  assert.equal(new Set(LINK_TILE_ICONS).size, 36, 'no duplicates')
})

check('every offered icon exists in @tabler/icons-react', () => {
  // DynamicIcon looks names up in the package and renders nothing for one it
  // does not know, so a typo or a removed icon is a silent hole in a tile.
  const missing = LINK_TILE_ICONS.filter((name) => !(name in TablerIcons))
  assert.deepEqual(missing, [])
})

check('isLinkTileIcon accepts only names in the set', () => {
  assert.equal(isLinkTileIcon('IconServer'), true)
  assert.equal(isLinkTileIcon(DEFAULT_LINK_TILE_ICON), true)
  // Real Tabler icons that are deliberately not offered must still be refused,
  // otherwise the server would store a name the picker cannot round-trip.
  assert.equal(isLinkTileIcon('IconTrash'), false)
  assert.equal(isLinkTileIcon('IconNotARealIcon'), false)
  assert.equal(isLinkTileIcon(''), false)
  assert.equal(isLinkTileIcon(null), false)
  assert.equal(isLinkTileIcon(42), false)
})

check('the default icon is part of the offered set', () => {
  assert.ok((LINK_TILE_ICONS as readonly string[]).includes(DEFAULT_LINK_TILE_ICON))
})

// ── Colors ──
check('tile colors resolve from the palette, falling back to the default', () => {
  assert.equal(linkTileColor('orange').id, 'orange')
  assert.equal(linkTileColor(null).id, DEFAULT_LINK_TILE_COLOR)
  assert.equal(linkTileColor('chartreuse').id, DEFAULT_LINK_TILE_COLOR)
})

check('every color ships complete, literal Tailwind classes, with a solid swatch', () => {
  // Tailwind scans for literal class strings, so an interpolated name would be
  // dropped from the build and the tile would render untinted.
  for (const option of LINK_TILE_COLORS) {
    assert.ok(option.border.startsWith('border-desert-'), option.id)
    assert.ok(option.bg.startsWith('bg-desert-'), option.id)
    assert.ok(option.marker.startsWith('text-desert-'), option.id)
    // A tint that reads well across a card is indistinguishable at 28px.
    assert.ok(option.swatch.startsWith('bg-desert-'), option.id)
    assert.ok(!option.swatch.includes('/'), `${option.id} swatch must be solid`)
    assert.ok(
      !`${option.border}${option.bg}${option.marker}${option.swatch}`.includes('${'),
      option.id
    )
  }
})

check('the default color is one of the offered options', () => {
  assert.ok(LINK_TILE_COLOR_IDS.includes(DEFAULT_LINK_TILE_COLOR))
})

console.log(`\n${passed} passed`)
