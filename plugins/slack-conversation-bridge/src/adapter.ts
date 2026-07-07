import type {
  ConversationBridgeAdapterRegistration,
  ConversationBridgeAdapterRuntime,
  ConversationBridgeAdapterRuntimeContext,
  ConversationBridgeConnectionRuntimeConfig,
  ConversationBridgeControlBlock,
  ConversationBridgeControlElement,
  ConversationBridgeControlOption,
  ConversationBridgeControlResponse,
  ConversationBridgeDeliveryInput,
  ConversationBridgeDeliveryResult,
  ConversationBridgeHost,
  NormalizedConversationControl,
  NormalizedConversationInboundMessage,
} from '@cradle/plugin-sdk/server'
import {
  CONVERSATION_BRIDGE_CHANNEL_UNBIND_ACTION,
  CONVERSATION_BRIDGE_SESSION_MODEL_SELECT_ACTION,
  CONVERSATION_BRIDGE_SESSION_TARGET_SELECT_ACTION,
  CONVERSATION_BRIDGE_STATUS_REFRESH_ACTION,
  CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION,
} from '@cradle/plugin-sdk/server'

type SlackEventName = 'app_mention' | 'message'
type SlackLogLevel = 'debug' | 'info' | 'warn' | 'error'
type SlackBoltModule = typeof import('@slack/bolt')
type SlackFormatModule = typeof import('./format')

type SlackResponder = (message: {
  text: string
  blocks?: unknown[]
  response_type?: 'ephemeral' | 'in_channel'
  replace_original?: boolean
}) => Promise<unknown>

type SlackAck = () => Promise<unknown>

export interface SlackMessageEvent {
  type?: string
  subtype?: string
  channel?: string
  user?: string
  text?: string
  ts?: string
  thread_ts?: string
  bot_id?: string
}

export interface SlackEventEnvelope {
  event_id?: string
  team_id?: string
  event: SlackMessageEvent
}

export interface SlackCommandPayload {
  team_id?: string
  channel_id?: string
  user_id?: string
  command?: string
  text?: string
}

export interface SlackActionPayload {
  team?: {
    id?: string
  } | null
  channel?: {
    id?: string
  } | null
  user?: {
    id?: string
  } | null
  actions?: Array<{
    action_id?: string
    selected_option?: {
      value?: string
    } | null
    value?: string
  }>
}

export interface SlackAppLike {
  client: {
    auth: {
      test: () => Promise<{ user_id?: string, team_id?: string, enterprise_id?: string | null }>
    }
    chat: {
      postMessage: (input: {
        channel: string
        thread_ts: string
        text: string
        blocks?: unknown[]
      }) => Promise<{ ts?: string }>
    }
    reactions?: {
      add: (input: {
        channel: string
        timestamp: string
        name: string
      }) => Promise<unknown>
    }
  }
  event: (name: SlackEventName, handler: (input: { body: SlackEventEnvelope }) => Promise<void>) => void
  command: (name: string, handler: (input: {
    command: SlackCommandPayload
    ack: SlackAck
    respond: SlackResponder
  }) => Promise<void>) => void
  action: (actionId: string, handler: (input: {
    body: SlackActionPayload
    ack: SlackAck
    respond: SlackResponder
  }) => Promise<void>) => void
  start: () => Promise<void>
  stop: () => Promise<void>
}

export interface SlackAppFactoryInput {
  botToken: string
  appToken: string
  signingSecret: string
  logLevel: SlackLogLevel
}

export type SlackAppFactory = (input: SlackAppFactoryInput) => SlackAppLike | Promise<SlackAppLike>

interface RunningSlackConnection {
  app: SlackAppLike
  botUserId: string | null
}

function toBoltLogLevel(value: unknown): SlackLogLevel {
  switch (value) {
    case 'debug':
      return 'debug'
    case 'warn':
      return 'warn'
    case 'error':
      return 'error'
    case 'info':
    default:
      return 'info'
  }
}

