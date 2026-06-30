import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk'

import type {
  RuntimeCompactUiSlotState,
  RuntimeContextUsage,
  RuntimeContextUsageItem,
  RuntimeContextUsageSection,
  RuntimeTokenUsageBreakdown,
} from '../../chat-runtime/runtime-provider-types'
import { CLAUDE_AGENT_RUNTIME_KIND } from './metadata'

type ClaudeContextUsage = SDKControlGetContextUsageResponse

export function projectClaudeAgentContextUsage(input: {
  providerSessionId: string | null
  response: ClaudeContextUsage
  updatedAt: number
}): RuntimeContextUsage {
  const sections = new Map<string, RuntimeContextUsageSection>()

  for (const category of input.response.categories ?? []) {
    const kind = readContextUsageKind(category.name)
    upsertContextUsageSection(sections, {
      kind,
      label: category.name,
      tokenCount: readTokenCount(category.tokens),
      color: readColor(category.color),
      isDeferred: category.isDeferred === true,
      items: [],
      raw: category,
    })
  }

  appendItem(sections, 'memory-files', 'Memory files', input.response.memoryFiles ?? [], file => ({
    kind: 'memory-file',
    label: file.path,
    tokenCount: readTokenCount(file.tokens),
    metadata: {
      path: file.path,
      type: file.type,
    },
    raw: file,
  }))

  appendItem(sections, 'mcp-tools', 'MCP tools', input.response.mcpTools ?? [], tool => ({
    kind: 'mcp-tool',
    label: tool.serverName ? `${tool.serverName}.${tool.name}` : tool.name,
    tokenCount: readTokenCount(tool.tokens),
    metadata: {
      name: tool.name,
      serverName: tool.serverName,
      isLoaded: tool.isLoaded ?? null,
    },
    raw: tool,
  }))

  appendItem(sections, 'tools', 'Tools', input.response.deferredBuiltinTools ?? [], tool => ({
    kind: 'deferred-builtin-tool',
    label: tool.name,
    tokenCount: readTokenCount(tool.tokens),
    metadata: { isLoaded: tool.isLoaded },
    raw: tool,
  }))

  appendItem(sections, 'tools', 'Tools', input.response.systemTools ?? [], tool => ({
    kind: 'system-tool',
    label: tool.name,
    tokenCount: readTokenCount(tool.tokens),
    raw: tool,
  }))

  appendItem(sections, 'system-prompt', 'System prompt', input.response.systemPromptSections ?? [], section => ({
    kind: 'system-prompt-section',
    label: section.name,
    tokenCount: readTokenCount(section.tokens),
    raw: section,
  }))

  appendItem(sections, 'agents', 'Agents', input.response.agents ?? [], agent => ({
    kind: 'agent',
    label: agent.agentType,
    tokenCount: readTokenCount(agent.tokens),
    metadata: {
      agentType: agent.agentType,
      source: agent.source,
    },
    raw: agent,
  }))

  appendOptionalItem(sections, 'slash-commands', 'Slash commands', input.response.slashCommands, commands => ({
    kind: 'slash-commands',
    label: 'Slash commands',
    tokenCount: readTokenCount(commands.tokens),
    metadata: {
      totalCommands: commands.totalCommands,
      includedCommands: commands.includedCommands,
    },
    raw: commands,
  }))

  appendOptionalItem(sections, 'skills', 'Skills', input.response.skills, skills => ({
    kind: 'skills-summary',
    label: 'Skills',
    tokenCount: readTokenCount(skills.tokens),
    metadata: {
      totalSkills: skills.totalSkills,
      includedSkills: skills.includedSkills,
    },
    raw: skills,
  }))

  appendItem(
    sections,
    'skills',
    'Skills',
    input.response.skills?.skillFrontmatter ?? [],
    skill => ({
      kind: 'skill-frontmatter',
      label: skill.name,
      tokenCount: readTokenCount(skill.tokens),
      metadata: {
        name: skill.name,
        source: skill.source,
      },
      raw: skill,
    }),
    { sumItemTokens: input.response.skills === undefined },
  )

  const messageBreakdown = input.response.messageBreakdown
  if (messageBreakdown) {
    appendMessageBreakdown(sections, messageBreakdown)
  }

  return {
    runtimeKind: CLAUDE_AGENT_RUNTIME_KIND,
    providerSessionId: input.providerSessionId,
    source: 'claude-agent-sdk.getContextUsage',
    model: input.response.model ?? null,
    totalTokens: readTokenCount(input.response.totalTokens),
    maxTokens: readNullableTokenCount(input.response.maxTokens),
    rawMaxTokens: readNullableTokenCount(input.response.rawMaxTokens),
    percentage: readNullableNumber(input.response.percentage),
    sections: Array.from(sections.values()),
    messageBreakdown: messageBreakdown ? { ...messageBreakdown } : null,
    apiUsage: input.response.apiUsage ? { ...input.response.apiUsage } : null,
    raw: input.response,
    updatedAt: input.updatedAt,
  }
}

