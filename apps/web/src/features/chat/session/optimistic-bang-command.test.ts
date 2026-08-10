import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatStore } from '~/store/chat'

import { readBangCommandMetadata, readBangResultMetadata } from '../commands/bang-command-metadata'
import { executeOptimisticBangCommand } from './optimistic-bang-command'

const mocks = vi.hoisted(() => ({
  executeBangCommand: vi.fn(),
}))

vi.mock('../commands/chat-response-command', () => ({
  executeBangCommand: mocks.executeBangCommand,
}))

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

function message(id: string, text: string): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

describe('executeOptimisticBangCommand', () => {
  beforeEach(() => {
    resetChatStore()
    mocks.executeBangCommand.mockReset()
  })

  it('replaces the optimistic driver with the persisted command and result', async () => {
    mocks.executeBangCommand.mockResolvedValue({
      command: 'printf hello',
      stdout: 'hello',
      stderr: '',
      exitCode: 0,
      durationMs: 12,
      timedOut: false,
      truncated: false,
      userMessageId: 'user-persisted',
      resultMessageId: 'result-persisted',
      userMessage: message('user-persisted', '!printf hello'),
      resultMessage: message('result-persisted', 'hello'),
    })
    const onSuccess = vi.fn()

    await executeOptimisticBangCommand({
      sessionId: 'session-1',
      command: 'printf hello',
      onSuccess,
    })

    expect(mocks.executeBangCommand).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      command: 'printf hello',
    }))
    const messages = useChatStore.getState().messagesMap.get('session-1') ?? []
    expect(messages.map(item => item.id)).toEqual(['user-persisted', 'result-persisted'])
    expect(readBangCommandMetadata(messages[0]!)).toEqual({ command: 'printf hello' })
    expect(readBangResultMetadata(messages[1]!)).toEqual({
      command: 'printf hello',
      stdout: 'hello',
      stderr: '',
      exitCode: 0,
      durationMs: 12,
      timedOut: false,
      truncated: false,
    })
    expect(onSuccess).toHaveBeenCalledOnce()
  })
})