async function defaultSlackAppFactory(input: SlackAppFactoryInput): Promise<SlackAppLike> {
  const { App, LogLevel } = await import('@slack/bolt') as SlackBoltModule
  const logLevel = (() => {
    switch (input.logLevel) {
      case 'debug':
        return LogLevel.DEBUG
      case 'warn':
        return LogLevel.WARN
      case 'error':
        return LogLevel.ERROR
      case 'info':
      default:
        return LogLevel.INFO
    }
  })()
  const app = new App({
    token: input.botToken,
    appToken: input.appToken,
    signingSecret: input.signingSecret,
    socketMode: true,
    logLevel,
  })
  return {
    client: app.client,
    event(name, handler) {
      app.event(name, async ({ body }) => {
        await handler({ body: body as SlackEventEnvelope })
      })
    },
    command(name, handler) {
      app.command(name, async ({ command, ack, respond }) => {
        await handler({
          command: command as SlackCommandPayload,
          ack,
          respond,
        })
      })
    },
    action(actionId, handler) {
      app.action(actionId, async ({ body, ack, respond }) => {
        await handler({
          body: body as SlackActionPayload,
          ack,
          respond,
        })
      })
    },
    async start() {
      await app.start()
    },
    async stop() {
      await app.stop()
    },
  }
}

function requireSecret(connection: ConversationBridgeConnectionRuntimeConfig, name: string): string {
  const value = connection.secrets[name]?.trim()
  if (!value) {
    throw new Error(`Slack connection ${connection.id} is missing required secret: ${name}`)
  }
  return value
}

function isIgnorableMessage(event: SlackMessageEvent): boolean {
  return Boolean(
    event.bot_id
    || event.subtype === 'bot_message'
    || event.subtype === 'message_changed'
    || event.subtype === 'message_deleted',
  )
}

function eventIdFor(envelope: SlackEventEnvelope, teamId: string, event: SlackMessageEvent): string {
  return `${teamId}:${event.channel ?? 'unknown'}:${event.ts ?? 'unknown'}`
}

function isMentioned(event: SlackMessageEvent, botUserId?: string | null): boolean {
  if (event.type === 'app_mention') {
    return true
  }
  return Boolean(botUserId && event.text?.includes(`<@${botUserId}>`))
}

function stripBotMention(text: string, botUserId?: string | null): string {
  let cleaned = text
  if (botUserId) {
    cleaned = cleaned.replace(new RegExp(`<@${botUserId}>`, 'g'), '')
  }
  return cleaned.trim()
}

function truncatePlainText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
}

function blockOptionToSlack(option: ConversationBridgeControlOption) {
  return {
    text: {
      type: 'plain_text' as const,
      text: truncatePlainText(option.label, 75),
    },
    ...(option.description
      ? {
          description: {
            type: 'plain_text' as const,
            text: truncatePlainText(option.description, 75),
          },
        }
      : {}),
    value: option.value,
  }
}

function blockElementToSlack(element: ConversationBridgeControlElement): Record<string, unknown> {
  if (element.type === 'button') {
    return {
      type: 'button',
      text: {
        type: 'plain_text',
        text: truncatePlainText(element.text, 75),
      },
      action_id: element.actionId,
      ...(element.value ? { value: element.value } : {}),
      ...(element.style ? { style: element.style } : {}),
      ...(element.confirm
        ? {
            confirm: {
              title: {
                type: 'plain_text',
                text: truncatePlainText(element.confirm.title, 100),
              },
              text: {
                type: 'mrkdwn',
                text: element.confirm.text,
              },
              confirm: {
                type: 'plain_text',
                text: truncatePlainText(element.confirm.confirm, 30),
              },
              deny: {
                type: 'plain_text',
                text: truncatePlainText(element.confirm.deny, 30),
              },
            },
          }
        : {}),
    }
  }

  const initialOption = element.initialOption ? blockOptionToSlack(element.initialOption) : undefined
  return {
    type: 'static_select',
    action_id: element.actionId,
    placeholder: {
      type: 'plain_text',
      text: truncatePlainText(element.placeholder, 150),
    },
    options: element.options.map(blockOptionToSlack),
    ...(initialOption ? { initial_option: initialOption } : {}),
  }
}

function blockToSlack(block: ConversationBridgeControlBlock): Record<string, unknown> {
  switch (block.type) {
    case 'header':
      return {
        type: 'header',
        text: {
          type: 'plain_text',
          text: truncatePlainText(block.text, 150),
        },
      }
    case 'section':
      return {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: block.text,
        },
        ...(block.accessory ? { accessory: blockElementToSlack(block.accessory) } : {}),
      }
    case 'context':
      return {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: block.text,
        }],
      }
    case 'actions':
      return {
        type: 'actions',
        elements: block.elements.map(blockElementToSlack),
      }
    case 'divider':
      return { type: 'divider' }
  }
}

