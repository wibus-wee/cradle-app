import { describe, expect, it } from 'vitest'

import { AppError } from '../../errors/app-error'
import {
  requestRuntimeToolApproval,
  submitRuntimeToolApprovalIfPending,
  submitRuntimeToolApproval,
} from './pending-tool-approval'

describe('pending runtime tool approval', () => {
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

    const submitted = submitRuntimeToolApproval({
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
  })

  it('rejects stale submissions with a not found app error', () => {
    expect(submitRuntimeToolApprovalIfPending({
      sessionId: 'session-pending-tool-approval-2',
      requestId: 'missing-request',
      approved: false,
    })).toBeNull()

    expect(() => submitRuntimeToolApproval({
      sessionId: 'session-pending-tool-approval-2',
      requestId: 'missing-request',
      approved: false,
    })).toThrow(AppError)

    try {
      submitRuntimeToolApproval({
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
