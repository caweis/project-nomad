/**
 * Standalone gate test for the IP policy that guards the mutating
 * /api/system/services and POST /api/host-commands/:cmd routes.
 *
 * The route group itself is wired with `.use(middleware.localNetworkOnly())` in
 * start/routes.ts (same precedent as the Workshop upload route). The policy those
 * routes enforce lives in `isPrivateIp` / `isLocalNetworkRequest` in
 * app/middleware/local_network_only_middleware.ts. That helper is already pure and
 * exported, so we exercise it directly here rather than duplicating the logic.
 *
 * Japa cannot boot locally without MySQL/Redis, so this runs under
 * `node --experimental-strip-types`. Run:
 *   node --experimental-strip-types tests/standalone/system_services_gate.standalone.ts
 *
 * Mirrors the shape of tests/standalone/readiness_pets.standalone.ts (node:assert/strict,
 * a check() counter). Asserts the gate's IP policy: public IPs are rejected;
 * RFC1918 / loopback / link-local / IPv6 loopback / IPv4-mapped-IPv6 are accepted.
 */
import assert from 'node:assert/strict'
import {
  isPrivateIp,
  isLocalNetworkRequest,
} from '../../app/middleware/local_network_only_middleware.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// ── Public / routable IPs are REJECTED ────────────────────────────────────────
check('rejects public IPv4 addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.7', '172.32.0.1', '172.15.255.255']) {
    assert.equal(isPrivateIp(ip), false, `${ip} must be rejected as public`)
  }
})

check('rejects public IPv6 addresses', () => {
  for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, `${ip} must be rejected as public`)
  }
})

check('rejects an empty / missing IP', () => {
  assert.equal(isPrivateIp(''), false)
})

check('rejects garbage and out-of-range octets', () => {
  for (const ip of ['not-an-ip', '999.999.999.999', '256.1.1.1', '10.0.0']) {
    assert.equal(isPrivateIp(ip), false, `${ip} must not be treated as private`)
  }
})

// ── RFC1918 IPv4 is ACCEPTED ──────────────────────────────────────────────────
check('accepts RFC1918 10.0.0.0/8', () => {
  for (const ip of ['10.0.0.1', '10.255.255.254']) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be accepted`)
  }
})

check('accepts RFC1918 172.16.0.0/12 (and rejects just outside it)', () => {
  assert.equal(isPrivateIp('172.16.0.1'), true)
  assert.equal(isPrivateIp('172.31.255.254'), true)
  assert.equal(isPrivateIp('172.15.0.1'), false)
  assert.equal(isPrivateIp('172.32.0.1'), false)
})

check('accepts RFC1918 192.168.0.0/16', () => {
  assert.equal(isPrivateIp('192.168.0.1'), true)
  assert.equal(isPrivateIp('192.168.1.5'), true)
})

// ── Loopback / link-local ─────────────────────────────────────────────────────
check('accepts IPv4 loopback 127.0.0.0/8', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true)
  assert.equal(isPrivateIp('127.1.2.3'), true)
})

check('accepts IPv4 link-local 169.254.0.0/16', () => {
  assert.equal(isPrivateIp('169.254.1.1'), true)
})

check('accepts IPv6 loopback ::1', () => {
  assert.equal(isPrivateIp('::1'), true)
})

check('accepts IPv6 link-local fe80::/10', () => {
  assert.equal(isPrivateIp('fe80::1'), true)
  assert.equal(isPrivateIp('febf::abcd'), true)
})

check('strips an IPv6 zone-id before matching link-local', () => {
  assert.equal(isPrivateIp('fe80::1%eth0'), true)
})

// ── IPv4-mapped IPv6 is unwrapped and checked against the v4 rules ─────────────
check('accepts IPv4-mapped IPv6 for a private v4', () => {
  assert.equal(isPrivateIp('::ffff:192.168.1.5'), true)
  assert.equal(isPrivateIp('::ffff:10.0.0.1'), true)
})

check('rejects IPv4-mapped IPv6 for a public v4', () => {
  assert.equal(isPrivateIp('::ffff:8.8.8.8'), false)
})

// ── isLocalNetworkRequest wrapper (what the middleware actually calls) ─────────
check('isLocalNetworkRequest permits a private socket IP', () => {
  const result = isLocalNetworkRequest({ ip: () => '192.168.1.10' } as never)
  assert.equal(result.permitted, true)
  assert.equal(result.observed_ip, '192.168.1.10')
})

check('isLocalNetworkRequest denies a public socket IP with a reason', () => {
  const result = isLocalNetworkRequest({ ip: () => '8.8.8.8' } as never)
  assert.equal(result.permitted, false)
  assert.equal(result.observed_ip, '8.8.8.8')
  assert.ok((result.reason ?? '').length > 0)
})

check('isLocalNetworkRequest denies when the socket IP is missing', () => {
  const result = isLocalNetworkRequest({ ip: () => undefined } as never)
  assert.equal(result.permitted, false)
})

console.log(`\n${passed} checks passed`)