function controlResponseToSlack(message: ConversationBridgeControlResponse) {
  return {
    text: message.text,
    response_type: message.visibility,
    replace_original: message.replaceOriginal,
    ...(message.blocks ? { blocks: message.blocks.map(blockToSlack) } : {}),
  }
}

function errorResponseToSlack(error: unknown) {
  return {
    text: error instanceof Error ? error.message : String(error),
    response_type: 'ephemeral' as const,
  }
}

function normalizeSlackCommandControl(input: {
  connectionId: string
  command: SlackCommandPayload
}): NormalizedConversationControl | null {
  const teamId = input.command.team_id
  const channelId = input.command.channel_id
  if (!teamId || !channelId) {
    return null
  }
  return {
    connectionId: input.connectionId,
    externalWorkspaceId: teamId,
    externalChannelId: channelId,
    externalActorId: input.command.user_id ?? null,
    kind: 'command',
    command: input.command.command ?? '/cradle',
    text: input.command.text ?? '',
    payload: {
      slack: {
        teamId,
        channelId,
        command: input.command.command ?? '/cradle',
      },
    },
  }
}

function normalizeSlackActionControl(input: {
  connectionId: string
  body: SlackActionPayload
}): NormalizedConversationControl | null {
  const teamId = input.body.team?.id
  const channelId = input.body.channel?.id
  const action = input.body.actions?.[0]
  if (!teamId || !channelId || !action?.action_id) {
    return null
  }
  return {
    connectionId: input.connectionId,
    externalWorkspaceId: teamId,
    externalChannelId: channelId,
    externalActorId: input.body.user?.id ?? null,
    kind: 'action',
    actionId: action.action_id,
    selectedValue: action.selected_option?.value ?? null,
    value: action.value ?? null,
    payload: {
      slack: {
        teamId,
        channelId,
        actionId: action.action_id,
      },
    },
  }
}

export function normalizeSlackMessageEvent(input: {
  connectionId: string
  envelope: SlackEventEnvelope
  botUserId?: string | null
}): NormalizedConversationInboundMessage | null {
  const { connectionId, envelope, botUserId } = input
  const event = envelope.event
  const teamId = envelope.team_id
  const channelId = event.channel
  const messageTs = event.ts
  const threadTs = event.thread_ts ?? event.ts

  if (!teamId || !channelId || !messageTs || !threadTs) {
    return null
  }
  if (isIgnorableMessage(event)) {
    return null
  }

  const text = stripBotMention(event.text ?? '', botUserId)
  if (!text) {
    return null
  }

  return {
    connectionId,
    externalEventId: eventIdFor(envelope, teamId, event),
    externalWorkspaceId: teamId,
    externalChannelId: channelId,
    externalThreadId: threadTs,
    externalMessageId: messageTs,
    externalActorId: event.user ?? null,
    text,
    mentionedAdapter: isMentioned(event, botUserId),
    eventType: event.type ?? 'message',
    payload: {
      slack: {
        teamId,
        channelId,
        messageTs,
        threadTs,
        eventType: event.type ?? 'message',
        subtype: event.subtype ?? null,
      },
    },
  }
}

export class SlackConversationBridgeRuntime implements ConversationBridgeAdapterRuntime {
  private readonly connections = new Map<string, RunningSlackConnection>()

  constructor(
    private readonly ctx: ConversationBridgeAdapterRuntimeContext,
    private readonly createApp: SlackAppFactory = defaultSlackAppFactory,
  ) {}

