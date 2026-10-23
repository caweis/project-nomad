import { lookup } from 'node:dns'
import type { LookupFunction } from 'node:net'
import { assertNotPrivateUrl } from '../validators/common.js'

export function validateResolvedAddress(address: string): void {
  const authority = address.includes(':') ? `[${address}]` : address
  assertNotPrivateUrl(`http://${authority}/`)
}

/** Reject blocked DNS answers at connection time, including after a redirect. */
export const safeRemoteLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '')
    if (addresses.length === 0) return callback(new Error('Remote host has no addresses'), '')
    try {
      for (const address of addresses) validateResolvedAddress(address.address)
    } catch {
      return callback(new Error('Remote host resolved to a blocked address'), '')
    }
    if (options.all) return callback(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}
