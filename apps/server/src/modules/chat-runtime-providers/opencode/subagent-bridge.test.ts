import type { Session as OpencodeSession, ToolPart as OpencodeToolPart } from '@opencode-ai/sdk'
import { describe, expect, it } from 'vitest'

import {
  OpencodeSubagentRegistry,
  readOpencodeSubagentBindingFromTaskPart,
  readOpencodeTaskBindingsFromMessages,
  resolveOpencodeProviderThreadTarget,
} from './subagent-bridge'

function taskPart(input: Partial<OpencodeToolPart> = {}): OpencodeToolPart {
  return {
    id: input.id ?? 'part_task',
    sessionID: input.sessionID ?? 'ses_parent',
    messageID: input.messageID ?? 'msg_assistant',
    type: 'tool',
    callID: input.callID ?? 'call_task_1',
    tool: 'task',
    state: input.state ?? {
      status: 'running',
      input: {
        description: 'Explore auth module',
        subagent_type: 'explore',
      },
      title: 'Explore auth module',
      metadata: {
        sessionId: 'ses_child',
        parentSessionId: 'ses_parent',
      },
      time: { start: 1 },
    },
  }
}

describe('openCode subagent bridge', () => {
  it('resolves provider-thread reads from task toolCallId via parent history', async () => {
    const registry = new OpencodeSubagentRegistry()
    const childSession: OpencodeSession = {
      id: 'ses_child',
      projectID: 'project-1',
      directory: '/tmp/workspace',
      parentID: 'ses_parent',
      title: 'Explore auth module',
      version: '1.17.11',
      time: { created: 2, updated: 3 },
    }

    const target = await resolveOpencodeProviderThreadTarget({
      threadId: 'call_task_1',
      parentSessionId: 'ses_parent',
      registry,
      readChildSession: async sessionId => sessionId === 'ses_child' ? childSession : null,
      readParentTaskBindings: async () => readOpencodeTaskBindingsFromMessages('ses_parent', [
        {
          info: {
            id: 'msg_assistant',
            sessionID: 'ses_parent',
            role: 'assistant',
            time: { created: 1 },
            parentID: 'msg_user',
            modelID: 'gpt-5',
            providerID: 'openai',
            mode: 'build',
            path: { cwd: '/tmp/workspace', root: '/tmp/workspace' },
            cost: 0,
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [taskPart()],
        },
      ]),
    })

    expect(target).toMatchObject({
      kind: 'session',
      sessionId: 'ses_child',
      requestedThreadId: 'call_task_1',
      binding: {
        toolCallId: 'call_task_1',
        childSessionId: 'ses_child',
        parentSessionId: 'ses_parent',
        description: 'Explore auth module',
        subagentType: 'explore',
      },
    })
  })

  it('reads child session id from completed task output when metadata is missing', () => {
    const binding = readOpencodeSubagentBindingFromTaskPart({
      ...taskPart(),
      state: {
        status: 'completed',
        input: { description: 'Run tests', subagent_type: 'general' },
        title: 'Run tests',
        output: 'task_id: ses_child_from_output',
        metadata: {},
        time: { start: 1, end: 2 },
      },
    }, 'ses_parent')

    expect(binding).toMatchObject({
      toolCallId: 'call_task_1',
      childSessionId: 'ses_child_from_output',
      parentSessionId: 'ses_parent',
    })
  })
})
