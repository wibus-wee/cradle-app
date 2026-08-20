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
  ConversationBridgeTurnEvent,
  ConversationBridgeTurnUserInputRequiredEvent,
  NormalizedConversationControl,
  NormalizedConversationInboundMessage,
} from '@cradle/plugin-sdk/server'
import {
  CONVERSATION_BRIDGE_CHANNEL_UNBIND_ACTION,
  CONVERSATION_BRIDGE_SESSION_MODEL_SELECT_ACTION,
  CONVERSATION_BRIDGE_SESSION_TARGET_SELECT_ACTION,
  CONVERSATION_BRIDGE_STATUS_REFRESH_ACTION,
  CONVERSATION_BRIDGE_TOOL_APPROVAL_ACTION,
  CONVERSATION_BRIDGE_TURN_ABORT_ACTION,
  CONVERSATION_BRIDGE_USER_INPUT_ACTION,
  CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION,
} from '@cradle/plugin-sdk/server'

type SlackEventName = 'app_mention' | 'message'
type SlackLogLevel = 'debug' | 'info' | 'warn' | 'error'
type SlackBoltModule = typeof import('@slack/bolt')
type SlackWebClient = InstanceType<SlackBoltModule['App']>['client']
type SlackFormatModule = typeof import('./format')
type SlackStreamChunk = NonNullable<Parameters<SlackWebClient['chat']['startStream']>[0]['chunks']>[number]
type SlackBlock = NonNullable<Parameters<SlackWebClient['chat']['stopStream']>[0]['blocks']>[number]

type SlackResponder = (message: {
  text: string
  blocks?: unknown[]
  response_type?: 'ephemeral' | 'in_channel'
  replace_original?: boolean
}) => Promise<unknown>

type SlackAck = () => Promise<unknown>

const CRADLE_USER_INPUT_VIEW = 'cradle_user_input_view'

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
  trigger_id?: string
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

export interface SlackViewSubmissionPayload {
  view?: {
    callback_id?: string
    private_metadata?: string
    state?: {
      values?: Record<string, Record<string, {
        value?: string | null
        selected_option?: { value?: string } | null
        selected_options?: Array<{ value?: string }>
      }>>
    }
  }
}

