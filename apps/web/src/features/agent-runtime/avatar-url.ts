export function buildAvatarUrl(style: string, seed: string): string | null {
  if (style === 'external-url') {
    return seed
  }
  if (style === 'lobehub-icon') {
    return null
  }
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`
}
