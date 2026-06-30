import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { AppError } from '../../errors/app-error'
import {
  requestRuntimeUserInput,
  setRuntimeUserInputPublisher,
  submitRuntimeUserInput,
} from './pending-user-input'

describe('pending runtime user input', () => {
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

    const submitted = submitRuntimeUserInput({
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
  })

  it('rejects stale submissions with a not found app error', () => {
    expect(() => submitRuntimeUserInput({
      sessionId: 'session-pending-user-input-2',
      requestId: 'missing-request',
      answers: {},
    })).toThrow(AppError)

    try {
      submitRuntimeUserInput({
        sessionId: 'session-pending-user-input-2',
        requestId: 'missing-request',
        answers: {},
      })
    }
    catch (error) {
      expect(error).toMatchObject({
        code: 'chat_runtime_user_input_not_found',
        status: 404,
      })
    }
  })
})
