/**
 * Resolve a container-registry tag-list pagination "next" URL.
 *
 * Per the OCI/Docker registry spec the Link-header `rel="next"` URL is relative
 * (e.g. "/v2/<repo>/tags/list?last=<tag>&n=1000"). Passing that raw relative
 * string straight to fetch() throws "Failed to parse URL", which silently broke
 * the update check for any repo with more than 1000 tags (ollama/ollama,
 * filebrowser/filebrowser) — the app then looked pinned at its installed
 * version. Resolving the next URL against the registry origin fixes the
 * second-page fetch; an already-absolute next URL passes through unchanged.
 *
 * Ported from upstream 5de58da (#945).
 */
export function resolveNextPageUrl(rawNextUrl: string, registry: string): string {
  return new URL(rawNextUrl, `https://${registry}`).toString()
}
