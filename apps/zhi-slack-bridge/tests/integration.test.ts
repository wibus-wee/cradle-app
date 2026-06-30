import { existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const TEST_DIR = join(tmpdir(), `zhi-bridge-e2e-${process.pid}`)
const TEST_SOCKET = join(tmpdir(), `zhi-bridge-test-${process.pid}.sock`)

// Integration test: MCP server -> bridge -> mock Slack reply -> MCP response
describe('bridge Server Integration', () => {
  beforeEach(() => {
    process.env.ZHI_DATA_DIR = TEST_DIR
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
    if (existsSync(TEST_SOCKET)) {
      unlinkSync(TEST_SOCKET)
    }
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
    if (existsSync(TEST_SOCKET)) {
      unlinkSync(TEST_SOCKET)
    }
    delete process.env.ZHI_DATA_DIR
  })

  it('handles full zhi request-response cycle via unix socket', async () => {
    const { PendingCallManager } = await import('../src/pending-calls.js')

    const pendingCalls = new PendingCallManager()

    // Create a mock bridge server that simulates the flow
    const server = createServer((socket) => {
      let buffer = ''
      socket.on('data', (chunk) => {
        buffer += chunk.toString()
        const idx = buffer.indexOf('\n')
        if (idx !== -1) {
          const line = buffer.slice(0, idx)
          JSON.parse(line)

          const callId = crypto.randomUUID()
          const threadTs = 'fake-thread-ts'

          // Simulate user reply after 50ms
          setTimeout(() => {
            pendingCalls.resolveCall(callId, 'User said hello back')
          }, 50)

          // Wait for resolution then respond
          pendingCalls.waitForResponse(callId, threadTs).then((reply) => {
            socket.write(`${JSON.stringify({
              success: true,
              result: { user_input: reply, selected_options: [] },
            })}\n`)
          })
        }
      })
    })

    await new Promise<void>(resolve => server.listen(TEST_SOCKET, resolve))

    // Client connects and sends zhi request
    const response = await new Promise<any>((resolve, reject) => {
      const client = createConnection(TEST_SOCKET)
      let buf = ''

      client.on('connect', () => {
        client.write(`${JSON.stringify({
          method: 'zhi',
          params: { message: 'Review this code' },
        })}\n`)
      })

      client.on('data', (chunk) => {
        buf += chunk.toString()
        const idx = buf.indexOf('\n')
        if (idx !== -1) {
          resolve(JSON.parse(buf.slice(0, idx)))
          client.end()
        }
      })

      client.on('error', reject)
      setTimeout(() => reject(new Error('timeout')), 5000)
    })

    expect(response.success).toBe(true)
    expect(response.result.user_input).toBe('User said hello back')

    server.close()
  })
})
