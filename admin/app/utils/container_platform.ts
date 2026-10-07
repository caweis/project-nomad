/**
 * The platform to ask Docker for when an app's image is built for one
 * architecture only (for upstream #1292's translation image).
 *
 * Almost every image the Supply Depot ships is multi-architecture, and Docker
 * picks the right one for the host. The translation engine is not: it is built
 * on Bergamot's intgemm backend, which is x86 only, and its image is published
 * for linux/amd64 alone. On an Apple Silicon Mac, asked for plain
 * `ghcr.io/...:0.1.1`, Docker looks for an arm64 build. Depending on how the
 * image was published and which image store Docker uses, that can end in a
 * refused pull or in an amd64 container started with only a warning. Naming
 * the platform takes the guess out: Docker pulls and creates the amd64 image,
 * and the engine's x86 emulation (Rosetta, where it is switched on) runs it.
 *
 * The platform is declared by the app's own container config (a top-level
 * `platform` key, beside HostConfig and Env) so it travels with the app: it
 * survives an edit, because edits merge into the existing config rather than
 * rebuilding it, and it applies to install, update and recreate alike.
 *
 * Pure and import-free.
 */
const PLATFORM_PATTERN = /^linux\/(amd64|arm64)(\/v\d+)?$/

export function platformFromContainerConfig(config: unknown): string | undefined {
  if (!config || typeof config !== 'object') return undefined
  const platform = (config as { platform?: unknown }).platform
  return typeof platform === 'string' && PLATFORM_PATTERN.test(platform) ? platform : undefined
}
