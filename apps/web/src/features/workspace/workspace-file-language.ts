const MONACO_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: 'shell',
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cxx: 'cpp',
  dart: 'dart',
  diff: 'diff',
  dockerfile: 'dockerfile',
  go: 'go',
  gql: 'graphql',
  graphql: 'graphql',
  h: 'c',
  hpp: 'cpp',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  md: 'markdown',
  mdx: 'markdown',
  php: 'php',
  proto: 'protobuf',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sass: 'sass',
  scss: 'scss',
  sh: 'shell',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'plaintext',
  vue: 'html',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zig: 'zig',
  zsh: 'shell',
}

const SHIKI_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  css: 'css',
  cxx: 'cpp',
  dart: 'dart',
  diff: 'diff',
  dockerfile: 'dockerfile',
  go: 'go',
  gql: 'graphql',
  graphql: 'graphql',
  h: 'c',
  hpp: 'cpp',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  lua: 'lua',
  md: 'markdown',
  mdx: 'markdown',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sass: 'sass',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zig: 'zig',
  zsh: 'bash',
}

const SPECIAL_FILE_LANGUAGES: Record<string, { monaco: string, shiki: string }> = {
  dockerfile: { monaco: 'dockerfile', shiki: 'dockerfile' },
  makefile: { monaco: 'makefile', shiki: 'makefile' },
}

export function getWorkspaceFileName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

export function getWorkspaceFileExtension(path: string): string {
  const fileName = getWorkspaceFileName(path)
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex > -1 ? fileName.slice(dotIndex + 1).toLowerCase() : ''
}

export function isWorkspaceMarkdownFile(path: string): boolean {
  const extension = getWorkspaceFileExtension(path)
  return extension === 'md' || extension === 'mdx'
}

export function getMonacoLanguage(path: string): string {
  const fileName = getWorkspaceFileName(path).toLowerCase()
  const special = SPECIAL_FILE_LANGUAGES[fileName]
  if (special) {
    return special.monaco
  }
  return MONACO_LANGUAGE_BY_EXTENSION[getWorkspaceFileExtension(path)] ?? 'plaintext'
}

export function getShikiLanguage(path: string): string {
  const fileName = getWorkspaceFileName(path).toLowerCase()
  const special = SPECIAL_FILE_LANGUAGES[fileName]
  if (special) {
    return special.shiki
  }
  return SHIKI_LANGUAGE_BY_EXTENSION[getWorkspaceFileExtension(path)] ?? 'plaintext'
}
