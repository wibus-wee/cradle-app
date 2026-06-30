const DEFAULT_MAX_TEXT_LENGTH = 64 * 1024

export interface BoundedTextCollector {
  append: (text: string) => void
  read: () => string | undefined
}

export function createBoundedTextCollector(maxLength: number = DEFAULT_MAX_TEXT_LENGTH): BoundedTextCollector {
  const parts: string[] = []
  let length = 0
  let truncated = false

  return {
    append(text: string) {
      if (text.length === 0 || length >= maxLength) {
        truncated ||= text.length > 0
        return
      }

      const available = maxLength - length
      if (text.length > available) {
        parts.push(text.slice(0, available))
        length = maxLength
        truncated = true
        return
      }

      parts.push(text)
      length += text.length
    },
    read() {
      if (parts.length === 0) {
        return undefined
      }
      return truncated
        ? `${parts.join('')}...<truncated>`
        : parts.join('')
    },
  }
}
