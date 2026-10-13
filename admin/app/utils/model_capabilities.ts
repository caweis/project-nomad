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

/**
 * The reason to show beside a failed request: the error's own text on one line,
 * cut short. The page already shows the same for any other failed chat.
 */
export function failureReason(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  const text = error.message.replace(/\s+/g, ' ').trim().slice(0, 200)
  return text === '' ? undefined : text
}

/**
 * What to tell someone whose request carried a picture and failed on a model
 * that never said whether it can see (see visionFromShow). The failure may be
 * anything: a model that cannot see, but equally one that is not installed or
 * too large to load, which is the commonest cause of a failed chat on a Mac. So
 * the message gives the reason the backend gave, says what is not known, and
 * names both causes. It does not say the message box still holds the question,
 * because it does not: it was cleared when the message was sent.
 */
export function unknownVisionFailureMessage(model: string, reason?: string): string {
  return (
    `The request failed${reason ? ` (${reason})` : ''}. It included a picture, and NOMAD ` +
    `cannot tell whether "${model}" can see pictures. If it cannot, try again without the ` +
    `picture. It can also mean "${model}" is not installed or is too large to load on this Mac.`
  )
}
