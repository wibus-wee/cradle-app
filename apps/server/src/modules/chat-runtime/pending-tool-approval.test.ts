import type { ChatSessionEvent } from './es/events'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AppError } from '../../errors/app-error'
import {
  resetRuntimeInteractionEventRecorder,
  setRuntimeInteractionEventRecorder,
} from './interaction/event-recorder'
import {
  requestRuntimeToolApproval,
  submitRuntimeToolApprovalIfPending,
  submitRuntimeToolApproval,
} from './pending-tool-approval'

describe('pending runtime tool approval', () => {
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

  it('resolves submitted approval decisions', async () => {
    const pending = requestRuntimeToolApproval({
      sessionId: 'session-pending-tool-approval-1',
      runId: 'run-pending-tool-approval-1',
      providerRequestId: 'request-1',
      providerKind: 'openai-compatible',
      runtimeKind: 'codex',
      providerMethod: 'applyPatchApproval',
      toolCallId: 'server-request-request-1',
      metadata: { files: ['README.md'] },
    })

    const submitted = await submitRuntimeToolApproval({
      sessionId: 'session-pending-tool-approval-1',
      requestId: 'request-1',
      approved: true,
      reason: 'User approved',
    })

    await expect(pending).resolves.toEqual({
      requestId: 'request-1',
      approved: true,
      reason: 'User approved',
    })
    expect(submitted).toEqual({
      requestId: 'request-1',
      approved: true,
      reason: 'User approved',
    })
    expect(recordedEvents).toMatchObject([
      {
        type: 'InteractionRequested',
        payload: {
          sessionId: 'session-pending-tool-approval-1',
          runId: 'run-pending-tool-approval-1',
          requestId: 'request-1',
          interactionKind: 'toolApproval',
          providerMethod: 'applyPatchApproval',
          toolCallId: 'server-request-request-1',
        },
      },
      {
        type: 'InteractionResolved',
        payload: {
          sessionId: 'session-pending-tool-approval-1',
          runId: 'run-pending-tool-approval-1',
          requestId: 'request-1',
          interactionKind: 'toolApproval',
          resolution: 'submitted',
          approved: true,
        },
      },
    ])
  })

  it('rejects stale submissions with a not found app error', async () => {
    expect(submitRuntimeToolApprovalIfPending({
      sessionId: 'session-pending-tool-approval-2',
      requestId: 'missing-request',
      approved: false,
    })).toBeNull()

    await expect(submitRuntimeToolApproval({
      sessionId: 'session-pending-tool-approval-2',
      requestId: 'missing-request',
      approved: false,
    })).rejects.toThrow(AppError)

    try {
      await submitRuntimeToolApproval({
        sessionId: 'session-pending-tool-approval-2',
        requestId: 'missing-request',
        approved: false,
      })
    }
    catch (error) {
      expect(error).toMatchObject({
        code: 'chat_runtime_tool_approval_not_found',
        status: 404,
      })
    }
  })
})
