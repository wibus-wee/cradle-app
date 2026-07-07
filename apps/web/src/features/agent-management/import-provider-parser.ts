import type { ApiProviderKind } from '~/features/agent-runtime/types'

export interface ParsedUrl {
  url: string
  kind: ApiProviderKind | 'unknown'
}

export interface ParsedProvider {
  providerKind: ApiProviderKind
  name: string
  apiKey: string
  baseUrl: string
}

export interface ParseResult {
  token: string | null
  urls: ParsedUrl[]
  providers: ParsedProvider[]
}

const URL_RE = /https?:\/\/[\w.~:/?#[\]@!$&()*+,;=%-]+/g

const ENV_VAR_DEFS: { prefix: string, providerKind: ApiProviderKind }[] = [
  { prefix: 'ANTHROPIC_', providerKind: 'anthropic' },
  { prefix: 'OPENAI_', providerKind: 'openai-compatible' },
]

function extractUrls(text: string): string[] {
  const matches = text.match(URL_RE)
  if (!matches) { return [] }
  return [...new Set(matches.map(u => u.replace(/[^\w/\-:.]+$/, '')))]
}

function classifyUrl(url: string): ApiProviderKind | 'unknown' {
  const lower = url.toLowerCase()
  if (lower.includes('/anthropic') || lower.includes('/claude')) { return 'anthropic' }
  if (lower.includes('/v1') || lower.includes('/openai') || lower.includes('/chat/completions')) { return 'openai-compatible' }
  return 'unknown'
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  }
 catch {
    return url
  }
}

// ── export KEY=VALUE parsing ──

const EXPORT_LINE_RE = /^\s*export\s+(\w+)\s*=\s*(.+)\s*$/gm

function cleanExportValue(raw: string): string {
  let v = raw.trim()
  // strip surrounding quotes (ASCII + Chinese)
  if (v.length >= 2) {
    const first = v[0]
    const last = v.at(-1) ?? ''
    const isQuote = (c: string) => c === '"' || c === '\'' || c === '“' || c === '”' || c === '‘' || c === '’' || c === '`'
    if (isQuote(first) && first === last) {
      v = v.slice(1, -1).trim()
    }
 else if (isQuote(first) && isQuote(last)) {
      // mismatched quotes e.g. "“...”"
      v = v.slice(1, -1).trim()
    }
  }
  return v
}

interface EnvGroup {
  baseUrl?: string
  apiKey?: string
}

function parseExportGroups(text: string): Map<ApiProviderKind, EnvGroup> {
  const groups = new Map<ApiProviderKind, EnvGroup>()
  const matches = text.matchAll(EXPORT_LINE_RE)

  for (const [, key, value] of matches) {
    const upper = key.toUpperCase()
    for (const def of ENV_VAR_DEFS) {
      if (!upper.startsWith(def.prefix)) { continue }
      const suffix = upper.slice(def.prefix.length)
      const clean = cleanExportValue(value)

      let group = groups.get(def.providerKind)
      if (!group) {
        group = {}
        groups.set(def.providerKind, group)
      }

      if (suffix === 'BASE_URL' || suffix === 'ENDPOINT' || suffix === 'BASE_URL_OVERRIDE') {
        group.baseUrl = clean
      }
 else if (
        suffix === 'AUTH_TOKEN'
        || suffix === 'API_KEY'
        || suffix === 'API_SECRET'
        || suffix === 'SECRET_KEY'
      ) {
        group.apiKey = clean
      }
      break
    }
  }

  return groups
}

// ── freetext token detection ──

function isKeyLike(token: string): number {
  if (token.length < 6) { return 0 }

  let hasUpper = false
  let hasLower = false
  let hasDigit = false
  let hasSpecial = false
  const charCounts = new Map<string, number>()

  for (const ch of token) {
    if (ch >= 'A' && ch <= 'Z') { hasUpper = true }
    else if (ch >= 'a' && ch <= 'z') { hasLower = true }
    else if (ch >= '0' && ch <= '9') { hasDigit = true }
    else { hasSpecial = true }
    charCounts.set(ch, (charCounts.get(ch) ?? 0) + 1)
  }

  let entropy = 0
  const len = token.length
  for (const count of charCounts.values()) {
    const p = count / len
    entropy -= p * Math.log2(p)
  }

  const types = [hasUpper, hasLower, hasDigit, hasSpecial].filter(Boolean).length
  return entropy * len * (1 + types * 0.3)
}

