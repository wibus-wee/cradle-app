import { existsSync, unlinkSync } from 'node:fs'
import type { Server, Socket } from 'node:net'
import { createServer } from 'node:net'

import { z } from 'zod'

import type { PendingCallManager } from './pending-calls.js'
import type { SlackBot } from './slack-bot.js'
import type { BridgeStore } from './store.js'

export interface BridgeServerConfig {
  socketPath: string
}

const ZhiToolRequestJsonSchema = z.string().transform(raw => JSON.parse(raw)).pipe(z.object({
  method: z.literal('zhi'),
  params: z.object({
    message: z.string(),
  }),
}))

interface BridgeResponse {
  success: boolean
  result?: {
    user_input: string
    selected_options: string[]
  }
  error?: string
}

/**
 * Bridge server that listens on a Unix socket.
 * MCP servers connect here to route zhi calls to Slack.
 */
export class BridgeServer {
  private server: Server | null = null
  private store: BridgeStore
  private pendingCalls: PendingCallManager
  private slackBot: SlackBot
  private socketPath: string

  constructor(
    config: BridgeServerConfig,
    store: BridgeStore,
    pendingCalls: PendingCallManager,
    slackBot: SlackBot,
  ) {
    this.socketPath = config.socketPath
    this.store = store
    this.pendingCalls = pendingCalls
    this.slackBot = slackBot
  }

  async start(): Promise<void> {
    // Clean up stale socket file
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath)
    }

    this.server = createServer(socket => this.handleConnection(socket))

    return new Promise((resolve, reject) => {
      this.server!.listen(this.socketPath, () => {
        console.warn(`[bridge] Listening on ${this.socketPath}`)
        resolve()
      })
      this.server!.on('error', reject)
    })
  }

  private handleConnection(socket: Socket): void {
    let buffer = ''

    socket.on('data', (chunk) => {
      buffer += chunk.toString()

      // Protocol: newline-delimited JSON
      let newlineIdx: number = buffer.indexOf('\n')
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx)
        buffer = buffer.slice(newlineIdx + 1)

        if (line.trim()) {
          this.handleMessage(line, socket)
        }
        newlineIdx = buffer.indexOf('\n')
      }
    })

    socket.on('error', (err) => {
      console.error('[bridge] Socket error:', err.message)
    })
  }

  private async handleMessage(raw: string, socket: Socket): Promise<void> {
    let response: BridgeResponse

    try {
      const request = ZhiToolRequestJsonSchema.parse(raw)
      response = await this.handleZhi(request.params)
    }
    catch (err) {
      response = { success: false, error: (err as Error).message }
    }

    socket.write(`${JSON.stringify(response)}\n`)
  }

  private async handleZhi(params: { message: string }): Promise<BridgeResponse> {
    const { message } = params

    // Every call gets a fresh Slack thread.
    const threadTs = await this.slackBot.sendZhiPrompt(message)

    // Create pending call and wait for reply
    const callId = crypto.randomUUID()

    console.warn(`[bridge] Waiting for reply on thread ${threadTs} (call ${callId.slice(0, 8)}...)`)

    try {
      const userResponse = await this.pendingCalls.waitForResponse(callId, threadTs)
      return {
        success: true,
        result: {
          user_input: `${userResponse}, 下次继续使用 zhi tool 反馈！`,
          selected_options: [],
        },
      }
    }
    catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.close()
      if (existsSync(this.socketPath)) {
        unlinkSync(this.socketPath)
      }
      console.warn('[bridge] Stopped')
    }
  }
}
