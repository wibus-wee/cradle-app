/**
 * Output: opencode SDK server host resource.
 * Input: opencode native config and Cradle runtime host key.
 * Position: opencode provider package runtime process owner.
 */

import net from 'node:net'

import { createOpencode, type Config, type OpencodeClient } from '@opencode-ai/sdk'

import type { RuntimeLiveResourceLease } from '../../chat-runtime/runtime-provider-types'
import { providerRuntimeHostManager } from '../../provider-runtime/host-manager'
import type { RuntimeKind } from '../../provider-contracts/types'

export interface OpencodeRuntimeResource {
  client: OpencodeClient
  server: {
    url: string
    close(): void
  }
}

export async function acquireOpencodeRuntimeResource(input: {
  runtimeKind: RuntimeKind
  providerTargetId: string
  chatSessionId: string
  config: Config
}): Promise<RuntimeLiveResourceLease<OpencodeRuntimeResource>> {
  return await providerRuntimeHostManager.acquireResource({
    runtimeKind: input.runtimeKind,
    providerTargetId: input.providerTargetId,
    scopeId: input.chatSessionId,
    createResource: async () => {
      const port = await findAvailablePort()
      return await createOpencode({
        hostname: '127.0.0.1',
        port,
        config: input.config,
      })
    },
    disposeResource: (resource) => {
      resource.server.close()
    },
  }) as RuntimeLiveResourceLease<OpencodeRuntimeResource>
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate opencode server port')))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}