const COMMON_WORDS = new Set([
  'the',
'and',
'for',
'are',
'but',
'not',
'you',
'all',
'can',
'had',
  'her',
'was',
'one',
'our',
'out',
'has',
'have',
'from',
'they',
  'this',
'that',
'with',
'your',
'which',
'their',
'them',
'about',
  'token',
'key',
'api',
'base64',
'secret',
'http',
'https',
  'compatible',
'interface',
'protocol',
'openai',
'anthropic',
  'export',
'base_url',
'auth_token',
'api_key',
])

const KNOWN_API_KEY_RE = /(?:^|[^\w-])((?:sk-ant-|sk-|tp-|ak-|key-|api-)[A-Z0-9][\w.+/=-]{5,})/i

function candidateTokens(text: string): string[] {
  const withoutUrls = text.replace(URL_RE, ' ')
  const tokens = withoutUrls.split(/[\s,.;:：；，。、]+/).filter(Boolean)
  return tokens.filter((t) => {
    const cleaned = t.replace(/[^\w\-+.=/]+$/g, '')
    if (COMMON_WORDS.has(cleaned.toLowerCase())) { return false }
    if (cleaned.length < 6) { return false }
    return true
  })
}

function detectFreeToken(text: string): string | null {
  const knownKeyMatch = text.match(KNOWN_API_KEY_RE)
  if (knownKeyMatch?.[1]) { return knownKeyMatch[1] }

  const tokens = candidateTokens(text)
  const scored = tokens
    .map(t => ({ token: t, score: isKeyLike(t) }))
    .sort((a, b) => b.score - a.score)

  if (scored.length > 0 && scored[0].score > 0) { return scored[0].token }

  return tokens.reduce<string | null>(
    (best, t) => (t.length > (best?.length ?? 0) ? t : best),
    null,
  )
}

// ── base64 detection ──

const BASE64_RE = /^[\w+/=-]+$/

// Common API key prefixes — keys starting with these are already plaintext
const KNOWN_KEY_PREFIXES = ['sk-', 'sk-ant-', 'tp-', 'ak-', 'key-', 'api-']

function tryDecodeBase64(token: string): string {
  const lower = token.toLowerCase()
  if (KNOWN_KEY_PREFIXES.some(p => lower.startsWith(p))) { return token }
  if (!BASE64_RE.test(token) || token.length < 16) { return token }
  // standardise URL-safe base64 to standard base64
  const standardised = token.replace(/-/g, '+').replace(/_/g, '/')
  try {
    const padded = standardised.padEnd(Math.ceil(standardised.length / 4) * 4, '=')
    const binary = globalThis.atob(padded)
    const decoded = new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)))
    // decoded must be printable text with no null bytes or control chars
    if (!decoded || /[\x00-\x08\v\f\x0E-\x1F]/.test(decoded)) { return token }
    return decoded.trim()
  }
 catch {
    return token
  }
}

function tryDecodeBase64Config(text: string): string | null {
  const trimmed = text.trim()
  if (!BASE64_RE.test(trimmed) || trimmed.length < 16) { return null }

  const decoded = tryDecodeBase64(trimmed)
  if (decoded === trimmed) { return null }
  if (!decoded.includes('http') && !decoded.includes('{') && !decoded.includes('export ')) { return null }

  return decoded
}

// ── JSON snippet parsing ──

interface JsonObject { [key: string]: unknown }

/**
 * Known JSON field names for API key and base URL.
 * Covers New API, One API, and similar gateways.
 */
const JSON_KEY_FIELDS = ['key', 'apiKey', 'api_key', 'token', 'secret_key', 'secretKey']
const JSON_URL_FIELDS = ['url', 'baseUrl', 'base_url', 'endpoint', 'baseURL']

