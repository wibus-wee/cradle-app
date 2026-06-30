import type {
  RuntimeContextUsage,
  RuntimeContextUsageItem,
  RuntimeContextUsageSection,
} from '../../../chat-runtime/runtime-provider-types'
import type { ThreadItem } from '../app-server-protocol/v2/ThreadItem'
import type { Turn } from '../app-server-protocol/v2/Turn'
import type { UserInput } from '../app-server-protocol/v2/UserInput'
import { CODEX_RUNTIME_KIND } from '../metadata'
import type { CodexProviderSnapshot } from '../types'
import { normalizeTokenUsageBreakdown, readCodexCompactSnapshot, readCodexProviderSnapshot } from './state-projector'

interface MutableSection {
  kind: string
  label: string
  color: string | null
  isDeferred: boolean
  tokenCount: number
  items: RuntimeContextUsageItem[]
}

export function projectCodexEstimatedContextUsage(input: {
  providerSessionId: string | null
  providerStateSnapshot: string | null | undefined
  systemPrompt?: string | null
  modelId?: string | null
  updatedAt: number
}): RuntimeContextUsage | null {
  const snapshot = readCodexProviderSnapshot(input.providerStateSnapshot)
  const compact = readCodexCompactSnapshot(input.providerStateSnapshot)
  const last = normalizeTokenUsageBreakdown(compact?.tokenUsage.last)
  const total = normalizeTokenUsageBreakdown(compact?.tokenUsage.total)
  const authoritativeInputTokens = last.inputTokens > 0
    ? last.inputTokens
    : total.inputTokens > 0
      ? total.inputTokens
      : 0
  const modelContextWindow = compact?.tokenUsage.modelContextWindow ?? null
  const sections = new Map<string, MutableSection>()

  if (input.systemPrompt) {
    appendSectionItem(sections, 'system-prompt', 'System prompt', {
      kind: 'cradle-system-prompt',
      label: 'Cradle system prompt',
      tokenCount: estimateTextTokens(input.systemPrompt),
      raw: { availableFrom: 'GetContextUsageInput.systemPrompt' },
    })
  }

  const nativeHistory = snapshot.codex?.nativeHistory ?? snapshot.codex?.previousNativeHistory
  for (const turn of nativeHistory?.turns ?? []) {
    if (turn.itemsView !== 'full') {
      continue
    }
    for (const item of turn.items) {
      appendThreadItem(sections, turn, item)
    }
  }

  appendSnapshotContext(sections, snapshot)

  const rawEstimatedVisibleTokens = sumSections(sections)
  const topLineInputTokens = authoritativeInputTokens > 0 ? authoritativeInputTokens : rawEstimatedVisibleTokens
  if (topLineInputTokens <= 0 && rawEstimatedVisibleTokens <= 0) {
    return null
  }

  const visibleBudget = topLineInputTokens
  if (rawEstimatedVisibleTokens > visibleBudget && visibleBudget > 0) {
    scaleSections(sections, visibleBudget / rawEstimatedVisibleTokens)
  }

  const estimatedVisibleTokens = sumSections(sections)
  const unattributedTokens = Math.max(0, topLineInputTokens - estimatedVisibleTokens)
  if (unattributedTokens > 0) {
    appendSectionItem(sections, 'codex-runtime-context', 'Codex runtime context', {
      kind: 'unattributed-input-tokens',
      label: 'Unattributed runtime input',
      tokenCount: unattributedTokens,
      metadata: {
        reason: 'Codex app-server exposes aggregate token usage but not full prompt assembly sections.',
      },
    })
  }

  const finalSections = Array.from(sections.values())
    .filter(section => section.tokenCount > 0)
    .map(section => ({
      kind: section.kind,
      label: section.label,
      tokenCount: section.tokenCount,
      color: section.color,
      isDeferred: section.isDeferred,
      items: section.items.filter(item => item.tokenCount > 0),
    }))

  return {
    runtimeKind: CODEX_RUNTIME_KIND,
    providerSessionId: input.providerSessionId,
    source: 'codex-native-history-estimate',
    model: input.modelId ?? snapshot.models?.currentModelId ?? null,
    totalTokens: topLineInputTokens,
    maxTokens: modelContextWindow,
    rawMaxTokens: modelContextWindow,
    percentage: modelContextWindow && modelContextWindow > 0
      ? (topLineInputTokens / modelContextWindow) * 100
      : null,
    sections: finalSections,
    messageBreakdown: readMessageBreakdown(finalSections),
    apiUsage: {
      inputTokens: last.inputTokens,
      cachedInputTokens: last.cachedInputTokens,
      outputTokens: last.outputTokens,
      reasoningOutputTokens: last.reasoningOutputTokens,
      totalTokens: last.totalTokens,
      lifetimeInputTokens: total.inputTokens,
      lifetimeCachedInputTokens: total.cachedInputTokens,
      lifetimeOutputTokens: total.outputTokens,
      lifetimeReasoningOutputTokens: total.reasoningOutputTokens,
      lifetimeTotalTokens: total.totalTokens,
    },
    raw: {
      estimate: true,
      estimateMethod: 'visible Codex native history text and JSON payload size, calibrated to Codex last input tokens when available',
      compact,
      nativeHistory: nativeHistory
        ? {
            threadId: nativeHistory.threadId,
            complete: nativeHistory.complete,
            turnCount: nativeHistory.turnCount,
            itemCount: nativeHistory.itemCount,
            fetchedAt: nativeHistory.fetchedAt,
            error: nativeHistory.error,
          }
        : null,
    },
    updatedAt: input.updatedAt,
  }
}

