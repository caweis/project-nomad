import type { SpecResource } from '../../types/collections.js'

/**
 * Pure predicate for "is this a resource the manifest gates behind an
 * entitlement key?" (Ported from upstream #1172.)
 *
 * Deliberately kept free of runtime imports (the SpecResource import is
 * type-only and erased at compile time):
 *  - hosted_content_auth.ts holds the env-reading side; importing `#start/env`
 *    here would trigger env validation at module load and break any consumer
 *    running outside a configured app context.
 *  - The standalone harness (`node --experimental-strip-types`) can only
 *    import source files whose runtime imports are `node:*` or type-only, so
 *    this module stays directly testable.
 *
 * Note: resolveZimDownload (zim_download_resolution.ts) checks the same field
 * inline rather than importing this predicate — a runtime `./hosted_content.js`
 * specifier would not resolve under the standalone harness that tests that
 * module. The `auth?: 'nomad_app_key'` literal type on SpecResource keeps both
 * sites compiler-checked against the same value.
 */

/** The only gating scheme we support today. See SpecResource.auth. */
export const NOMAD_APP_KEY_AUTH = 'nomad_app_key' as const

export function isGatedResource(resource: Pick<SpecResource, 'auth'>): boolean {
  return resource.auth === NOMAD_APP_KEY_AUTH
}
