import type { ConversationBridgeHost } from '@cradle/plugin-sdk/server'
import {
  CONVERSATION_BRIDGE_SESSION_TARGET_SELECT_ACTION,
  CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION,
} from '@cradle/plugin-sdk/server'
import { describe, expect, it, vi } from 'vitest'

import type { SlackAppFactory, SlackAppLike } from './adapter'
import {
  normalizeSlackMessageEvent,
  SlackConversationBridgeRuntime,
} from './adapter'

function createFakeApp(): {
  app: SlackAppLike
  posted: Array<{ channel: string, thread_ts: string, text: string, blocks?: unknown[] }>
  handlers: Record<string, (input: { body: any }) => Promise<void>>
  commands: Record<string, Parameters<SlackAppLike['command']>[1]>
  actions: Record<string, Parameters<SlackAppLike['action']>[1]>
} {
  const posted: Array<{ channel: string, thread_ts: string, text: string, blocks?: unknown[] }> = []
  const handlers: Record<string, (input: { body: any }) => Promise<void>> = {}
  const commands: Record<string, Parameters<SlackAppLike['command']>[1]> = {}
  const actions: Record<string, Parameters<SlackAppLike['action']>[1]> = {}
  const app: SlackAppLike = {
    client: {
      auth: {
        test: async () => ({ user_id: 'UBOT', team_id: 'T1' }),
      },
      chat: {
        postMessage: async (input) => {
          posted.push(input)
          return { ts: `posted-${posted.length}` }
        },
      },
      reactions: {
        add: async () => undefined,
      },
    },
    event: (name, handler) => {
      handlers[name] = handler
    },
    command: (name, handler) => {
      commands[name] = handler
    },
    action: (actionId, handler) => {
      actions[actionId] = handler
    },
    start: async () => undefined,
    stop: async () => undefined,
  }
  return { app, posted, handlers, commands, actions }
}

