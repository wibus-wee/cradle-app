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
  const customFontFamily = fontFamily?.trim() ?? ''
  return customFontFamily.length > 0 ? customFontFamily : DEFAULT_TERMINAL_FONT_FAMILY
}
