import type { ContextEnvelope, ContextItem } from '~/features/context/context-items'

export interface ContextAssemblyOptions {
  tokenBudget?: number
}

export interface ContextAssemblyDecision {
  itemId: string
  owner: string
  kind: ContextItem['kind']
  title: string
  priority: number
  tokenEstimate: number
  sensitivity: ContextItem['sensitivity']
  reason: 'included' | 'budget-exceeded' | 'secret'
}

export interface ContextAssemblyTrace {
  envelopeId: string
  capturedAt: number
  activeSurfaceId: string | null
  activeSurfaceType: string | null
  itemCount: number
  tokenBudget: number
  includedTokenEstimate: number
  included: ContextAssemblyDecision[]
  dropped: ContextAssemblyDecision[]
  promptBlock: string
}

export interface ContextAssemblyResult {
  promptBlock: string
  trace: ContextAssemblyTrace
  includedItems: ContextItem[]
  droppedItems: ContextItem[]
}

const DEFAULT_TOKEN_BUDGET = 1_200

function compareContextItems(left: ContextItem, right: ContextItem): number {
  const explicitRank = Number(right.id.startsWith('explicit:')) - Number(left.id.startsWith('explicit:'))
  return explicitRank
    || right.priority - left.priority
    || freshnessRank(right.freshness) - freshnessRank(left.freshness)
    || left.tokenEstimate - right.tokenEstimate
    || left.id.localeCompare(right.id)
}

function freshnessRank(freshness: ContextItem['freshness']): number {
  switch (freshness) {
    case 'live':
      return 3
    case 'recent':
      return 2
    case 'stale':
      return 1
  }
}

function decision(item: ContextItem, reason: ContextAssemblyDecision['reason']): ContextAssemblyDecision {
  return {
    itemId: item.id,
    owner: item.owner,
    kind: item.kind,
    title: item.title,
    priority: item.priority,
    tokenEstimate: item.tokenEstimate,
    sensitivity: item.sensitivity,
    reason,
  }
}

export function assembleContextForPrompt(
  envelope: ContextEnvelope,
  options: ContextAssemblyOptions = {},
): ContextAssemblyResult {
  const tokenBudget = Math.max(0, Math.floor(options.tokenBudget ?? DEFAULT_TOKEN_BUDGET))
  const sortedItems = envelope.items.toSorted(compareContextItems)
  const includedItems: ContextItem[] = []
  const droppedItems: ContextItem[] = []
  const included: ContextAssemblyDecision[] = []
  const dropped: ContextAssemblyDecision[] = []
  let includedTokenEstimate = 0

  for (const item of sortedItems) {
    if (item.sensitivity === 'secret') {
      droppedItems.push(item)
      dropped.push(decision(item, 'secret'))
      continue
    }

    const nextEstimate = includedTokenEstimate + Math.max(0, item.tokenEstimate)
    if (nextEstimate > tokenBudget) {
      droppedItems.push(item)
      dropped.push(decision(item, 'budget-exceeded'))
      continue
    }

    includedItems.push(item)
    included.push(decision(item, 'included'))
    includedTokenEstimate = nextEstimate
  }

  const promptBlock = formatContextPromptBlock(includedItems)

  return {
    promptBlock,
    trace: {
      envelopeId: envelope.id,
      capturedAt: envelope.capturedAt,
      activeSurfaceId: envelope.activeSurfaceId,
      activeSurfaceType: envelope.activeSurfaceType,
      itemCount: envelope.items.length,
      tokenBudget,
      includedTokenEstimate,
      included,
      dropped,
      promptBlock,
    },
    includedItems,
    droppedItems,
  }
}

function formatContextPromptBlock(items: ContextItem[]): string {
  const lines = items.flatMap(formatContextItem)

  if (lines.length === 0) {
    lines.push('context: none')
  }

  return `<cradle_context>\n${lines.join('\n')}\n</cradle_context>`
}

function contextValue(value: string): string {
  return value
    .replace(/<\/?cradle_context>/gi, tag => tag.replaceAll('<', '[').replaceAll('>', ']'))
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatContextItem(item: ContextItem): string[] {
  const prefix = `${contextValue(item.kind)}: ${contextValue(item.title)}`
  const lines = [`${prefix} - ${contextValue(item.summary)}`]

  if (item.content) {
    lines.push(`  content: ${contextValue(item.content)}`)
  }

  if (item.references?.length) {
    const references = item.references
      .map(ref => `${contextValue(ref.kind)}:${contextValue(ref.label)}`)
      .join(', ')
    lines.push(`  refs: ${references}`)
  }

  return lines
}
