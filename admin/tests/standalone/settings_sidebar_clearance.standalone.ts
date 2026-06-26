/**
 * Standalone gate test: every settings page clears the fixed sidebar.
 *
 * StyledSidebar's desktop rail is `xl:fixed xl:w-72` (out of flow), so the
 * SettingsLayout content area spans full width and the rail overlaps its left
 * edge. Each page rendered inside SettingsLayout must add `xl:pl-72` to its top
 * container, or its content renders under the rail and the left ~288px is
 * clipped. grocy.tsx forgot this and shipped a decapitated Food Readiness page
 * (every helper line cut off on the left). This guard catches the next page
 * that forgets. Run:
 *   node --experimental-strip-types tests/standalone/settings_sidebar_clearance.standalone.ts
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const settingsDir = join(here, '../../inertia/pages/settings')

let p = 0
const check = (n: string, f: () => void) => {
  f()
  p++
  console.log(`  ok - ${n}`)
}

// Top-level settings pages only. Subdirectories (e.g. zim/) are excluded: they
// can compose their own layout, so the flat-page clearance rule does not apply.
const pages = readdirSync(settingsDir, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
  .map((e) => e.name)
  .sort()

check('found the settings pages', () => {
  assert.ok(pages.length >= 8, `expected several settings pages, found ${pages.length}`)
})

for (const name of pages) {
  const src = readFileSync(join(settingsDir, name), 'utf8')
  // Only pages that actually mount SettingsLayout owe the clearance. A page that
  // composes a different layout is out of scope for this rule.
  if (!src.includes('SettingsLayout')) continue
  check(`${name} clears the fixed sidebar (xl:pl-72)`, () => {
    assert.ok(
      src.includes('xl:pl-72'),
      `${name} mounts SettingsLayout but is missing xl:pl-72; its content renders under the fixed sidebar`
    )
  })
}

console.log(`\n${p} checks passed`)