export function projectClaudeAgentCompactState(input: {
  threadId: string
  turnId: string | null
  usage: RuntimeContextUsage
  updatedAt: number
}): RuntimeCompactUiSlotState {
  const totalTokens = readTokenCount(input.usage.totalTokens)
  const modelContextWindow = input.usage.maxTokens
  const usagePercent = readCompactUsagePercent({
    percentage: input.usage.percentage,
    totalTokens,
    modelContextWindow,
  })
  const status = readCompactStatus({ usagePercent })

  return {
    kind: 'compact',
    slotId: 'claude-agent:compact',
    threadId: input.threadId,
    turnId: input.turnId,
    status,
    isCompactRelevant: status !== 'idle',
    total: {
      totalTokens,
      inputTokens: totalTokens,
      cachedInputTokens: readApiUsageTokenCount(input.usage.apiUsage, 'cache_read_input_tokens'),
      outputTokens: readApiUsageTokenCount(input.usage.apiUsage, 'output_tokens'),
      reasoningOutputTokens: 0,
    },
    last: createEmptyTokenUsageBreakdown(),
    modelContextWindow,
    autoCompactTokenLimit: null,
    usagePercent,
    autoCompactPercent: null,
    lastCompactedAt: null,
    compactionItemId: null,
    updatedAt: input.updatedAt,
  }
}

function appendMessageBreakdown(
  sections: Map<string, RuntimeContextUsageSection>,
  breakdown: NonNullable<ClaudeContextUsage['messageBreakdown']>,
): void {
  appendBreakdownCounter(sections, 'tools', 'Tools', 'tool-call-tokens', 'Tool calls', breakdown.toolCallTokens)
  appendBreakdownCounter(sections, 'tool-results', 'Tool results', 'tool-result-tokens', 'Tool results', breakdown.toolResultTokens)
  appendBreakdownCounter(sections, 'attachments', 'Attachments', 'attachment-tokens', 'Attachments', breakdown.attachmentTokens)
  appendBreakdownCounter(sections, 'messages', 'Messages', 'assistant-message-tokens', 'Assistant messages', breakdown.assistantMessageTokens)
  appendBreakdownCounter(sections, 'messages', 'Messages', 'user-message-tokens', 'User messages', breakdown.userMessageTokens)
  appendBreakdownCounter(sections, 'messages', 'Messages', 'redirected-context-tokens', 'Redirected context', breakdown.redirectedContextTokens)
  appendBreakdownCounter(sections, 'others', 'Others', 'unattributed-tokens', 'Unattributed', breakdown.unattributedTokens)

  appendItem(
    sections,
    'tools',
    'Tools',
    breakdown.toolCallsByType ?? [],
    tool => ({
      kind: 'tool-call-type',
      label: tool.name,
      tokenCount: readTokenCount(tool.callTokens) + readTokenCount(tool.resultTokens),
      metadata: {
        callTokens: readTokenCount(tool.callTokens),
        resultTokens: readTokenCount(tool.resultTokens),
      },
      raw: tool,
    }),
    { sumItemTokens: false },
  )

  appendItem(
    sections,
    'attachments',
    'Attachments',
    breakdown.attachmentsByType ?? [],
    attachment => ({
      kind: 'attachment-type',
      label: attachment.name,
      tokenCount: readTokenCount(attachment.tokens),
      raw: attachment,
    }),
    { sumItemTokens: false },
  )
}