describe('slack conversation bridge adapter', () => {
  it('normalizes Slack app mentions into platform-neutral inbound messages', () => {
    const normalized = normalizeSlackMessageEvent({
      connectionId: 'connection-1',
      botUserId: 'UBOT',
      envelope: {
        event_id: 'Ev1',
        team_id: 'T1',
        event: {
          type: 'app_mention',
          channel: 'C1',
          user: 'U1',
          text: '<@UBOT> hello from Slack',
          ts: '171.001',
        },
      },
    })

    expect(normalized).toEqual({
      connectionId: 'connection-1',
      externalEventId: 'T1:C1:171.001',
      externalWorkspaceId: 'T1',
      externalChannelId: 'C1',
      externalThreadId: '171.001',
      externalMessageId: '171.001',
      externalActorId: 'U1',
      text: 'hello from Slack',
      mentionedAdapter: true,
      eventType: 'app_mention',
      payload: {
        slack: {
          teamId: 'T1',
          channelId: 'C1',
          messageTs: '171.001',
          threadTs: '171.001',
          eventType: 'app_mention',
          subtype: null,
        },
      },
    })
  })

  it('starts a fake Slack app and delivers messages through chat.postMessage', async () => {
    const fake = createFakeApp()
    const createApp: SlackAppFactory = (input) => {
      expect(input.logLevel).toBe('debug')
      return fake.app
    }
    const inbound = vi.fn()
    const control = vi.fn(async () => ({
      text: 'Control response',
      visibility: 'ephemeral' as const,
      blocks: [{
        type: 'section' as const,
        text: 'Choose a runtime',
      }, {
        type: 'actions' as const,
        elements: [{
          type: 'static_select' as const,
          actionId: CONVERSATION_BRIDGE_SESSION_TARGET_SELECT_ACTION,
          placeholder: 'Choose Cradle runtime',
          options: [{
            label: 'Standard: OpenAI',
            description: 'openai-compatible',
            value: 'provider-target:standard:target-1',
          }],
        }],
      }],
    }))
    const health = vi.fn()
    const host: ConversationBridgeHost = {
      handleInboundMessage: inbound,
      handleControl: control,
      reportConnectionHealth: health,
    }
    const runtime = new SlackConversationBridgeRuntime({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      sharedConfig: new Map(),
      signal: new AbortController().signal,
    }, createApp)

    await runtime.start({
      id: 'connection-1',
      platform: 'slack',
      displayName: 'Test Slack',
      config: { logLevel: 'debug' },
      secrets: {
        botToken: 'xoxb-token',
        appToken: 'xapp-token',
        signingSecret: 'signing-secret',
      },
    }, host)

    await fake.handlers.app_mention?.({
      body: {
        event_id: 'Ev2',
        team_id: 'T1',
        event: {
          type: 'app_mention',
          channel: 'C1',
          user: 'U1',
          text: '<@UBOT> continue this',
          ts: '171.002',
          thread_ts: '171.001',
        },
      },
    })

    expect(inbound).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'connection-1',
      externalWorkspaceId: 'T1',
      externalChannelId: 'C1',
      externalThreadId: '171.001',
      text: 'continue this',
    }))

    const delivered = await runtime.sendMessage({
      connectionId: 'connection-1',
      externalWorkspaceId: 'T1',
      externalChannelId: 'C1',
      externalThreadId: '171.001',
      text: 'Assistant **response**',
    })

    expect(fake.posted).toHaveLength(1)
    expect(fake.posted[0]).toEqual(expect.objectContaining({
      channel: 'C1',
      thread_ts: '171.001',
      text: expect.stringContaining('Assistant'),
    }))
    expect(delivered.externalMessageId).toBe('posted-1')
    expect(health).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'connection-1',
      status: 'running',
    }))
  })

  it('acks Slack slash commands and actions before responding with host control output', async () => {
    const fake = createFakeApp()
    const createApp: SlackAppFactory = () => fake.app
    const control = vi.fn(async () => ({
      text: 'Bound this external channel',
      visibility: 'in_channel' as const,
      blocks: [{
        type: 'section' as const,
        text: 'Bound.',
      }],
    }))
    const host: ConversationBridgeHost = {
      handleInboundMessage: vi.fn(),
      handleControl: control,
      reportConnectionHealth: vi.fn(),
    }
    const runtime = new SlackConversationBridgeRuntime({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      sharedConfig: new Map(),
      signal: new AbortController().signal,
    }, createApp)

    await runtime.start({
      id: 'connection-1',
      platform: 'slack',
      displayName: 'Test Slack',
      config: {},
      secrets: {
        botToken: 'xoxb-token',
        appToken: 'xapp-token',
        signingSecret: 'signing-secret',
      },
    }, host)

    const ack = vi.fn(async () => undefined)
    const responses: unknown[] = []
    const respond = vi.fn(async (message) => {
      responses.push(message)
    })

    await fake.commands['/cradle']?.({
      command: {
        team_id: 'T1',
        channel_id: 'C1',
        user_id: 'U1',
        command: '/cradle',
        text: 'bind workspace workspace-1',
      },
      ack,
      respond,
    })

    expect(ack).toHaveBeenCalledTimes(1)
    expect(control).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'connection-1',
      externalWorkspaceId: 'T1',
      externalChannelId: 'C1',
      externalActorId: 'U1',
      kind: 'command',
      text: 'bind workspace workspace-1',
    }))
    expect(responses.at(-1)).toEqual(expect.objectContaining({
      text: 'Bound this external channel',
      response_type: 'in_channel',
      blocks: expect.arrayContaining([
        expect.objectContaining({ type: 'section' }),
      ]),
    }))

    await fake.actions[CONVERSATION_BRIDGE_SESSION_TARGET_SELECT_ACTION]?.({
      body: {
        team: { id: 'T1' },
        channel: { id: 'C1' },
        user: { id: 'U1' },
        actions: [{
          action_id: CONVERSATION_BRIDGE_SESSION_TARGET_SELECT_ACTION,
          selected_option: { value: 'provider-target:standard:target-1' },
        }],
      },
      ack,
      respond,
    })

    expect(ack).toHaveBeenCalledTimes(2)
    expect(control).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'action',
      actionId: CONVERSATION_BRIDGE_SESSION_TARGET_SELECT_ACTION,
      selectedValue: 'provider-target:standard:target-1',
    }))

    await fake.actions[CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION]?.({
      body: {
        team: { id: 'T1' },
        channel: { id: 'C1' },
        user: { id: 'U1' },
        actions: [{
          action_id: CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION,
          selected_option: { value: 'workspace-1' },
        }],
      },
      ack,
      respond,
    })

    expect(ack).toHaveBeenCalledTimes(3)
    expect(control).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'action',
      actionId: CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION,
      selectedValue: 'workspace-1',
    }))
  })

  it('posts an error message to Slack when handleInboundMessage throws', async () => {
    const fake = createFakeApp()
    const createApp: SlackAppFactory = () => fake.app
    const errorLogger = vi.fn()
    const host: ConversationBridgeHost = {
      handleInboundMessage: vi.fn(async () => {
        throw new Error('Session creation failed')
      }),
      handleControl: vi.fn(),
      reportConnectionHealth: vi.fn(),
    }
    const runtime = new SlackConversationBridgeRuntime({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: errorLogger,
        debug: vi.fn(),
      },
      sharedConfig: new Map(),
      signal: new AbortController().signal,
    }, createApp)

    await runtime.start({
      id: 'connection-1',
      platform: 'slack',
      displayName: 'Test Slack',
      config: {},
      secrets: {
        botToken: 'xoxb-token',
        appToken: 'xapp-token',
        signingSecret: 'signing-secret',
      },
    }, host)

    await fake.handlers.app_mention?.({
      body: {
        event_id: 'Ev3',
        team_id: 'T1',
        event: {
          type: 'app_mention',
          channel: 'C1',
          user: 'U1',
          text: '<@UBOT> do something',
          ts: '171.003',
          thread_ts: '171.001',
        },
      },
    })

    // Error should be logged
    expect(errorLogger).toHaveBeenCalledWith(
      'Slack conversation bridge inbound processing failed',
      expect.objectContaining({ message: 'Session creation failed' }),
    )

    // Error message should be posted to the Slack thread
    expect(fake.posted).toHaveLength(1)
    expect(fake.posted[0]).toEqual(expect.objectContaining({
      channel: 'C1',
      thread_ts: '171.001',
      text: '⚠️ Failed to process your message: Session creation failed',
    }))
  })
})
