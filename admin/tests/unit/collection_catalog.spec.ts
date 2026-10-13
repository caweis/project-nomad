import { test } from '@japa/runner'
import vine from '@vinejs/vine'
import { readFileSync } from 'node:fs'
import { mapsSpecSchema, zimCategoriesSpecSchema } from '#validators/curated_collections'

function catalog(filename: string) {
  return JSON.parse(
    readFileSync(new URL(`../../../collections/${filename}`, import.meta.url), 'utf8')
  )
}

test.group('bundled collection catalogs', () => {
  test('updated Kiwix resources decode and point at current editions', async ({ assert }) => {
    const spec = await vine.validate({
      schema: zimCategoriesSpecSchema,
      data: catalog('kiwix-categories.json'),
    })
    const resources = spec.categories.flatMap((category) =>
      category.tiers.flatMap((tier) => tier.resources)
    )
    const medicine = resources.find((resource) => resource.id === 'wikipedia_en_medicine_maxi')
    const bash = resources.find((resource) => resource.id === 'devdocs_en_bash')

    assert.equal(spec.spec_version, '2026-10-13')
    assert.equal(medicine?.version, '2026-10')
    assert.match(medicine?.url ?? '', /wikipedia_en_medicine_maxi_2026-10\.zim$/)
    assert.equal(bash?.version, '2026-10')
    assert.match(bash?.url ?? '', /devdocs_en_bash_2026-10\.zim$/)
  })

  test('updated map resources decode as separate states', async ({ assert }) => {
    const spec = await vine.validate({ schema: mapsSpecSchema, data: catalog('maps.json') })
    const resources = spec.collections.flatMap((collection) => collection.resources)
    const byId = new Map(resources.map((resource) => [resource.id, resource]))

    assert.equal(spec.spec_version, '2026-10-13')
    assert.match(byId.get('indiana')?.url ?? '', /indiana_2025-12\.pmtiles$/)
    assert.match(byId.get('michigan')?.url ?? '', /michigan_2025-12\.pmtiles$/)
    assert.isFalse(byId.has('indianamichigan'))
    assert.isFalse(byId.has('district_of_columbia'))
  })
})
