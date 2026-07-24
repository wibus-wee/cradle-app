import { clampPercent } from '~/lib/number-format'

import type {
  ChatRuntimeCompactUiSlotState,
  ChatRuntimeContextUsage,
  ChatRuntimeContextUsageSection,
} from '../../capabilities/chat-capabilities'

export type ContextUsageSource = 'details' | 'compact'

export interface ContextUsageAggregate {
  totalTokens: number
  maxTokens: number | null
  percentage: number | null
  source: ContextUsageSource
}

export const contextUsageSectionLabels: Record<string, string> = {
  'system-prompt': 'System prompt',
  'messages': 'Conversation',
  'tools': 'Tool definitions',
  'tool-results': 'Tool results',
  'memory-files': 'File context',
  'attachments': 'Attachments',
  'skills': 'Skills',
  'mcp-tools': 'MCP',
  'plugins': 'Plugins',
  'agents': 'Subagent definitions',
  'slash-commands': 'Slash commands',
  'others': 'Rules',
}

export function readContextUsageAggregate(
  usage: ChatRuntimeContextUsage | null,
  compactState: ChatRuntimeCompactUiSlotState | null | undefined,
): ContextUsageAggregate | null {
  if (usage) {
    return {
      totalTokens: usage.totalTokens,
      maxTokens: usage.maxTokens,
      percentage: usage.percentage,
      source: 'details',
    }
  }
  if (!compactState) {
    return null
  }

  const displayUsage = readCompactWindowUsage(compactState)
  if (displayUsage.totalTokens <= 0) {
    return null
  }

  return {
    totalTokens: displayUsage.totalTokens,
    maxTokens: compactState.modelContextWindow,
    percentage: compactState.modelContextWindow && compactState.modelContextWindow > 0
      ? (displayUsage.totalTokens / compactState.modelContextWindow) * 100
      : null,
    source: 'compact',
  }
}

export function readContextUsageSections(
  usage: ChatRuntimeContextUsage | null,
): ChatRuntimeContextUsageSection[] {
  return [...(usage?.sections ?? [])]
    .filter(section => section.tokenCount > 0 || section.items.some(item => item.tokenCount > 0))
    .sort((left, right) => right.tokenCount - left.tokenCount)
}

export function readCompactUsageRows(
  compactState: ChatRuntimeCompactUiSlotState | null | undefined,
): Array<{ label: string, value: number }> {
  if (!compactState) {
    return []
  }

  const usage = readCompactWindowUsage(compactState)
  return [
    { label: 'Input', value: usage.inputTokens },
    { label: 'Cached input', value: usage.cachedInputTokens },
    { label: 'Output', value: usage.outputTokens },
    { label: 'Reasoning', value: usage.reasoningOutputTokens },
  ].filter(row => row.value > 0)
}

export function readContextUsagePercent(aggregate: ContextUsageAggregate): number {
  if (aggregate.percentage !== null) {
    return clampPercent(aggregate.percentage)
  }
  if (!aggregate.maxTokens || aggregate.totalTokens <= 0) {
    return 0
  }
  return clampPercent((aggregate.totalTokens / aggregate.maxTokens) * 100)
}

export function readContextUsageSectionShareTotal(
  sections: ChatRuntimeContextUsageSection[],
): number {
  return sections.reduce((total, section) => total + Math.max(0, section.tokenCount), 0)
}

export function readContextUsageSectionLabel(section: ChatRuntimeContextUsageSection): string {
  return contextUsageSectionLabels[section.kind] ?? section.label
}

function readCompactWindowUsage(compactState: ChatRuntimeCompactUiSlotState) {
  return compactState.last.totalTokens > 0 ? compactState.last : compactState.total
}
