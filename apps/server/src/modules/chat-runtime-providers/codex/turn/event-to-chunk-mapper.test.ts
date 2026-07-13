import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createCodexAppServerMapperState,
  mapCodexAppServerNotificationToChunks,
} from './event-to-chunk-mapper'

describe('mapCodexAppServerNotificationToChunks', () => {
  it('inserts retryable errors between streamed text segments as warnings', () => {
    const state = createCodexAppServerMapperState('text-1')

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/agentMessage/delta',
      params: { itemId: 'text-1', delta: 'Before' },
    }, state)).toEqual([
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Before' },
    ])

    expect(mapCodexAppServerNotificationToChunks({
      method: 'error',
      params: {
        error: {
          message: 'Reconnecting... 2/5',
          additionalDetails: 'request timed out',
          codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } },
        },
        willRetry: true,
      },
    }, state)).toEqual([
      { type: 'text-end', id: 'text-1' },
      {
        type: 'data-runtime-warning',
        data: {
          message: 'Reconnecting... 2/5',
          additionalDetails: 'request timed out',
        },
      },
    ])

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/agentMessage/delta',
      params: { itemId: 'text-1', delta: 'After' },
    }, state)).toEqual([
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'After' },
    ])
  })

  it('projects Codex moderation metadata as AI SDK message metadata', () => {
    const state = createCodexAppServerMapperState('text-1')

    expect(mapCodexAppServerNotificationToChunks({
      method: 'turn/moderationMetadata',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        metadata: { categories: { violence: false } },
      },
    }, state)).toEqual([{
      type: 'message-metadata',
      messageMetadata: {
        codex: {
          moderationMetadataByTurnId: {
            'turn-1': {
              threadId: 'thread-1',
              turnId: 'turn-1',
              metadata: { categories: { violence: false } },
            },
          },
        },
      },
    }])
  })

  it('projects raw Codex response items into message metadata', () => {
    const state = createCodexAppServerMapperState('text-1')
    const item = {
      type: 'agent_message',
      author: 'assistant',
      recipient: 'user',
      content: [{ type: 'input_text', text: 'Native agent text' }],
      metadata: { turn_id: 'turn-1' },
    }

    expect(mapCodexAppServerNotificationToChunks({
      method: 'rawResponseItem/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item,
      },
    }, state)).toEqual([{
      type: 'message-metadata',
      messageMetadata: {
        codex: {
          responseItems: [{
            threadId: 'thread-1',
            turnId: 'turn-1',
            item,
          }],
        },
      },
    }])
  })

  it('projects raw Codex image generation response items into metadata and file content', () => {
    const state = createCodexAppServerMapperState('text-1')
    const item = {
      type: 'image_generation_call',
      id: 'raw-img-1',
      status: 'completed',
      revised_prompt: 'A calm interface',
      result: 'raw-image-data',
    }

    expect(mapCodexAppServerNotificationToChunks({
      method: 'rawResponseItem/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item,
      },
    }, state)).toEqual([
      {
        type: 'message-metadata',
        messageMetadata: {
          codex: {
            responseItems: [{
              threadId: 'thread-1',
              turnId: 'turn-1',
              item,
            }],
          },
        },
      },
      {
        type: 'file',
        mediaType: 'image/png',
        url: 'data:image/png;base64,raw-image-data',
      },
    ])
  })

  it('projects Codex image generation items as tool output and renderable file content', () => {
    const state = createCodexAppServerMapperState('text-1')
    const imageUrl = 'data:image/png;base64,generated-image'

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'img-1',
          type: 'imageGeneration',
          status: 'in_progress',
          revisedPrompt: 'A calm interface',
          result: '',
        },
      },
    }, state)).toEqual([
      { type: 'tool-input-start', toolCallId: 'img-1', toolName: 'image_generation' },
      {
        type: 'tool-input-available',
        toolCallId: 'img-1',
        toolName: 'image_generation',
        input: {
          type: 'cradle.builtin-tool-call.input.v1',
          identifier: 'codex',
          apiName: 'image_generation',
          kind: 'generic',
          args: {
            status: 'in_progress',
            revisedPrompt: 'A calm interface',
          },
        },
      },
    ])

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'img-1',
          type: 'imageGeneration',
          status: 'completed',
          revisedPrompt: 'A calm interface',
          result: imageUrl,
        },
      },
    }, state)).toEqual([
      {
        type: 'tool-output-available',
        toolCallId: 'img-1',
        output: {
          type: 'cradle.builtin-tool-call.result.v1',
          identifier: 'codex',
          apiName: 'image_generation',
          kind: 'generic',
          args: {
            status: 'in_progress',
            revisedPrompt: 'A calm interface',
          },
          result: {
            status: 'completed',
            revisedPrompt: 'A calm interface',
            result: imageUrl,
            savedPath: null,
          },
        },
      },
      {
        type: 'file',
        mediaType: 'image/png',
        url: imageUrl,
      },
    ])
  })

  it('projects Codex image view local files as browser-renderable data URLs', () => {
    const state = createCodexAppServerMapperState('text-1')
    const tempDir = mkdtempSync(join(tmpdir(), 'cradle-codex-image-view-'))
    const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    const imagePath = join(tempDir, 'capture.png')

    try {
      writeFileSync(imagePath, Buffer.from(imageBase64, 'base64'))

      expect(mapCodexAppServerNotificationToChunks({
        method: 'item/completed',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: {
            id: 'view-1',
            type: 'imageView',
            path: imagePath,
          },
        },
      }, state)).toEqual([
        {
          type: 'tool-output-available',
          toolCallId: 'view-1',
          output: {
            type: 'cradle.builtin-tool-call.result.v1',
            identifier: 'codex',
            apiName: 'image_view',
            kind: 'generic',
            args: {
              path: imagePath,
            },
            result: {
              path: imagePath,
            },
          },
        },
        {
          type: 'file',
          mediaType: 'image/png',
          url: `data:image/png;base64,${imageBase64}`,
        },
      ])
    }
    finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('preserves Codex command and MCP metadata in tool payloads', () => {
    const state = createCodexAppServerMapperState('text-1')
    const commandActions = [{ type: 'unknown', command: 'cat package.json' }]

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'cmd-1',
          type: 'commandExecution',
          command: 'cat package.json',
          cwd: '/repo',
          processId: 'pty-1',
          source: 'agent',
          status: 'inProgress',
          commandActions,
        },
      },
    }, state)).toEqual([
      { type: 'tool-input-start', toolCallId: 'cmd-1', toolName: 'command_execution' },
      {
        type: 'tool-input-available',
        toolCallId: 'cmd-1',
        toolName: 'command_execution',
        input: {
          type: 'cradle.builtin-tool-call.input.v1',
          identifier: 'codex',
          apiName: 'command_execution',
          kind: 'terminal',
          args: {
            command: 'cat package.json',
            cwd: '/repo',
            processId: 'pty-1',
            source: 'agent',
            status: 'inProgress',
            commandActions,
          },
        },
      },
    ])

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/commandExecution/outputDelta',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-1',
        delta: '{ "name": "cradle" }\n',
      },
    }, state)).toEqual([{
      type: 'tool-output-available',
      toolCallId: 'cmd-1',
      preliminary: true,
      output: {
        type: 'cradle.builtin-tool-call.result.v1',
        identifier: 'codex',
        apiName: 'command_execution',
        kind: 'terminal',
        args: {
          command: 'cat package.json',
          cwd: '/repo',
          processId: 'pty-1',
          source: 'agent',
          status: 'inProgress',
          commandActions,
        },
        result: {
          command: 'cat package.json',
          cwd: '/repo',
          processId: 'pty-1',
          source: 'agent',
          status: 'inProgress',
          commandActions,
          output: '{ "name": "cradle" }\n',
          exitCode: null,
          code: null,
        },
      },
    }])

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'cmd-1',
          type: 'commandExecution',
          command: 'cat package.json',
          cwd: '/repo',
          processId: 'pty-1',
          source: 'agent',
          status: 'completed',
          commandActions,
          aggregatedOutput: '{ "name": "cradle" }\n',
          exitCode: 0,
          durationMs: 1250,
        },
      },
    }, state)).toEqual([{
      type: 'tool-output-available',
      toolCallId: 'cmd-1',
      output: {
        type: 'cradle.builtin-tool-call.result.v1',
        identifier: 'codex',
        apiName: 'command_execution',
        kind: 'terminal',
        args: {
          command: 'cat package.json',
          cwd: '/repo',
          processId: 'pty-1',
          source: 'agent',
          status: 'inProgress',
          commandActions,
        },
        result: {
          command: 'cat package.json',
          cwd: '/repo',
          processId: 'pty-1',
          source: 'agent',
          status: 'completed',
          commandActions,
          output: '{ "name": "cradle" }\n',
          exitCode: 0,
          code: 0,
          durationMs: 1250,
          durationSeconds: 1.25,
        },
      },
    }])

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'mcp-1',
          type: 'mcpToolCall',
          server: 'github',
          tool: 'search',
          arguments: { query: 'cradle' },
        },
      },
    }, state)).toEqual([
      { type: 'tool-input-start', toolCallId: 'mcp-1', toolName: 'github_search' },
      {
        type: 'tool-input-available',
        toolCallId: 'mcp-1',
        toolName: 'github_search',
        input: {
          type: 'cradle.builtin-tool-call.input.v1',
          identifier: 'codex',
          apiName: 'github/search',
          kind: 'mcp',
          args: { query: 'cradle' },
        },
      },
    ])

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'mcp-1',
          type: 'mcpToolCall',
          server: 'github',
          tool: 'search',
          status: 'completed',
          pluginId: 'plugin-github',
          mcpAppResourceUri: 'mcp://github/search',
          durationMs: 500,
          result: {
            content: [{ type: 'text', text: 'ok' }],
            structuredContent: { total: 1 },
            _meta: { requestId: 'req-1' },
          },
        },
      },
    }, state)).toEqual([{
      type: 'tool-output-available',
      toolCallId: 'mcp-1',
      output: {
        type: 'cradle.builtin-tool-call.result.v1',
        identifier: 'codex',
        apiName: 'github/search',
        kind: 'mcp',
        args: { query: 'cradle' },
        result: {
          server: 'github',
          tool: 'search',
          status: 'completed',
          pluginId: 'plugin-github',
          mcpAppResourceUri: 'mcp://github/search',
          durationMs: 500,
          durationSeconds: 0.5,
          result: {
            content: [{ type: 'text', text: 'ok' }],
            structuredContent: { total: 1 },
            _meta: { requestId: 'req-1' },
          },
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { total: 1 },
          _meta: { requestId: 'req-1' },
        },
      },
    }])
  })

  it('projects Codex sleep, subagent activity, and review mode items instead of dropping them', () => {
    const state = createCodexAppServerMapperState('text-1')

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'sleep-1',
          type: 'sleep',
          durationMs: 750,
        },
      },
    }, state)).toEqual([
      { type: 'tool-input-start', toolCallId: 'sleep-1', toolName: 'sleep' },
      {
        type: 'tool-input-available',
        toolCallId: 'sleep-1',
        toolName: 'sleep',
        input: {
          type: 'cradle.builtin-tool-call.input.v1',
          identifier: 'codex',
          apiName: 'sleep',
          kind: 'generic',
          args: { durationMs: 750, durationSeconds: 0.75 },
        },
      },
    ])

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'sleep-1',
          type: 'sleep',
          durationMs: 750,
        },
      },
    }, state)).toEqual([{
      type: 'tool-output-available',
      toolCallId: 'sleep-1',
      output: {
        type: 'cradle.builtin-tool-call.result.v1',
        identifier: 'codex',
        apiName: 'sleep',
        kind: 'generic',
        args: { durationMs: 750, durationSeconds: 0.75 },
        result: { durationMs: 750, durationSeconds: 0.75 },
      },
    }])

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'subagent-1',
          type: 'subAgentActivity',
          kind: 'interacted',
          agentThreadId: 'agent-thread-1',
          agentPath: 'agents/reviewer',
        },
      },
    }, state)).toEqual([
      { type: 'tool-input-start', toolCallId: 'subagent-1', toolName: 'sub_agent_activity' },
      {
        type: 'tool-input-available',
        toolCallId: 'subagent-1',
        toolName: 'sub_agent_activity',
        input: {
          type: 'cradle.builtin-tool-call.input.v1',
          identifier: 'codex',
          apiName: 'sub_agent_activity',
          kind: 'generic',
          args: {
            kind: 'interacted',
            agentThreadId: 'agent-thread-1',
            agentPath: 'agents/reviewer',
          },
        },
      },
    ])

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'review-1',
          type: 'enteredReviewMode',
          review: 'Review requested',
        },
      },
    }, state)).toEqual([
      { type: 'tool-input-start', toolCallId: 'review-1', toolName: 'review_mode_entered' },
      {
        type: 'tool-input-available',
        toolCallId: 'review-1',
        toolName: 'review_mode_entered',
        input: {
          type: 'cradle.builtin-tool-call.input.v1',
          identifier: 'codex',
          apiName: 'review_mode_entered',
          kind: 'generic',
          args: { review: 'Review requested' },
        },
      },
    ])
  })
})
