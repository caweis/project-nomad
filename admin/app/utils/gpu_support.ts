/** Keep unknown or hybrid controllers out of an Intel-only verdict. */
export function hasOnlyIntelGpus(controllers: ReadonlyArray<{ vendor?: string | null }>): boolean {
  return (
    controllers.length > 0 && controllers.every(({ vendor }) => /\bintel\b/i.test(vendor ?? ''))
  )
}

/** Custom images and an explicitly enabled Vulkan backend need their own capability probe. */
export function isBundledOllamaWithoutVulkan(config: {
  Image?: string
  Env?: string[] | null
}): boolean {
  const officialImage =
    /^(?:docker\.io\/)?ollama\/ollama(?::[^@]+)?(?:@sha256:[a-f0-9]{64})?$/.test(config.Image ?? '')
  const vulkanEnabled = (config.Env ?? []).some((entry) =>
    /^OLLAMA_VULKAN=(?:1|true|yes|on)$/i.test(entry)
  )
  return officialImage && !vulkanEnabled
}