  async start(connection: ConversationBridgeConnectionRuntimeConfig, host: ConversationBridgeHost): Promise<void> {
    if (this.connections.has(connection.id)) {
      return
    }

    host.reportConnectionHealth({
      connectionId: connection.id,
      status: 'starting',
      message: null,
    })

    let botUserId: string | null = null
    const app = await this.createApp({
      botToken: requireSecret(connection, 'botToken'),
      appToken: requireSecret(connection, 'appToken'),
      signingSecret: requireSecret(connection, 'signingSecret'),
      logLevel: toBoltLogLevel(connection.config.logLevel),
    })

    const handleEnvelope = async (envelope: SlackEventEnvelope) => {
      const normalized = normalizeSlackMessageEvent({
        connectionId: connection.id,
        envelope,
        botUserId,
      })
      if (!normalized) {
        return
      }
      try {
        await app.client.reactions?.add({
          channel: normalized.externalChannelId,
          timestamp: normalized.externalMessageId,
          name: 'eyes',
        })
      }
      catch (error) {
        this.ctx.logger.debug('Slack reaction acknowledgement failed', error)
      }
      try {
        await host.handleInboundMessage(normalized)
      }
      catch (error) {
        this.ctx.logger.error('Slack conversation bridge inbound processing failed', error)
        try {
          await app.client.chat.postMessage({
            channel: normalized.externalChannelId,
            thread_ts: normalized.externalThreadId,
            text: `⚠️ Failed to process your message: ${error instanceof Error ? error.message : 'Unknown error'}`,
          })
        }
        catch (postError) {
          this.ctx.logger.debug('Failed to post error feedback to Slack', postError)
        }
      }
    }

    const respondWithControl = async (
      control: NormalizedConversationControl | null,
      respond: SlackResponder,
    ) => {
      if (!control) {
        await respond({
          text: 'Slack command context was missing team or channel id.',
          response_type: 'ephemeral',
        })
        return
      }
      try {
        await respond(controlResponseToSlack(await host.handleControl(control)))
      }
      catch (error) {
        await respond(errorResponseToSlack(error))
      }
    }

    app.command('/cradle', async ({ command, ack, respond }) => {
      await ack()
      await respondWithControl(
        normalizeSlackCommandControl({ connectionId: connection.id, command }),
        respond,
      )
    })

    for (const actionId of [
      CONVERSATION_BRIDGE_STATUS_REFRESH_ACTION,
      CONVERSATION_BRIDGE_CHANNEL_UNBIND_ACTION,
      CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION,
      CONVERSATION_BRIDGE_SESSION_TARGET_SELECT_ACTION,
      CONVERSATION_BRIDGE_SESSION_MODEL_SELECT_ACTION,
    ]) {
      app.action(actionId, async ({ body, ack, respond }) => {
        await ack()
        await respondWithControl(
          normalizeSlackActionControl({ connectionId: connection.id, body }),
          respond,
        )
      })
    }

    app.event('app_mention', async ({ body }) => handleEnvelope(body))
    app.event('message', async ({ body }) => handleEnvelope(body))

    const auth = await app.client.auth.test()
    botUserId = auth.user_id ?? null
    await app.start()
    this.connections.set(connection.id, { app, botUserId })

    host.reportConnectionHealth({
      connectionId: connection.id,
      status: 'running',
      message: auth.team_id ? `Connected to Slack workspace ${auth.team_id}` : null,
    })
  }

  async stop(connectionId: string): Promise<void> {
    const running = this.connections.get(connectionId)
    if (!running) {
      return
    }
    this.connections.delete(connectionId)
    await running.app.stop()
  }

  async sendMessage(input: ConversationBridgeDeliveryInput): Promise<ConversationBridgeDeliveryResult> {
    const running = this.connections.get(input.connectionId)
    if (!running) {
      throw new Error(`Slack connection is not running: ${input.connectionId}`)
    }

    const { renderMarkdownForSlack } = await import('./format') as SlackFormatModule
    const postedMessageIds: string[] = []
    const messages = renderMarkdownForSlack(input.text)
    for (const message of messages) {
      try {
        const posted = await running.app.client.chat.postMessage({
          channel: input.externalChannelId,
          thread_ts: input.externalThreadId,
          text: message.text,
          blocks: message.blocks,
        })
        if (posted.ts) {
          postedMessageIds.push(posted.ts)
        }
      }
      catch (error) {
        this.ctx.logger.error('Slack message delivery failed', error)
        throw error
      }
    }

    return {
      externalMessageId: postedMessageIds.at(-1) ?? null,
      payload: {
        slack: {
          postedMessageIds,
        },
      },
    }
  }
}

export function createSlackConversationAdapter(
  createApp?: SlackAppFactory,
): ConversationBridgeAdapterRegistration {
  return {
    id: 'slack',
    platform: 'slack',
    label: 'Slack',
    description: 'Slack Socket Mode conversation adapter for Cradle conversation bridge',
    capabilities: {
      realtime: 'socket',
      channelBinding: true,
      threadBinding: true,
      interactiveControls: true,
    },
    createRuntime: ctx => new SlackConversationBridgeRuntime(ctx, createApp),
  }
}
