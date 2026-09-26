/**
 * Standalone checks for map marker management: the server's validators, the
 * pure helpers the map uses (coordinates, colors, sorting), and the icon set.
 *
 *   node --experimental-strip-types tests/standalone/map_markers.standalone.ts
 *
 * Upstream (a01aa5dc and follow-ups) ships no tests for these. Two of the cases
 * pin regressions upstream fixed after the fact: a plain visit to /maps flying
 * to 0,0 (102a00ba), and notes with no length cap (f702ff51).
 *
 * Needs node_modules (VineJS and Tabler), as the other validator checks do.
 */
import assert from 'node:assert/strict'
import * as TablerIcons from '@tabler/icons-react'
import {
  createMapMarkerValidator,
  updateMapMarkerValidator,
} from '../../app/validators/map_marker.ts'
import {
  MAX_MARKER_NAME_LENGTH,
  MAX_MARKER_NOTES_LENGTH,
  PIN_COLORS,
  colorSortValue,
  contrastRatio,
  contrastingIconColor,
  isValidCoordinate,
  parseCoordinateSearch,
  parseMapLocationParams,
  resolvePinColor,
  sortDirectionLabel,
  sortMarkers,
} from '../../inertia/util/map_markers.ts'
import {
  DEFAULT_MARKER_ICON,
  MARKER_ICONS,
  resolveMarkerIcon,
} from '../../inertia/components/maps/marker_icons.ts'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`  ok - ${name}`)
}

async function accepts(validator: typeof createMapMarkerValidator, data: unknown) {
  return validator.validate(data)
}

async function refuses(
  validator: typeof createMapMarkerValidator | typeof updateMapMarkerValidator,
  data: unknown,
  field: string
) {
  await assert.rejects(
    () => validator.validate(data),
    (error: any) => {
      assert.ok(
        error.messages?.some((m: any) => m.field === field),
        `expected an error on ${field}, got ${JSON.stringify(error.messages)}`
      )
      return true
    }
  )
}

const base = { name: 'Well', latitude: 40.015, longitude: -105.27 }

// ── Server validators ──
await check('a new pin with every new field is accepted as sent', async () => {
  const out = await accepts(createMapMarkerValidator, {
    ...base,
    color: 'blue',
    custom_color: '#a1b2c3',
    icon: 'tabler:IconDroplet',
    icon_color: '#FFFFFF',
    visible: false,
    notes: 'Hand pump; boil first.',
  })
  assert.equal(out.custom_color, '#a1b2c3')
  assert.equal(out.icon, 'tabler:IconDroplet')
  assert.equal(out.visible, false)
})

await check('notes stop at the length the form counts to (upstream f702ff51)', async () => {
  assert.equal(MAX_MARKER_NOTES_LENGTH, 500)
  await accepts(createMapMarkerValidator, { ...base, notes: 'n'.repeat(MAX_MARKER_NOTES_LENGTH) })
  await refuses(
    createMapMarkerValidator,
    { ...base, notes: 'n'.repeat(MAX_MARKER_NOTES_LENGTH + 1) },
    'notes'
  )
  await refuses(
    updateMapMarkerValidator,
    { notes: 'n'.repeat(MAX_MARKER_NOTES_LENGTH + 1) },
    'notes'
  )
  // The limit applies after trimming, as the form counts it.
  await accepts(createMapMarkerValidator, {
    ...base,
    notes: `  ${'n'.repeat(MAX_MARKER_NOTES_LENGTH)}  `,
  })
})

await check('a name is required and fits the column, as the form allows', async () => {
  assert.equal(MAX_MARKER_NAME_LENGTH, 255)
  await accepts(createMapMarkerValidator, { ...base, name: 'x'.repeat(MAX_MARKER_NAME_LENGTH) })
  await refuses(
    createMapMarkerValidator,
    { ...base, name: 'x'.repeat(MAX_MARKER_NAME_LENGTH + 1) },
    'name'
  )
  await refuses(createMapMarkerValidator, { ...base, name: '   ' }, 'name')
})

await check(
  'custom and icon colors must be #rrggbb, since both are drawn into the pin',
  async () => {
    for (const field of ['custom_color', 'icon_color']) {
      await accepts(createMapMarkerValidator, { ...base, [field]: '#0a0B0c' })
      await accepts(createMapMarkerValidator, { ...base, [field]: null })
      for (const bad of ['#abc', 'red', 'url(#a)', '#12345g', '1234567']) {
        await refuses(createMapMarkerValidator, { ...base, [field]: bad }, field)
      }
    }
  }
)

