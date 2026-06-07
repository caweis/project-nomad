import vine from '@vinejs/vine'
import ipaddr from 'ipaddr.js'

/**
 * Checks whether a URL points to a loopback or link-local address.
 * Used to prevent SSRF — the server should not fetch from localhost
 * or link-local/metadata endpoints (e.g. cloud instance metadata at 169.254.169.254).
 *
 * RFC1918 private ranges (10.x, 172.16-31.x, 192.168.x) are intentionally
 * ALLOWED because NOMAD is a LAN appliance and users may host content
 * mirrors on their local network.
 *
 * Hostnames are canonicalized with ipaddr.js so EVERY encoding of a blocked
 * address is rejected — IPv4-mapped IPv6 (::ffff:127.0.0.1, ::ffff:a9fe:a9fe),
 * fully-expanded forms (0:0:0:0:0:ffff:a9fe:a9fe), and bracketed IPv6 literals.
 * (The previous regex-only guard matched bracketed patterns, but URL.hostname
 * strips the brackets, so the IPv6 patterns never fired — a live SSRF bypass.)
 *
 * Throws if the URL is a loopback, link-local, unspecified, or cloud-metadata
 * address.
 */
export function assertNotPrivateUrl(urlString: string): void {
  const parsed = new URL(urlString)
  // WHATWG URL keeps brackets on IPv6 literals (`http://[::1]/` → `[::1]`); strip them.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  // Not an IP literal → a DNS name. Block the obvious `localhost` alias; allow
  // everything else (LAN names like `my-nas` stay usable). DNS rebinding is out
  // of scope — it would need a resolve-and-recheck at fetch time.
  if (!ipaddr.isValid(hostname)) {
    if (hostname === 'localhost') {
      throw new Error(`Download URL must not point to localhost: ${hostname}`)
    }
    return
  }

  let addr: ipaddr.IPv4 | ipaddr.IPv6 = ipaddr.parse(hostname)
  // Unwrap IPv4-mapped IPv6 so the range check sees the embedded IPv4 address
  // regardless of how it was written.
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address()
  }

  // Block loopback, link-local (covers the 169.254.169.254 cloud IMDS), and the
  // unspecified address — in both families. RFC1918 / LAN ranges are deliberately
  // NOT blocked (appliance use on the user's own network).
  const BLOCKED_RANGES = new Set(['loopback', 'linkLocal', 'unspecified'])
  if (BLOCKED_RANGES.has(addr.range())) {
    throw new Error(`Download URL must not point to a loopback or link-local address: ${hostname}`)
  }

  // AWS also exposes IMDS over IPv6 at fd00:ec2::254, which sits in fc00::/7
  // (unique-local) that we otherwise allow as LAN — block that one address in
  // every encoding via its normalized form.
  if (addr.kind() === 'ipv6') {
    const IMDS_V6 = ipaddr.parse('fd00:ec2::254').toNormalizedString()
    if ((addr as ipaddr.IPv6).toNormalizedString() === IMDS_V6) {
      throw new Error(`Download URL must not point to the cloud instance metadata endpoint: ${hostname}`)
    }
  }
}

export const remoteDownloadValidator = vine.compile(
  vine.object({
    url: vine
      .string()
      .url({ require_tld: false }) // Allow LAN URLs (e.g. http://my-nas:8080/file.zim)
      .trim(),
  })
)

export const remoteDownloadWithMetadataValidator = vine.compile(
  vine.object({
    url: vine
      .string()
      .url({ require_tld: false }) // Allow LAN URLs
      .trim(),
    metadata: vine
      .object({
        title: vine.string().trim().minLength(1),
        summary: vine.string().trim().optional(),
        author: vine.string().trim().optional(),
        size_bytes: vine.number().optional(),
      })
      .optional(),
  })
)

export const remoteDownloadValidatorOptional = vine.compile(
  vine.object({
    url: vine
      .string()
      .url({ require_tld: false }) // Allow LAN URLs
      .trim()
      .optional(),
  })
)

export const filenameParamValidator = vine.compile(
  vine.object({
    params: vine.object({
      filename: vine.string().trim().minLength(1).maxLength(4096),
    }),
  })
)

export const downloadCollectionValidator = vine.compile(
  vine.object({
    slug: vine.string(),
  })
)

export const downloadCategoryTierValidator = vine.compile(
  vine.object({
    categorySlug: vine.string().trim().minLength(1),
    tierSlug: vine.string().trim().minLength(1),
  })
)

export const selectWikipediaValidator = vine.compile(
  vine.object({
    optionId: vine.string().trim().minLength(1),
  })
)

const resourceUpdateInfoBase = vine.object({
  resource_id: vine.string().trim().minLength(1),
  resource_type: vine.enum(['zim', 'map'] as const),
  installed_version: vine.string().trim(),
  latest_version: vine.string().trim().minLength(1),
  download_url: vine.string().url({ require_tld: false }).trim(),
})

export const applyContentUpdateValidator = vine.compile(resourceUpdateInfoBase)

export const applyAllContentUpdatesValidator = vine.compile(
  vine.object({
    updates: vine
      .array(resourceUpdateInfoBase)
      .minLength(1),
  })
)
