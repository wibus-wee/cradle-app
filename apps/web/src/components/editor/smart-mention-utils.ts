export type SmartMentionKind = 'issue' | 'session' | 'workspace' | 'agent' | 'milestone' | 'file'

export interface SmartMentionAttrs {
  kind: SmartMentionKind
  id: string
  label: string
  title?: string | null
  detail?: string | null
  workspaceId?: string | null
}

export interface SmartMentionItem extends SmartMentionAttrs {
  searchText?: string
}

const SMART_MENTION_HOST = 'mention'
const SMART_MENTION_PROTOCOL = 'cradle:'
const SMART_MENTION_URL_PREFIX = 'cradle://mention'
const SMART_MENTION_KINDS = new Set<SmartMentionKind>([
  'issue',
  'session',
  'workspace',
  'agent',
  'milestone',
  'file',
])

function nullableString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

export function parseSmartMentionKind(value: string | null | undefined): SmartMentionKind | null {
  if (!value || !SMART_MENTION_KINDS.has(value as SmartMentionKind)) {
    return null
  }
  return value as SmartMentionKind
}

export function getSmartMentionHref(attrs: SmartMentionAttrs): string {
  const params = new URLSearchParams()
  params.set('label', attrs.label)

  const title = nullableString(attrs.title)
  const detail = nullableString(attrs.detail)
  const workspaceId = nullableString(attrs.workspaceId)

  if (title) {
    params.set('title', title)
  }
  if (detail) {
    params.set('detail', detail)
  }
  if (workspaceId) {
    params.set('workspaceId', workspaceId)
  }

  const query = params.toString()
  const base = `${SMART_MENTION_URL_PREFIX}/${attrs.kind}/${encodeURIComponent(attrs.id)}`
  return query ? `${base}?${query}` : base
}

export function parseSmartMentionHref(href: string | null | undefined): SmartMentionAttrs | null {
  if (!href) {
    return null
  }

  try {
    const url = new URL(href)
    if (url.protocol !== SMART_MENTION_PROTOCOL || url.hostname !== SMART_MENTION_HOST) {
      return null
    }

    const [kindValue, rawId] = url.pathname.split('/').filter(Boolean)
    const kind = parseSmartMentionKind(kindValue)
    if (!kind || !rawId) {
      return null
    }

    const id = decodeURIComponent(rawId)
    const label = nullableString(url.searchParams.get('label')) ?? id

    return {
      kind,
      id,
      label,
      title: nullableString(url.searchParams.get('title')) ?? null,
      detail: nullableString(url.searchParams.get('detail')) ?? null,
      workspaceId: nullableString(url.searchParams.get('workspaceId')) ?? null,
    }
  }
  catch {
    return null
  }
}

export function getSmartMentionMarkdownLabel(attrs: SmartMentionAttrs): string {
  const title = nullableString(attrs.title)
  if (!title || title === attrs.label) {
    return `[${attrs.label}]`
  }
  return `[${attrs.label}] ${title}`
}
