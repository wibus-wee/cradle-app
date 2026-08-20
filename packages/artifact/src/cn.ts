/** Minimal className joiner for the agent kit (no app-local utils). */
export function cn(
  ...parts: Array<string | false | null | undefined | Record<string, boolean | undefined | null>>
): string {
  const classes: string[] = []
  for (const part of parts) {
    if (!part) {
      continue
    }
    if (typeof part === 'string') {
      classes.push(part)
      continue
    }
    for (const [key, enabled] of Object.entries(part)) {
      if (enabled) {
        classes.push(key)
      }
    }
  }
  return classes.join(' ')
}
