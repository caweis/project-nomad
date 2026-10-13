import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const catalog = JSON.parse(
  readFileSync(new URL('../../../collections/kiwix-categories.json', import.meta.url), 'utf8')
)
const resources = catalog.categories.flatMap((category: any) =>
  category.tiers.flatMap((tier: any) => tier.resources)
)
const videos = resources.filter((resource: any) =>
  new URL(resource.url).pathname.startsWith('/zim/videos/')
)
assert.ok(videos.length > 0, 'catalog has video ZIMs to classify')
for (const video of videos) {
  assert.equal(video.skip_embedding, true, `${video.id} must stay out of the knowledge base`)
}
console.log(`${videos.length} video ZIM resources classified as browse-only`)
