import assert from 'node:assert/strict'
import { latestProtomapsBuild, worldBasemapExtractArgs } from '../../constants/world_basemap.ts'

assert.deepEqual(
  latestProtomapsBuild([
    { key: '20261001.pmtiles', size: 100 },
    { key: '20261022.pmtiles', size: 120 },
  ]),
  { key: '20261022.pmtiles', url: 'https://build.protomaps.com/20261022.pmtiles' }
)

assert.throws(() => latestProtomapsBuild([{ key: '../private.pmtiles', size: 1 }]))
assert.throws(() => latestProtomapsBuild([{ key: '20261022.pmtiles', size: 0 }]))
assert.throws(() => latestProtomapsBuild({ key: '20261022.pmtiles' }))
assert.deepEqual(
  worldBasemapExtractArgs(
    'https://build.protomaps.com/20261022.pmtiles',
    '/storage/maps/pmtiles/world.partial'
  ),
  [
    'extract',
    'https://build.protomaps.com/20261022.pmtiles',
    '/storage/maps/pmtiles/world.partial',
    '--maxzoom=5',
    '--download-threads=4',
  ]
)
console.log('world_basemap: 5 passed')
