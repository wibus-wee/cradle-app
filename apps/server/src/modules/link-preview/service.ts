import type { Static } from 'elysia'

import { fetchWithRetry } from '../../lib/fetch-retry'
import { resolveSafeFetchTarget } from '../../lib/ssrf-guard'
import type { LinkPreviewModel } from './model'

export type LinkPreview = Static<typeof LinkPreviewModel['preview']>

const CACHE_TTL_MS = 1000 * 60 * 60 // 1 hour
const CACHE_MAX_ENTRIES = 500
const FETCH_TIMEOUT_MS = 8000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024 // 2 MB — OG metadata lives near the top

const USER_AGENT = 'CradleLinkPreview/1.0 (+https://cradle.dev)'

interface CacheEntry {
  data: LinkPreview
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

export async function getPreview(rawUrl: string): Promise<LinkPreview> {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    return emptyPreview('')
  }

  const cached = cache.get(trimmed)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  let target
  try {
    target = await resolveSafeFetchTarget(trimmed)
  }
  catch {
    // SSRF / invalid URL — degrade to a minimal card rather than surfacing an error,
    // so a bad link in content never blocks the editor from rendering.
    const fallback = emptyPreview(trimmed)
    writeCache(trimmed, fallback)
    return fallback
  }

  const preview = await fetchPreview(target)
  writeCache(trimmed, preview)
  return preview
}

async function fetchPreview(target: { url: string, hostname: string }): Promise<LinkPreview> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetchWithRetry(target.url, {
      headers: {
        'user-agent': USER_AGENT,
        'accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    }, { maxRetries: 1 })

    if (!response.ok) {
      return emptyPreview(target.url)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      // Non-HTML target (image, pdf, etc.) — surface the URL itself as the card.
      return {
        url: target.url,
        title: target.hostname,
        description: null,
        image: contentType.startsWith('image/') ? target.url : null,
        siteName: target.hostname,
        favicon: deriveFavicon(target.url),
      }
    }

    const html = await readLimitedText(response)
    const meta = extractOpenGraph(html)
    return {
      url: target.url,
      title: meta.title,
      description: meta.description,
      image: resolveUrl(meta.image, target.url),
      siteName: meta.siteName ?? target.hostname,
      favicon: deriveFavicon(target.url),
    }
  }
  catch {
    return emptyPreview(target.url)
  }
  finally {
    clearTimeout(timeout)
  }
}

async function readLimitedText(response: Response): Promise<string> {
  // OG metadata always appears in <head>, well before 2 MB. Truncating protects us
  // from arbitrarily large HTML bodies.
  const reader = response.body?.getReader()
  if (!reader) {
    return ''
  }
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    bytes += value.byteLength
    text += decoder.decode(value, { stream: true })
    if (bytes >= MAX_RESPONSE_BYTES) {
      break
    }
  }
  text += decoder.decode()
  return text
}

interface ExtractedMeta {
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
}

/**
 * Dependency-free OG/Twitter/meta extractor. OG metadata is a flat set of
 * `<meta property="og:*" content="...">` tags; a tolerant regex scan over the
 * (truncated) HTML is the standard pragmatic unfurling approach and avoids
 * pulling in an HTML parser dependency for a read-only extraction.
 */
function extractOpenGraph(html: string): ExtractedMeta {
  const og = collectMeta(html, 'property')
  const twitter = collectMeta(html, 'name')
  const named = collectMeta(html, 'name')

  const title
    = og.get('og:title')
      ?? twitter.get('twitter:title')
      ?? readTitleTag(html)
      ?? null

  const description
    = og.get('og:description')
      ?? twitter.get('twitter:description')
      ?? named.get('description')
      ?? null

  const image
    = og.get('og:image')
      ?? og.get('og:image:url')
      ?? twitter.get('twitter:image')
      ?? twitter.get('twitter:image:src')
      ?? null

  const siteName = og.get('og:site_name') ?? null

  return {
    title: title ? clean(title) : null,
    description: description ? clean(description) : null,
    image: image ? clean(image) : null,
    siteName: siteName ? clean(siteName) : null,
  }
}

/** Collects `<meta keyAttr="x" content="y">` pairs into a map. */
function collectMeta(html: string, keyAttr: 'property' | 'name'): Map<string, string> {
  const map = new Map<string, string>()
  const metaRe = /<meta\b[^>]*>/gi
  for (const tag of html.matchAll(metaRe)) {
    const node = tag[0]
    const key = readAttr(node, keyAttr)
    if (!key) {
      continue
    }
    const content = readAttr(node, 'content')
    if (content == null) {
      continue
    }
    if (!map.has(key)) {
      map.set(key, content)
    }
  }
  return map
}

function readTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? match[1] : null
}

function readAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = tag.match(re)
  if (!match) {
    return null
  }
  return match[2] ?? match[3] ?? match[4] ?? null
}

function clean(value: string): string {
  return decodeEntities(value).replace(/\s+/g, ' ').trim()
}

const ENTITY_MAP: Record<string, string> = {
  'amp': '&',
  'lt': '<',
  'gt': '>',
  'quot': '"',
  'apos': '\'',
  '#39': '\'',
  'nbsp': ' ',
}

function decodeEntities(value: string): string {
  return value.replace(/&(#?\w+);/g, (full, entity: string) => {
    if (ENTITY_MAP[entity]) {
      return ENTITY_MAP[entity]
    }
    if (entity.startsWith('#')) {
      const code = entity.startsWith('#x')
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      if (Number.isFinite(code)) {
        return String.fromCodePoint(code)
      }
    }
    return full
  })
}

function resolveUrl(value: string | null, base: string): string | null {
  if (!value) {
    return null
  }
  try {
    return new URL(value, base).toString()
  }
  catch {
    return value
  }
}

function deriveFavicon(url: string): string {
  try {
    const parsed = new URL(url)
    return new URL('/favicon.ico', parsed.origin).toString()
  }
  catch {
    return ''
  }
}

function emptyPreview(url: string): LinkPreview {
  let hostname = url
  try {
    hostname = new URL(url).hostname
  }
  catch {
    // keep raw url
  }
  return {
    url,
    title: hostname || null,
    description: null,
    image: null,
    siteName: hostname || null,
    favicon: deriveFavicon(url) || null,
  }
}

function writeCache(key: string, data: LinkPreview): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Evict the oldest entry to bound memory.
    const firstKey = cache.keys().next().value
    if (firstKey) {
      cache.delete(firstKey)
    }
  }
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

export function resetLinkPreviewCacheForTests(): void {
  cache.clear()
}
