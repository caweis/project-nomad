/**
 * Pure mapper from low-level dockerode error text to a message a non-technical
 * user can act on. Extracted from DockerService so it can be unit-tested under
 * `node --experimental-strip-types` without booting Adonis or touching Docker.
 *
 * Ported from upstream commit 7288a0b (fix(system): show a clear message when a
 * service port is already in use, #934). The fork keeps the method
 * `DockerService._humanizeDockerError` as a thin wrapper that passes the
 * fork's Ollama service name (`SERVICE_NAMES.OLLAMA`) in.
 */

/**
 * Translate a raw dockerode error message into something actionable. Currently
 * handles host port conflicts — the most common install failure, where a
 * service can't bind its port because something on the host already holds it
 * (classic case: a native Ollama install owns 11434). Returns the original
 * message unchanged for anything we don't recognize.
 *
 * @param rawMessage  the raw error message (error.message ?? String(error))
 * @param serviceName the service being installed (used to special-case Ollama)
 * @param ollamaServiceName the SERVICE_NAMES.OLLAMA value (passed in so this
 *        module imports nothing app-specific and stays standalone-testable)
 */
export function humanizeDockerError(
  rawMessage: string,
  serviceName: string,
  ollamaServiceName: string
): string {
  const raw = rawMessage
  // dockerode surfaces port conflicts as e.g.
  //   "...Bind for 0.0.0.0:11434 failed: port is already allocated"
  //   "...listen tcp 0.0.0.0:8090: bind: address already in use"
  const portMatch = raw.match(
    /(?:Bind for [^:]+:(\d+) failed: port is already allocated|:(\d+): bind: address already in use)/i
  )
  if (portMatch) {
    const port = portMatch[1] || portMatch[2]
    const portText = port ? `port ${port}` : 'a required port'
    if (port === '11434' || serviceName === ollamaServiceName) {
      return `Couldn't start because ${portText} is already in use on this machine. This usually means Ollama is already installed and running directly on the host (outside NOMAD). Stop and disable the host Ollama service (e.g. "sudo systemctl stop ollama" then "sudo systemctl disable ollama"), then try again.`
    }
    return `Couldn't start because ${portText} is already in use on this machine. Stop whatever is using ${portText} on the host, then try again.`
  }

  // Image/tag not found in the registry. dockerode surfaces this as e.g.
  //   "(HTTP code 404) ... manifest unknown"
  //   "manifest for <ref> not found: manifest unknown"
  //   "pull access denied for <ref>, repository does not exist or may require 'docker login'"
  if (
    /manifest unknown|not found: manifest|manifest for .+ not found|pull access denied|repository does not exist/i.test(
      raw
    )
  ) {
    return `Couldn't pull the image from the registry — it returned "not found". The image tag is likely wrong, removed, or private. Check this service's container image reference, then try again.`
  }

  return raw
}
