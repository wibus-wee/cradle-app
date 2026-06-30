import tocData from '~/assets/lobe-icons-toc.json'

export interface LobeIconEntry {
  id: string
  docsUrl: string
  title: string
  fullTitle: string
  color: string
  group: 'model' | 'provider' | 'application'
  param: {
    hasAvatar: boolean
    hasBrand: boolean
    hasBrandColor: boolean
    hasColor: boolean
    hasCombine: boolean
    hasText: boolean
    hasTextCn: boolean
    hasTextColor: boolean
  }
}

export const lobeIconsToc = tocData as LobeIconEntry[]

// Vite glob import for PNG icons (as URL, for <img> usage)
const darkIcons = import.meta.glob<string>(
  '/node_modules/@lobehub/icons-static-png/dark/*.png',
  { query: '?url', import: 'default' },
)

const lightIcons = import.meta.glob<string>(
  '/node_modules/@lobehub/icons-static-png/light/*.png',
  { query: '?url', import: 'default' },
)

const ICON_PATH_RE = /\/(?:dark|light)\/(.+)\.png$/
const VARIANT_SUFFIX_RE = /-(color|text|brand|brand-color)$/

type Theme = 'dark' | 'light'

/**
 * Get the URL for an icon PNG (colored variant preferred).
 * Returns a promise that resolves to the asset URL or null.
 */
export async function getLobeIconUrl(
  slug: string,
  theme: Theme = 'dark',
): Promise<string | null> {
  const icons = theme === 'dark' ? darkIcons : lightIcons
  // Try color variant first
  const colorKey = `/node_modules/@lobehub/icons-static-png/${theme}/${slug}-color.png`
  if (icons[colorKey]) {
    return await icons[colorKey]()
  }
  // Fallback to base
  const baseKey = `/node_modules/@lobehub/icons-static-png/${theme}/${slug}.png`
  if (icons[baseKey]) {
    return await icons[baseKey]()
  }
  return null
}

// ── Icon catalog (built from actual PNG files) ──

export interface IconCatalogEntry {
  /** The filesystem slug used for loading (e.g. "adobefirefly") */
  slug: string
  /** Display title (from toc if matched, otherwise titleCased slug) */
  title: string
  /** Group from toc or "provider" as default */
  group: 'model' | 'provider' | 'application'
}

// Build a lookup from toc by normalized key (lowercase, no dashes)
const tocByNormalized = new Map<string, LobeIconEntry>()
for (const entry of lobeIconsToc) {
  tocByNormalized.set(entry.docsUrl.replace(/-/g, '').toLowerCase(), entry)
}

function buildIconCatalog(): IconCatalogEntry[] {
  const slugs = new Set<string>()
  for (const path of Object.keys(darkIcons)) {
    const match = ICON_PATH_RE.exec(path)
    if (match) {
      const raw = match[1]
      const base = raw.replace(VARIANT_SUFFIX_RE, '')
      slugs.add(base)
    }
  }

  const entries: IconCatalogEntry[] = []
  for (const slug of slugs) {
    const normalized = slug.toLowerCase()
    const tocEntry = tocByNormalized.get(normalized)
    entries.push({
      slug,
      title: tocEntry?.title ?? slug,
      group: tocEntry?.group ?? 'provider',
    })
  }

  // Sort: providers first, then by title
  return entries.sort((a, b) => {
    if (a.group === 'provider' && b.group !== 'provider') {
      return -1
    }
    if (a.group !== 'provider' && b.group === 'provider') {
      return 1
    }
    return a.title.localeCompare(b.title)
  })
}

/** Pre-built catalog of all available icons */
export const iconCatalog: IconCatalogEntry[] = buildIconCatalog()

/** Search icons by title/slug (case-insensitive) */
export function searchIcons(query: string): IconCatalogEntry[] {
  const q = query.toLowerCase()
  return iconCatalog.filter(entry =>
    entry.title.toLowerCase().includes(q)
    || entry.slug.toLowerCase().includes(q))
}
