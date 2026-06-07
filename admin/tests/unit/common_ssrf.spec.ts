import { test } from '@japa/runner'
import { assertNotPrivateUrl } from '../../app/validators/common.js'

// Must be blocked — loopback / link-local / unspecified / cloud-IMDS, in every
// encoding. The bracketed-IPv6 cases are the live bypass this fix closes.
const BLOCKED = [
  'http://localhost/',
  'http://127.0.0.1/',
  'http://127.0.0.5:8080/x',
  'http://0.0.0.0/',
  'http://169.254.169.254/latest/meta-data/', // IPv4 cloud IMDS
  'http://[::1]/', // IPv6 loopback (was bypassing)
  'http://[::]/', // IPv6 unspecified
  'http://[fe80::1]/', // IPv6 link-local
  'http://[::ffff:127.0.0.1]/', // IPv4-mapped loopback (was bypassing)
  'http://[::ffff:169.254.169.254]/', // IPv4-mapped IMDS (was bypassing)
  'http://[::ffff:a9fe:a9fe]/', // same, hex form
  'http://[0:0:0:0:0:ffff:a9fe:a9fe]/', // same, fully expanded
  'http://[fd00:ec2::254]/', // AWS IPv6 IMDS (was bypassing)
  'http://[fd00:ec2:0:0:0:0:0:254]/', // AWS IPv6 IMDS, expanded
]

// Must be allowed — RFC1918 LAN, DNS names, and public addresses (NOMAD is a
// LAN appliance; users mirror content on their own network).
const ALLOWED = [
  'http://192.168.1.10/file.zim',
  'http://10.0.0.5:8080/x',
  'http://172.16.4.4/x',
  'http://my-nas:8080/file.zim',
  'http://example.com/x',
  'http://8.8.8.8/x',
  'http://[2606:4700:4700::1111]/x', // public IPv6 (Cloudflare DNS)
]

test.group('assertNotPrivateUrl (SSRF guard)', () => {
  for (const url of BLOCKED) {
    test(`blocks ${url}`, ({ assert }) => {
      assert.throws(() => assertNotPrivateUrl(url))
    })
  }
  for (const url of ALLOWED) {
    test(`allows ${url}`, ({ assert }) => {
      assert.doesNotThrow(() => assertNotPrivateUrl(url))
    })
  }
})
