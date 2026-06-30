export function buildAgentAvatarUrl(style: string | null, seed: string | null): string | null {
  if (style === 'external-url') {
    return seed && seed.trim().length > 0 ? seed : null
  }
  if (style === 'lobehub-icon') {
    return null
  }
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style ?? 'bottts')}/svg?seed=${encodeURIComponent(seed ?? 'default')}`
}
