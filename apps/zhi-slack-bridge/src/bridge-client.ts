/**
 * Bridge client for forwarding MCP zhi calls to the local Unix socket bridge.
 * Retries through temporary bridge restarts instead of failing fast.
 */
import { createConnection } from 'node:net'

import { z } from 'zod'

const BridgeResponseJsonSchema = z.string().transform(raw => JSON.parse(raw)).pipe(z.union([
  z.object({
    success: z.literal(true),
    result: z.object({
      user_input: z.string(),
      selected_options: z.array(z.string()),
    }),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]))

export type BridgeResponse = z.infer<typeof BridgeResponseJsonSchema>

export interface BridgeClientOptions {
  socketPath: string
  retryDelayMs?: number
  logger?: Pick<Console, 'error'>
}

export class BridgeConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeConnectionError'
  }
}

export async function callBridge(message: string, options: BridgeClientOptions): Promise<BridgeResponse> {
  const retryDelayMs = options.retryDelayMs ?? 1000
  const logger = options.logger ?? console

  while (true) {
    try {
      return await callBridgeOnce(message, options.socketPath)
    }
    catch (error) {
      if (!(error instanceof BridgeConnectionError)) {
        throw error
      }

      logger.error(
        `[mcp-server] Bridge unavailable (${error.message}). Retrying in ${retryDelayMs}ms...`,
      )
      await delay(retryDelayMs)
    }
  }
}

function callBridgeOnce(message: string, socketPath: string): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    let settled = false

    socket.on('connect', () => {
      const request = JSON.stringify({
        method: 'zhi',
        params: {
          message,
        },
      })
      socket.write(`${request}\n`)
    })

    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const newlineIdx = buffer.indexOf('\n')
      if (newlineIdx === -1 || settled) {
        return
      }

      const line = buffer.slice(0, newlineIdx)
      settled = true
      try {
        resolve(BridgeResponseJsonSchema.parse(line))
      }
      catch {
        reject(new Error(`Invalid bridge response: ${line}`))
      }
      finally {
        socket.end()
      }
    })

    socket.on('error', (err) => {
      if (settled) {
        return
      }
      settled = true
      reject(new BridgeConnectionError(`Cannot connect to bridge at ${socketPath}: ${err.message}`))
    })

    socket.on('close', () => {
      if (settled || buffer.includes('\n')) {
        return
      }

      settled = true
      reject(new BridgeConnectionError('Bridge closed connection without response'))
    })
  })
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