function appendThreadItem(
  sections: Map<string, MutableSection>,
  turn: Turn,
  item: ThreadItem,
): void {
  switch (item.type) {
    case 'userMessage':
      appendSectionItem(sections, 'messages', 'Messages', {
        kind: 'user-message',
        label: `User message ${item.id}`,
        tokenCount: estimateUserInputTokens(item.content),
        metadata: { turnId: turn.id, itemId: item.id, role: 'user' },
      })
      return
    case 'agentMessage':
      appendSectionItem(sections, 'messages', 'Messages', {
        kind: 'assistant-message',
        label: `Assistant message ${item.id}`,
        tokenCount: estimateTextTokens(item.text),
        metadata: { turnId: turn.id, itemId: item.id, role: 'assistant', phase: item.phase },
      })
      return
    case 'reasoning':
      appendSectionItem(sections, 'reasoning', 'Reasoning', {
        kind: 'reasoning-item',
        label: `Reasoning ${item.id}`,
        tokenCount: estimateTextTokens([...item.summary, ...item.content].join('\n')),
        metadata: { turnId: turn.id, itemId: item.id, summaryCount: item.summary.length, contentCount: item.content.length },
      })
      return
    case 'plan':
      appendSectionItem(sections, 'plans', 'Plans', {
        kind: 'plan',
        label: `Plan ${item.id}`,
        tokenCount: estimateTextTokens(item.text),
        metadata: { turnId: turn.id, itemId: item.id },
      })
      return
    case 'hookPrompt':
      appendSectionItem(sections, 'hooks', 'Hooks', {
        kind: 'hook-prompt',
        label: `Hook prompt ${item.id}`,
        tokenCount: estimateJsonTokens(item.fragments),
        metadata: { turnId: turn.id, itemId: item.id },
      })
      return
    case 'commandExecution':
      appendSectionItem(sections, 'tools', 'Tools', {
        kind: 'command-execution',
        label: item.command,
        tokenCount: estimateTextTokens(item.command) + estimateTextTokens(item.aggregatedOutput ?? ''),
        metadata: { turnId: turn.id, itemId: item.id, tool: 'commandExecution', status: item.status, exitCode: item.exitCode },
      })
      return
    case 'mcpToolCall':
      appendSectionItem(sections, 'mcp-tools', 'MCP tools', {
        kind: 'mcp-tool-call',
        label: `${item.server}.${item.tool}`,
        tokenCount: estimateJsonTokens(item.arguments) + estimateJsonTokens(item.result) + estimateJsonTokens(item.error),
        metadata: { turnId: turn.id, itemId: item.id, server: item.server, tool: item.tool, status: item.status, pluginId: item.pluginId },
      })
      return
    case 'dynamicToolCall':
      appendSectionItem(sections, 'tools', 'Tools', {
        kind: 'dynamic-tool-call',
        label: item.namespace ? `${item.namespace}.${item.tool}` : item.tool,
        tokenCount: estimateJsonTokens(item.arguments) + estimateJsonTokens(item.contentItems),
        metadata: { turnId: turn.id, itemId: item.id, namespace: item.namespace, tool: item.tool, status: item.status, success: item.success },
      })
      return
    case 'collabAgentToolCall':
      appendSectionItem(sections, 'agents', 'Agents', {
        kind: 'collab-agent-tool-call',
        label: item.tool,
        tokenCount: estimateTextTokens(item.prompt ?? '') + estimateJsonTokens(item.agentsStates),
        metadata: { turnId: turn.id, itemId: item.id, tool: item.tool, receiverThreadIds: item.receiverThreadIds },
      })
      return
    case 'subAgentActivity':
      appendSectionItem(sections, 'agents', 'Agents', {
        kind: 'sub-agent-activity',
        label: item.agentPath,
        tokenCount: estimateJsonTokens({
          kind: item.kind,
          agentThreadId: item.agentThreadId,
          agentPath: item.agentPath,
        }),
        metadata: { turnId: turn.id, itemId: item.id, kind: item.kind, agentThreadId: item.agentThreadId },
      })
      return
    case 'fileChange':
      appendSectionItem(sections, 'files', 'Files', {
        kind: 'file-change',
        label: `${item.changes.length} file changes`,
        tokenCount: estimateJsonTokens(item.changes),
        metadata: { turnId: turn.id, itemId: item.id, status: item.status, changeCount: item.changes.length },
      })
      return
    case 'webSearch':
      appendSectionItem(sections, 'tools', 'Tools', {
        kind: 'web-search',
        label: item.query,
        tokenCount: estimateTextTokens(item.query) + estimateJsonTokens(item.action),
        metadata: { turnId: turn.id, itemId: item.id, tool: 'webSearch' },
      })
      return
    case 'sleep':
      appendSectionItem(sections, 'tools', 'Tools', {
        kind: 'sleep',
        label: `Sleep ${item.durationMs}ms`,
        tokenCount: estimateTextTokens(String(item.durationMs)),
        metadata: { turnId: turn.id, itemId: item.id, durationMs: item.durationMs },
      })
      return
    case 'imageView':
      appendSectionItem(sections, 'attachments', 'Attachments', {
        kind: 'image-view',
        label: item.path,
        tokenCount: estimateTextTokens(item.path),
        metadata: { turnId: turn.id, itemId: item.id, path: item.path },
      })
      return
    case 'imageGeneration':
      appendSectionItem(sections, 'attachments', 'Attachments', {
        kind: 'image-generation',
        label: item.revisedPrompt ?? item.id,
        tokenCount: estimateTextTokens(item.revisedPrompt ?? '') + estimateJsonTokens(item.result),
        metadata: { turnId: turn.id, itemId: item.id, status: item.status, savedPath: item.savedPath },
      })
      return
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      appendSectionItem(sections, 'review', 'Review', {
        kind: item.type,
        label: item.review,
        tokenCount: estimateTextTokens(item.review),
        metadata: { turnId: turn.id, itemId: item.id },
      })
      return
    case 'contextCompaction':
      appendSectionItem(sections, 'compaction', 'Compaction', {
        kind: 'context-compaction',
        label: `Context compaction ${item.id}`,
        tokenCount: 1,
        metadata: { turnId: turn.id, itemId: item.id },
      })
  }
}

