/**
 * Standalone checks that dark mode's accent text stays readable.
 *
 *   node --experimental-strip-types tests/standalone/dark_mode_contrast.standalone.ts
 *
 * Ported from upstream's dark_mode_contrast.spec.ts (02fe66e9, c9a1a763). Theirs
 * is node:test, which this fork's tests/unit glob would load under Japa and
 * report green having registered nothing, so it lives here instead.
 *
 * The accent green (#525530) stays dark so white button text on it keeps its
 * contrast, which means text drawn IN the accent on a dark surface measured
 * 1.6-2.2:1. Chat links sit on surface-secondary, the worst of the three.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../../inertia/css/app.css', import.meta.url), 'utf8')
const builderTagSelector = readFileSync(
  new URL('../../inertia/components/BuilderTagSelector.tsx', import.meta.url),
  'utf8'
)

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const darkTheme = css.match(/\[data-theme="dark"\]\s*\{(?<tokens>[\s\S]*?)\n\}/)?.groups?.tokens
if (!darkTheme) throw new Error('dark theme token block must exist')

function token(name: string): string {
  const value = darkTheme!.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
  assert.ok(value, `${name} must be defined in the dark theme`)
  return value
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const surfaces = () => [
  token('--color-desert-sand'),
  token('--color-desert-white'),
  token('--color-surface-secondary'),
]

check('the old accent really was unreadable as text on the dark surfaces', () => {
  // Pins the premise, so the fix below cannot quietly become pointless.
  for (const surface of surfaces()) {
    assert.ok(contrast(token('--color-desert-green'), surface) < 3, `#525530 on ${surface}`)
  }
})

check('the dark accent foreground clears WCAG AA on every dark surface', () => {
  const accent = token('--color-desert-green-foreground')
  for (const surface of surfaces()) {
    assert.ok(
      contrast(accent, surface) >= 4.5,
      `${accent} on ${surface} must have at least 4.5:1 contrast`
    )
  }
})

check('accent text utilities use the foreground token in dark mode', () => {
  assert.match(
    css,
    /\[data-theme="dark"\] \.text-desert-green\s*\{\s*color:\s*var\(--color-desert-green-foreground\)/
  )
  assert.match(
    css,
    /\[data-theme="dark"\] \.hover\\:text-desert-green:hover\s*\{\s*color:\s*var\(--color-desert-green-foreground\)/
  )
  assert.match(
    css,
    /\[data-theme="dark"\] \.hover\\:text-desert-green\\\/80:hover\s*\{[^}]*var\(--color-desert-green-foreground\)/
  )
  assert.match(
    css,
    /\[data-theme="dark"\] \.group-hover\\:text-desert-green:is\(:where\(\.group\):hover \*\)\s*\{\s*color:\s*var\(--color-desert-green-foreground\)/
  )
})

check('the accent background itself is unchanged and keeps white text readable', () => {
  assert.equal(token('--color-desert-green').toLowerCase(), '#525530')
  assert.ok(contrast('#ffffff', token('--color-desert-green')) >= 4.5)
})

check('Builder Tag controls pair their stone background with semantic text', () => {
  const controls = builderTagSelector.match(
    /className="[^"]*bg-desert-stone-lighter[^"]*text-text-primary[^"]*"/g
  )
  assert.equal(controls?.length, 3, 'the two selects and the number should use semantic text')
  assert.ok(contrast(token('--color-text-primary'), token('--color-desert-stone-lighter')) >= 4.5)
})

console.log(`\n${passed} passed`)