await check('coordinates must be on the globe', async () => {
  await refuses(createMapMarkerValidator, { ...base, latitude: 90.5 }, 'latitude')
  await refuses(createMapMarkerValidator, { ...base, longitude: -180.5 }, 'longitude')
  await refuses(updateMapMarkerValidator, { latitude: -91 }, 'latitude')
})

await check('an update may carry any one field, so hiding a pin sends only visible', async () => {
  const out = await accepts(updateMapMarkerValidator as any, { visible: true })
  assert.deepEqual(out, { visible: true })
  await accepts(updateMapMarkerValidator as any, {})
})

// ── Coordinates ──
await check('a plain visit to /maps is not a location (upstream 102a00ba)', () => {
  // Number(null) and Number('') are both 0, which is a valid coordinate. Read
  // carelessly, every visit without parameters flew to 0,0 and saved it.
  assert.equal(parseMapLocationParams(''), null)
  assert.equal(parseMapLocationParams('?zoom=5'), null)
  assert.equal(parseMapLocationParams('?lat=40'), null)
  assert.equal(parseMapLocationParams('?lng=-105'), null)
  assert.equal(parseMapLocationParams('?lat=&lng='), null)
  assert.equal(parseMapLocationParams('?lat=%20&lng=%20'), null)
  // One blank beside one real value must not become 0 either.
  assert.equal(parseMapLocationParams('?lat=&lng=-105'), null)
  assert.equal(parseMapLocationParams('?lat=40&lng=%20'), null)
})

await check('a link with lat and lng opens there, at zoom 12 unless it says otherwise', () => {
  assert.deepEqual(parseMapLocationParams('?lat=40.015&lng=-105.27'), {
    lat: 40.015,
    lng: -105.27,
    zoom: 12,
    canonicalSearch: null,
  })
  assert.equal(parseMapLocationParams('?lat=40&lng=-105&zoom=7')?.zoom, 7)
  assert.equal(parseMapLocationParams('?lat=40&lng=-105&zoom=abc')?.zoom, 12)
  // An explicit 0,0 is a real place and must still work.
  assert.deepEqual(parseMapLocationParams('?lat=0&lng=0')?.lat, 0)
  assert.equal(parseMapLocationParams('?lat=91&lng=0'), null)
  assert.equal(parseMapLocationParams('?lat=north&lng=0'), null)
})

await check('`long` is read as `lng`, and the address bar is given lng', () => {
  const location = parseMapLocationParams('?lat=1&long=2&zoom=5')
  assert.equal(location?.lng, 2)
  const rewritten = new URLSearchParams(location?.canonicalSearch ?? '')
  assert.equal(rewritten.get('lng'), '2')
  assert.equal(rewritten.get('long'), null)
  assert.equal(rewritten.get('zoom'), '5')
  // lng wins when both are present, and then nothing needs rewriting.
  const both = parseMapLocationParams('?lat=1&lng=3&long=2')
  assert.equal(both?.lng, 3)
  assert.equal(both?.canonicalSearch, null)
})

await check('the coordinate box reads "lat, lng" with a comma or a space', () => {
  assert.deepEqual(parseCoordinateSearch('40.015, -105.27'), { lat: 40.015, lng: -105.27 })
  assert.deepEqual(parseCoordinateSearch('40.015,-105.27'), { lat: 40.015, lng: -105.27 })
  assert.deepEqual(parseCoordinateSearch('  40.015 -105.27 '), { lat: 40.015, lng: -105.27 })
  assert.deepEqual(parseCoordinateSearch('0, 0'), { lat: 0, lng: 0 })
})

await check('the coordinate box refuses half an answer rather than reading it as 0', () => {
  for (const bad of ['', '40.015', '40.015,', ', -105.27', '1, 2, 3', '91, 0', 'north, west']) {
    assert.equal(parseCoordinateSearch(bad), null, JSON.stringify(bad))
  }
})

await check('isValidCoordinate covers the globe and nothing else', () => {
  assert.equal(isValidCoordinate(90, 180), true)
  assert.equal(isValidCoordinate(-90, -180), true)
  assert.equal(isValidCoordinate(90.0001, 0), false)
  assert.equal(isValidCoordinate(0, 180.0001), false)
  assert.equal(isValidCoordinate(Number.NaN, 0), false)
})

// ── Colors ──
await check('a pin is drawn in its custom color, else its preset, else orange', () => {
  assert.equal(resolvePinColor('blue', '#123456'), '#123456')
  assert.equal(resolvePinColor('blue', null), '#2563eb')
  assert.equal(resolvePinColor(null, null), PIN_COLORS[0].hex)
  assert.equal(resolvePinColor('orange'), '#a84a12')
})

