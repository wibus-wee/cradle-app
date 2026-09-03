import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ObservedRequest, SimulatorScenario } from '@cradle/model-api-simulator'
import {
  isJsonArray,
  isJsonObject,
} from '@cradle/model-api-simulator'
import type { UIMessage, UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ClaudeAgentIntegrationHarness } from './harness'
import {
  createClaudeAgentIntegrationHarness,
  createSimulatorController,
  createTextExchange,
  createToolUseExchange,
  createUserMessage,
  readClaudeAgentIntegrationContext,
  readTextChunks,
} from './harness'

const context = readClaudeAgentIntegrationContext()
const describeIntegration = context ? describe : describe.skip

if (!context) {
  console.warn('Skipping Claude Agent integration tests: shared simulator context is unavailable.')
}

describeIntegration('Claude Agent real CLI integration', () => {
  const simulator = createSimulatorController(context!)
  const harnesses: ClaudeAgentIntegrationHarness[] = []

  beforeEach(async () => {
    await simulator.reset()
  })

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map(harness => harness.cleanup()))
    await simulator.reset()
  })

  it('streams one real CLI turn through the shared simulator', async () => {
    await simulator.enqueue(scenario(
      createTextExchange({ label: 'smoke', text: 'wire smoke passed' }),
    ))
    const harness = await createHarness()

    const chunks = await harness.runTurn({ text: 'Run the wire smoke test.' })

    expect(readTextChunks(chunks)).toContain('wire smoke passed')
    const requests = conversationRequests(await simulator.requests())
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'POST', path: '/v1/messages' })
    await simulator.assertExhausted()
  }, 20_000)

  it('does not duplicate Cradle history in the live Query wire payload', async () => {
    await simulator.enqueue(scenario(
      createTextExchange({ label: 'history-first', text: 'first wire response' }),
      createTextExchange({ label: 'history-second', text: 'second wire response' }),
    ))
    const harness = await createHarness()
    const earlierUser = createUserMessage('earlier-history-marker')
    const earlierAssistant: UIMessage = {
      id: 'earlier-assistant',
      role: 'assistant',
      parts: [{ type: 'text', text: 'earlier-assistant-marker' }],
    }
    const firstUser = createUserMessage('first-live-task-marker')

    await collectTurn(harness, firstUser, [earlierUser, earlierAssistant])
    const secondTurn = await harness.runTurn({
      text: 'second-live-task-marker',
      history: [
        earlierUser,
        earlierAssistant,
        firstUser,
        {
          id: 'first-wire-assistant',
          role: 'assistant',
          parts: [{ type: 'text', text: 'first wire response' }],
        },
      ],
    })

    const allRequests = await simulator.requests()
    expect(readTextChunks(secondTurn)).toContain('second wire response')
    const requests = conversationRequests(allRequests)
    expect(requests).toHaveLength(2)
    const firstBody = JSON.stringify(requests[0]?.body)
    const secondBody = JSON.stringify(requests[1]?.body)
    expect(firstBody).toContain('Previous messages in this Cradle chat session:')
    // The CLI carries turn one forward once. Replaying Cradle history on turn two would duplicate both markers.
    expect(occurrences(secondBody, 'Previous messages in this Cradle chat session:')).toBe(1)
    expect(occurrences(secondBody, 'earlier-history-marker')).toBe(1)
    expect(occurrences(secondBody, 'first-live-task-marker')).toBe(1)
    await simulator.assertExhausted()
  }, 20_000)

  it('honors startup permission mode before processing a real CLI tool call', async () => {
    let planApprovalRequests = 0
    const planHarness = await createHarness({
      requestToolApproval: async (request) => {
        planApprovalRequests += 1
        return { requestId: request.providerRequestId, approved: true }
      },
    })
    const planFile = join(planHarness.workspacePath, 'permission.txt')
    await simulator.enqueue(scenario(
      createToolUseExchange({
        label: 'plan-write',
        toolUseId: 'toolu_plan_write',
        toolName: 'Write',
        toolInput: { file_path: planFile, content: 'permission-file-marker' },
      }),
      createTextExchange({ label: 'plan-finish', text: 'plan mode finished' }),
    ))

    await planHarness.runTurn({ text: 'Write the permission fixture.', permissionMode: 'plan' })
    const planRequests = conversationRequests(await simulator.requests())
    expect(planRequests).toHaveLength(2)
    expect(planApprovalRequests).toBe(0)
    expect(existsSync(planFile)).toBe(false)
    expect(JSON.stringify(planRequests[1]?.body)).toContain(
      'Cradle is in plan mode. Submit or revise the plan before running implementation tools.',
    )
    await simulator.assertExhausted()

    await planHarness.cleanup()
    harnesses.splice(harnesses.indexOf(planHarness), 1)
    await simulator.reset()

    let bypassApprovalRequests = 0
    const bypassHarness = await createHarness({
      requestToolApproval: async (request) => {
        bypassApprovalRequests += 1
        return { requestId: request.providerRequestId, approved: true }
      },
    })
    const bypassFile = join(bypassHarness.workspacePath, 'permission.txt')
    await simulator.enqueue(scenario(
      createToolUseExchange({
        label: 'bypass-write',
        toolUseId: 'toolu_bypass_write',
        toolName: 'Write',
        toolInput: { file_path: bypassFile, content: 'permission-file-marker' },
      }),
      createTextExchange({ label: 'bypass-finish', text: 'bypass mode finished' }),
    ))
    const bypassChunks = await bypassHarness.runTurn({ text: 'Write the permission fixture.', permissionMode: 'bypassPermissions' })
    const bypassAllRequests = await simulator.requests()
    const bypassRequests = conversationRequests(bypassAllRequests)
    expect(readTextChunks(bypassChunks)).toContain('bypass mode finished')
    expect(bypassRequests).toHaveLength(2)
    expect(bypassApprovalRequests).toBe(0)
    expect(readFileSync(bypassFile, 'utf8')).toBe('permission-file-marker')
    expect(JSON.stringify(bypassRequests[1]?.body)).toContain('permission-file-marker')
    expect(JSON.stringify(bypassRequests[1]?.body)).not.toContain('Cradle is in plan mode.')
    await simulator.assertExhausted()
  }, 30_000)

  it('tears down a pre-output CLI turn on cancel and serves the next turn from a fresh Query', async () => {
    const gate = 'cancel-before-output'
    await simulator.enqueue(scenario(
      createTextExchange({ label: 'cancel-slow', text: 'late output', gateAfterStart: gate }),
    ))
    const harness = await createHarness()
    const stream = harness.provider.streamTurn({
      runId: 'run-cancel-integration',
      runtimeSession: harness.runtimeSession,
      profile: harness.profile,
      message: createUserMessage('Cancel before output.'),
      modelId: 'claude-sonnet-4-5',
      workspaceId: 'workspace-integration',
      workspacePath: harness.workspacePath,
      providerOptions: { runtimeSettings: { permissionMode: 'bypassPermissions' } },
    })
    const firstChunk = stream.next()

    await simulator.waitForGate(gate)
    await harness.provider.cancelTurn({
      runtimeSession: harness.runtimeSession,
      profile: harness.profile,
    })
    expect(harness.activeQueryCount()).toBe(0)
    await simulator.release(gate)
    await expect(firstChunk).resolves.toMatchObject({
      value: expect.objectContaining({ type: 'abort', reason: 'user' }),
    })

    await simulator.enqueue(scenario(
      createTextExchange({ label: 'cancel-recovery', text: 'fresh query recovered' }),
    ))
    const recovery = await harness.runTurn({ text: 'Try again after cancel.' })
    expect(readTextChunks(recovery)).toContain('fresh query recovered')
    expect(conversationRequests(await simulator.requests())).toHaveLength(2)
    await simulator.assertExhausted()
  }, 30_000)

  it('loads project CLAUDE.md into the API-key CLI request', async () => {
    await simulator.enqueue(scenario(
      createTextExchange({ label: 'project-settings', text: 'project settings loaded' }),
    ))
    const harness = await createHarness()
    writeFileSync(
      join(harness.workspacePath, 'CLAUDE.md'),
      'project-claude-md-wire-marker',
    )

    await harness.runTurn({ text: 'Use the project instructions.' })

    const requests = conversationRequests(await simulator.requests())
    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0]?.body)).toContain('project-claude-md-wire-marker')
    await simulator.assertExhausted()
  }, 20_000)

  async function createHarness(
    deps?: Parameters<typeof createClaudeAgentIntegrationHarness>[0]['deps'],
  ): Promise<ClaudeAgentIntegrationHarness> {
    const harness = await createClaudeAgentIntegrationHarness({ context: context!, deps })
    harnesses.push(harness)
    return harness
  }
})

function scenario(...exchanges: SimulatorScenario['exchanges']): SimulatorScenario {
  return { provider: 'anthropic', exchanges }
}

async function collectTurn(
  harness: ClaudeAgentIntegrationHarness,
  message: UIMessage,
  history: UIMessage[],
): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = []
  for await (const chunk of harness.provider.streamTurn({
    runId: 'run-history-first',
    runtimeSession: harness.runtimeSession,
    profile: harness.profile,
    message,
    history,
    modelId: 'claude-sonnet-4-5',
    workspaceId: 'workspace-integration',
    workspacePath: harness.workspacePath,
    providerOptions: { runtimeSettings: { permissionMode: 'bypassPermissions' } },
  })) {
    chunks.push(chunk)
  }
  return chunks
}

function occurrences(value: string, marker: string): number {
  return value.split(marker).length - 1
}

function conversationRequests(requests: ObservedRequest[]): ObservedRequest[] {
  return requests.filter((request) => {
    if (request.path !== '/v1/messages' || request.body === undefined || !isJsonObject(request.body)) {
      return false
    }
    const tools = request.body.tools
    return request.body.stream === true && tools !== undefined && isJsonArray(tools) && tools.length > 0
  })
}
