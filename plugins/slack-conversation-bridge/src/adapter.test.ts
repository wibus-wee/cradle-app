import type {
  ConversationBridgeHost,
  ConversationBridgeTurnEvent,
} from '@cradle/plugin-sdk/server'
import {
  CONVERSATION_BRIDGE_TOOL_APPROVAL_ACTION,
  CONVERSATION_BRIDGE_TURN_ABORT_ACTION,
  CONVERSATION_BRIDGE_USER_INPUT_ACTION,
} from '@cradle/plugin-sdk/server'
import { describe, expect, it, vi } from 'vitest'

import type { SlackAppFactory, SlackAppLike, SlackEventEnvelope } from './adapter'
import {
  normalizeSlackMessageEvent,
  SlackConversationBridgeRuntime,
} from './adapter'

function createHost(events: ConversationBridgeTurnEvent[]): ConversationBridgeHost {
  return {
    async* startTurn() {
      yield* events
    },
    abortTurn: vi.fn(async () => undefined),
    submitInteraction: vi.fn(async () => undefined),
    completeDelivery: vi.fn(),
    failDelivery: vi.fn(),
    handleControl: vi.fn(async () => ({
      text: 'Control response',
      visibility: 'ephemeral' as const,
    })),
    reportConnectionHealth: vi.fn(),
  }
}

