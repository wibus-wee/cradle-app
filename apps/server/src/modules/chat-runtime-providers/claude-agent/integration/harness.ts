import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  JsonValue,
  ObservedRequest,
  RequestMatch,
  SimulatorExchange,
  SimulatorScenario,
  StreamStep,
} from '@cradle/model-api-simulator'
import type { UIMessage, UIMessageChunk } from 'ai'
import { inject } from 'vitest'

import type {
  ProviderContext,
  RuntimeProviderTargetProfile,
  RuntimeSession,
} from '../../../chat-runtime/runtime-provider-types'
import { ClaudeAgentProvider } from '../provider'

const TEST_MODEL = 'claude-sonnet-4-5'

declare module 'vitest' {
  export interface ProvidedContext {
    cradleAnthropicSimulatorBaseUrl: string
    cradleAnthropicSimulatorControlUrl: string
  }
}

export interface ClaudeAgentIntegrationContext {
  anthropicBaseUrl: string
  controlUrl: string
}

export interface ClaudeAgentIntegrationHarness {
  provider: ClaudeAgentProvider
  profile: RuntimeProviderTargetProfile
  runtimeSession: RuntimeSession
  workspacePath: string
  runTurn: (input: {
    text: string
    history?: UIMessage[]
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
  }) => Promise<UIMessageChunk[]>
  activeQueryCount: () => number
  cleanup: () => Promise<void>
}

const DISABLED_TITLE_PROFILE_ID = 'profile-claude-integration-title-disabled'

export function readClaudeAgentIntegrationContext(): ClaudeAgentIntegrationContext | null {
  try {
    const anthropicBaseUrl = inject('cradleAnthropicSimulatorBaseUrl')
    const controlUrl = inject('cradleAnthropicSimulatorControlUrl')
    return anthropicBaseUrl && controlUrl ? { anthropicBaseUrl, controlUrl } : null
  }
  catch {
    return null
  }
}

export function createSimulatorController(context: ClaudeAgentIntegrationContext) {
  return {
    async enqueue(scenario: SimulatorScenario): Promise<void> {
      await controlRequest(context, '/enqueue', { scenario })
    },
    async reset(): Promise<void> {
      await controlRequest(context, '/reset', {})
    },
    async requests(): Promise<ObservedRequest[]> {
      const response = await fetch(`${context.controlUrl}/requests`)
      if (!response.ok) {
        throw new Error(`Simulator control request failed: ${response.status} ${await response.text()}`)
      }
      return await response.json() as ObservedRequest[]
    },
    async waitForRequest(match: RequestMatch): Promise<ObservedRequest> {
      return await controlRequest<ObservedRequest>(context, '/wait-for-request', { match })
    },
    async waitForGate(gate: string): Promise<void> {
      await controlRequest(context, '/wait-for-gate', { gate })
    },
    async release(gate: string): Promise<void> {
      await controlRequest(context, '/release', { gate })
    },
    async assertExhausted(): Promise<void> {
      await controlRequest(context, '/assert-exhausted', {})
    },
  }
}

export async function createClaudeAgentIntegrationHarness(input: {
  context: ClaudeAgentIntegrationContext
  deps?: Pick<ProviderContext, 'requestToolApproval' | 'requestUserInput'>
  workspacePath?: string
}): Promise<ClaudeAgentIntegrationHarness> {
  const ownsWorkspace = input.workspacePath === undefined
  const workspacePath = input.workspacePath
    ?? mkdtempSync(join(tmpdir(), 'cradle-claude-integration-'))
  const profile = createIntegrationProfile(input.context.anthropicBaseUrl)
  // Title generation has separate coverage and would race this harness's strict FIFO wire scenarios.
  const provider = new ClaudeAgentProvider({
    readSecret: secretRef => secretRef === 'credential-claude-integration'
      ? 'sk-ant-simulator'
      : '',
    readChatPreferences: () => ({
      titleGeneration: {
        providerTargetId: DISABLED_TITLE_PROFILE_ID,
        modelId: null,
        thinkingEffort: 'minimal',
      },
    }),
    resolveProviderTargetProfile: providerTargetId =>
      providerTargetId === DISABLED_TITLE_PROFILE_ID
        ? createDisabledTitleProfile(input.context.anthropicBaseUrl)
        : null,
    ...input.deps,
  })
  const runtimeSession = await provider.startChatSession({
    chatSessionId: `integration-${randomUUID()}`,
    profile,
    workspacePath,
    modelId: TEST_MODEL,
  })

  return {
    provider,
    profile,
    runtimeSession,
    workspacePath,
    async runTurn(turnInput): Promise<UIMessageChunk[]> {
      const chunks: UIMessageChunk[] = []
      for await (const chunk of provider.streamTurn({
        runId: `run-${randomUUID()}`,
        runtimeSession,
        profile,
        message: createUserMessage(turnInput.text),
        history: turnInput.history,
        modelId: TEST_MODEL,
        workspaceId: 'workspace-integration',
        workspacePath,
        providerOptions: {
          runtimeSettings: {
            permissionMode: turnInput.permissionMode ?? 'bypassPermissions',
          },
        },
      })) {
        chunks.push(chunk)
      }
      return chunks
    },
    activeQueryCount: () => (provider as unknown as { activeQueries: Map<string, unknown> }).activeQueries.size,
    async cleanup(): Promise<void> {
      await provider.dispose()
      if (ownsWorkspace) {
        rmSync(workspacePath, { recursive: true, force: true })
      }
    },
  }
}

