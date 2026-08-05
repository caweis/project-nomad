/**
 * Standalone test for curated ZIM download resolution (fork-native #1091).
 *
 *   node --experimental-strip-types tests/standalone/zim_download_resolution.standalone.ts
 *
 * The pure decision: given a curated manifest resource (pinned dated URL +
 * version) and the live catalog's current entry for the same book (or null
 * when the lookup failed / book is missing), pick the URL+version to
 * download. The catalog wins unless it is OLDER than the manifest; versions
 * compare numerically so 2026-10 beats 2026-2.
 */
import assert from 'node:assert/strict'
import { resolveZimDownload } from '../../app/utils/zim_download_resolution.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const manifestResource = {
  version: '2025-12',
  url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2025-12.zim',
}

check('live catalog result replaces stale manifest URL and version', () => {
  const resolved = resolveZimDownload(manifestResource, {
    version: '2026-06',
    download_url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2026-06.zim',
  })
  assert.deepEqual(resolved, {
    url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2026-06.zim',
    version: '2026-06',
  })
})

check('missing catalog result falls back to the static manifest', () => {
  assert.deepEqual(resolveZimDownload(manifestResource, null), {
    url: manifestResource.url,
    version: manifestResource.version,
  })
})

check('older catalog result does not replace newer manifest metadata', () => {
  const resolved = resolveZimDownload(manifestResource, {
    version: '2025-09',
    download_url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2025-09.zim',
  })
  assert.equal(resolved.url, manifestResource.url)
  assert.equal(resolved.version, manifestResource.version)
})

check('equal catalog version resolves to the catalog URL (filename may differ)', () => {
  const resolved = resolveZimDownload(manifestResource, {
    version: '2025-12',
    download_url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2025-12.zim',
  })
  assert.equal(resolved.version, '2025-12')
  assert.equal(
    resolved.url,
    'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2025-12.zim'
  )
})

check('non-padded months are compared numerically (2026-10 > 2026-2)', () => {
  const resource = {
    version: '2026-2',
    url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2026-2.zim',
  }
  const resolved = resolveZimDownload(resource, {
    version: '2026-10',
    download_url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2026-10.zim',
  })
  assert.equal(
    resolved.url,
    'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2026-10.zim'
  )
  assert.equal(resolved.version, '2026-10')
})

check('unparseable versions fall back to locale comparison without throwing', () => {
  const resolved = resolveZimDownload(
    { version: 'rolling', url: 'https://example.org/book_rolling.zim' },
    { version: 'stable', download_url: 'https://example.org/book_stable.zim' }
  )
  // 'stable' > 'rolling' lexicographically, so the catalog entry wins.
  assert.equal(resolved.version, 'stable')
})

// ---- Gated, self-hosted content (upstream #1172) ----
//
// Resources gated behind an entitlement key (`auth: 'nomad_app_key'`) are
// pinned to the manifest URL. They are not in the openzim catalog, so a
// catalog match can only ever be a resource-id collision, and following it
// would swap the content for a third party's AND drop the Authorization
// header.

const gatedResource = {
  version: '2026-07',
  url: 'https://gated.example.org/content/field-manuals_2026-07.zim',
  auth: 'nomad_app_key' as const,
}

check('gated resource ignores a newer catalog result and stays on the manifest URL', () => {
  const resolved = resolveZimDownload(gatedResource, {
    version: '2026-12',
    download_url: 'https://download.kiwix.org/zim/other/field-manuals_2026-12.zim',
  })
  assert.deepEqual(resolved, {
    url: gatedResource.url,
    version: gatedResource.version,
  })
})

check('gated resource resolves normally with no catalog result', () => {
  assert.deepEqual(resolveZimDownload(gatedResource, null), {
    url: gatedResource.url,
    version: gatedResource.version,
  })
})

check('absent auth leaves catalog precedence untouched', () => {
  const resolved = resolveZimDownload(manifestResource, {
    version: '2026-06',
    download_url: 'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2026-06.zim',
  })
  assert.equal(
    resolved.url,
    'https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2026-06.zim'
  )
})

console.log(`\nzim_download_resolution: ${passed}/9 checks passed`)