function createFakeApp() {
  const posted: unknown[] = []
  const started: unknown[] = []
  const appended: unknown[] = []
  const stopped: unknown[] = []
  const statuses: unknown[] = []
  const openedViews: unknown[] = []
  const handlers: Record<string, (input: { body: SlackEventEnvelope }) => Promise<void>> = {}
  const commands: Record<string, Parameters<SlackAppLike['command']>[1]> = {}
  const actions: Record<string, Parameters<SlackAppLike['action']>[1]> = {}
  const views: Record<string, Parameters<SlackAppLike['view']>[1]> = {}
  const app: SlackAppLike = {
    client: {
      auth: {
        test: async () => ({ user_id: 'UBOT', team_id: 'T1' }),
      },
      users: {
        info: async () => ({ ok: true, user: { id: 'U1', name: 'wibus', real_name: 'Wibus' } }),
      },
      conversations: {
        info: async () => ({
          ok: true,
          channel: { id: 'C1', name: 'engineering', topic: { value: 'Build Cradle', creator: 'U1', last_set: 1 } },
        }),
      },
      chat: {
        postMessage: async (input) => {
          posted.push(input)
          return { ok: true, ts: `posted-${posted.length}` }
        },
        startStream: async (input) => {
          started.push(input)
          return { ok: true, ts: `stream-${started.length}` }
        },
        appendStream: async (input) => {
          appended.push(input)
          return { ok: true }
        },
        stopStream: async (input) => {
          stopped.push(input)
          return { ok: true }
        },
      },
      assistant: {
        threads: {
          setStatus: async (input) => {
            statuses.push(input)
            return {}
          },
        },
      },
      views: {
        open: async (input) => {
          openedViews.push(input)
          return { ok: true }
        },
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
    view: (callbackId, handler) => {
      views[callbackId] = handler
    },
    start: async () => undefined,
    stop: async () => undefined,
  }
  return { app, posted, started, appended, stopped, statuses, openedViews, handlers, commands, actions, views }
}

async function startRuntime(host: ConversationBridgeHost, fake = createFakeApp()) {
  const createApp: SlackAppFactory = () => fake.app
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
  return { runtime, fake }
}

function appMention(text = '<@UBOT> hello from Slack') {
  return {
    event_id: 'Ev1',
    team_id: 'T1',
    event: {
      type: 'app_mention',
      channel: 'C1',
      user: 'U1',
      text,
      ts: '171.001',
    },
  }
}

describe('slack conversation bridge adapter', () => {
  it('normalizes Slack app mentions into platform-neutral inbound messages', () => {
    expect(normalizeSlackMessageEvent({
      connectionId: 'connection-1',
      botUserId: 'UBOT',
      envelope: appMention(),
    })).toEqual(expect.objectContaining({
      connectionId: 'connection-1',
      externalWorkspaceId: 'T1',
      externalChannelId: 'C1',
      externalThreadId: '171.001',
      externalActorId: 'U1',
      text: 'hello from Slack',
      mentionedAdapter: true,
    }))
  })

  it('renders the Cradle turn as a Slack-native stream with tasks and delivery receipt', async () => {
    const host = createHost([
      { type: 'accepted', runId: 'run-1', sessionId: 'session-1', assistantMessageId: 'assistant-1' },
      { type: 'text_delta', delta: 'Hello ' },
      { type: 'tool_started', toolCallId: 'tool-1', title: 'Read file' },
      { type: 'tool_completed', toolCallId: 'tool-1', title: 'Read file', detail: 'package.json' },
      { type: 'text_delta', delta: 'world' },
      { type: 'completed', runId: 'run-1', assistantMessageId: 'assistant-1', deliveryId: 'delivery-1', text: 'Hello world' },
    ])
    const { fake } = await startRuntime(host)

    await fake.handlers.app_mention?.({ body: appMention() })

    expect(fake.started).toHaveLength(1)
    expect(fake.started[0]).toEqual(expect.objectContaining({
      channel: 'C1',
      thread_ts: '171.001',
      recipient_team_id: 'T1',
      recipient_user_id: 'U1',
      markdown_text: 'Hello ',
    }))
    expect(fake.appended).toEqual(expect.arrayContaining([
      expect.objectContaining({
        chunks: expect.arrayContaining([
          expect.objectContaining({ type: 'task_update', id: 'tool-1', status: 'in_progress' }),
        ]),
      }),
      expect.objectContaining({ markdown_text: 'world' }),
    ]))
    expect(fake.stopped).toHaveLength(1)
    expect(host.completeDelivery).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: 'delivery-1',
      result: expect.objectContaining({ externalMessageId: 'stream-1' }),
    }))
    expect(fake.statuses.at(-1)).toEqual(expect.objectContaining({ status: '' }))
  })

  it('connects Slack stop and tool approval actions to the Cradle runtime', async () => {
    const host = createHost([])
    const { fake } = await startRuntime(host)
    const ack = vi.fn(async () => undefined)
    const respond = vi.fn(async () => undefined)

    await fake.actions[CONVERSATION_BRIDGE_TURN_ABORT_ACTION]?.({
      body: { actions: [{ action_id: CONVERSATION_BRIDGE_TURN_ABORT_ACTION, value: 'run-1' }] },
      ack,
      respond,
    })
    expect(host.abortTurn).toHaveBeenCalledWith({ runId: 'run-1' })

    await fake.actions[CONVERSATION_BRIDGE_TOOL_APPROVAL_ACTION]?.({
      body: {
        actions: [{
          action_id: CONVERSATION_BRIDGE_TOOL_APPROVAL_ACTION,
          value: JSON.stringify({ sessionId: 'session-1', requestId: 'request-1', approved: true }),
        }],
      },
      ack,
      respond,
    })
    expect(host.submitInteraction).toHaveBeenCalledWith({
      type: 'tool_approval',
      sessionId: 'session-1',
      requestId: 'request-1',
      approved: true,
    })
    expect(ack).toHaveBeenCalledTimes(2)
  })

  it('collects Ask User answers in a Slack modal and submits them to Cradle', async () => {
    const host = createHost([
      { type: 'accepted', runId: 'run-1', sessionId: 'session-1', assistantMessageId: 'assistant-1' },
      {
        type: 'user_input_required',
        sessionId: 'session-1',
        requestId: 'request-1',
        title: 'Choose a target',
        questions: [{
          id: 'target',
          header: 'Target',
          question: 'Which target should Cradle use?',
          isOther: false,
          isSecret: false,
          multiSelect: false,
          options: [
            { label: 'Production', description: 'Use the production target' },
            { label: 'Staging', description: 'Use the staging target' },
          ],
        }],
      },
    ])
    const { fake } = await startRuntime(host)
    await fake.handlers.app_mention?.({ body: appMention() })

    const ack = vi.fn(async () => undefined)
    const respond = vi.fn(async () => undefined)
    await fake.actions[CONVERSATION_BRIDGE_USER_INPUT_ACTION]?.({
      body: {
        trigger_id: 'trigger-1',
        actions: [{ action_id: CONVERSATION_BRIDGE_USER_INPUT_ACTION, value: 'request-1' }],
      },
      ack,
      respond,
    })
    expect(fake.openedViews).toHaveLength(1)

    await fake.views.cradle_user_input_view?.({
      body: {
        view: {
          private_metadata: JSON.stringify({ sessionId: 'session-1', requestId: 'request-1' }),
          state: {
            values: {
              question_0: { answer: { selected_option: { value: '1' } } },
            },
          },
        },
      },
      ack,
    })
    expect(host.submitInteraction).toHaveBeenCalledWith({
      type: 'user_input',
      sessionId: 'session-1',
      requestId: 'request-1',
      answers: { target: ['Staging'] },
    })
  })

  it('posts a thread error when a turn fails before Slack streaming starts', async () => {
    const host = createHost([{ type: 'failed', runId: null, message: 'Session creation failed' }])
    const { fake } = await startRuntime(host)

    await fake.handlers.app_mention?.({ body: appMention() })

    expect(fake.posted).toEqual([
      expect.objectContaining({
        channel: 'C1',
        thread_ts: '171.001',
        text: '⚠️ Failed to process your message: Session creation failed',
      }),
    ])
  })
})
