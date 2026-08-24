import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { JsonObject, SimulatorExchange } from '@cradle/model-api-simulator'
import { startModelApiSimulator } from '@cradle/model-api-simulator'
import type { UIMessage, UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import type {
  RuntimeProviderTargetProfile,
} from '../../../chat-runtime/runtime-provider-types'
import { CodexAppServerClient } from '../app-server/client'
import type { ThreadGoalSetParams } from '../app-server-protocol/v2/ThreadGoalSetParams'
import { CodexProvider } from '../provider'
import type { CodexAppServerClientLike } from '../types'

const RUN_REAL_INTEGRATION = process.env.CRADLE_CODEX_APP_SERVER_INTEGRATION === '1'
const APP_SERVER_PATH = process.env.CRADLE_CODEX_APP_SERVER_PATH?.trim() ?? ''
const describeIntegration = RUN_REAL_INTEGRATION && existsSync(APP_SERVER_PATH)
  ? describe
  : describe.skip

describeIntegration('Codex real app-server live steer integration', () => {
  it('applies live steer after a goal handoff publishes its active turn', async () => {
    const repoRoot = resolve(process.cwd(), '..', '..')
    const cacheRoot = join(repoRoot, 'node_modules', '.cache')
    mkdirSync(cacheRoot, { recursive: true })
    const dataDir = mkdtempSync(join(cacheRoot, 'cradle-codex-steer-repro-'))
    const workspacePath = join(dataDir, 'workspace')
    mkdirSync(workspacePath, { recursive: true })

    const previousDataDir = process.env.CRADLE_DATA_DIR
    const simulator = await startModelApiSimulator({
      autoRespond: true,
      strictRequestValidation: false,
    })
    process.env.CRADLE_DATA_DIR = dataDir
    const objectiveGate = new GoalObjectiveRequestGate()
    const clients: CodexAppServerClientLike[] = []
    const profile = createProfile(simulator.openaiBaseUrl)
    const provider = new CodexProvider({
      readSecret: () => '',
      resolveSkillPaths: () => [],
      recordObservability: () => {},
      createAppServerClient: (options) => {
        const client = new GoalGatedCodexClient(
          new CodexAppServerClient({
            ...options,
            appServerPath: APP_SERVER_PATH,
          }),
          objectiveGate,
        )
        clients.push(client)
        return client
      },
    })
    const chatSessionId = `codex-steer-repro-${randomUUID()}`
    const runtimeSession = await provider.startChatSession({
      chatSessionId,
      profile,
      workspacePath,
      modelId: 'gpt-test',
    })

    let goalStreamSettled = false
    let goalStream: Promise<void> | null = null
    let simulatorGateReached = false
    let simulatorGate: string | null = null
    try {
      await drain(provider.streamTurn({
        runId: `warm-${randomUUID()}`,
        runtimeSession,
        profile,
        message: userMessage('Warm the provider thread.'),
        modelId: 'gpt-test',
        workspaceId: 'workspace-integration',
        workspacePath,
      }))

      const objective = 'Persist the Codex live steer handoff reproduction.'
      simulatorGate = `goal-model-${randomUUID()}`
      simulator.controller.enqueue({
        provider: 'openai',
        exchanges: [openAiTextExchange({
          label: 'goal handoff remains live',
          text: 'Goal work is still running.',
          bodyTextIncludes: objective,
          gateAfterCreated: simulatorGate,
        })],
      })

      goalStream = drain(provider.streamTurn({
        runId: `goal-${randomUUID()}`,
        runtimeSession,
        profile,
        message: userMessage(`/goal ${objective}`),
        modelId: 'gpt-test',
        workspaceId: 'workspace-integration',
        workspacePath,
      })).finally(() => {
        goalStreamSettled = true
      })

      await objectiveGate.waitUntilReached()

      expect(runtimeSession.providerSessionId).toEqual(expect.any(String))
      expect(runtimeSession.providerSessionId).not.toBe(chatSessionId)
      expect(goalStreamSettled).toBe(false)

      let steerSettled = false
      const steer = provider.steerTurn({
        runtimeSession,
        profile,
        message: userMessage('Steer during the goal handoff.'),
      }).finally(() => {
        steerSettled = true
      })
      await Promise.resolve()
      expect(steerSettled).toBe(false)

      objectiveGate.release()
      await simulator.controller.waitForGate(simulatorGate)
      simulatorGateReached = true
      await expect(steer).resolves.toBeUndefined()

      expect(goalStreamSettled).toBe(false)
      expect(simulator.controller.requests()).toEqual(expect.arrayContaining([
        expect.objectContaining({ method: 'POST', path: '/v1/responses' }),
      ]))
    }
    finally {
      objectiveGate.release()
      const cancel = provider.cancelTurn({ runtimeSession, profile }).catch(() => undefined)
      if (simulatorGateReached && simulatorGate) {
        simulator.controller.release(simulatorGate)
      }
      await cancel
      await goalStream?.catch(() => undefined)
      try {
        await Promise.allSettled(clients.map(client => client.close()))
        await simulator.close()
      }
      finally {
        if (previousDataDir === undefined) {
          delete process.env.CRADLE_DATA_DIR
        }
        else {
          process.env.CRADLE_DATA_DIR = previousDataDir
        }
        rmSync(dataDir, { recursive: true, force: true })
      }
    }
  }, 30_000)
})

class GoalObjectiveRequestGate {
  private reached = Promise.withResolvers<void>()
  private released = Promise.withResolvers<void>()
  private didReach = false
  private didRelease = false

  async hold(): Promise<void> {
    if (!this.didReach) {
      this.didReach = true
      this.reached.resolve()
    }
    await this.released.promise
  }

  waitUntilReached(): Promise<void> {
    return this.reached.promise
  }

  release(): void {
    if (this.didRelease) {
      return
    }
    this.didRelease = true
    this.released.resolve()
  }
}

class GoalGatedCodexClient implements CodexAppServerClientLike {
  constructor(
    private readonly client: CodexAppServerClientLike,
    private readonly objectiveGate: GoalObjectiveRequestGate,
  ) {}

  get pid(): number | null {
    return this.client.pid
  }

  initialize(): Promise<void> {
    return this.client.initialize()
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const result = await this.client.request(method, params)
    if (method === 'thread/goal/set' && hasGoalObjective(params)) {
      await this.objectiveGate.hold()
    }
    return result
  }

  nextNotification(signal?: AbortSignal) {
    return this.client.nextNotification(signal)
  }

  close(): void | Promise<void> {
    return this.client.close()
  }
}

function hasGoalObjective(params: unknown): boolean {
  const goal = params as Partial<ThreadGoalSetParams> | undefined
  return typeof goal?.objective === 'string'
}

function createProfile(baseUrl: string): RuntimeProviderTargetProfile {
  const id = `codex-steer-repro-profile-${randomUUID()}`
  return {
    id,
    name: 'Codex steer reproduction',
    providerKind: 'openai-compatible',
    enabled: true,
    configJson: JSON.stringify({
      apiKey: 'sk-codex-steer-repro',
      authMode: 'apikey',
      baseUrl,
      model: 'gpt-test',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      reasoningEffort: 'minimal',
    }),
    credentialRef: null,
    customModels: '[]',
    iconSlug: null,
    providerTargetKind: 'manual',
    providerTargetId: id,
  }
}

function userMessage(text: string): UIMessage {
  return {
    id: randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

async function drain(stream: AsyncGenerator<UIMessageChunk, void, void>): Promise<void> {
  for await (const _chunk of stream) {
    // Drive the native stream to completion.
  }
}

function openAiTextExchange(input: {
  label: string
  text: string
  bodyTextIncludes: string
  gateAfterCreated: string
}): SimulatorExchange {
  const id = input.label.replaceAll(/[^a-z0-9]+/gi, '_').toLowerCase()
  const response = completedResponse(id, input.text)
  return {
    label: input.label,
    request: {
      method: 'POST',
      path: '/v1/responses',
      bodyFields: { '/stream': true },
      bodyTextIncludes: input.bodyTextIncludes,
    },
    response: {
      kind: 'stream',
      steps: [
        {
          kind: 'event',
          event: {
            type: 'response.created',
            sequence_number: 0,
            response: { ...response, status: 'in_progress', output: [] },
          },
        },
        { kind: 'gate', name: input.gateAfterCreated },
        { kind: 'event', event: { type: 'response.completed', sequence_number: 1, response } },
        { kind: 'close' },
      ],
    },
  }
}

function completedResponse(id: string, text: string): JsonObject {
  return {
    id: `resp_${id}`,
    object: 'response',
    created_at: 1,
    status: 'completed',
    background: false,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    max_tool_calls: null,
    model: 'gpt-test',
    output: [{
      id: `msg_${id}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [], logprobs: [] }],
    }],
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: null,
    service_tier: 'default',
    store: false,
    temperature: 1,
    text: { format: { type: 'text' } },
    tool_choice: 'auto',
    tools: [],
    top_p: 1,
    truncation: 'disabled',
    usage: {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2,
    },
    metadata: {},
  }
}
