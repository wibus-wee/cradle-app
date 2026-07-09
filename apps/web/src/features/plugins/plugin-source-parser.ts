/**
 * Parse a free-form user paste into a structured plugin source descriptor.
 *
 * The C-end "Add plugin" dialog exposes a single text input. Consumers paste
 * whatever they have — a `cradle://` install link, a GitHub URL, an
 * `owner/repo` shorthand, or an npm package name — and this module figures out
 * the `{ kind, location, ref?, subPath? }` shape the `POST /plugins/sources`
 * body expects. No `localPath` is ever produced: local folders are a dev-only
 * path handled by the `cradle plugin source add` CLI, not the Settings UI.
 *
 * Detection is intentionally strict: when in doubt, return `null` and let the
 * dialog show a hint rather than silently shipping a malformed request.
 */

export type ParsedPluginSourceKind = 'git' | 'npm'

export interface ParsedPluginSource {
  kind: ParsedPluginSourceKind
  location: string
  ref?: string
  subPath?: string
}

const GITHUB_REPO_PATTERN = /^([\w.-]+)\/([\w.-]+)$/
const NPM_SCOPED_PATTERN = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/
const NPM_UNSCOPED_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const CRADLE_DEEP_LINK_PREFIX = 'cradle://'

/**
 * Resolve a raw sub-path string into one of three states:
 * - `undefined` — no subPath requested (empty / `.`)
 * - `string` — a valid normalized relative path
 * - `'invalid'` — present but unsafe (traversal / absolute / empty segments);
 *   callers must reject the whole input in this case rather than silently
 *   dropping the subPath and installing from the repo root.
 */
type SubPathResolution = string | undefined | 'invalid'

function resolveSubPath(raw: string): SubPathResolution {
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!trimmed || trimmed === '.') {
    return undefined
  }
  if (trimmed.startsWith('/')) {
    return 'invalid'
  }
  const segments = trimmed.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    return 'invalid'
  }
  return trimmed
}

function subPathOrReject(raw: string): { subPath: string | undefined, valid: boolean } {
  const resolved = resolveSubPath(raw)
  if (resolved === 'invalid') {
    return { subPath: undefined, valid: false }
  }
  return { subPath: resolved, valid: true }
}

function stripGitSuffix(repo: string): string {
  return repo.endsWith('.git') ? repo.slice(0, -'.git'.length) : repo
}

function isAbsoluteLocalPath(input: string): boolean {
  if (input.startsWith('/') || input.startsWith('~')) {
    return true
  }
  return /^[A-Z]:[\\/]/i.test(input)
}

function parseCradleDeepLink(input: string): ParsedPluginSource | null {
  let url: URL
  try {
    url = new URL(input)
  }
  catch {
    return null
  }
  if (url.hostname !== 'plugins' || url.pathname !== '/install') {
    return null
  }
  const repository = url.searchParams.get('repository')?.trim()
  if (!repository || !GITHUB_REPO_PATTERN.test(repository)) {
    return null
  }
  const rawRef = url.searchParams.get('ref')?.trim()
  const rawPath = url.searchParams.get('path')?.trim() ?? ''
  const subPath = subPathOrReject(rawPath)
  if (!subPath.valid) {
    return null
  }
  return {
    kind: 'git',
    location: repository,
    ref: rawRef || undefined,
    subPath: subPath.subPath,
  }
}

function parseGitHubUrl(input: string): ParsedPluginSource | null {
  let url: URL | null = null
  if (/^https?:\/\//i.test(input)) {
    try {
      url = new URL(input)
    }
    catch {
      return null
    }
  }
  else if (/^github\.com\//i.test(input)) {
    try {
      url = new URL(`https://${input}`)
    }
    catch {
      return null
    }
  }

  if (!url) {
    return null
  }
  if (!/^(?:www\.)?github\.com$/i.test(url.hostname)) {
    return null
  }

  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return null
  }
  const owner = parts[0]
  const repo = stripGitSuffix(parts[1])
  if (!GITHUB_REPO_PATTERN.test(`${owner}/${repo}`)) {
    return null
  }
  const location = `${owner}/${repo}`

  if (parts.length >= 4 && parts[2] === 'tree' && parts[3]) {
    const ref = parts[3]
    const subPath = subPathOrReject(parts.slice(4).join('/'))
    if (!subPath.valid) {
      return null
    }
    return { kind: 'git', location, ref, subPath: subPath.subPath }
  }
  return { kind: 'git', location }
}

function parseShorthand(input: string): ParsedPluginSource | null {
  if (input.startsWith('@')) {
    return NPM_SCOPED_PATTERN.test(input)
      ? { kind: 'npm', location: input }
      : null
  }
  if (input.includes('/')) {
    const matched = input.match(GITHUB_REPO_PATTERN)
    if (!matched) {
      return null
    }
    return { kind: 'git', location: `${matched[1]}/${stripGitSuffix(matched[2])}` }
  }
  return NPM_UNSCOPED_PATTERN.test(input)
    ? { kind: 'npm', location: input }
    : null
}

export function parsePluginSourceInput(raw: string): ParsedPluginSource | null {
  const input = raw.trim()
  if (!input) {
    return null
  }
  if (input.startsWith(CRADLE_DEEP_LINK_PREFIX)) {
    return parseCradleDeepLink(input)
  }
  if (isAbsoluteLocalPath(input)) {
    return null
  }
  const fromUrl = parseGitHubUrl(input)
  if (fromUrl) {
    return fromUrl
  }
  return parseShorthand(input)
}

/** True when the input looks like an absolute filesystem path (localPath is CLI-only). */
export function looksLikeLocalPath(raw: string): boolean {
  const input = raw.trim()
  return !!input && isAbsoluteLocalPath(input)
}
