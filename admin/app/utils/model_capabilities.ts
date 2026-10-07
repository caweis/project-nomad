import type { ModelVisionCapability } from '../../types/ollama.js'

/**
 * Whether a model accepts images, from the `capabilities` array /api/show
 * returns (upstream edbfe1ad and 26f40baf).
 *
 * Three answers, because there are three situations:
 *
 * - Native Ollama lists `vision` for a model that can see, and lists
 *   capabilities without it for one that cannot. That is authoritative.
 * - Ollama before its `capabilities` field returns none at all. Not knowing is
 *   not the same as no, so the attempt is allowed.
 * - The oMLX proxy fills the field with a placeholder (["completion"]) so the
 *   thinking check cannot trip over an undefined. It says nothing about what
 *   the MLX model can do, so on that backend the answer is always 'unknown'.
 *   Believing it would lock image upload for every vision model on MLX.
 *
 * Capability is read from /api/show only, never from the installed-model list.
 * Upstream 26f40baf fixes the opposite habit: its list reports gemma3 as
 * ['completion'] while /api/show for the same model reports ['completion',
 * 'vision'], so trusting the list disabled images for one of the commonest small
 * vision models. This fork never asked the list, which is why that fix needs no
 * code here.
 */
export function visionFromShow(
  capabilities: unknown,
  backend: string | undefined
): ModelVisionCapability {
  if (backend === 'omlx') return 'unknown'
  if (!Array.isArray(capabilities) || capabilities.length === 0) return 'unknown'
  if (!capabilities.every((item) => typeof item === 'string')) return 'unknown'
  return capabilities.includes('vision') ? 'supported' : 'unsupported'
}
