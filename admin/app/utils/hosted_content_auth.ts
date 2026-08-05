import env from '#start/env'
import type { SpecResource } from '../../types/collections.js'
import { isGatedResource } from './hosted_content.js'

/**
 * Auth for curated content served from a gated, self-hosted source.
 * (Ported from upstream #1172.)
 *
 * Upstream keeps such content in a private R2 bucket behind an entitlement
 * Worker that requires a bearer key only their official release builds bake in
 * (a CI secret fed through a Dockerfile ARG, reusing CREATOR_PACKS_APP_KEY).
 * This fork ships no Creator Packs and bakes in no key: the operator sets
 * HOSTED_CONTENT_APP_KEY themselves — the macOS compose forwards it from the
 * installer's --env-file — when a manifest entry points at a gated server they
 * run.
 *
 * A manifest resource opts in with `auth: 'nomad_app_key'`. Everything else
 * keeps downloading unauthenticated exactly as before.
 *
 * Deliberately still dispatches with no header when the key is absent: the
 * gated server answers 401 and the download fails fast with the entitlement
 * message (see GatedContentAuthError in downloads.ts), which is a more useful
 * signal than a silent no-op.
 *
 * The pure `isGatedResource` predicate lives in hosted_content.ts so modules
 * that must not pull in env validation can still use it.
 */
export function getHostedContentHeaders(
  resource: Pick<SpecResource, 'auth'>
): Record<string, string> | undefined {
  if (!isGatedResource(resource)) return undefined

  const appKey = env.get('HOSTED_CONTENT_APP_KEY')
  if (!appKey) return undefined

  return { Authorization: `Bearer ${appKey}` }
}
