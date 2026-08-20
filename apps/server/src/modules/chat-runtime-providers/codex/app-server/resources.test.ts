import { afterEach, describe, expect, it, vi } from 'vitest'

import { providerRuntimeHostManager } from '../../../provider-runtime/host-manager'
import type { CodexAppServerClientLike } from '../types'
import { createCodexAppServerHostResource } from './host-resource'
import { getCodexAppServerNativeDiagnostics } from './resources'

afterEach(async () => {
  await providerRuntimeHostManager.clear()
})

describe('codex app-server observability resources', () => {
  it('reads native server diagnostics for each active provider host', async () => {
    const request = vi.fn(async (method: string) => {
      expect(method).toBe('server/diagnostics')
      return {
        process: {
          id: 42,
          residentMemoryBytes: 1_024,
          physicalFootprintBytes: 2_048,
        },
        gauges: [{ name: 'loaded_threads', value: 3 }],
      }
    })
    const resource = createCodexAppServerHostResource({
      clientOptions: {},
      createClient: () => createClient(request),
    })
    const lease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'target-1',
      scopeId: 'provider-host',
      retainOnRelease: true,
      createResource: () => resource,
      disposeResource: async value => value.client.close(),
    })

    await expect(getCodexAppServerNativeDiagnostics()).resolves.toEqual([{
      hostId: 'codex:target-1:provider-host',
      providerTargetId: 'target-1',
      scopeId: 'provider-host',
      diagnostics: {
        process: {
          id: 42,
          residentMemoryBytes: 1_024,
          physicalFootprintBytes: 2_048,
        },
        gauges: [{ name: 'loaded_threads', value: 3 }],
      },
      error: null,
    }])
    expect(request).toHaveBeenCalledWith('server/diagnostics', {})
    lease.release()
  })
})

function createClient(
  request: CodexAppServerClientLike['request'],
): CodexAppServerClientLike {
  return {
    pid: 42,
    initialize: async () => undefined,
    request,
    nextNotification: async () => null,
    close: async () => undefined,
  }
}