function tryParseJsonSnippet(text: string): JsonObject | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) { return null }
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null
        ? parsed[0] as JsonObject
        : null
    }
    return typeof parsed === 'object' && parsed !== null ? parsed as JsonObject : null
  }
  catch {
    return null
  }
}

function extractFromJsonObject(obj: JsonObject): { apiKey?: string, baseUrl?: string } {
  let apiKey: string | undefined
  let baseUrl: string | undefined

  for (const field of JSON_KEY_FIELDS) {
    if (typeof obj[field] === 'string' && obj[field]) {
      apiKey = obj[field] as string
      break
    }
  }

  for (const field of JSON_URL_FIELDS) {
    if (typeof obj[field] === 'string' && obj[field]) {
      baseUrl = obj[field] as string
      break
    }
  }

  return { apiKey, baseUrl }
}

// ── main ──

function parseProviderConfigText(text: string): ParseResult {
  // 0. Try JSON snippet first (most structured)
  const jsonObj = tryParseJsonSnippet(text)
  if (jsonObj) {
    const { apiKey: jsonKey, baseUrl: jsonUrl } = extractFromJsonObject(jsonObj)
    if (jsonKey || jsonUrl) {
      const urls: ParsedUrl[] = jsonUrl ? [{ url: jsonUrl, kind: classifyUrl(jsonUrl) }] : []
      const providers: ParsedProvider[] = []
      if (jsonUrl) {
        const kind = classifyUrl(jsonUrl)
        providers.push({
          providerKind: kind === 'unknown' ? 'openai-compatible' : kind,
          name: hostnameFromUrl(jsonUrl),
          apiKey: jsonKey ?? '',
          baseUrl: jsonUrl,
        })
      }
      return { token: jsonKey ?? null, urls, providers }
    }
  }

  const exportGroups = parseExportGroups(text)

  const urls = extractUrls(text).map(url => ({
    url,
    kind: classifyUrl(url),
  }))

  const freeToken = detectFreeToken(text)

  const providers: ParsedProvider[] = []
  const seen = new Set<string>()

  function addProvider(kind: ApiProviderKind, name: string, baseUrl: string, apiKey: string) {
    if (!baseUrl) { return }
    // dedupe by (baseUrl + apiKey) — same URL with different key is allowed
    const dedupeKey = `${baseUrl}\0${apiKey}`
    if (seen.has(dedupeKey)) { return }
    seen.add(dedupeKey)
    providers.push({ providerKind: kind, name, apiKey, baseUrl })
  }

  // 1. Export groups (most reliable) — decode base64 keys
  for (const [kind, group] of exportGroups) {
    if (group.baseUrl && group.apiKey) {
      addProvider(kind, hostnameFromUrl(group.baseUrl), group.baseUrl, tryDecodeBase64(group.apiKey))
    }
  }

  // 2. Export token + remaining URLs of matching kind
  for (const [kind, group] of exportGroups) {
    if (!group.apiKey) { continue }
    const decodedKey = tryDecodeBase64(group.apiKey)
    for (const u of urls) {
      const urlKind = u.kind === 'unknown' ? kind : u.kind
      if (urlKind === kind) {
        addProvider(kind, hostnameFromUrl(u.url), u.url, decodedKey)
      }
    }
  }

  // 3. Freetext token + remaining URLs
  const rawToken
    = [...exportGroups.values()].find(g => g.apiKey)?.apiKey ?? freeToken
  const bestToken = rawToken ? tryDecodeBase64(rawToken) : null

  for (const u of urls) {
    const kind = u.kind === 'unknown' ? 'openai-compatible' : u.kind
    addProvider(kind as ApiProviderKind, hostnameFromUrl(u.url), u.url, bestToken ?? '')
  }

  return { token: bestToken, urls, providers }
}

export function parseProviderConfig(text: string): ParseResult {
  const decodedConfig = tryDecodeBase64Config(text)
  if (decodedConfig) {
    const decodedResult = parseProviderConfigText(decodedConfig)
    if (decodedResult.token || decodedResult.urls.length > 0 || decodedResult.providers.length > 0) {
      return decodedResult
    }
  }

  return parseProviderConfigText(text)
}
