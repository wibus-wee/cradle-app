import { App, LogLevel } from '@slack/bolt'

import type { PendingCallManager } from './pending-calls.js'
import { formatForSlack, markdownToSlackMrkdwn } from './slack-format.js'
import type { BridgeStore } from './store.js'

const WHITESPACE_RE = /\s+/

export interface SlackBotConfig {
  botToken: string
  appToken: string
  signingSecret: string
}

export class SlackBot {
  private app: App
  private store: BridgeStore
  private pendingCalls: PendingCallManager

  constructor(config: SlackBotConfig, store: BridgeStore, pendingCalls: PendingCallManager) {
    this.store = store
    this.pendingCalls = pendingCalls

    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
      logLevel: LogLevel.INFO,
    })

    this.registerCommands()
    this.registerMessageHandlers()
  }

  private registerCommands(): void {
    // /zhi bind
    this.app.command('/zhi', async ({ command, ack, respond }) => {
      await ack()

      const args = command.text.trim().split(WHITESPACE_RE)
      const subcommand = args[0]

      switch (subcommand) {
        case 'bind':
          await this.handleBind(command.channel_id, command.user_id, respond)
          break
        case 'unbind':
          await this.handleUnbind(command.channel_id, respond)
          break
        case 'status':
          await this.handleStatus(respond)
          break
        default:
          await respond({
            text: '未知命令。可用命令: `bind`, `unbind`, `status`',
            response_type: 'ephemeral',
          })
      }
    })
  }

  private registerMessageHandlers(): void {
    // Listen for replies in threads where we have pending calls
    this.app.event('message', async ({ event, client }) => {
      // Only care about threaded replies
      if (!('thread_ts' in event) || !event.thread_ts) {
        return
      }
      // Ignore bot messages
      if ('bot_id' in event && event.bot_id) {
        return
      }
      // Ignore subtypes like message_changed
      if ('subtype' in event && event.subtype) {
        return
      }

      const threadTs = event.thread_ts
      const text = ('text' in event && event.text) || ''

      // Resolve the pending call
      const callId = this.pendingCalls.resolveByThreadTs(threadTs, text)
      if (callId) {
        // React to confirm receipt
        try {
          await client.reactions.add({
            channel: event.channel,
            timestamp: ('ts' in event && event.ts) || '',
            name: 'white_check_mark',
          })
        }
 catch {
          // Reaction failed, not critical
        }
      }
    })
  }

  private async handleBind(channelId: string, userId: string, respond: (msg: any) => Promise<unknown>): Promise<void> {
    this.store.setChannelBinding(channelId, userId)
    await respond({
      text: '✅ 已绑定 zhi 到当前 channel。后续每次 zhi 调用都会在这里创建一个新的 thread。',
      response_type: 'in_channel',
    })
  }

  private async handleUnbind(channelId: string, respond: (msg: any) => Promise<unknown>): Promise<void> {
    const binding = this.store.getChannelBinding()
    if (!binding || binding.channelId !== channelId) {
      await respond({
        text: '当前 channel 未绑定 zhi。',
        response_type: 'ephemeral',
      })
      return
    }
    this.store.clearChannelBinding()
    await respond({
      text: '已解绑 zhi 与当前 channel 的绑定关系。',
      response_type: 'in_channel',
    })
  }

  private async handleStatus(respond: (msg: any) => Promise<unknown>): Promise<void> {
    const binding = this.store.getChannelBinding()

    const blocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: binding
            ? `*Channel 绑定:* <#${binding.channelId}>\n绑定时间: ${binding.boundAt}`
            : '*Channel 绑定:* 未绑定',
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*当前等待中的 zhi 调用:* ${this.pendingCalls.size}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '每次 zhi 调用都会新建一个 Slack thread；收到回复后 bridge 会立刻忘掉它。',
          },
        ],
      },
    ]

    await respond({
      blocks,
      text: 'Zhi 状态',
      response_type: 'ephemeral',
    })
  }

  /**
   * Send a zhi prompt to a fresh Slack thread.
   * Every zhi call gets its own thread and the bridge does not reuse it later.
   */
  async sendZhiPrompt(message: string): Promise<string> {
    const binding = this.store.getChannelBinding()
    if (!binding) {
      throw new Error('No channel bound. Use /zhi bind in a Slack channel first.')
    }

    const channelId = binding.channelId

    // Format message for Slack first, then use it directly as the thread root.
    const formatted = formatForSlack(message)
    const fallbackText = markdownToSlackMrkdwn(
      formatted.type === 'inline' ? formatted.text : formatted.summary,
    )

    const root = await this.app.client.chat.postMessage(
      formatted.type === 'inline'
        ? {
            channel: channelId,
            text: fallbackText,
            blocks: [
              {
                type: 'markdown',
                text: formatted.text,
              },
            ],
          }
        : {
            channel: channelId,
            text: fallbackText,
            blocks: [
              {
                type: 'markdown',
                text: formatted.summary,
              },
            ],
          },
    )

    if (!root.ts) {
      throw new Error('Failed to create Slack thread')
    }

    const threadTs = root.ts

    if (formatted.type === 'split') {
      for (const chunk of formatted.continuation) {
        await this.app.client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: markdownToSlackMrkdwn(chunk),
          blocks: [
            {
              type: 'markdown',
              text: chunk,
            },
          ],
        })
      }
    }

    return threadTs
  }

  async start(): Promise<void> {
    await this.app.start()
    console.warn('[slack-bot] Started in Socket Mode')
  }

  async stop(): Promise<void> {
    await this.app.stop()
    console.warn('[slack-bot] Stopped')
  }
}
