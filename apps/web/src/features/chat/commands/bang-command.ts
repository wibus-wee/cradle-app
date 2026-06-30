// Parses Composer bang commands before normal chat submission.
export function readBangCommand(text: string): string | null {
  const normalized = text.trimStart()
  if (!normalized.startsWith('!')) {
    return null
  }
  if (normalized.includes('\n') || normalized.includes('\r')) {
    return null
  }

  const command = normalized.slice(1)
  if (command.length === 0 || command.startsWith(' ') || command.startsWith('\t')) {
    return null
  }

  const trimmed = command.trim()
  return trimmed.length > 0 ? trimmed : null
}