function appendSnapshotContext(
  sections: Map<string, MutableSection>,
  snapshot: CodexProviderSnapshot,
): void {
  const codex = snapshot.codex
  if (!codex) {
    return
  }
  if (codex.mcp) {
    appendSectionItem(sections, 'mcp-tools', 'MCP tools', {
      kind: 'mcp-status-summary',
      label: 'MCP status summary',
      tokenCount: estimateJsonTokens(codex.mcp),
      raw: codex.mcp,
    })
  }
  if (codex.skills) {
    appendSectionItem(sections, 'skills', 'Skills', {
      kind: 'skills-summary',
      label: 'Skills summary',
      tokenCount: estimateJsonTokens(codex.skills),
      raw: codex.skills,
    })
  }
  if (codex.plugin) {
    appendSectionItem(sections, 'plugins', 'Plugins', {
      kind: 'plugin-summary',
      label: 'Plugin summary',
      tokenCount: estimateJsonTokens(codex.plugin),
      raw: codex.plugin,
    })
  }
}

function estimateUserInputTokens(inputs: UserInput[]): number {
  return inputs.reduce((sum, input) => {
    switch (input.type) {
      case 'text':
        return sum + estimateTextTokens(input.text)
      case 'image':
        return sum + estimateTextTokens(input.url) + (input.detail ? estimateTextTokens(input.detail) : 0)
      case 'localImage':
      case 'mention':
      case 'skill':
        return sum + estimateJsonTokens(input)
      default:
        return sum + estimateJsonTokens(input)
    }
  }, 0)
}

