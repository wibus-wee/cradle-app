import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AppError } from '../../errors/app-error'
import type { ChatSessionEvent } from './es/events'
import {
  resetRuntimeInteractionEventRecorder,
  setRuntimeInteractionEventRecorder,
} from './interaction/event-recorder'
import {
  listPendingRuntimeUserInputSummaries,
  requestRuntimeUserInput,
  setRuntimeUserInputPublisher,
  submitRuntimeUserInput,
} from './pending-user-input'

describe('pending runtime user input', () => {
  const recordedEvents: ChatSessionEvent[] = []

  beforeEach(() => {
    recordedEvents.length = 0
    setRuntimeInteractionEventRecorder(async (_sessionId, events) => {
      recordedEvents.push(...events)
    })
  })

  afterEach(() => {
    resetRuntimeInteractionEventRecorder()
  })

  it('resolves submitted answers and publishes a synthetic resolved tool output', async () => {
    const published: Array<{ runId: string, chunk: UIMessageChunk }> = []
    setRuntimeUserInputPublisher((runId, chunk) => {
      published.push({ runId, chunk })
    })

    const pending = requestRuntimeUserInput({
      sessionId: 'session-pending-user-input-1',
      runId: 'run-pending-user-input-1',
      providerRequestId: 'request-1',
      providerKind: 'openai-compatible',
      runtimeKind: 'codex',
      providerMethod: 'item/tool/requestUserInput',
      toolCallId: 'server-request-request-1',
      questions: [
        {
          id: 'scope',
          header: 'Scope',
          question: 'Which scope should I use?',
          isOther: false,
          isSecret: false,
          multiSelect: false,
          options: [{ label: 'Small', description: 'Limit the change' }],
        },
      ],
    })

    const submitted = await submitRuntimeUserInput({
      sessionId: 'session-pending-user-input-1',
      requestId: 'request-1',
      answers: { scope: ['Small'] },
    })

    await expect(pending).resolves.toEqual({
      requestId: 'request-1',
      answers: { scope: ['Small'] },
    })
    expect(submitted).toEqual({
      requestId: 'request-1',
      answers: { scope: ['Small'] },
    })
    expect(published).toEqual([
      {
        runId: 'run-pending-user-input-1',
        chunk: {
          type: 'tool-output-available',
          toolCallId: 'server-request-request-1',
          output: expect.objectContaining({
            type: 'cradle.runtime-user-input.resolved.v1',
            requestId: 'request-1',
            answers: { scope: ['Small'] },
          }),
        },
      },
    ])
    expect(recordedEvents).toMatchObject([
      {
        type: 'InteractionRequested',
        payload: {
          sessionId: 'session-pending-user-input-1',
          runId: 'run-pending-user-input-1',
          requestId: 'request-1',
          interactionKind: 'userInput',
          providerMethod: 'item/tool/requestUserInput',
          toolCallId: 'server-request-request-1',
          questionCount: 1,
        },
      },
      {
        type: 'InteractionResolved',
        payload: {
          sessionId: 'session-pending-user-input-1',
          runId: 'run-pending-user-input-1',
          requestId: 'request-1',
          interactionKind: 'userInput',
          resolution: 'submitted',
          approved: null,
        },
      },
    ])
  })

  it('rejects stale submissions with a not found app error', async () => {
    await expect(submitRuntimeUserInput({
      sessionId: 'session-pending-user-input-2',
      requestId: 'missing-request',
      answers: {},
    })).rejects.toThrow(AppError)

    try {
      await submitRuntimeUserInput({
        sessionId: 'session-pending-user-input-2',
        requestId: 'missing-request',
        answers: {},
      })
    } catch (error) {
      expect(error).toMatchObject({
        code: 'chat_runtime_user_input_not_found',
        status: 404,
      })
    }
  })

  it('lists pending request summaries for status and desktop projections', async () => {
    const pending = requestRuntimeUserInput({
      sessionId: 'session-pending-user-input-summary',
      runId: 'run-pending-user-input-summary',
      providerRequestId: 'request-summary',
      providerKind: 'anthropic',
      runtimeKind: 'claude-agent',
      providerMethod: 'askUserQuestion',
      toolCallId: 'toolu-question-summary',
      questions: [
        {
          id: 'direction',
          header: 'Direction',
          question: 'Which direction should I take?',
          isOther: false,
          isSecret: false,
          multiSelect: false,
          options: [{ label: 'A', description: 'Use direction A' }],
        },
      ],
    })

    expect(listPendingRuntimeUserInputSummaries({
      sessionId: 'session-pending-user-input-summary',
      runId: 'run-pending-user-input-summary',
    })).toEqual([
      expect.objectContaining({
        sessionId: 'session-pending-user-input-summary',
        runId: 'run-pending-user-input-summary',
        requestId: 'request-summary',
        providerMethod: 'askUserQuestion',
        toolCallId: 'toolu-question-summary',
        questionCount: 1,
        firstQuestion: 'Which direction should I take?',
      }),
    ])

    await submitRuntimeUserInput({
      sessionId: 'session-pending-user-input-summary',
      requestId: 'request-summary',
      answers: { direction: ['A'] },
    })
    await expect(pending).resolves.toEqual({
      requestId: 'request-summary',
      answers: { direction: ['A'] },
    })
  })
})
