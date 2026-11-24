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

    assert.equal(spec.spec_version, '2026-11-24')
    assert.equal(medicine?.version, '2026-10')
    assert.equal(medicine?.size_mb, 1778)
    assert.match(medicine?.url ?? '', /wikipedia_en_medicine_maxi_2026-10\.zim$/)
    assert.equal(bash?.version, '2026-10')
    assert.match(bash?.url ?? '', /devdocs_en_bash_2026-10\.zim$/)
  })

  test('Military Medicine uses the renamed Kiwix edition and a new manifest version', async ({
    assert,
  }) => {
    const spec = await vine.validate({
      schema: zimCategoriesSpecSchema,
      data: catalog('kiwix-categories.json'),
    })
    const resources = spec.categories.flatMap((category) =>
      category.tiers.flatMap((tier) => tier.resources)
    )
    const military = resources.find(
      (resource) => resource.id === 'irp.fas.org_en_military-medicine'
    )

    assert.exists(military)
    assert.equal(military?.version, '2026-10')
    assert.equal(
      military?.url,
      'https://download.kiwix.org/zim/zimit/irp.fas.org_en_military-medicine_2026-10.zim'
    )
    assert.equal(military?.size_mb, 62)
    assert.isFalse(resources.some((resource) => resource.id === 'fas-military-medicine_en'))
    assert.equal(spec.spec_version, '2026-11-24')
  })

  test('all five renamed books keep their former IDs after catalog validation', async ({
    assert,
  }) => {
    const spec = await vine.validate({
      schema: zimCategoriesSpecSchema,
      data: catalog('kiwix-categories.json'),
    })
    const resources = spec.categories.flatMap((category) =>
      category.tiers.flatMap((tier) => tier.resources)
    )
    const expected = {
      'irp.fas.org_en_military-medicine': 'fas-military-medicine_en',
      'canadian-prepper_en_winterprepping': 'canadian_prepper_winterprepping_en',
      'canadian-prepper_en_bugoutroll': 'canadian_prepper_bugoutroll_en',
      'canadian-prepper_en_bugoutconcepts': 'canadian_prepper_bugoutconcepts_en',
      'canadian-prepper_en_preppingfood': 'canadian_prepper_preppingfood_en',
    }
    for (const [id, formerId] of Object.entries(expected)) {
      assert.deepEqual(resources.find((r) => r.id === id)?.previous_ids, [formerId], id)
    }
  })

  test('retired Stack Exchange and Wikibooks editions use published October releases', async ({
    assert,
  }) => {
    const spec = await vine.validate({
      schema: zimCategoriesSpecSchema,
      data: catalog('kiwix-categories.json'),
    })
    const resources = spec.categories.flatMap((category) =>
      category.tiers.flatMap((tier) => tier.resources)
    )
    const refreshed = resources.filter(
      (resource) =>
        resource.url?.includes('/stack_exchange/') || resource.url?.includes('/wikibooks/')
    )

    assert.lengthOf(refreshed, 13)
    for (const resource of refreshed) {
      assert.equal(resource.version, '2026-10', resource.id)
      assert.match(resource.url ?? '', /_2026-10\.zim$/, resource.id)
    }
  })

  test('Wikiversity and Cooking Book use published November releases', async ({ assert }) => {
    const spec = await vine.validate({
      schema: zimCategoriesSpecSchema,
      data: catalog('kiwix-categories.json'),
    })
    const resources = spec.categories.flatMap((category) =>
      category.tiers.flatMap((tier) => tier.resources)
    )
    for (const id of ['wikiversity_en_all_maxi', 'foss.cooking_en_all']) {
      const resource = resources.find((entry) => entry.id === id)
      assert.exists(resource, id)
      assert.equal(resource?.version, '2026-11', id)
      assert.match(resource?.url ?? '', /_2026-11\.zim$/, id)
    }
  })

  test('React uses the published November DevDocs edition', async ({ assert }) => {
    const spec = await vine.validate({
      schema: zimCategoriesSpecSchema,
      data: catalog('kiwix-categories.json'),
    })
    const react = spec.categories
      .flatMap((category) => category.tiers.flatMap((tier) => tier.resources))
      .find((resource) => resource.id === 'devdocs_en_react')
    assert.equal(react?.version, '2026-11')
    assert.equal(react?.url, 'https://download.kiwix.org/zim/devdocs/devdocs_en_react_2026-11.zim')
    assert.equal(react?.size_mb, 3)
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
