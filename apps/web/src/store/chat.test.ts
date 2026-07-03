import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it } from 'vitest'

import type { RuntimeSessionRunStatus } from '~/features/chat/commands/runtime-session-status-command'
import {
  detachPassiveSessionStreamingState,
  releaseSessionStreamingStateForTerminalRun,
} from '~/features/chat/session/use-chat-session-types'

import { chatSelectors, useChatStore } from './chat'

function resetChatStore(): void {
  useChatStore.setState(state => ({
    ...state,
    messagesMap: new Map(),
    hydratedSessionIds: new Set(),
    runStateMap: new Map(),
    activeAbortControllers: new Map(),
    runDisplayMetaMap: new Map(),
    errorMap: new Map(),
    assistantDisplaySplitMap: new Map(),
  }))
}

function runtimeRun(input: Pick<RuntimeSessionRunStatus, 'runId' | 'messageId' | 'status'>): RuntimeSessionRunStatus {
  return {
    ...input,
    startedAt: 0,
    finishedAt: null,
    modelId: null,
    providerSessionId: null,
    queueItemId: null,
    runtimeSettings: {
      accessMode: 'approval-required',
      interactionMode: 'default',
    },
  }
}

describe('chat store messages', () => {
  beforeEach(() => {
    resetChatStore()
  })

  it('keeps hydrated tool payload in message.parts', () => {
    const message: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'tool-read-1',
          toolName: 'Read',
          state: 'output-available',
          argumentsText: '{"file_path":"/tmp/readme.md"}',
          input: { file_path: '/tmp/readme.md' },
          output: '1\tHello',
        } as unknown as UIMessage['parts'][number],
        {
          type: 'text',
          text: 'Done.',
        },
      ],
    }

    useChatStore.getState().setMessages('session-1', [message])

    const storedMessage = chatSelectors.messages('session-1')(useChatStore.getState())[0]

    expect(storedMessage.parts[0]).toEqual({
      type: 'dynamic-tool',
      toolCallId: 'tool-read-1',
      toolName: 'Read',
      state: 'output-available',
      argumentsText: '{"file_path":"/tmp/readme.md"}',
      input: { file_path: '/tmp/readme.md' },
      output: '1\tHello',
    })
    expect(storedMessage.parts[1]).toEqual({
      type: 'text',
      text: 'Done.',
    })
  })

  it('reuses unchanged tool parts across hydration snapshots', () => {
    const message: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'tool-read-1',
          toolName: 'Read',
          state: 'output-available',
          input: { file_path: '/tmp/readme.md' },
          output: { text: 'Hello' },
        } as unknown as UIMessage['parts'][number],
        { type: 'text', text: 'Done.' },
      ],
    }

    useChatStore.getState().setMessages('session-1', [message])
    const firstToolPart = chatSelectors.messages('session-1')(useChatStore.getState())[0].parts[0]

    useChatStore.getState().setMessages('session-1', [structuredClone(message) as UIMessage])
    const secondToolPart = chatSelectors.messages('session-1')(useChatStore.getState())[0].parts[0]

    expect(secondToolPart).toBe(firstToolPart)
  })

  it('reuses existing messages when hydration appends a message', () => {
    const assistantMessage: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'tool-read-1',
          toolName: 'Read',
          state: 'output-available',
          input: { file_path: '/tmp/readme.md' },
          output: { text: 'Hello' },
        } as unknown as UIMessage['parts'][number],
      ],
    }

    useChatStore.getState().setMessages('session-1', [assistantMessage])
    const firstMessage = chatSelectors.messages('session-1')(useChatStore.getState())[0]

    useChatStore.getState().setMessages('session-1', [
      structuredClone(assistantMessage) as UIMessage,
      {
        id: 'assistant-2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Next.' }],
      },
    ])

    const messages = chatSelectors.messages('session-1')(useChatStore.getState())
    expect(messages[0]).toBe(firstMessage)
    expect(messages[1]?.id).toBe('assistant-2')
  })

  it('reuses non-dirty tool parts during streaming updates', () => {
    const toolOne = {
      type: 'dynamic-tool',
      toolCallId: 'tool-read-1',
      toolName: 'Read',
      state: 'output-available',
      input: { file_path: '/tmp/readme.md' },
      output: { text: 'Hello' },
    } as unknown as UIMessage['parts'][number]
    const toolTwo = {
      type: 'dynamic-tool',
      toolCallId: 'tool-write-1',
      toolName: 'Write',
      state: 'input-streaming',
      input: { file_path: '/tmp/app.ts', content: 'old' },
    } as unknown as UIMessage['parts'][number]
    const message: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [toolOne, toolTwo],
    }

    useChatStore.getState().setMessages('session-1', [message])
    const firstParts = chatSelectors.messages('session-1')(useChatStore.getState())[0].parts

    useChatStore.getState().updateMessage(
      'session-1',
      'assistant-1',
      () => ({
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          structuredClone(toolOne) as UIMessage['parts'][number],
          {
            ...(structuredClone(toolTwo) as UIMessage['parts'][number]),
            input: { file_path: '/tmp/app.ts', content: 'new' },
          },
        ],
      }),
      { dirtyToolCallIds: new Set(['tool-write-1']) },
    )

    const secondParts = chatSelectors.messages('session-1')(useChatStore.getState())[0].parts
    expect(secondParts[0]).toBe(firstParts[0])
    expect(secondParts[1]).not.toBe(firstParts[1])
  })

  it('reuses existing tool parts when streaming appends a new part', () => {
    const toolPart = {
      type: 'dynamic-tool',
      toolCallId: 'tool-read-1',
      toolName: 'Read',
      state: 'output-available',
      input: { file_path: '/tmp/readme.md' },
      output: { text: 'Hello' },
    } as unknown as UIMessage['parts'][number]

    useChatStore.getState().setMessages('session-1', [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [toolPart],
    }])
    const firstToolPart = chatSelectors.messages('session-1')(useChatStore.getState())[0].parts[0]

    useChatStore.getState().updateMessage(
      'session-1',
      'assistant-1',
      () => ({
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          structuredClone(toolPart) as UIMessage['parts'][number],
          { type: 'text', text: 'Done.' },
        ],
      }),
      { dirtyToolCallIds: new Set() },
    )

    const secondParts = chatSelectors.messages('session-1')(useChatStore.getState())[0].parts
    expect(secondParts[0]).toBe(firstToolPart)
    expect(secondParts[1]).toEqual({ type: 'text', text: 'Done.' })
  })

  it('tracks passive streaming only for messages in the hydrated session', () => {
    const message: UIMessage = {
      id: 'assistant-streaming',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Working' }],
    }

    useChatStore.getState().setMessages('session-1', [message])
    useChatStore.getState().setPassiveRunState('session-1', {
      messageIds: ['assistant-streaming', 'assistant-other-session'],
      status: 'streaming',
    })

    const state = useChatStore.getState()
    expect(chatSelectors.isStreamingMessage('assistant-streaming')(state)).toBe(true)
    expect(chatSelectors.isStreamingMessage('assistant-other-session')(state)).toBe(false)
    expect(chatSelectors.isSessionStreaming('session-1')(state)).toBe(true)
  })

  it('clears passive streaming ids when messages leave the session snapshot', () => {
    const message: UIMessage = {
      id: 'assistant-streaming',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Working' }],
    }

    useChatStore.getState().setMessages('session-1', [message])
    useChatStore.getState().setPassiveRunState('session-1', {
      messageIds: ['assistant-streaming'],
      status: 'streaming',
    })
    useChatStore.getState().setMessages('session-1', [])

    expect(chatSelectors.isStreamingMessage('assistant-streaming')(useChatStore.getState())).toBe(false)
  })

  it('can represent a passive active run before the message snapshot arrives', () => {
    useChatStore.getState().setPassiveRunState('session-1', {
      messageIds: ['assistant-pending-snapshot'],
      allowMissingMessage: true,
      status: 'streaming',
    })

    const state = useChatStore.getState()
    expect(chatSelectors.isSessionStreaming('session-1')(state)).toBe(true)
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-pending-snapshot')(state)).toBe(true)
  })

  it('does not let passive snapshots replace a local streaming run', () => {
    useChatStore.getState().setMessages('session-1', [
      {
        id: 'assistant-local',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Local' }],
      },
      {
        id: 'assistant-passive',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Passive' }],
      },
    ])
    useChatStore.getState().startGeneration('session-1', 'assistant-local', new AbortController())
    useChatStore.getState().setPassiveRunState('session-1', {
      messageIds: ['assistant-passive'],
      status: 'streaming',
    })

    const state = useChatStore.getState()
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-local')(state)).toBe(true)
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-passive')(state)).toBe(false)
  })

  it('drops stale session errors when a new local generation starts', () => {
    const previousAssistant: UIMessage = {
      id: 'assistant-failed',
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
    }

    useChatStore.getState().setMessages('session-1', [previousAssistant])
    useChatStore.getState().failGeneration('assistant-failed', 'Previous stream failed')

    expect(chatSelectors.visibleStatus('session-1')(useChatStore.getState())).toBe('error')

    useChatStore.getState().appendMessage('session-1', {
      id: 'assistant-next',
      role: 'assistant',
      parts: [],
    })
    useChatStore.getState().startGeneration('session-1', 'assistant-next', new AbortController())

    const state = useChatStore.getState()
    expect(chatSelectors.visibleStatus('session-1')(state)).toBe('streaming')
    expect(chatSelectors.latestError('session-1')(state)).toBeUndefined()
  })

  it('keeps streaming refs until the same run reaches a terminal status', () => {
    useChatStore.getState().setMessages('session-1', [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Working' }],
    }])
    useChatStore.getState().startGeneration('session-1', 'assistant-1', new AbortController())
    useChatStore.getState().setRunDisplayId('assistant-1', 'run-a')

    expect(releaseSessionStreamingStateForTerminalRun('session-1', runtimeRun({
      runId: 'run-a',
      messageId: 'assistant-1',
      status: 'streaming',
    }))).toBe(false)
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1')(useChatStore.getState())).toBe(true)

    expect(releaseSessionStreamingStateForTerminalRun('session-1', runtimeRun({
      runId: 'run-b',
      messageId: 'assistant-1',
      status: 'complete',
    }))).toBe(false)
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1')(useChatStore.getState())).toBe(true)

    expect(releaseSessionStreamingStateForTerminalRun('session-1', runtimeRun({
      runId: 'run-a',
      messageId: 'assistant-1',
      status: 'complete',
    }))).toBe(true)
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1')(useChatStore.getState())).toBe(false)
  })

  it('releases a live steer tail only when the source run is terminal', () => {
    useChatStore.getState().setMessages('session-1', [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Before steer.' }],
    }])
    useChatStore.getState().startGeneration('session-1', 'assistant-1', new AbortController())
    useChatStore.getState().setRunDisplayId('assistant-1', 'run-a')
    useChatStore.getState().insertLiveSteerMessage('session-1', {
      id: 'continuation-steer-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Please adjust.' }],
      metadata: {
        cradle: {
          continuation: {
            mode: 'steer',
            queueItemId: 'steer-1',
          },
        },
      },
    } as UIMessage)

    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1:steer-tail')(useChatStore.getState())).toBe(true)
    expect(releaseSessionStreamingStateForTerminalRun('session-1', runtimeRun({
      runId: 'run-b',
      messageId: 'assistant-1',
      status: 'failed',
    }))).toBe(false)
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1:steer-tail')(useChatStore.getState())).toBe(true)

    expect(releaseSessionStreamingStateForTerminalRun('session-1', runtimeRun({
      runId: 'run-a',
      messageId: 'assistant-1',
      status: 'failed',
    }))).toBe(true)
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1:steer-tail')(useChatStore.getState())).toBe(false)
  })

  it('maps passive active-run streaming from a split source message to the visible tail', () => {
    useChatStore.getState().setMessages('session-1', [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer. After steer.' }],
      },
      {
        id: 'continuation-steer-canonical',
        role: 'user',
        parts: [{ type: 'text', text: 'Please adjust.' }],
        metadata: {
          cradle: {
            continuation: {
              mode: 'steer',
              queueItemId: 'steer-1',
              sourceMessageId: 'assistant-1',
              splitParts: [{ type: 'text', text: 'Before steer.' }],
            },
          },
        },
      } as UIMessage,
    ])
    expect(useChatStore.getState().messagesMap.get('session-1')?.map(message => message.id)).toEqual([
      'assistant-1',
      'continuation-steer-canonical',
      'assistant-1:steer-tail',
    ])

    useChatStore.getState().setRunDisplayId('assistant-1', 'run-a')
    useChatStore.getState().setPassiveRunState('session-1', {
      messageIds: ['assistant-1'],
      status: 'streaming',
    })

    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1')(useChatStore.getState())).toBe(false)
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1:steer-tail')(useChatStore.getState())).toBe(true)
    expect(chatSelectors.runDisplayMeta('assistant-1')(useChatStore.getState())).toBeUndefined()
    expect(chatSelectors.runDisplayMeta('assistant-1:steer-tail')(useChatStore.getState())?.runId).toBe('run-a')

    const projected = useChatStore.getState().projectStreamingMessageForDisplay('session-1', {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Before steer. After steer. Still running.' }],
    })
    useChatStore.getState().updateMessage('session-1', projected.id, () => projected)

    expect(useChatStore.getState().messagesMap.get('session-1')?.[2]?.parts).toEqual([
      { type: 'text', text: ' After steer. Still running.' },
    ])
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1:steer-tail')(useChatStore.getState())).toBe(true)

    useChatStore.getState().setPassiveRunState('session-1', { messageIds: [], status: 'idle' })
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1:steer-tail')(useChatStore.getState())).toBe(false)

    useChatStore.getState().setPassiveRunState('session-1', {
      messageIds: ['assistant-1'],
      status: 'streaming',
    })
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1:steer-tail')(useChatStore.getState())).toBe(true)

    expect(releaseSessionStreamingStateForTerminalRun('session-1', runtimeRun({
      runId: 'run-a',
      messageId: 'assistant-1',
      status: 'complete',
    }))).toBe(true)
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1:steer-tail')(useChatStore.getState())).toBe(false)
  })

  it('detaches passive run state without marking an active run meta as complete', () => {
    useChatStore.getState().setMessages('session-1', [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Working' }],
    }])
    useChatStore.getState().setRunDisplayId('assistant-1', 'run-a')
    useChatStore.getState().setPassiveRunState('session-1', {
      messageIds: ['assistant-1'],
      status: 'streaming',
    })

    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1')(useChatStore.getState())).toBe(true)

    detachPassiveSessionStreamingState('session-1')

    const state = useChatStore.getState()
    expect(chatSelectors.sessionRunState('session-1')(state)).toMatchObject({ phase: 'idle' })
    expect(chatSelectors.runDisplayMeta('assistant-1')(state)?.completedAtMs).toBeNull()
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1')(state)).toBe(false)

    expect(releaseSessionStreamingStateForTerminalRun('session-1', runtimeRun({
      runId: 'run-a',
      messageId: 'assistant-1',
      status: 'complete',
    }))).toBe(true)
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1')(useChatStore.getState())).toBe(false)
  })

  it('reopens stale completed run meta without using it as streaming state', () => {
    useChatStore.getState().setMessages('session-1', [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Working' }],
    }])
    useChatStore.getState().setRunDisplayId('assistant-1', 'run-a')
    useChatStore.getState().finishGeneration('assistant-1')

    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1')(useChatStore.getState())).toBe(false)
    expect(chatSelectors.runDisplayMeta('assistant-1')(useChatStore.getState())?.completedAtMs).not.toBeNull()

    useChatStore.getState().setRunDisplayId('assistant-1', 'run-a')

    const state = useChatStore.getState()
    expect(chatSelectors.runDisplayMeta('assistant-1')(state)?.completedAtMs).toBeNull()
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1')(state)).toBe(false)

    useChatStore.getState().setPassiveRunState('session-1', {
      messageIds: ['assistant-1'],
      status: 'streaming',
    })
    expect(chatSelectors.isVisibleStreamingMessage('session-1', 'assistant-1')(useChatStore.getState())).toBe(true)
  })

  it('inserts live steer messages before the assistant tail and keeps later deltas in a new bubble', () => {
    useChatStore.getState().setMessages('session-1', [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Before steer.' }],
    }])
    useChatStore.getState().startGeneration('session-1', 'assistant-1', new AbortController())

    useChatStore.getState().insertLiveSteerMessage('session-1', {
      id: 'continuation-steer-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Please adjust.' }],
      metadata: {
        cradle: {
          continuation: {
            mode: 'steer',
            queueItemId: 'steer-1',
          },
        },
      },
    } as UIMessage)

    const afterInsert = useChatStore.getState()
    expect(afterInsert.messagesMap.get('session-1')?.map(message => message.id)).toEqual([
      'assistant-1',
      'continuation-steer-1',
      'assistant-1:steer-tail',
    ])
    expect(chatSelectors.isStreamingMessage('assistant-1')(afterInsert)).toBe(false)
    expect(chatSelectors.isStreamingMessage('assistant-1:steer-tail')(afterInsert)).toBe(true)

    const projected = useChatStore.getState().projectStreamingMessageForDisplay('session-1', {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Before steer. After steer.' }],
    })
    useChatStore.getState().updateMessage('session-1', projected.id, () => projected)

    expect(useChatStore.getState().messagesMap.get('session-1')).toEqual([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer.' }],
      },
      {
        id: 'continuation-steer-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Please adjust.' }],
        metadata: {
          cradle: {
            continuation: {
              mode: 'steer',
              queueItemId: 'steer-1',
            },
          },
        },
      },
      {
        id: 'assistant-1:steer-tail',
        role: 'assistant',
        parts: [{ type: 'text', text: ' After steer.' }],
      },
    ])
  })

  it('keeps canonical live steer snapshots anchored by queue item id', () => {
    useChatStore.getState().setMessages('session-1', [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Before steer.' }],
    }])
    useChatStore.getState().startGeneration('session-1', 'assistant-1', new AbortController())

    useChatStore.getState().insertLiveSteerMessage('session-1', {
      id: 'continuation-steer-optimistic',
      role: 'user',
      parts: [{ type: 'text', text: 'Please adjust.' }],
      metadata: {
        cradle: {
          continuation: {
            mode: 'steer',
            queueItemId: 'steer-1',
          },
        },
      },
    } as UIMessage)

    useChatStore.getState().setMessages('session-1', [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer. After steer.' }],
      },
      {
        id: 'continuation-steer-canonical',
        role: 'user',
        parts: [{ type: 'text', text: 'Please adjust.' }],
        metadata: {
          cradle: {
            continuation: {
              mode: 'steer',
              queueItemId: 'steer-1',
            },
          },
        },
      } as UIMessage,
    ])

    expect(useChatStore.getState().messagesMap.get('session-1')?.map(message => message.id)).toEqual([
      'assistant-1',
      'continuation-steer-canonical',
      'assistant-1:steer-tail',
    ])
    expect(useChatStore.getState().messagesMap.get('session-1')?.[2]).toEqual({
      id: 'assistant-1:steer-tail',
      role: 'assistant',
      parts: [{ type: 'text', text: ' After steer.' }],
    })
  })

  it('hydrates persisted live steer splits from continuation metadata', () => {
    useChatStore.getState().setMessages('session-1', [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer. After steer.' }],
      },
      {
        id: 'continuation-steer-canonical',
        role: 'user',
        parts: [{ type: 'text', text: 'Please adjust.' }],
        metadata: {
          cradle: {
            continuation: {
              mode: 'steer',
              queueItemId: 'steer-1',
              sourceMessageId: 'assistant-1',
              splitParts: [{ type: 'text', text: 'Before steer.' }],
            },
          },
        },
      } as UIMessage,
    ])

    expect(useChatStore.getState().messagesMap.get('session-1')).toEqual([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer.' }],
      },
      {
        id: 'continuation-steer-canonical',
        role: 'user',
        parts: [{ type: 'text', text: 'Please adjust.' }],
        metadata: {
          cradle: {
            continuation: {
              mode: 'steer',
              queueItemId: 'steer-1',
              sourceMessageId: 'assistant-1',
              splitParts: [{ type: 'text', text: 'Before steer.' }],
            },
          },
        },
      },
      {
        id: 'assistant-1:steer-tail',
        role: 'assistant',
        parts: [{ type: 'text', text: ' After steer.' }],
      },
    ])
  })

  it('keeps live steer anchored after the assistant id changes to the server snapshot id', () => {
    useChatStore.getState().setMessages('session-1', [{
      id: 'assistant-temp',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Before steer.' }],
    }])
    useChatStore.getState().startGeneration('session-1', 'assistant-temp', new AbortController())

    useChatStore.getState().insertLiveSteerMessage('session-1', {
      id: 'continuation-steer-optimistic',
      role: 'user',
      parts: [{ type: 'text', text: 'Please adjust.' }],
      metadata: {
        cradle: {
          continuation: {
            mode: 'steer',
            queueItemId: 'steer-1',
          },
        },
      },
    } as UIMessage)

    useChatStore.getState().updateMessage('session-1', 'assistant-temp', message => ({
      ...message,
      id: 'assistant-canonical',
    }))
    expect(chatSelectors.isStreamingMessage('assistant-canonical:steer-tail')(useChatStore.getState())).toBe(true)

    useChatStore.getState().setMessages('session-1', [
      {
        id: 'assistant-canonical',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer. After steer.' }],
      },
      {
        id: 'continuation-steer-canonical',
        role: 'user',
        parts: [{ type: 'text', text: 'Please adjust.' }],
        metadata: {
          cradle: {
            continuation: {
              mode: 'steer',
              queueItemId: 'steer-1',
            },
          },
        },
      } as UIMessage,
    ])

    expect(useChatStore.getState().messagesMap.get('session-1')?.map(message => message.id)).toEqual([
      'assistant-canonical',
      'continuation-steer-canonical',
      'assistant-canonical:steer-tail',
    ])
    expect(useChatStore.getState().messagesMap.get('session-1')?.[0]?.parts).toEqual([
      { type: 'text', text: 'Before steer.' },
    ])
    expect(useChatStore.getState().messagesMap.get('session-1')?.[2]?.parts).toEqual([
      { type: 'text', text: ' After steer.' },
    ])

    useChatStore.getState().finishGeneration('assistant-canonical')
    expect(chatSelectors.isStreamingMessage('assistant-canonical:steer-tail')(useChatStore.getState())).toBe(false)
  })
})
