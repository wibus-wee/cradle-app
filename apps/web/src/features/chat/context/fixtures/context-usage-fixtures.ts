import type {
  ChatRuntimeCompactUiSlotState,
  ChatRuntimeContextUsage,
} from '../../capabilities/chat-capabilities'

export const contextUsageFixture: ChatRuntimeContextUsage = {
  runtimeKind: 'codex',
  providerSessionId: 'session-context-fixture',
  source: 'provider',
  model: 'gpt-5',
  totalTokens: 78_420,
  maxTokens: 128_000,
  rawMaxTokens: 128_000,
  percentage: 61.3,
  sections: [
    { kind: 'system-prompt', label: 'System prompt', tokenCount: 8_400, color: null, isDeferred: false, items: [] },
    { kind: 'messages', label: 'Messages', tokenCount: 34_600, color: null, isDeferred: false, items: [] },
    { kind: 'tools', label: 'Tools', tokenCount: 9_800, color: null, isDeferred: false, items: [] },
    { kind: 'tool-results', label: 'Tool results', tokenCount: 20_200, color: null, isDeferred: false, items: [] },
    { kind: 'skills', label: 'Skills', tokenCount: 5_420, color: null, isDeferred: false, items: [] },
  ],
  messageBreakdown: null,
  apiUsage: null,
  raw: null,
  updatedAt: 1_725_000_000,
}

export const contextUsageNearLimitFixture: ChatRuntimeContextUsage = {
  ...contextUsageFixture,
  totalTokens: 121_120,
  percentage: 94.6,
}

export const compactContextUsageFixture: ChatRuntimeCompactUiSlotState = {
  kind: 'compact',
  slotId: 'compact-context-fixture',
  threadId: 'thread-context-fixture',
  turnId: 'turn-context-fixture',
  status: 'running',
  isCompactRelevant: true,
  total: {
    totalTokens: 8_400,
    inputTokens: 4_900,
    cachedInputTokens: 2_200,
    outputTokens: 1_000,
    reasoningOutputTokens: 300,
  },
  last: {
    totalTokens: 20_400,
    inputTokens: 12_900,
    cachedInputTokens: 4_200,
    outputTokens: 2_300,
    reasoningOutputTokens: 1_000,
  },
  modelContextWindow: 128_000,
  autoCompactTokenLimit: 110_000,
  usagePercent: 15.9,
  autoCompactPercent: 85.9,
  lastCompactedAt: null,
  compactionItemId: null,
  updatedAt: 1_725_000_000,
}