export function createTextExchange(input: {
  label: string
  text: string
  gateAfterStart?: string
}): SimulatorExchange {
  const messageId = `msg_${input.label.replaceAll(/[^a-z0-9]/gi, '_')}`
  const steps: StreamStep[] = [messageStart(messageId)]
  if (input.gateAfterStart) {
    steps.push({ kind: 'gate', name: input.gateAfterStart })
  }
  steps.push(
    { kind: 'event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } } },
    { kind: 'event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: input.text } } },
    { kind: 'event', event: { type: 'content_block_stop', index: 0 } },
    { kind: 'event', event: createMessageDelta('end_turn') },
    { kind: 'event', event: { type: 'message_stop' } },
    { kind: 'close' },
  )
  return streamExchange(input.label, steps)
}

export function createToolUseExchange(input: {
  label: string
  toolUseId: string
  toolName: string
  toolInput: Record<string, unknown>
}): SimulatorExchange {
  const messageId = `msg_${input.label.replaceAll(/[^a-z0-9]/gi, '_')}`
  return streamExchange(input.label, [
    messageStart(messageId),
    {
      kind: 'event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: input.toolUseId,
          name: input.toolName,
          input: {},
          caller: { type: 'direct' },
        },
      },
    },
    {
      kind: 'event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(input.toolInput) },
      },
    },
    { kind: 'event', event: { type: 'content_block_stop', index: 0 } },
    { kind: 'event', event: createMessageDelta('tool_use') },
    { kind: 'event', event: { type: 'message_stop' } },
    { kind: 'close' },
  ])
}

export function createContextUsageProbeExchanges(): SimulatorExchange[] {
  return [
    tokenCountExchange('context-count-base'),
    tokenCountExchange('context-count-agent'),
    tokenCountExchange('context-count-read-only'),
    tokenCountExchange('context-count-write-tools'),
    createCurrentModeContextUsageProbeExchange(),
  ]
}

export function createCurrentModeContextUsageProbeExchange(): SimulatorExchange {
  return tokenCountExchange('context-count-current-mode')
}

export function readTextChunks(chunks: UIMessageChunk[]): string {
  return chunks
    .filter((chunk): chunk is Extract<UIMessageChunk, { type: 'text-delta' }> => chunk.type === 'text-delta')
    .map(chunk => chunk.delta)
    .join('')
}

export function createUserMessage(text: string): UIMessage {
  return {
    id: randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

function createIntegrationProfile(baseUrl: string): RuntimeProviderTargetProfile {
  return {
    id: 'profile-claude-integration',
    name: 'Claude Agent Integration',
    providerKind: 'anthropic',
    enabled: true,
    configJson: JSON.stringify({
      authMode: 'apiKey',
      baseUrl,
      model: TEST_MODEL,
    }),
    credentialRef: 'credential-claude-integration',
    customModels: '[]',
    iconSlug: null,
    providerTargetKind: 'manual',
    providerTargetId: 'profile-claude-integration',
  }
}

function createDisabledTitleProfile(baseUrl: string): RuntimeProviderTargetProfile {
  return {
    ...createIntegrationProfile(baseUrl),
    id: DISABLED_TITLE_PROFILE_ID,
    name: 'Claude Agent Integration Title Disabled',
    credentialRef: 'credential-claude-integration-title-disabled',
    providerTargetId: DISABLED_TITLE_PROFILE_ID,
  }
}

function messageStart(messageId: string): StreamStep {
  return {
    kind: 'event',
    event: {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: TEST_MODEL,
        content: [],
        container: null,
        context_management: null,
        diagnostics: null,
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        usage: {
          cache_creation: null,
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          fallback_credit: null,
          inference_geo: null,
          iterations: null,
          output_tokens_details: null,
          server_tool_use: null,
          service_tier: null,
          speed: null,
        },
      },
    },
  }
}

function createMessageDelta(stopReason: 'end_turn' | 'tool_use'): JsonValue {
  return {
    type: 'message_delta',
    context_management: null,
    delta: {
      container: null,
      stop_details: null,
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage: {
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      fallback_credit: null,
      input_tokens: 1,
      iterations: null,
      output_tokens: 3,
      output_tokens_details: null,
      server_tool_use: null,
    },
  }
}

function streamExchange(label: string, steps: StreamStep[]): SimulatorExchange {
  return {
    label,
    request: {
      method: 'POST',
      path: '/v1/messages',
      bodyFields: { '/stream': true },
    },
    response: { kind: 'stream', steps },
  }
}

function tokenCountExchange(label: string): SimulatorExchange {
  return {
    label,
    request: { method: 'POST', path: '/v1/messages/count_tokens' },
    response: {
      kind: 'json',
      body: { context_management: null, input_tokens: 1 },
    },
  }
}

async function controlRequest<T = void>(
  context: ClaudeAgentIntegrationContext,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${context.controlUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`Simulator control request failed: ${response.status} ${await response.text()}`)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return await response.json() as T
}
