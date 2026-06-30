import { existsSync, unlinkSync } from 'node:fs'
import type { Server } from 'node:net'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { callBridge } from '../src/bridge-client.js'

const TEST_SOCKET = join(tmpdir(), `zhi-bridge-client-test-${process.pid}.sock`)

describe('bridge-client', () => {
  let server: Server | null = null

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve()
        return
      }

      server.close(() => resolve())
      server = null
    })

    if (existsSync(TEST_SOCKET)) {
      unlinkSync(TEST_SOCKET)
    }
  })

  it('retries until the bridge becomes available', async () => {
    const responsePromise = callBridge('hello', {
      socketPath: TEST_SOCKET,
      retryDelayMs: 10,
      logger: { error: () => {} },
    })

    await new Promise(resolve => setTimeout(resolve, 30))

    server = createServer((socket) => {
      socket.on('data', () => {
        socket.write(`${JSON.stringify({
          success: true,
          result: { user_input: 'bridge recovered', selected_options: [] },
        })}\n`)
      })
    })

    await new Promise<void>(resolve => server!.listen(TEST_SOCKET, resolve))

    await expect(responsePromise).resolves.toEqual({
      success: true,
      result: { user_input: 'bridge recovered', selected_options: [] },
    })
  })
})