function appendSectionItem(
  sections: Map<string, MutableSection>,
  sectionKind: string,
  sectionLabel: string,
  item: RuntimeContextUsageItem,
): void {
  const tokenCount = Math.max(0, Math.round(item.tokenCount))
  if (tokenCount <= 0) {
    return
  }
  const section = sections.get(sectionKind) ?? {
    kind: sectionKind,
    label: sectionLabel,
    color: null,
    isDeferred: false,
    tokenCount: 0,
    items: [],
  }
  section.tokenCount += tokenCount
  section.items.push({ ...item, tokenCount })
  sections.set(sectionKind, section)
}

function sumSections(sections: Map<string, MutableSection>): number {
  return Array.from(sections.values()).reduce((sum, section) => sum + section.tokenCount, 0)
}

function scaleSections(sections: Map<string, MutableSection>, factor: number): void {
  for (const section of sections.values()) {
    section.items = section.items.map(item => ({
      ...item,
      tokenCount: Math.max(0, Math.round(item.tokenCount * factor)),
    })).filter(item => item.tokenCount > 0)
    section.tokenCount = section.items.reduce((sum, item) => sum + item.tokenCount, 0)
  }
}

function readMessageBreakdown(sections: RuntimeContextUsageSection[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const section of sections) {
    result[`${section.kind}Tokens`] = section.tokenCount
    for (const item of section.items) {
      result[`${item.kind}Tokens`] = (Number(result[`${item.kind}Tokens`]) || 0) + item.tokenCount
    }
  }
  return result
}

function estimateJsonTokens(value: unknown): number {
  if (value === null || value === undefined) {
    return 0
  }
  if (typeof value === 'string') {
    return estimateTextTokens(value)
  }
  try {
    return estimateTextTokens(JSON.stringify(value))
  }
  catch {
    return 1
  }
}

function estimateTextTokens(text: string): number {
  if (!text) {
    return 0
  }
  let asciiChars = 0
  let cjkChars = 0
  for (const char of text) {
    if (/[\u3400-\u9FFF\uF900-\uFAFF]/.test(char)) {
      cjkChars += 1
    }
    else {
      asciiChars += 1
    }
  }
  return Math.max(1, Math.ceil(asciiChars / 4 + cjkChars))
}
