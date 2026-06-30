import type { Root } from 'mdast'
import type { Plugin } from 'unified'

interface RemarkIncompleteOptions {
  enabled?: boolean
}

// Module-level regex constants
const INCOMPLETE_LINK_RE = /\[([^\]]*)\]\(([^)]*$)/gm
const INCOMPLETE_IMAGE_RE = /!\[([^\]]*)\]\(([^)]*$)/gm
const FENCE_OPEN_RE = /^(`{3,}|~{3,})/gm
const FENCE_CHAR_STRIP_RE = /[^`~]/g
const INLINE_BACKTICK_RE = /(?<!`)`(?!`)/g
const MATH_BLOCK_RE = /\$\$/g
const MATH_BLOCK_STRIP_RE = /\$\$[\s\S]*?\$\$/g
const INLINE_MATH_RE = /(?<!\$)\$(?!\$)/g
const BOLD_OPEN_RE = /\*\*(?!\*)/g
const BOLD_CLOSE_RE = /(?<!\*)\*\*/g
const TRAILING_BOLD_RE = /\*\*[^*]+$/
const BOLD_PAIR_RE = /\*\*/g
const TRAILING_ITALIC_RE = /(?<!\*)\*[^*]+$/
const ITALIC_SINGLE_RE = /(?<!\*)\*(?!\*)/g
const INCOMPLETE_HTML_RE = /<([a-z][a-z0-9]*(\s[^>]*)?)$/gim

const FENCE_OPEN_LINE_RE = /^(?:`{3,}|~{3,})/
const FENCE_CLOSE_LINE_RE = /^(?:`{3,}|~{3,})\s*$/
const FENCE_PREFIX_RE = /^[`~]+/

/**
 * Strip fenced code blocks from text using line-by-line scanning.
 * Avoids super-linear backtracking regex patterns.
 */
function stripFencedBlocks(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let fenceChar: string | null = null
  let fenceLen = 0

  for (const line of lines) {
    const m = FENCE_OPEN_LINE_RE.exec(line)
    if (m) {
      if (fenceChar === null) {
        fenceChar = line[0]
        fenceLen = m[0].length
      }
 else if (line[0] === fenceChar && FENCE_CLOSE_LINE_RE.test(line)) {
        const prefixMatch = FENCE_PREFIX_RE.exec(line)
        if (prefixMatch && prefixMatch[0].length >= fenceLen) {
          fenceChar = null
          fenceLen = 0
        }
      }
      continue
    }
    if (fenceChar === null) {
      result.push(line)
    }
  }
  return result.join('\n')
}

export function patchIncomplete(md: string): string {
  let result = md

  // 1. Incomplete links: [text](url without closing )
  result = result.replace(INCOMPLETE_LINK_RE, '[$1](streamdown:incomplete-link)')

  // 7. Incomplete image: ![alt](url without closing )
  result = result.replace(INCOMPLETE_IMAGE_RE, '![$1](streamdown:incomplete-link)')

  // 2. Unclosed code fences
  const fenceMatches = result.match(FENCE_OPEN_RE)
  if (fenceMatches && fenceMatches.length % 2 !== 0) {
    const lastFence = fenceMatches.at(-1)
    if (lastFence) {
      const marker = lastFence.replace(FENCE_CHAR_STRIP_RE, '').slice(0, 3)
      result = `${result}\n${marker}`
    }
  }

  // 3. Unclosed inline code (odd backticks outside fenced blocks)
  // Count backticks that are not part of fenced code blocks
  const withoutFences = stripFencedBlocks(result)
  const inlineBackticks = withoutFences.match(INLINE_BACKTICK_RE)
  if (inlineBackticks && inlineBackticks.length % 2 !== 0) {
    result = `${result}\``
  }

  // 4. Unclosed math blocks ($$)
  const mathBlockMatches = result.match(MATH_BLOCK_RE)
  if (mathBlockMatches && mathBlockMatches.length % 2 !== 0) {
    result = `${result}\n$$`
  }

  // 5. Unclosed inline math ($) - exclude $$ already handled
  const withoutMathBlocks = result.replace(MATH_BLOCK_STRIP_RE, '')
  const inlineMathMatches = withoutMathBlocks.match(INLINE_MATH_RE)
  if (inlineMathMatches && inlineMathMatches.length % 2 !== 0) {
    result = `${result}$`
  }

  // 6. Unclosed bold/italic
  // Check for unclosed ** (bold)
  const boldMatches = result.match(BOLD_OPEN_RE)
  const boldCloseMatches = result.match(BOLD_CLOSE_RE)
  if (boldMatches && boldCloseMatches) {
    if (boldMatches.length > boldCloseMatches.length / 2) {
      // odd pairing
    }
  }
  // Simpler approach: check trailing unclosed markers
  const trimmed = result.trimEnd()
  if (TRAILING_BOLD_RE.test(trimmed) && (trimmed.match(BOLD_PAIR_RE) || []).length % 2 !== 0) {
    result = `${result}**`
  }
 else if (TRAILING_ITALIC_RE.test(trimmed) && (trimmed.match(ITALIC_SINGLE_RE) || []).length % 2 !== 0) {
    result = `${result}*`
  }

  // 8. Incomplete HTML tag: <tagname without >
  result = result.replace(INCOMPLETE_HTML_RE, '<$1>')

  return result
}

const remarkIncomplete: Plugin<[RemarkIncompleteOptions?], Root> = function (options) {
  const enabled = options?.enabled ?? true
  if (!enabled) {
    return
  }

  const originalParse = this.parse.bind(this)

  this.parse = function (doc: string) {
    const patched = patchIncomplete(doc)
    return originalParse(patched)
  } as typeof this.parse
}

export default remarkIncomplete
