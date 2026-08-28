import type {
  CreateElicitationResponse,
  ElicitationUrlMode,
} from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'

import type { RuntimeUserInputResolution } from '../../chat-runtime/runtime-provider-types'
import type {
  AcpConnectionManager,
  AcpElicitationCompleteHandler,
  AcpElicitationHandler,
} from './connection-manager'
import { wireAcpIntegration } from './runtime-integration'

describe('wireAcpIntegration', () => {
  it('resolves the matching URL elicitation when the agent reports completion', async () => {
    let elicitationHandler: AcpElicitationHandler | null = null
    let completionHandler: AcpElicitationCompleteHandler | null = null
    let resolvePending: ((resolution: RuntimeUserInputResolution) => void) | null = null
    const runtime: Pick<
      AcpConnectionManager,
      'onSessionTitle' | 'setElicitationCompleteHandler' | 'setElicitationHandler' | 'setPermissionHandler'
    > = {
      setPermissionHandler: vi.fn(),
      setElicitationHandler: (handler) => {
        elicitationHandler = handler
      },
      setElicitationCompleteHandler: (handler) => {
        completionHandler = handler
      },
      onSessionTitle: vi.fn(() => () => undefined),
    }
    const requestUserInput = vi.fn(() => new Promise<RuntimeUserInputResolution>((resolve) => {
      resolvePending = resolve
    }))
    const resolveUserInput = vi.fn(async (input: {
      sessionId: string
      requestId: string
      answers: Record<string, string[]>
    }) => {
      const resolution = { requestId: input.requestId, answers: input.answers }
      resolvePending?.(resolution)
      return resolution
    })

    wireAcpIntegration(runtime, {
      deps: {
        requestToolApproval: vi.fn(),
        requestUserInput,
        resolveUserInput,
      },
    })

    const params: ElicitationUrlMode & { mode: 'url', message: string } = {
      mode: 'url',
      sessionId: 'acp-session-1',
      elicitationId: 'browser-auth-1',
      message: 'Complete authentication in the browser',
      url: 'https://example.test/auth',
    }
    const response = elicitationHandler!({
      agentId: 'agent-1',
      params,
      runtimeContext: {
        chatSessionId: 'chat-session-1',
        runId: 'run-1',
        providerKind: 'universal',
        runtimeKind: 'acp',
      },
    }) as Promise<CreateElicitationResponse>

    await completionHandler!({
      agentId: 'agent-1',
      params: { elicitationId: 'browser-auth-1' },
    })

    await expect(response).resolves.toEqual({ action: 'accept' })
    expect(resolveUserInput).toHaveBeenCalledWith({
      sessionId: 'chat-session-1',
      requestId: expect.stringMatching(/^acp-elicitation-/),
      answers: { complete: [] },
    })
  })
})
