export const WORLD_BASEMAP_FILENAME = 'world.pmtiles'
export const WORLD_BASEMAP_MAX_ZOOM = 5
export const WORLD_BASEMAP_SOURCE_NAME = 'world'
export const PMTILES_BINARY_PATH = '/usr/local/bin/pmtiles'
export const PROTOMAPS_BUILDS_METADATA_URL = 'https://build-metadata.protomaps.dev/builds.json'
export const PROTOMAPS_BUILD_BASE_URL = 'https://build.protomaps.com'

export function latestProtomapsBuild(raw: unknown): { key: string; url: string } {
  if (!Array.isArray(raw)) throw new Error('Invalid Protomaps build metadata')
  const keys = raw
    .filter(
      (item): item is { key: string; size: number } =>
        item &&
        typeof item.key === 'string' &&
        /^\d{8}\.pmtiles$/.test(item.key) &&
        typeof item.size === 'number' &&
        Number.isFinite(item.size) &&
        item.size > 0
    )
    .map((item) => item.key)
    .sort()
  const key = keys.at(-1)
  if (!key) throw new Error('No valid Protomaps build found')
  return { key, url: `${PROTOMAPS_BUILD_BASE_URL}/${key}` }
}

export function worldBasemapExtractArgs(sourceUrl: string, outputPath: string): string[] {
  return [
    'extract',
    sourceUrl,
    outputPath,
    `--maxzoom=${WORLD_BASEMAP_MAX_ZOOM}`,
    '--download-threads=4',
  ]
}
