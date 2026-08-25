import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AppError } from '../../errors/app-error'
import type { ChatSessionEvent } from './es/events'
import {
  resetRuntimeInteractionEventRecorder,
  setRuntimeInteractionEventRecorder,
} from './interaction/event-recorder'
import {
  hasPendingRuntimeToolApproval,
  requestRuntimeToolApproval,
  submitRuntimeToolApproval,
  submitRuntimeToolApprovalIfPending,
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

  it('reports pending approvals for the matching session and run', async () => {
    const pending = requestRuntimeToolApproval({
      sessionId: 'session-pending-tool-approval-3',
      runId: 'run-pending-tool-approval-3',
      providerRequestId: 'request-3',
      providerKind: 'openai-compatible',
      runtimeKind: 'codex',
      providerMethod: 'applyPatchApproval',
      toolCallId: 'server-request-request-3',
      metadata: { files: ['README.md'] },
    })

    expect(hasPendingRuntimeToolApproval('session-pending-tool-approval-3')).toBe(true)
    expect(hasPendingRuntimeToolApproval('session-pending-tool-approval-3', {
      runId: 'run-pending-tool-approval-3',
    })).toBe(true)
    expect(hasPendingRuntimeToolApproval('session-pending-tool-approval-3', {
      runId: 'other-run',
    })).toBe(false)
    expect(hasPendingRuntimeToolApproval('other-session')).toBe(false)

    await submitRuntimeToolApproval({
      sessionId: 'session-pending-tool-approval-3',
      requestId: 'request-3',
      approved: false,
    })
    await pending

    expect(hasPendingRuntimeToolApproval('session-pending-tool-approval-3')).toBe(false)
  })

  it('does not block the native approval on interaction event persistence', async () => {
    let releaseRequestedEvent!: () => void
    setRuntimeInteractionEventRecorder(async (_sessionId, events) => {
      recordedEvents.push(...events)
      if (events[0]?.type === 'InteractionRequested') {
        await new Promise<void>((resolve) => {
          releaseRequestedEvent = resolve
        })
      }
    })

    const pending = requestRuntimeToolApproval({
      sessionId: 'session-pending-tool-approval-4',
      runId: 'run-pending-tool-approval-4',
      providerRequestId: 'request-4',
      providerKind: 'openai-compatible',
      runtimeKind: 'codex',
      providerMethod: 'item/commandExecution/requestApproval',
      toolCallId: 'server-request-request-4',
      metadata: { command: 'echo approval' },
    })

    const submitted = submitRuntimeToolApprovalIfPending({
      sessionId: 'session-pending-tool-approval-4',
      requestId: 'request-4',
      approved: true,
    })

    expect(submitted).toEqual({
      requestId: 'request-4',
      approved: true,
    })
    await expect(pending).resolves.toEqual({
      requestId: 'request-4',
      approved: true,
    })
    releaseRequestedEvent()
  })

  it('does not reject the native approval when the interaction recorder throws synchronously', async () => {
    setRuntimeInteractionEventRecorder(() => {
      throw new Error('synchronous interaction audit failure')
    })

    const pending = requestRuntimeToolApproval({
      sessionId: 'session-pending-tool-approval-5',
      runId: 'run-pending-tool-approval-5',
      providerRequestId: 'request-5',
      providerKind: 'openai-compatible',
      runtimeKind: 'codex',
      providerMethod: 'item/commandExecution/requestApproval',
      toolCallId: 'server-request-request-5',
      metadata: { command: 'echo approval' },
    })

    await expect(submitRuntimeToolApproval({
      sessionId: 'session-pending-tool-approval-5',
      requestId: 'request-5',
      approved: true,
    })).resolves.toEqual({
      requestId: 'request-5',
      approved: true,
    })
    await expect(pending).resolves.toEqual({
      requestId: 'request-5',
      approved: true,
    })
  })
})