await check('every preset pin carries an icon at 4.5:1 or better', () => {
  for (const { id, hex } of PIN_COLORS) {
    const ratio = contrastRatio(hex, contrastingIconColor(hex))
    assert.ok(ratio !== null && ratio >= 4.5, `${id}: ${ratio}`)
  }
  // Yellow is the one preset light enough to need a dark icon.
  assert.equal(contrastingIconColor('#ca8a04'), '#111827')
})

await check('the icon color is always the better of the two, mid-tones included', () => {
  // Upstream compares uncorrected brightness with 0.55, which gives a #808080 pin
  // a white icon at 3.95:1 when near-black would give 4.49:1.
  assert.equal(contrastingIconColor('#808080'), '#111827')
  for (let v = 0; v <= 255; v += 5) {
    const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`
    const chosen = contrastingIconColor(hex)
    const other = chosen === '#ffffff' ? '#111827' : '#ffffff'
    assert.ok(contrastRatio(hex, chosen)! >= contrastRatio(hex, other)!, hex)
  }
  assert.equal(contrastingIconColor('not-a-color'), '#ffffff')
  assert.equal(contrastRatio('#000000', '#ffffff'), 21)
})

await check('sorting by hue puts greys first, then the wheel from red, then the unreadable', () => {
  assert.equal(colorSortValue('x', '#808080').bucket, 0)
  assert.equal(colorSortValue('red').bucket, 1)
  assert.equal(colorSortValue('x', 'url(#a)').bucket, 2)
  assert.ok(colorSortValue('x', '#ff0000').hue < colorSortValue('x', '#0000ff').hue)
})

// ── The marker list ──
const pins = [
  { name: 'well', color: 'blue', visible: true, icon: 'tabler:IconDroplet' },
  { name: 'Cache', color: 'orange', visible: false, icon: null },
  { name: 'barn', color: 'red', visible: true, icon: 'tabler:IconHome' },
  { name: 'Antenna', color: 'green', visible: false, icon: 'tabler:IconAntenna' },
]
const names = (list: { name: string }[]) => list.map((pin) => pin.name)

await check('the list sorts by name ignoring case, and reverses', () => {
  assert.deepEqual(names(sortMarkers(pins, 'name', 'asc')), ['Antenna', 'barn', 'Cache', 'well'])
  assert.deepEqual(names(sortMarkers(pins, 'name', 'desc')), ['well', 'Cache', 'barn', 'Antenna'])
  assert.equal(pins[0].name, 'well', 'the input is not reordered in place')
})

await check('within a group, pins stay alphabetical whichever way the list runs', () => {
  assert.deepEqual(names(sortMarkers(pins, 'visibility', 'asc')), [
    'Antenna',
    'Cache',
    'barn',
    'well',
  ])
  assert.deepEqual(names(sortMarkers(pins, 'visibility', 'desc')), [
    'barn',
    'well',
    'Antenna',
    'Cache',
  ])
  assert.deepEqual(names(sortMarkers(pins, 'icon', 'asc'))[0], 'Cache', 'no icon sorts first')
})

await check('the direction button names what it will do', () => {
  assert.equal(sortDirectionLabel('name', 'asc'), 'A → Z')
  assert.equal(sortDirectionLabel('icon', 'desc'), 'Z → A')
  assert.equal(sortDirectionLabel('visibility', 'asc'), 'Hidden first')
  assert.equal(sortDirectionLabel('color', 'desc'), 'Hue ↓')
})

// ── Icons ──
await check('the icon set is 36, unique, and each name is the Tabler icon it draws', () => {
  assert.equal(MARKER_ICONS.length, 36)
  assert.equal(new Set(MARKER_ICONS.map((i) => i.name)).size, 36)
  for (const { name, Icon } of MARKER_ICONS) {
    assert.match(name, /^tabler:Icon[A-Za-z0-9]+$/)
    const tablerName = name.slice('tabler:'.length)
    assert.equal(Icon, (TablerIcons as Record<string, unknown>)[tablerName], name)
    // map_markers.icon is a VARCHAR(50), and the validator caps it there too.
    assert.ok(name.length <= 50, name)
  }
})

await check('a stored icon the set does not know still draws, as the default pin', () => {
  assert.equal(resolveMarkerIcon(null), DEFAULT_MARKER_ICON)
  assert.equal(resolveMarkerIcon('tabler:IconRemovedLongAgo'), DEFAULT_MARKER_ICON)
  const fallback = TablerIcons.IconCircleFilled
  assert.equal(resolveMarkerIcon(undefined, fallback), fallback)
  assert.equal(resolveMarkerIcon('tabler:IconDroplet'), TablerIcons.IconDroplet)
})

console.log(`\n${passed} checks passed`)
