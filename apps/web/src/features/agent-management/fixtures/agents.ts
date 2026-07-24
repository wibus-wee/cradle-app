import type {
  Agent,
  PreviewLocalConfigImportResult,
} from '~/features/agent-runtime/use-agents'
import type { ProviderTargetOption } from '~/features/agent-runtime/use-provider-targets'

export const codexAgentFixture = {
  id: 'agent-codex',
  name: 'Codex',
  description: 'Primary implementation agent',
  avatarUrl: null,
  avatarStyle: 'lobehub-icon',
  avatarSeed: 'openai',
  providerTargetId: 'openai-primary',
  modelId: 'gpt-5',
  thinkingEffort: 'high',
  runtimeKind: 'codex',
  configJson: '{}',
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
} satisfies Agent

export const claudeCliAgentFixture = {
  ...codexAgentFixture,
  id: 'agent-claude-cli',
  name: 'Claude CLI',
  avatarSeed: 'anthropic',
  providerTargetId: null,
  modelId: null,
  runtimeKind: 'cli-tui',
  configJson: JSON.stringify({
    cliTui: {
      preset: 'claude',
      executable: 'claude',
      args: [],
    },
  }),
  enabled: false,
} satisfies Agent

export const providerTargetFixtures = [
  {
    id: 'openai-primary',
    kind: 'manual',
    name: 'OpenAI',
    providerKind: 'openai-compatible',
    enabled: true,
    iconSlug: 'openai',
    sourceKey: null,
    externalRecordId: null,
  },
] satisfies ProviderTargetOption[]

export const agentImportPreviewFixture = {
  candidates: [
    {
      id: 'candidate-codex',
      app: 'codex',
      runtimeKind: 'codex',
      sourceKind: 'local-config',
      sourceLabel: 'Codex config',
      externalRecordId: 'codex-default',
      providerTargetId: 'openai-primary',
      agentName: 'Codex Local',
      resolvedProviderName: 'OpenAI',
      name: 'default',
      modelId: 'gpt-5',
      endpoint: 'https://api.openai.com/v1',
      executable: null,
      iconSlug: 'openai',
      avatarUrl: null,
      importable: true,
      alreadyConfigured: false,
      reason: null,
      notes: ['Uses the existing local Codex authentication.'],
      agent: null,
    },
    {
      id: 'candidate-claude',
      app: 'claude',
      runtimeKind: 'claude-agent',
      sourceKind: 'cc-switch',
      sourceLabel: 'CC Switch',
      externalRecordId: 'claude-work',
      providerTargetId: null,
      agentName: 'Claude Work',
      resolvedProviderName: 'Anthropic',
      name: 'work',
      modelId: 'claude-opus-4-1',
      endpoint: null,
      executable: null,
      iconSlug: 'anthropic',
      avatarUrl: null,
      importable: false,
      alreadyConfigured: true,
      reason: 'An agent already uses this mapping.',
      notes: [],
      agent: null,
    },
  ],
  sourceRefreshes: [
    {
      sourceKey: 'local-codex',
      sourceLabel: 'Codex config',
      status: 'ok',
      recordsSeen: 1,
      recordsProjected: 1,
      recordsMissing: 0,
      message: null,
    },
  ],
} satisfies PreviewLocalConfigImportResult
