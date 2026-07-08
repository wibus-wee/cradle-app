export const DEFAULT_TERMINAL_FONT_FAMILY = [
  '"JetBrainsMono Nerd Font"',
  '"Cascadia Code"',
  '"Fira Mono"',
  'monospace',
].join(', ')

export function getTerminalFontFamily(fontFamily: string | null | undefined): string {
  const customFontFamily = fontFamily?.trim() ?? ''
  return customFontFamily.length > 0 ? customFontFamily : DEFAULT_TERMINAL_FONT_FAMILY
}
