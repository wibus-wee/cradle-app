import type { BundledLanguage, BundledTheme, HighlighterGeneric } from 'shiki'

export const LIGHT_THEME = 'github-light'
export const DARK_THEME = 'github-dark'

const POPULAR_LANGS: string[] = [
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'python',
  'rust',
  'go',
  'java',
  'cpp',
  'c',
  'html',
  'css',
  'scss',
  'json',
  'yaml',
  'toml',
  'markdown',
  'bash',
  'shell',
  'sql',
  'graphql',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'dart',
  'dockerfile',
  'lua',
  'zig',
]

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  kt: 'kotlin',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  text: 'plaintext',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'bash',
}

export type ShikiHighlighter = HighlighterGeneric<BundledLanguage, BundledTheme>

let highlighterPromise: Promise<ShikiHighlighter> | null = null
let highlighterInstance: ShikiHighlighter | null = null

export function normalizeLanguage(language: string | null | undefined): string {
  if (!language) {
    return 'plaintext'
  }
  const lower = language.toLowerCase()
  return LANGUAGE_ALIASES[lower] ?? lower
}

export function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki')
      .then(({ createHighlighter }) => createHighlighter({
        themes: [LIGHT_THEME, DARK_THEME],
        langs: POPULAR_LANGS,
      }))
      .then((highlighter) => {
        highlighterInstance = highlighter
        return highlighter
      })
  }
  return highlighterPromise
}

export function getLoadedHighlighter(): ShikiHighlighter | null {
  return highlighterInstance
}

export async function loadLanguage(lang: string): Promise<boolean> {
  const language = normalizeLanguage(lang)
  const highlighter = highlighterInstance ?? await getHighlighter()
  const loaded = highlighter.getLoadedLanguages()
  if (loaded.includes(language)) {
    return true
  }

  const { bundledLanguages } = await import('shiki')
  if (language in bundledLanguages) {
    await highlighter.loadLanguage(language as keyof typeof bundledLanguages)
    return true
  }
  return false
}