function appendBreakdownCounter(
  sections: Map<string, RuntimeContextUsageSection>,
  sectionKind: string,
  sectionLabel: string,
  itemKind: string,
  itemLabel: string,
  tokens: number,
): void {
  const tokenCount = readTokenCount(tokens)
  if (tokenCount <= 0) {
    return
  }
  const existing = sections.get(sectionKind)
  upsertContextUsageSection(sections, {
    kind: sectionKind,
    label: sectionLabel,
    tokenCount: existing?.raw ? 0 : tokenCount,
    color: null,
    isDeferred: false,
    items: [],
  }).items.push({
    kind: itemKind,
    label: itemLabel,
    tokenCount,
  })
}

function appendOptionalItem<T>(
  sections: Map<string, RuntimeContextUsageSection>,
  sectionKind: string,
  sectionLabel: string,
  value: T | undefined,
  projectItem: (value: T) => RuntimeContextUsageItem,
): void {
  if (value === undefined) {
    return
  }
  appendItem(sections, sectionKind, sectionLabel, [value], projectItem)
}

function appendItem<T>(
  sections: Map<string, RuntimeContextUsageSection>,
  sectionKind: string,
  sectionLabel: string,
  values: T[],
  projectItem: (value: T) => RuntimeContextUsageItem,
  options: { sumItemTokens?: boolean } = {},
): void {
  if (values.length === 0) {
    return
  }
  const section = upsertContextUsageSection(sections, {
    kind: sectionKind,
    label: sectionLabel,
    tokenCount: 0,
    color: null,
    isDeferred: false,
    items: [],
  })
  const shouldSumItems = (options.sumItemTokens ?? true) && section.raw === undefined
  for (const value of values) {
    const item = projectItem(value)
    section.items.push(item)
    if (shouldSumItems) {
      section.tokenCount += item.tokenCount
    }
  }
}

function upsertContextUsageSection(
  sections: Map<string, RuntimeContextUsageSection>,
  next: RuntimeContextUsageSection,
): RuntimeContextUsageSection {
  const existing = sections.get(next.kind)
  if (!existing) {
    sections.set(next.kind, next)
    return next
  }

  existing.tokenCount += next.tokenCount
  existing.items.push(...next.items)
  existing.color ??= next.color
  existing.isDeferred = existing.isDeferred || next.isDeferred
  if (!existing.raw && next.raw) {
    existing.raw = next.raw
  }
  return existing
}

function readContextUsageKind(name: string): string {
  const normalized = name.toLowerCase().replace(/[_-]+/g, ' ')
  if (normalized.includes('system') && normalized.includes('prompt')) {
    return 'system-prompt'
  }
  if (normalized.includes('mcp') && normalized.includes('tool')) {
    return 'mcp-tools'
  }
  if (normalized.includes('tool result')) {
    return 'tool-results'
  }
  if (normalized.includes('tool')) {
    return 'tools'
  }
  if (normalized.includes('memory') || normalized.includes('file')) {
    return 'memory-files'
  }
  if (normalized.includes('message') || normalized.includes('conversation')) {
    return 'messages'
  }
  if (normalized.includes('slash') || normalized.includes('command')) {
    return 'slash-commands'
  }
  if (normalized.includes('skill')) {
    return 'skills'
  }
  if (normalized.includes('agent')) {
    return 'agents'
  }
  if (normalized.includes('attachment')) {
    return 'attachments'
  }
  return 'others'
}

function readTokenCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0
}

function readNullableTokenCount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null
}

function readNullableNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readCompactUsagePercent(input: {
  percentage: number | null
  totalTokens: number
  modelContextWindow: number | null
}): number | null {
  if (input.percentage !== null) {
    return Math.min(100, Math.max(0, input.percentage))
  }
  if (!input.modelContextWindow || input.totalTokens <= 0) {
    return null
  }
  return Math.min(100, Math.max(0, (input.totalTokens / input.modelContextWindow) * 100))
}

function readCompactStatus(input: { usagePercent: number | null }): RuntimeCompactUiSlotState['status'] {
  if (input.usagePercent !== null && input.usagePercent >= 100) {
    return 'overLimit'
  }
  if (input.usagePercent !== null && input.usagePercent >= 70) {
    return 'nearLimit'
  }
  return 'idle'
}

function readApiUsageTokenCount(value: Record<string, unknown> | null, key: string): number {
  const tokenCount = value?.[key]
  return typeof tokenCount === 'number' && Number.isFinite(tokenCount) && tokenCount > 0
    ? Math.round(tokenCount)
    : 0
}

function createEmptyTokenUsageBreakdown(): RuntimeTokenUsageBreakdown {
  return {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  }
}

function readColor(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
