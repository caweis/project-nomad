/**
 * Standalone test for the benchmark platform-metadata helpers (upstream #1158,
 * fork-adapted).
 *
 *   node --experimental-strip-types tests/standalone/platform_metadata.standalone.ts
 *
 * deriveOsName splits the distro name out of the daemon's free-form
 * OperatingSystem string; detectContainerEngine identifies which macOS
 * container VM (or none) runs the daemon. Architecture mapping is NOT tested
 * here — that is the existing mapDockerArch, covered by
 * host_arch.standalone.ts.
 *
 * Fixtures: Ubuntu/Debian/RHEL shapes come from upstream's observed daemon
 * output; the OrbStack / Docker Desktop / colima shapes are the ones this
 * fork's supported engines report.
 */
import assert from 'node:assert/strict'
import { deriveOsName, detectContainerEngine } from '../../app/utils/platform_metadata.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// --- deriveOsName ---

check('takes the name preceding the version', () => {
  assert.equal(deriveOsName('Ubuntu 24.04.4 LTS', '24.04'), 'Ubuntu')
  assert.equal(deriveOsName('Ubuntu 26.04 LTS', '26.04'), 'Ubuntu')
})

check('handles multi-word distro names', () => {
  assert.equal(deriveOsName('Debian GNU/Linux 12 (bookworm)', '12'), 'Debian GNU/Linux')
  assert.equal(deriveOsName('Red Hat Enterprise Linux 9.4 (Plow)', '9.4'), 'Red Hat Enterprise Linux')
})

check('null version falls back to the full description', () => {
  assert.equal(deriveOsName('Ubuntu 24.04.4 LTS', null), 'Ubuntu 24.04.4 LTS')
})

check('empty version falls back to the full description', () => {
  assert.equal(deriveOsName('Ubuntu 24.04.4 LTS', ''), 'Ubuntu 24.04.4 LTS')
})

check('whitespace-only version falls back to the full description', () => {
  assert.equal(deriveOsName('Ubuntu 24.04.4 LTS', '   '), 'Ubuntu 24.04.4 LTS')
})

check('version absent from the description falls back untruncated', () => {
  // Daemons have been known to disagree with themselves; do not truncate on a guess.
  assert.equal(deriveOsName('Alpine Linux v3.20', '3.20.1'), 'Alpine Linux v3.20')
})

check('description beginning with the version falls back whole', () => {
  assert.equal(deriveOsName('12 Debian', '12'), '12 Debian')
})

check('trims surrounding whitespace', () => {
  assert.equal(deriveOsName('  Ubuntu 24.04.4 LTS  ', '24.04'), 'Ubuntu')
})

check('OrbStack shape: bare engine name with no version passes through', () => {
  // This is what the fork's supported engine actually reports — the VM's OS,
  // not macOS. Keeping it verbatim is the honest record.
  assert.equal(deriveOsName('OrbStack', null), 'OrbStack')
})

check('Docker Desktop shape passes through without a version', () => {
  assert.equal(deriveOsName('Docker Desktop', null), 'Docker Desktop')
})

// --- detectContainerEngine ---

check('OrbStack detected from OS string, kernel, and hostname together', () => {
  assert.equal(
    detectContainerEngine('OrbStack', '6.14.10-orbstack-00291-g1b252bd3edea', 'orbstack'),
    'orbstack'
  )
})

check('OrbStack detected from the kernel marker alone', () => {
  // Survives an OperatingSystem string change in a future OrbStack release.
  assert.equal(detectContainerEngine(null, '6.12.1-orbstack-00299-gf46bcd6e9f01', null), 'orbstack')
})

check('OrbStack detection is case-insensitive', () => {
  assert.equal(detectContainerEngine('ORBSTACK', null, null), 'orbstack')
})

check('Docker Desktop detected from the OS string', () => {
  assert.equal(detectContainerEngine('Docker Desktop', null, null), 'docker-desktop')
})

check('Docker Desktop detected from a linuxkit kernel', () => {
  assert.equal(
    detectContainerEngine(null, '6.10.14-linuxkit', 'docker-desktop'),
    'docker-desktop'
  )
})

check('colima detected from the daemon hostname despite an Ubuntu OS string', () => {
  assert.equal(
    detectContainerEngine('Ubuntu 24.04.2 LTS', '6.8.0-58-generic', 'colima'),
    'colima'
  )
})

check('lima detected from the lima- hostname prefix', () => {
  assert.equal(
    detectContainerEngine('Ubuntu 24.04.2 LTS', '6.8.0-58-generic', 'lima-default'),
    'lima'
  )
})

check('a plain Linux host yields null — no marker, no claim', () => {
  // We cannot distinguish a real Linux box from an unrecognized VM distro
  // using daemon strings alone, so nothing is recorded rather than a guess.
  assert.equal(
    detectContainerEngine('Ubuntu 24.04.4 LTS', '6.8.0-58-generic', 'nomad3'),
    null
  )
})

check('all-null input yields null', () => {
  assert.equal(detectContainerEngine(null, null, null), null)
})

console.log(`\n${passed} passed`)
