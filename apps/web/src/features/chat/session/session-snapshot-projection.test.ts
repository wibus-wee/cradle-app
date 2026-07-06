import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import type { ChatRunState } from '~/store/chat'

import {
  deriveSessionPassiveStreamProjection,
  deriveSessionSnapshotProjection,
  deriveStableSessionSnapshotProjection,
} from './session-snapshot-projection'
import type { ChatSessionMessageRow } from './use-chat-session-types'

const idleRunState: ChatRunState = { phase: 'idle', error: false }

function message(input: {
  id: string
  role: 'user' | 'assistant'
  text?: string
  parts?: UIMessage['parts']
}): UIMessage {
  return {
    id: input.id,
    role: input.role,
    parts: input.parts ?? [{ type: 'text', text: input.text ?? '' }],
  }
}

function row(input: {
  id: string
  role: 'user' | 'assistant'
  status?: string
  text?: string
  parts?: UIMessage['parts']
  errorText?: string | null
  parentToolCallId?: string | null
}): ChatSessionMessageRow {
  return {
    messageId: input.id,
    role: input.role,
    status: input.status ?? 'complete',
    errorText: input.errorText ?? null,
    content: input.text ?? '',
    message: message({
      id: input.id,
      role: input.role,
      text: input.text,
      parts: input.parts,
    }),
    parentMessageId: null,
    parentToolCallId: input.parentToolCallId ?? null,
    taskId: null,
    depth: 0,
  }
}

describe('session snapshot projection', () => {
  it('projects stable rows and reports the latest failed main assistant message', () => {
    const projection = deriveStableSessionSnapshotProjection([
      row({ id: 'user-1', role: 'user', text: 'Question' }),
      row({
        id: 'assistant-1',
        role: 'assistant',
        status: 'failed',
        text: 'Partial answer',
        errorText: 'Provider failed',
      }),
    ])

    expect(projection.messages.map(item => item.id)).toEqual(['user-1', 'assistant-1'])
    expect(projection.passiveRunState).toEqual({
      messageIds: [],
      cancelling: false,
      status: 'error',
    })
    expect(projection.failedMessage).toEqual({
      messageId: 'assistant-1',
      errorText: 'Provider failed',
    })
  })

  it('projects an empty streaming snapshot as a normal placeholder row', () => {
    const projection = deriveSessionSnapshotProjection({
      rows: [
        row({ id: 'user-1', role: 'user', text: 'Question' }),
        row({ id: 'assistant-empty', role: 'assistant', status: 'streaming', parts: [] }),
      ],
      runState: idleRunState,
      existingMessageCount: 2,
      runtimeStatusKnown: true,
      runtimeIdle: true,
      runtimeActiveRunMessageId: null,
    })

    expect(projection).toMatchObject({
      messages: [
        expect.objectContaining({ id: 'user-1' }),
        expect.objectContaining({ id: 'assistant-empty', parts: [] }),
      ],
      requestSnapshotRefresh: false,
      passiveRunState: {
        messageIds: [],
        allowMissingMessage: false,
        cancelling: false,
        status: 'idle',
      },
    })
  })

  it('uses the active run message id as the passive streaming identity even before it appears in the snapshot', () => {
    const projection = deriveSessionSnapshotProjection({
      rows: [
        row({ id: 'user-1', role: 'user', text: 'Question' }),
        row({ id: 'assistant-old', role: 'assistant', text: 'Previous answer' }),
      ],
      runState: idleRunState,
      existingMessageCount: 2,
      runtimeStatusKnown: true,
      runtimeIdle: false,
      runtimeActiveRunMessageId: 'assistant-live',
    })

    expect(projection?.messages?.map(item => item.id)).toEqual(['user-1', 'assistant-old'])
    expect(projection?.passiveRunState).toEqual({
      messageIds: ['assistant-live'],
      allowMissingMessage: true,
      cancelling: false,
      status: 'streaming',
    })
  })

  it('does not project snapshots over a locally driven run', () => {
    const projection = deriveSessionSnapshotProjection({
      rows: [
        row({ id: 'assistant-passive', role: 'assistant', status: 'streaming', text: 'Passive' }),
      ],
      runState: { phase: 'streaming', source: 'local', messageId: 'assistant-local' },
      existingMessageCount: 1,
      runtimeStatusKnown: true,
      runtimeIdle: false,
      runtimeActiveRunMessageId: 'assistant-passive',
    })

    expect(projection).toBeNull()
  })

  it('derives passive stream inputs only from local driver state', () => {
    const projection = deriveSessionPassiveStreamProjection({
      runState: idleRunState,
    })

    expect(projection).toEqual({
      locallyDriven: false,
    })
  })
})