export interface SlackAppLike {
  client: {
    auth: {
      test: () => Promise<{ user_id?: string, team_id?: string, enterprise_id?: string | null }>
    }
    users: {
      info: SlackWebClient['users']['info']
    }
    conversations: {
      info: SlackWebClient['conversations']['info']
    }
    chat: {
      postMessage: SlackWebClient['chat']['postMessage']
      startStream: SlackWebClient['chat']['startStream']
      appendStream: SlackWebClient['chat']['appendStream']
      stopStream: SlackWebClient['chat']['stopStream']
    }
    assistant?: {
      threads: {
        setStatus: (input: {
          channel_id: string
          thread_ts: string
          status: string
          loading_messages?: string[]
        }) => Promise<unknown>
      }
    }
    views: {
      open: SlackWebClient['views']['open']
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
  view: (callbackId: string, handler: (input: {
    body: SlackViewSubmissionPayload
    ack: (response?: unknown) => Promise<unknown>
  }) => Promise<void>) => void
  start: () => Promise<void>
  stop: () => Promise<void>
}

export interface SlackAppFactoryInput {
  botToken: string
  appToken: string
  signingSecret?: string
  logLevel: SlackLogLevel
}

export type SlackAppFactory = (input: SlackAppFactoryInput) => SlackAppLike | Promise<SlackAppLike>

interface RunningSlackConnection {
  app: SlackAppLike
  botUserId: string | null
  pendingUserInputs: Map<string, ConversationBridgeTurnUserInputRequiredEvent>
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
    ...(input.signingSecret ? { signingSecret: input.signingSecret } : {}),
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
    view(callbackId, handler) {
      app.view(callbackId, async ({ body, ack }) => {
        await handler({
          body: body as SlackViewSubmissionPayload,
          ack: async response => response === undefined
            ? await ack()
            : await (ack as (input: unknown) => Promise<unknown>)(response),
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

async function enrichSlackMessageContext(input: {
  app: SlackAppLike
  message: NormalizedConversationInboundMessage
  userNames: Map<string, string>
  channels: Map<string, { name: string | null, topic: string | null }>
  logger: ConversationBridgeAdapterRuntimeContext['logger']
}): Promise<void> {
  const { app, message, userNames, channels, logger } = input
  if (message.externalActorId) {
    const cachedName = userNames.get(message.externalActorId)
    if (cachedName) {
      message.externalActorName = cachedName
    }
    else {
      try {
        const response = await app.client.users.info({ user: message.externalActorId })
        const name = response.user?.profile?.display_name
          || response.user?.real_name
          || response.user?.name
        if (name) {
          userNames.set(message.externalActorId, name)
          message.externalActorName = name
        }
      }
      catch (error) {
        logger.debug('Slack user identity lookup failed', error)
      }
    }
  }

  const cachedChannel = channels.get(message.externalChannelId)
  if (cachedChannel) {
    message.externalChannelName = cachedChannel.name
    message.externalChannelTopic = cachedChannel.topic
    return
  }
  try {
    const response = await app.client.conversations.info({ channel: message.externalChannelId })
    const channel = {
      name: response.channel?.name ?? null,
      topic: response.channel?.topic?.value ?? null,
    }
    channels.set(message.externalChannelId, channel)
    message.externalChannelName = channel.name
    message.externalChannelTopic = channel.topic
  }
  catch (error) {
    logger.debug('Slack channel context lookup failed', error)
  }
}

interface SlackToolApprovalActionValue {
  sessionId: string
  requestId: string
  approved: boolean
}

function parseToolApprovalActionValue(value?: string): SlackToolApprovalActionValue | null {
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value) as SlackToolApprovalActionValue
  }
  catch {
    return null
  }
}

function stopBlocks(runId: string): SlackBlock[] {
  return [{
    type: 'actions',
    block_id: `cradle_turn_${runId}`,
    elements: [{
      type: 'button',
      action_id: CONVERSATION_BRIDGE_TURN_ABORT_ACTION,
      text: { type: 'plain_text', text: 'Stop' },
      value: runId,
      style: 'danger',
      confirm: {
        title: { type: 'plain_text', text: 'Stop this run?' },
        text: { type: 'mrkdwn', text: 'Cradle will keep the partial response and stop the active Agent run.' },
        confirm: { type: 'plain_text', text: 'Stop run' },
        deny: { type: 'plain_text', text: 'Keep running' },
      },
    }],
  }]
}

function approvalBlocks(event: Extract<ConversationBridgeTurnEvent, { type: 'approval_required' }>): SlackBlock[] {
  const allow = JSON.stringify({
    sessionId: event.sessionId,
    requestId: event.requestId,
    approved: true,
  } satisfies SlackToolApprovalActionValue)
  const deny = JSON.stringify({
    sessionId: event.sessionId,
    requestId: event.requestId,
    approved: false,
  } satisfies SlackToolApprovalActionValue)
  return [{
    type: 'section',
    text: { type: 'mrkdwn', text: `*Approval required*\n${event.title}` },
  }, {
    type: 'actions',
    elements: [{
      type: 'button',
      action_id: CONVERSATION_BRIDGE_TOOL_APPROVAL_ACTION,
      text: { type: 'plain_text', text: 'Allow' },
      value: allow,
      style: 'primary',
    }, {
      type: 'button',
      action_id: CONVERSATION_BRIDGE_TOOL_APPROVAL_ACTION,
      text: { type: 'plain_text', text: 'Deny' },
      value: deny,
      style: 'danger',
    }],
  }]
}

function userInputBlocks(event: ConversationBridgeTurnUserInputRequiredEvent): SlackBlock[] {
  const summary = event.questions.map(question => `• ${question.question}`).join('\n')
  const section: SlackBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: event.questions.some(question => question.isSecret)
        ? `*${event.title}*\n${summary}\n\nThis answer is sensitive. Continue in Cradle so Slack never receives it.`
        : `*${event.title}*\n${summary}`,
    },
  }
  if (event.questions.some(question => question.isSecret)) {
    return [section]
  }
  return [section, {
    type: 'actions',
    elements: [{
      type: 'button',
      action_id: CONVERSATION_BRIDGE_USER_INPUT_ACTION,
      text: { type: 'plain_text', text: 'Answer in Slack' },
      value: event.requestId,
      style: 'primary',
    }],
  }]
}

function userInputModal(
  event: ConversationBridgeTurnUserInputRequiredEvent,
): Parameters<SlackWebClient['views']['open']>[0]['view'] {
  return {
    type: 'modal',
    callback_id: CRADLE_USER_INPUT_VIEW,
    private_metadata: JSON.stringify({ sessionId: event.sessionId, requestId: event.requestId }),
    title: { type: 'plain_text', text: truncatePlainText(event.title, 24) },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: event.questions.map((question, index) => ({
      type: 'input',
      block_id: `question_${index}`,
      label: { type: 'plain_text', text: truncatePlainText(question.header || question.question, 2000) },
      element: question.options?.length
        ? {
            type: question.multiSelect ? 'multi_static_select' : 'static_select',
            action_id: 'answer',
            placeholder: { type: 'plain_text', text: 'Choose an answer' },
            options: question.options.map((option, optionIndex) => ({
              text: { type: 'plain_text', text: truncatePlainText(option.label, 75) },
              description: { type: 'plain_text', text: truncatePlainText(option.description, 75) },
              value: String(optionIndex),
            })),
          }
        : {
            type: 'plain_text_input',
            action_id: 'answer',
            multiline: true,
          },
    })),
  }
}

function readUserInputAnswers(
  event: ConversationBridgeTurnUserInputRequiredEvent,
  values: NonNullable<NonNullable<SlackViewSubmissionPayload['view']>['state']>['values'],
): Record<string, string[]> {
  const answers: Record<string, string[]> = {}
  event.questions.forEach((question, index) => {
    const answer = values?.[`question_${index}`]?.answer
    if (answer?.selected_options) {
      answers[question.id] = answer.selected_options
        .map(option => question.options?.[Number(option.value)]?.label)
        .filter((label): label is string => Boolean(label))
      return
    }
    if (answer?.selected_option?.value !== undefined) {
      const label = question.options?.[Number(answer.selected_option.value)]?.label
      answers[question.id] = label ? [label] : []
      return
    }
    answers[question.id] = answer?.value ? [answer.value] : []
  })
  return answers
}

class SlackTurnStream {
  private streamTs: string | null = null
  private runId: string | null = null
  private textBuffer = ''
  private lastTextFlushAt = 0

  constructor(
    private readonly app: SlackAppLike,
    private readonly host: ConversationBridgeHost,
    private readonly event: NormalizedConversationInboundMessage,
    private readonly pendingUserInputs: Map<string, ConversationBridgeTurnUserInputRequiredEvent>,
    private readonly logger: ConversationBridgeAdapterRuntimeContext['logger'],
  ) {}

  private async setStatus(status: string): Promise<void> {
    try {
      await this.app.client.assistant?.threads.setStatus({
        channel_id: this.event.externalChannelId,
        thread_ts: this.event.externalThreadId,
        status,
        ...(status
          ? { loading_messages: ['is reading the request…', 'is working through the task…', 'is preparing the response…'] }
          : {}),
      })
    }
    catch (error) {
      this.logger.debug('Slack assistant thread status update failed', error)
    }
  }

  private async ensureStarted(input: { markdownText?: string, chunks?: SlackStreamChunk[] } = {}): Promise<void> {
    if (this.streamTs) {
      if (input.markdownText || input.chunks?.length) {
        await this.app.client.chat.appendStream({
          channel: this.event.externalChannelId,
          ts: this.streamTs,
          ...(input.markdownText ? { markdown_text: input.markdownText } : {}),
          ...(input.chunks?.length ? { chunks: input.chunks } : {}),
        })
      }
      return
    }
    if (!this.runId) {
      throw new Error('Slack turn stream was started before Cradle accepted the run')
    }
    const started = await this.app.client.chat.startStream({
      channel: this.event.externalChannelId,
      thread_ts: this.event.externalThreadId,
      recipient_team_id: this.event.externalWorkspaceId,
      ...(this.event.externalActorId ? { recipient_user_id: this.event.externalActorId } : {}),
      task_display_mode: 'timeline',
      ...(input.markdownText ? { markdown_text: input.markdownText } : {}),
      chunks: [
        ...(input.chunks ?? []),
        { type: 'blocks', blocks: stopBlocks(this.runId) },
      ],
    })
    if (!started.ts) {
      throw new Error('Slack did not return a timestamp for the streaming response')
    }
    this.streamTs = started.ts
  }

  private async flushText(force = false): Promise<void> {
    if (!this.textBuffer) {
      return
    }
    if (!force && this.streamTs && Date.now() - this.lastTextFlushAt < 250) {
      return
    }
    const text = this.textBuffer
    this.textBuffer = ''
    await this.ensureStarted({ markdownText: text })
    this.lastTextFlushAt = Date.now()
  }

  private async appendTask(event: Extract<ConversationBridgeTurnEvent, { type: 'tool_started' | 'tool_completed' | 'tool_failed' }>): Promise<void> {
    await this.flushText(true)
    await this.ensureStarted({
      chunks: [{
        type: 'task_update',
        id: event.toolCallId,
        title: truncatePlainText(event.title, 256),
        status: event.type === 'tool_started'
          ? 'in_progress'
          : event.type === 'tool_completed' ? 'complete' : 'error',
        ...(event.detail ? { details: truncatePlainText(event.detail, 256) } : {}),
      }],
    })
  }

  async consume(events: AsyncIterable<ConversationBridgeTurnEvent>): Promise<void> {
    let deliveryId: string | null = null
    try {
      for await (const turnEvent of events) {
        switch (turnEvent.type) {
          case 'accepted':
            this.runId = turnEvent.runId
            await this.setStatus('is working on your request…')
            break
          case 'text_delta':
            this.textBuffer += turnEvent.delta
            await this.flushText()
            break
          case 'tool_started':
          case 'tool_completed':
          case 'tool_failed':
            await this.appendTask(turnEvent)
            await this.setStatus(turnEvent.type === 'tool_started' ? `is using ${turnEvent.title}…` : 'is continuing the run…')
            break
          case 'approval_required':
            await this.flushText(true)
            await this.ensureStarted({ chunks: [{ type: 'blocks', blocks: approvalBlocks(turnEvent) }] })
            await this.setStatus('is waiting for approval…')
            break
          case 'user_input_required':
            if (!turnEvent.questions.some(question => question.isSecret)) {
              this.pendingUserInputs.set(turnEvent.requestId, turnEvent)
            }
            await this.flushText(true)
            await this.ensureStarted({ chunks: [{ type: 'blocks', blocks: userInputBlocks(turnEvent) }] })
            await this.setStatus('is waiting for your answer…')
            break
          case 'completed':
            deliveryId = turnEvent.deliveryId
            await this.flushText(true)
            if (!this.streamTs) {
              await this.ensureStarted({ markdownText: turnEvent.text || 'Done.' })
            }
            await this.app.client.chat.stopStream({
              channel: this.event.externalChannelId,
              ts: this.streamTs!,
              blocks: [{
                type: 'context',
                elements: [{ type: 'mrkdwn', text: `Completed by Cradle · Run \`${turnEvent.runId}\`` }],
              }],
            })
            this.host.completeDelivery({
              deliveryId,
              result: {
                externalMessageId: this.streamTs,
                payload: { slack: { streamed: true, messageTs: this.streamTs } },
              },
            })
            deliveryId = null
            break
          case 'aborted':
            await this.flushText(true)
            if (this.streamTs) {
              await this.app.client.chat.stopStream({
                channel: this.event.externalChannelId,
                ts: this.streamTs,
                markdown_text: '\n\n_Run stopped._',
              })
            }
            break
          case 'failed':
            await this.flushText(true)
            if (this.streamTs) {
              await this.app.client.chat.stopStream({
                channel: this.event.externalChannelId,
                ts: this.streamTs,
                markdown_text: `\n\n:warning: ${turnEvent.message}`,
              })
            }
            else {
              await this.app.client.chat.postMessage({
                channel: this.event.externalChannelId,
                thread_ts: this.event.externalThreadId,
                text: `⚠️ Failed to process your message: ${turnEvent.message}`,
              })
            }
            break
          case 'ignored':
            break
        }
      }
    }
    catch (error) {
      if (deliveryId) {
        this.host.failDelivery({
          deliveryId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
    finally {
      await this.setStatus('')
    }
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
      signingSecret: connection.secrets.signingSecret?.trim() || undefined,
      logLevel: toBoltLogLevel(connection.config.logLevel),
    })
    const pendingUserInputs = new Map<string, ConversationBridgeTurnUserInputRequiredEvent>()
    const userNames = new Map<string, string>()
    const channels = new Map<string, { name: string | null, topic: string | null }>()

    const handleEnvelope = async (envelope: SlackEventEnvelope) => {
      const normalized = normalizeSlackMessageEvent({
        connectionId: connection.id,
        envelope,
        botUserId,
      })
      if (!normalized) {
        return
      }
      await enrichSlackMessageContext({
        app,
        message: normalized,
        userNames,
        channels,
        logger: this.ctx.logger,
      })
      try {
        await new SlackTurnStream(
          app,
          host,
          normalized,
          pendingUserInputs,
          this.ctx.logger,
        ).consume(host.startTurn(normalized))
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

    app.action(CONVERSATION_BRIDGE_TURN_ABORT_ACTION, async ({ body, ack, respond }) => {
      await ack()
      const runId = body.actions?.[0]?.value
      if (!runId) {
        await respond({ text: 'This Cradle run could not be identified.', response_type: 'ephemeral' })
        return
      }
      try {
        await host.abortTurn({ runId })
        await respond({ text: 'Stopping the Cradle run…', response_type: 'ephemeral' })
      }
      catch (error) {
        await respond(errorResponseToSlack(error))
      }
    })

    app.action(CONVERSATION_BRIDGE_TOOL_APPROVAL_ACTION, async ({ body, ack, respond }) => {
      await ack()
      const action = parseToolApprovalActionValue(body.actions?.[0]?.value)
      if (!action) {
        await respond({ text: 'This approval request is no longer valid.', response_type: 'ephemeral' })
        return
      }
      try {
        await host.submitInteraction({ type: 'tool_approval', ...action })
        await respond({
          text: action.approved ? 'Approved. Cradle is continuing the run.' : 'Denied. Cradle is continuing with that decision.',
          response_type: 'ephemeral',
        })
      }
      catch (error) {
        await respond(errorResponseToSlack(error))
      }
    })

    app.action(CONVERSATION_BRIDGE_USER_INPUT_ACTION, async ({ body, ack, respond }) => {
      await ack()
      const requestId = body.actions?.[0]?.value
      const request = requestId ? pendingUserInputs.get(requestId) : null
      if (!request || !body.trigger_id) {
        await respond({ text: 'This question is no longer waiting for an answer.', response_type: 'ephemeral' })
        return
      }
      try {
        await app.client.views.open({
          trigger_id: body.trigger_id,
          view: userInputModal(request),
        })
      }
      catch (error) {
        await respond(errorResponseToSlack(error))
      }
    })

    app.view(CRADLE_USER_INPUT_VIEW, async ({ body, ack }) => {
      const metadata = body.view?.private_metadata
        ? JSON.parse(body.view.private_metadata) as { sessionId: string, requestId: string }
        : null
      const request = metadata ? pendingUserInputs.get(metadata.requestId) : null
      if (!metadata || !request) {
        await ack({
          response_action: 'errors',
          errors: { question_0: 'This Cradle question is no longer active.' },
        })
        return
      }
      const answers = readUserInputAnswers(request, body.view?.state?.values)
      await ack()
      try {
        await host.submitInteraction({
          type: 'user_input',
          sessionId: metadata.sessionId,
          requestId: metadata.requestId,
          answers,
        })
        pendingUserInputs.delete(metadata.requestId)
      }
      catch (error) {
        this.ctx.logger.error('Slack user input submission failed', error)
      }
    })

    app.event('app_mention', async ({ body }) => handleEnvelope(body))
    app.event('message', async ({ body }) => handleEnvelope(body))

    const auth = await app.client.auth.test()
    botUserId = auth.user_id ?? null
    await app.start()
    this.connections.set(connection.id, { app, botUserId, pendingUserInputs })

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
