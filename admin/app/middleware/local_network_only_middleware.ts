import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Local-network-only gate for endpoints that must never accept requests from
 * the public internet — currently the Workshop file upload, but reusable for
 * other upload surfaces (e.g. Knowledge Base RAG documents).
 *
 * Decision (2026-05-11, Chris): socket IP only, no X-Forwarded-For inspection.
 * NOMAD is an offline LAN appliance; the primary perimeter is the host's port
 * mapping, this gate is defense-in-depth at the application layer.
 *
 * In practice, because the admin runs inside Docker with userland-proxy, the
 * socket peer the container sees for LAN clients is the docker-bridge gateway
 * (an RFC1918 address) — that's intentional and still satisfies the gate.
 *
 * Accept iff `request.ip()` resolves to one of:
 *   • IPv4 RFC1918 — 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   • IPv4 loopback — 127.0.0.0/8
 *   • IPv4 link-local — 169.254.0.0/16
 *   • IPv6 loopback — ::1
 *   • IPv6 link-local — fe80::/10
 *   • IPv4-mapped IPv6 — ::ffff:<v4> (unwrapped and checked against v4 rules)
 */

export interface LocalNetworkCheck {
  permitted: boolean
  reason?: string
  observed_ip: string
}

/**
 * Pure helper — given an Adonis Request, returns whether the source IP is in
 * a local-network range. Exported so controllers can call it directly (e.g.
 * the `uploadPermitted()` endpoint that the UI uses to decide whether to
 * render the drop zone).
 */
export function isLocalNetworkRequest(request: HttpContext['request']): LocalNetworkCheck {
  const ip = request.ip() ?? ''
  if (isPrivateIp(ip)) {
    return { permitted: true, observed_ip: ip }
  }
  return {
    permitted: false,
    reason: 'Upload is enabled only from devices on your local network.',
    observed_ip: ip,
  }
}

/**
 * Adonis named middleware. Registered as `localNetworkOnly` in start/kernel.ts.
 * Reject with 403 + clear message so the client can render an honest error.
 */
export default class LocalNetworkOnlyMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const check = isLocalNetworkRequest(ctx.request)
    if (!check.permitted) {
      return ctx.response.forbidden({
        error: 'Uploads disabled for non-local-network requests.',
        observed_ip: check.observed_ip,
      })
    }
    return next()
  }
}

// ─── IP-range matching (no external deps; small + auditable) ─────────────────

export function isPrivateIp(rawIp: string): boolean {
  if (!rawIp) return false

  // Strip IPv6 zone-id suffix (e.g. fe80::1%eth0 → fe80::1)
  const ip = rawIp.split('%')[0].toLowerCase()

  // Unwrap IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.5 → 192.168.1.5)
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIpv4(mapped[1])

  // IPv6 loopback
  if (ip === '::1') return true

  // IPv6 link-local fe80::/10 — first 10 bits 1111 1110 10 → first hextet
  // matches fe80–febf, i.e. fe[89ab][0-9a-f]
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true

  // Plain IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return isPrivateIpv4(ip)

  return false
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10))
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false
  }
  const [a, b] = parts
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 127 ||
    (a === 169 && b === 254)
  )
}
