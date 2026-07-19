import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ClaudeWorkflowArtifactSnapshot } from './artifact-stream'
import { ClaudeWorkflowArtifactSource } from './artifact-stream'
import { createClaudeWorkflowExecutionRecord } from './execution'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('claudeWorkflowArtifactSource', () => {
  it('projects journal and agent transcripts into one live Workflow snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cradle-workflow-artifacts-'))
    temporaryDirectories.push(root)
    const runId = 'wf_test_1'
    const workflowsDir = join(root, 'workflows')
    const transcriptDir = join(root, 'subagents', 'workflows', runId)
    await mkdir(join(workflowsDir, 'scripts'), { recursive: true })
    await mkdir(transcriptDir, { recursive: true })
    await writeFile(join(workflowsDir, `${runId}.json`), JSON.stringify({ result: { complete: true } }))
    await writeFile(join(workflowsDir, 'scripts', 'workflow.js'), 'export const meta = {}')
    await writeFile(join(transcriptDir, 'journal.jsonl'), [
      JSON.stringify({ type: 'started', agentId: 'agent-1' }),
      JSON.stringify({ type: 'result', agentId: 'agent-1', result: { answer: 'done' } }),
      '',
    ].join('\n'))
    await writeFile(join(transcriptDir, 'agent-agent-1.jsonl'), [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-07-19T00:00:00.000Z',
        message: { content: 'Inspect the implementation' },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-07-19T00:00:03.000Z',
        message: {
          model: 'opus',
          usage: { input_tokens: 100, output_tokens: 20 },
          content: [{ type: 'tool_use', name: 'Read' }],
        },
      }),
      '',
    ].join('\n'))

    const execution = createClaudeWorkflowExecutionRecord({
      toolCallId: 'tool-1',
      input: { name: 'workflow', description: 'A workflow' },
      output: {
        status: 'async_launched',
        taskId: 'task-1',
        taskType: 'local_workflow',
        workflowName: 'workflow',
        runId,
        transcriptDir,
        scriptPath: join(workflowsDir, 'scripts', 'workflow.js'),
      },
      status: 'running',
    })
    const source = new ClaudeWorkflowArtifactSource(execution, () => undefined)
    await source.initialize()
    const snapshots: ClaudeWorkflowArtifactSnapshot[] = []
    const unsubscribe = source.subscribe(snapshot => snapshots.push(snapshot))

    await eventually(() => {
      const agent = snapshots.at(-1)?.agents[0]
      expect(agent).toMatchObject({
        id: 'agent-1',
        status: 'completed',
        prompt: 'Inspect the implementation',
        model: 'opus',
        totalTokens: 120,
        toolUses: 1,
        lastToolName: 'Read',
        result: { answer: 'done' },
      })
    })
    expect(snapshots.at(-1)?.workflow.result).toEqual({ complete: true })

    unsubscribe()
  })

  it('streams declaration, partial journal, transcript, and final authoritative state then releases the source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cradle-workflow-live-'))
    temporaryDirectories.push(root)
    const runId = 'wf_live_1'
    const workflowsDir = join(root, 'workflows')
    const scriptPath = join(workflowsDir, 'scripts', 'workflow.js')
    const transcriptDir = join(root, 'subagents', 'workflows', runId)
    await mkdir(join(workflowsDir, 'scripts'), { recursive: true })
    await mkdir(transcriptDir, { recursive: true })
    await writeFile(scriptPath, `
export const meta = { name: 'live-review', phases: [{ title: 'Review' }] }
phase('Review')
await agent('Inspect errors', { label: 'review:errors' })
`)
    await writeFile(join(transcriptDir, 'journal.jsonl'), '')

    const execution = createClaudeWorkflowExecutionRecord({
      toolCallId: 'tool-live',
      input: { name: 'live-review', scriptPath },
      output: {
        status: 'async_launched',
        taskId: 'task-live',
        taskType: 'local_workflow',
        workflowName: 'live-review',
        runId,
        transcriptDir,
        scriptPath,
      },
      status: 'running',
    })
    let emptied = false
    const source = new ClaudeWorkflowArtifactSource(execution, () => { emptied = true })
    await source.initialize()
    const snapshots: ClaudeWorkflowArtifactSnapshot[] = []
    const unsubscribe = source.subscribe(snapshot => snapshots.push(snapshot))

    await eventually(() => {
      expect(snapshots.at(-1)).toMatchObject({
        phases: [{ index: 1, title: 'Review' }],
        agents: [{ label: 'review:errors', alignment: 'declared', status: 'pending' }],
      })
    })

    const journalPath = join(transcriptDir, 'journal.jsonl')
    await appendFile(journalPath, JSON.stringify({ type: 'started', agentId: 'agent-live' }))
    await appendFile(journalPath, '\n')
    await eventually(() => expect(snapshots.at(-1)?.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent-live', status: 'running' }),
    ])))

    await writeFile(join(transcriptDir, 'agent-agent-live.jsonl'), `${JSON.stringify({
      type: 'user',
      uuid: 'prompt-live',
      timestamp: '2026-07-19T00:00:00.000Z',
      message: { content: 'Inspect errors' },
    })}\n`)
    await eventually(() => expect(snapshots.at(-1)?.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent-live', alignment: 'inferred', phaseTitle: 'Review' }),
    ])))

    await writeFile(join(workflowsDir, `${runId}.json`), JSON.stringify({
      runId,
      workflowName: 'live-review',
      status: 'completed',
      workflowProgress: [
        { type: 'workflow_phase', index: 1, title: 'Review' },
        {
          type: 'workflow_agent',
          index: 1,
          label: 'review:errors',
          phaseIndex: 1,
          phaseTitle: 'Review',
          agentId: 'agent-live',
          state: 'done',
        },
      ],
    }))
    await eventually(() => expect(snapshots.at(-1)).toMatchObject({
      workflow: { status: 'completed' },
      agents: [{ id: 'agent-live', alignment: 'observed', status: 'completed' }],
    }))

    unsubscribe()
    expect(emptied).toBe(true)
    expect(() => source.subscribe(() => undefined)).toThrow('closed Workflow artifact source')
  })
})

async function eventually(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1_000
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      assertion()
      return
    }
    catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  throw lastError
}
