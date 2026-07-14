export interface ComposerPastedText {
  id: string
  text: string
  lineCount: number
  charCount: number
}

export const PASTED_TEXT_MIN_LINES = 25
export const PASTED_TEXT_MIN_CHARS = 4_000

const TRAILING_PASTED_TEXT_BLOCK_PATTERN = /\n*<pasted_text>\n([\s\S]*?)\n<\/pasted_text>\s*$/

export function normalizePastedText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function countPastedTextLines(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length
}

export function shouldCollapsePastedText(text: string): boolean {
  const normalized = normalizePastedText(text)
  return (
    normalized.length >= PASTED_TEXT_MIN_CHARS
    || countPastedTextLines(normalized) >= PASTED_TEXT_MIN_LINES
  )
}

export function createComposerPastedText(
  text: string,
  id: string = crypto.randomUUID(),
): ComposerPastedText {
  const normalized = normalizePastedText(text)
  return {
    id,
    text: normalized,
    lineCount: countPastedTextLines(normalized),
    charCount: normalized.length,
  }
}

export function pastedTextTitle(text: string): string {
  const line = normalizePastedText(text)
    .split('\n')
    .map(value => value.trim())
    .find(Boolean)
  if (!line) {
    return 'Pasted text'
  }
  return line.length > 100 ? `${line.slice(0, 97)}...` : line
}

export function appendPastedTextsToPrompt(
  prompt: string,
  pastedTexts: readonly Pick<ComposerPastedText, 'text'>[],
): string {
  if (pastedTexts.length === 0) {
    return prompt.trim()
  }
  const payload = JSON.stringify(
    pastedTexts.map(item => ({ text: normalizePastedText(item.text) })),
  )
  const block = `<pasted_text>\n${payload}\n</pasted_text>`
  const trimmed = prompt.trim()
  return trimmed ? `${trimmed}\n\n${block}` : block
}

export function extractPastedTextsFromPrompt(prompt: string): {
  text: string
  pastedTexts: ComposerPastedText[]
} {
  const match = TRAILING_PASTED_TEXT_BLOCK_PATTERN.exec(prompt)
  if (!match) {
    return { text: prompt, pastedTexts: [] }
  }
  try {
    const parsed = JSON.parse(match[1] ?? '') as Array<{ text: string }>
    if (!Array.isArray(parsed)) {
      return { text: prompt, pastedTexts: [] }
    }
    return {
      text: prompt.slice(0, match.index).replace(/\n+$/, ''),
      pastedTexts: parsed
        .filter(item => item && typeof item.text === 'string')
        .map((item, index) => createComposerPastedText(item.text, `history-paste-${index}`)),
    }
  }
 catch {
    return { text: prompt, pastedTexts: [] }
  }
}
