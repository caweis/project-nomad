import { test } from '@japa/runner'
import assert from 'node:assert/strict'
import {
  normalizeLibraryBaseUrl,
  parseLibraryListing,
  resolveLibraryPath,
} from '../../app/utils/custom_library_url.js'
import { safeRemoteLookup, validateResolvedAddress } from '../../app/utils/safe_remote_lookup.js'

test.group('custom Kiwix library URL guard', () => {
  test('normalizes an HTTPS mirror root and preserves a LAN mirror', () => {
    assert.equal(
      normalizeLibraryBaseUrl('https://mirror.example.org/kiwix/zim'),
      'https://mirror.example.org/kiwix/zim/'
    )
    assert.equal(
      normalizeLibraryBaseUrl('http://192.168.1.20:8080/books/'),
      'http://192.168.1.20:8080/books/'
    )
  })

  test('rejects credentials, fragments, query strings, and local metadata targets', () => {
    for (const url of [
      'https://user:secret@mirror.example.org/zim/',
      'https://mirror.example.org/zim/?token=x',
      'https://mirror.example.org/zim/#section',
      'file:///tmp/zim/',
      'http://127.0.0.1/zim/',
      'http://169.254.169.254/latest/',
    ]) {
      assert.throws(() => normalizeLibraryBaseUrl(url), url)
    }
  })

  test('resolves a relative directory but refuses to leave the saved root', () => {
    const base = 'https://mirror.example.org/kiwix/zim/'
    assert.equal(resolveLibraryPath(base, 'wikipedia/'), base + 'wikipedia/')
    assert.equal(resolveLibraryPath(base, ''), base)
    for (const path of [
      '../private/',
      '%2e%2e/private/',
      '/admin/',
      '//other.example.org/',
      'wikipedia/?token=x',
      'wikipedia/#part',
    ]) {
      assert.throws(() => resolveLibraryPath(base, path), path)
    }
  })

  test('accepts LAN DNS results and blocks loopback, link-local, and metadata addresses', () => {
    validateResolvedAddress('192.168.1.20')
    validateResolvedAddress('10.0.0.7')
    validateResolvedAddress('8.8.8.8')
    for (const address of ['127.0.0.1', '::1', '169.254.169.254', '0.0.0.0']) {
      assert.throws(() => validateResolvedAddress(address), address)
    }
  })

  test('rejects a hostname that resolves to loopback at connection time', async () => {
    await new Promise<void>((resolve, reject) => {
      safeRemoteLookup('localhost', { all: false }, (error) => {
        if (!error) return reject(new Error('Loopback DNS result was accepted'))
        resolve()
      })
    })
  })

  test('keeps only in-root directories and ZIM files from a listing', () => {
    const base = 'https://mirror.example.org/kiwix/zim/'
    const html = `<pre>
<a href="../">Parent Directory</a>
<a href="wikipedia/">wikipedia/</a>
<a href="guide%20books/">guide books/</a>
<a href="guide_en_2026-10.zim">guide_en_2026-10.zim</a>  2026-10-01 12:00  5.1G
<a href="https://elsewhere.example/file.zim">offsite.zim</a>
<a href="%2e%2e/private.zim">private.zim</a>
<a href="malware.exe">malware.exe</a>
</pre>`
    const listing = parseLibraryListing(html, base, base)
    assert.deepEqual(
      listing.directories.map((entry) => entry.path),
      ['guide%20books/', 'wikipedia/']
    )
    assert.deepEqual(
      listing.files.map((entry) => entry.name),
      ['guide_en_2026-10.zim']
    )
    assert.equal(listing.files[0].size_bytes, Math.round(5.1 * 1024 ** 3))
  })

  test('refuses a listing fetched from a different host or outside the saved root', () => {
    const base = 'https://mirror.example.org/kiwix/zim/'
    assert.throws(() => parseLibraryListing('', 'https://elsewhere.example/kiwix/zim/', base))
    assert.throws(() => parseLibraryListing('', 'https://mirror.example.org/admin/', base))
  })
})
