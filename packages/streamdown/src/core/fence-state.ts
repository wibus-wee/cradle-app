/**
 * Scan content for an unclosed fenced code block.
 * Returns the language string if found, null otherwise.
 *
 * Logic: scan for ``` or ~~~ at line starts. Track open/close.
 * The last fence is "open" if there's an odd number of fence markers
 * with the same style (backtick vs tilde).
 */

const WHITESPACE_SPLIT = /\s/

/**
 * Parse a fence line. Returns fence info or null if not a fence.
 * Avoids regex backtracking by using string operations.
 */
function parseFenceLine(line: string): { fenceChars: string, rest: string } | null {
  // Strip up to 3 leading spaces
  let start = 0
  while (start < 3 && start < line.length && line[start] === ' ') {
    start++
  }

  const fenceChar = line[start]
  if (fenceChar !== '`' && fenceChar !== '~') {
    return null
  }

  let end = start
  while (end < line.length && line[end] === fenceChar) {
    end++
  }

  const fenceLen = end - start
  if (fenceLen < 3) {
    return null
  }

  return { fenceChars: line.slice(start, end), rest: line.slice(end) }
}

export function findOpenFenceLanguage(content: string): string | null {
  const lines = content.split('\n')
  const stack: { type: 'backtick' | 'tilde', count: number, language: string }[] = []

  for (const line of lines) {
    const parsed = parseFenceLine(line)
    if (!parsed) {
      continue
    }

    const { fenceChars, rest: rawRest } = parsed
    const type: 'backtick' | 'tilde' = fenceChars[0] === '`' ? 'backtick' : 'tilde'
    const count = fenceChars.length
    const rest = rawRest.trim()

    // Check if this is a closing fence for the current open block
    if (stack.length > 0) {
      const top = stack.at(-1)!
      if (type === top.type && count >= top.count && rest === '') {
        stack.pop()
        continue
      }
    }

    // Opening fence: backtick fences cannot have backticks in info string
    if (type === 'backtick' && rest.includes('`')) {
      continue
    }

    const language = rest.split(WHITESPACE_SPLIT)[0].toLowerCase()
    stack.push({ type, count, language })
  }

  if (stack.length === 0) {
    return null
  }
  return stack.at(-1)!.language
}

/**
 * Languages that should bypass the CPS smoother entirely when in an open fence.
 * When streaming HTML/SVG inside a fence, the smoother causes broken renders.
 */
export const BYPASS_FENCE_LANGUAGES = new Set(['html', 'svg', 'xml', 'htm'])

/**
 * Returns true if the content currently has an open fence in a bypass language.
 */
export function shouldBypassSmoother(content: string): boolean {
  const language = findOpenFenceLanguage(content)
  if (language === null) {
    return false
  }
  return BYPASS_FENCE_LANGUAGES.has(language)
}
