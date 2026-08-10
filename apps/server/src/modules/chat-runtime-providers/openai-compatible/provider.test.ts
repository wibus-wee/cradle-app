import type { UIMessage, UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ProviderContext,
  RuntimeProviderTargetProfile,
  RuntimeSession,
  RuntimeTurnResult,
} from '../../chat-runtime/runtime-provider-types'
import type { AiSdkEngineInput } from '../../chat-runtime-engine/ai-sdk-engine'
import { assertValidProviderChunkSequence } from '../kit/testing/chunk-contract'
import { OpenAICompatibleProvider } from './provider'

const engineMocks = vi.hoisted(() => ({
  buildModelMessages: vi.fn(async () => [{ role: 'user', content: 'Hello standard' }]),
  executeAiSdkTurn: vi.fn(async function* (_input: AiSdkEngineInput) {
    yield { type: 'text-start', id: 'text-1' }
    yield { type: 'text-delta', id: 'text-1', delta: 'Standard answer' }
    yield { type: 'text-end', id: 'text-1' }
    yield { type: 'finish', finishReason: 'stop' }
  }),
  createLanguageModel: vi.fn(() => ({ provider: 'mock-model' })),
  detectApiFormat: vi.fn(() => 'openai'),
  getCachedContextWindow: vi.fn(() => 32_000),
}))

vi.mock('../../chat-runtime-engine/ai-sdk-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../chat-runtime-engine/ai-sdk-engine')>()
  return {
    ...actual,
    buildModelMessages: engineMocks.buildModelMessages,
    executeAiSdkTurn: engineMocks.executeAiSdkTurn,
  }
})

vi.mock('../../chat-runtime-engine/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../chat-runtime-engine/providers')>()
  return {
    ...actual,
    createLanguageModel: engineMocks.createLanguageModel,
    detectApiFormat: engineMocks.detectApiFormat,
  }
})

vi.mock('../../model-registry/model-info-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../model-registry/model-info-registry')>()
  return {
    ...actual,
    getCachedContextWindow: engineMocks.getCachedContextWindow,
  }
})

describe('openai compatible provider', () => {
  afterEach(() => {
    vi.clearAllMocks()
    engineMocks.executeAiSdkTurn.mockImplementation(async function* (_input: AiSdkEngineInput) {
      yield { type: 'text-start', id: 'text-1' }
      yield { type: 'text-delta', id: 'text-1', delta: 'Standard answer' }
      yield { type: 'text-end', id: 'text-1' }
      yield { type: 'finish', finishReason: 'stop' }
    })
  })

  it('streams AI SDK engine chunks as a valid provider chunk sequence', async () => {
    const provider = new OpenAICompatibleProvider(createProviderContext())
    const chunks: UIMessageChunk[] = []

    for await (const chunk of provider.streamTurn({
      runId: 'run-standard',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Hello standard'),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/workspace',
    })) {
      chunks.push(chunk)
    }

    expect(chunks.map(chunk => chunk.type)).toEqual([
      'text-start',
      'text-delta',
      'text-end',
      'finish',
    ])
    assertValidProviderChunkSequence(chunks)
    expect(engineMocks.createLanguageModel).toHaveBeenCalledWith(expect.objectContaining({
      apiFormat: 'openai',
      baseUrl: 'http://openai-compatible.local/v1',
      modelId: 'gpt-test',
    }))
    expect(engineMocks.executeAiSdkTurn).toHaveBeenCalledWith(expect.objectContaining({
      contextWindow: 32_000,
      maxSteps: 1,
      chatSessionId: 'chat-session-1',
    }))
  })

  it('keeps usage and step results isolated across concurrent turns', async () => {
    const provider = new OpenAICompatibleProvider(createProviderContext())
    let callIndex = 0
    let releaseFirstTurn!: () => void
    let markFirstUsageReported!: () => void
    const firstTurnMayFinish = new Promise<void>((resolve) => { releaseFirstTurn = resolve })
    const firstUsageReported = new Promise<void>((resolve) => { markFirstUsageReported = resolve })

    engineMocks.executeAiSdkTurn.mockImplementation(async function* (input: AiSdkEngineInput) {
      const turn = ++callIndex
      const usage = {
        promptTokens: turn,
        completionTokens: turn * 10,
        totalTokens: turn * 11,
      }
      input.onUsage?.(usage)
      input.onStepFinish?.({
        stepNumber: 0,
        stepType: 'initial',
        modelId: `model-${turn}`,
        usage,
      })
      if (turn === 1) {
        markFirstUsageReported()
        await firstTurnMayFinish
      }
      else {
        releaseFirstTurn()
      }
      yield { type: 'finish', finishReason: 'stop' }
    })

    const results: RuntimeTurnResult[] = []
    const consume = async (turn: number): Promise<void> => {
      for await (const _chunk of provider.streamTurn({
        runId: `run-${turn}`,
        runtimeSession: createRuntimeSession(`chat-session-${turn}`),
        profile: createProfile(),
        message: createUserMessage(`turn ${turn}`),
        workspaceId: 'workspace-1',
        workspacePath: '/tmp/workspace',
        reportTurnResult: (result) => { results[turn - 1] = result },
      })) {
        // Consume the provider stream so the turn result is finalized.
      }
    }

    const first = consume(1)
    await firstUsageReported
    await Promise.all([first, consume(2)])

    expect(results).toEqual([
      {
        modelId: 'gpt-test',
        usage: { promptTokens: 1, completionTokens: 10, totalTokens: 11 },
        stepUsages: [{
          stepNumber: 0,
          stepType: 'initial',
          modelId: 'model-1',
          usage: { promptTokens: 1, completionTokens: 10, totalTokens: 11 },
        }],
      },
      {
        modelId: 'gpt-test',
        usage: { promptTokens: 2, completionTokens: 20, totalTokens: 22 },
        stepUsages: [{
          stepNumber: 0,
          stepType: 'initial',
          modelId: 'model-2',
          usage: { promptTokens: 2, completionTokens: 20, totalTokens: 22 },
        }],
      },
    ])
  })
})

function createProviderContext(): ProviderContext {
  return {
    readSecret: () => 'test-key',
  }
}

function createProfile(): RuntimeProviderTargetProfile {
  return {
    id: 'profile-standard',
    name: 'Standard',
    providerKind: 'openai-compatible',
    enabled: true,
    configJson: JSON.stringify({
      baseUrl: 'http://openai-compatible.local/v1',
      model: 'gpt-test',
      maxMessages: 8,
    }),
    credentialRef: null,
    customModels: '[]',
    iconSlug: null,
    providerTargetKind: 'manual',
    providerTargetId: 'profile-standard',
  }
}

function createRuntimeSession(chatSessionId = 'chat-session-1'): RuntimeSession {
  return {
    id: 'runtime-session-1',
    chatSessionId,
    providerTargetId: 'profile-standard',
    runtimeKind: 'standard',
    providerSessionId: null,
    providerStateSnapshot: JSON.stringify({
      baseUrl: 'http://openai-compatible.local/v1',
      models: { currentModelId: 'gpt-test' },
    }),
  }
}

function createUserMessage(text: string): UIMessage {
  return {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}
