import type { ModelVisionCapability } from '../../types/ollama'

/**
 * What the chat box says about attaching images (upstream edbfe1ad), by what is
 * known about the selected model.
 *
 * Images are not kept. They travel with the one message that carries them, so a
 * follow-up question cannot refer back to them. Saying so at the point of
 * attaching is kinder than letting the second question get an answer about
 * nothing.
 */
export const IMAGE_NOTICE =
  'Images are sent only with the message they are attached to. They are not saved, so ask about them in that message; they disappear after you send them or reload this page.'

export function visionAttachmentGuidance(capability: ModelVisionCapability): string {
  if (capability === 'unsupported') {
    return 'This model cannot use images. Choose a model whose Input Type includes Image in Models & Settings.'
  }
  if (capability === 'unknown') {
    return `NOMAD cannot confirm whether this model accepts images. You can try one, but the request will fail if the model is text-only. ${IMAGE_NOTICE}`
  }
  return IMAGE_NOTICE
}
