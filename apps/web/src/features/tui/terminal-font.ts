export const DEFAULT_TERMINAL_FONT_FAMILY = [
  'ui-monospace',
  'SFMono-Regular',
  'Menlo',
  'Monaco',
  'Consolas',
  '"Liberation Mono"',
  '"Courier New"',
  'monospace',
].join(', ')

export function getTerminalFontFamily(fontFamily: string | null | undefined): string {
  if (typeof document !== 'undefined' && document.documentElement.dataset.themeCodeFont === 'true') {
    const themeFontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
    if (themeFontFamily) {
      return themeFontFamily
    }
  }

  const customFontFamily = fontFamily?.trim() ?? ''
  return customFontFamily.length > 0 ? customFontFamily : DEFAULT_TERMINAL_FONT_FAMILY
}
