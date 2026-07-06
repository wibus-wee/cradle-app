import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  conversationBridgeChannelBindings,
  conversationBridgeDeliveryAttempts,
  conversationBridgeInboundEvents,
  conversationBridgeThreadBindings,
  messages,
  providerTargetModelCache,
  providerTargets,
  sessions,
  workspaces,
} from '@cradle/db'
import type { ConversationBridgeDeliveryInput } from '@cradle/plugin-sdk/server'
import {
  CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION,
} from '@cradle/plugin-sdk/server'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import {
  registerConversationBridgeAdapter,
  resetConversationBridgeAdapterRegistry,
} from '../../plugins/conversation-adapter-registry'
import { resetPluginRuntimeRegistry } from '../../plugins/runtime-registry'
import { localWorkspaceLocator, serializeWorkspaceLocator } from '../workspace/workspace-locator'
import { stopAllConversationBridgeConnections } from './runtime-supervisor'
import * as ConversationBridge from './service'

const chatRuntimeMock = vi.hoisted(() => ({
  streamResponse: vi.fn(),
  waitForRunCompletion: vi.fn(),
}))

vi.mock('../chat-runtime/runtime', () => chatRuntimeMock)

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir: string
let deliveredMessages: ConversationBridgeDeliveryInput[]

function makeInboundEvent(
  overrides: Partial<Parameters<typeof ConversationBridge.handleInboundMessage>[0]> = {},
) {
  return {
    connectionId: 'connection-1',
    externalEventId: 'event-1',
    externalWorkspaceId: 'external-workspace-1',
    externalChannelId: 'external-channel-1',
    externalThreadId: 'external-thread-1',
    externalMessageId: 'external-message-1',
    externalActorId: 'external-user-1',
    text: 'hello bridge',
    mentionedAdapter: true,
    eventType: 'message',
    payload: { source: 'test' },
    ...overrides,
  }
}

function seedCradleRuntimeTarget(): void {
  const timestamp = Math.floor(Date.now() / 1000)
  db()
    .insert(workspaces)
    .values({
      id: 'workspace-1',
      name: 'Workspace 1',
      locatorJson: serializeWorkspaceLocator(localWorkspaceLocator(dataDir)),
      gitIdentityJson: '{}',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run()
  db()
    .insert(providerTargets)
    .values({
      id: 'target-1',
      kind: 'manual',
      providerKind: 'openai-compatible',
      displayName: 'Target 1',
      enabled: true,
      connectionConfigJson: '{}',
      enabledModelsJson: '[]',
      customModelsJson: '[]',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run()
}

function seedProviderModelCache(): void {
  db()
    .insert(providerTargetModelCache)
    .values({
      providerTargetId: 'target-1',
      modelsJson: JSON.stringify([
        {
          id: 'gpt-5',
          label: 'GPT-5',
          providerKind: 'openai-compatible',
          capabilities: {},
        },
      ]),
      fetchedAt: Math.floor(Date.now() / 1000),
    })
    .run()
}

function registerFakeAdapter(): void {
  registerConversationBridgeAdapter('@cradle/test-conversation-adapter', {
    id: 'fake',
    platform: 'test',
    label: 'Fake Conversation Adapter',
    createRuntime: () => ({
      async start() {},
      async stop() {},
      async sendMessage(input) {
        deliveredMessages.push(input)
        return { externalMessageId: `delivered-${deliveredMessages.length}` }
      },
    }),
  })
}

describe('conversation bridge service', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-conversation-bridge-'))
    process.env.CRADLE_DATA_DIR = dataDir
    deliveredMessages = []
    registerFakeAdapter()
    chatRuntimeMock.streamResponse.mockImplementation(
      async ({ sessionId }: { sessionId: string }) => {
        const timestamp = Math.floor(Date.now() / 1000)
        db()
          .insert(messages)
          .values({
            id: 'assistant-message-1',
            sessionId,
            role: 'assistant',
            status: 'complete',
            content: 'Bridge response',
            messageJson: JSON.stringify({
              id: 'assistant-message-1',
              role: 'assistant',
              parts: [{ type: 'text', text: 'Bridge response' }],
            }),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .run()
        return {
          runId: 'run-1',
          assistantMessageId: 'assistant-message-1',
          userMessageId: 'user-message-1',
          stream: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close()
            },
          }),
        }
      },
    )
    chatRuntimeMock.waitForRunCompletion.mockResolvedValue({
      id: 'run-1',
      status: 'completed',
    })
  })

  afterEach(async () => {
    await stopAllConversationBridgeConnections()
    resetConversationBridgeAdapterRegistry()
    resetPluginRuntimeRegistry()
    vi.clearAllMocks()
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    if (previousDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
 else {
      process.env.CRADLE_DATA_DIR = previousDataDir
    }
  })

  it('records an unbound mentioned channel event as ignored', async () => {
    const connection = ConversationBridge.createConnection({
      platform: 'test',
      adapterOwner: '@cradle/test-conversation-adapter',
      adapterId: 'fake',
      displayName: 'Fake',
      enabled: true,
    })

    await ConversationBridge.handleInboundMessage(makeInboundEvent({ connectionId: connection.id }))

    const event = db()
      .select()
      .from(conversationBridgeInboundEvents)
      .where(eq(conversationBridgeInboundEvents.externalEventId, 'event-1'))
      .get()
    expect(event).toEqual(
      expect.objectContaining({
        status: 'ignored',
        reason: 'external channel is not bound to a Cradle workspace',
      }),
    )
    expect(db().select().from(conversationBridgeThreadBindings).all()).toHaveLength(0)
    expect(deliveredMessages).toHaveLength(0)
  })

  it('handles integrated slash controls for bind, status, runtime selection, model selection, and unbind', async () => {
    seedCradleRuntimeTarget()
    seedProviderModelCache()
    const connection = ConversationBridge.createConnection({
      platform: 'test',
      adapterOwner: '@cradle/test-conversation-adapter',
      adapterId: 'fake',
      displayName: 'Fake',
      enabled: true,
    })

    const workspaceSelectResponse = await ConversationBridge.handleControl({
      connectionId: connection.id,
      externalWorkspaceId: 'external-workspace-1',
      externalChannelId: 'external-channel-1',
      externalActorId: 'external-user-1',
      kind: 'command',
      command: '/cradle',
      text: 'bind workspace',
    })

    expect(workspaceSelectResponse).toMatchObject({
      visibility: 'ephemeral',
      text: expect.stringContaining('Choose a Cradle workspace'),
    })
    expect(workspaceSelectResponse.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'actions',
          elements: expect.arrayContaining([
            expect.objectContaining({
              type: 'static_select',
              actionId: CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION,
              options: expect.arrayContaining([
                expect.objectContaining({
                  label: 'Workspace 1',
                  value: 'workspace-1',
                }),
              ]),
            }),
          ]),
        }),
      ]),
    )
    expect(db().select().from(conversationBridgeChannelBindings).all()).toHaveLength(0)

    const bindResponse = await ConversationBridge.handleControl({
      connectionId: connection.id,
      externalWorkspaceId: 'external-workspace-1',
      externalChannelId: 'external-channel-1',
      externalActorId: 'external-user-1',
      kind: 'action',
      actionId: CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION,
      selectedValue: 'workspace-1',
    })

    expect(bindResponse).toMatchObject({
      visibility: 'ephemeral',
      replaceOriginal: true,
      text: expect.stringContaining('workspace-1'),
    })
    expect(db().select().from(conversationBridgeChannelBindings).all()).toEqual([
      expect.objectContaining({
        connectionId: connection.id,
        externalWorkspaceId: 'external-workspace-1',
        externalChannelId: 'external-channel-1',
        cradleWorkspaceId: 'workspace-1',
        boundByExternalActorId: 'external-user-1',
        sessionProviderTargetId: null,
      }),
    ])

    const runtimeResponse = await ConversationBridge.handleControl({
      connectionId: connection.id,
      externalWorkspaceId: 'external-workspace-1',
      externalChannelId: 'external-channel-1',
      externalActorId: 'external-user-1',
      kind: 'action',
      actionId: 'cradle_session_target_select',
      selectedValue: 'provider-target:standard:target-1',
    })

    expect(runtimeResponse).toMatchObject({
      visibility: 'ephemeral',
      replaceOriginal: true,
      text: expect.stringContaining('workspace-1'),
    })
    expect(db().select().from(conversationBridgeChannelBindings).all()).toEqual([
      expect.objectContaining({
        sessionAgentId: null,
        sessionProviderTargetId: 'target-1',
        sessionRuntimeKind: 'standard',
        sessionModelId: null,
      }),
    ])

    const modelResponse = await ConversationBridge.handleControl({
      connectionId: connection.id,
      externalWorkspaceId: 'external-workspace-1',
      externalChannelId: 'external-channel-1',
      externalActorId: 'external-user-1',
      kind: 'action',
      actionId: 'cradle_session_model_select',
      selectedValue: 'gpt-5',
    })
    expect(modelResponse.text).toContain('GPT-5')
    expect(db().select().from(conversationBridgeChannelBindings).all()).toEqual([
      expect.objectContaining({
        sessionProviderTargetId: 'target-1',
        sessionRuntimeKind: 'standard',
        sessionModelId: 'gpt-5',
      }),
    ])

    const statusResponse = await ConversationBridge.handleControl({
      connectionId: connection.id,
      externalWorkspaceId: 'external-workspace-1',
      externalChannelId: 'external-channel-1',
      externalActorId: 'external-user-1',
      kind: 'command',
      command: '/cradle',
      text: 'status',
    })
    expect(statusResponse).toMatchObject({
      visibility: 'ephemeral',
      text: expect.stringContaining('workspace-1'),
    })
    expect(statusResponse.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'header' }),
        expect.objectContaining({ type: 'actions' }),
      ]),
    )

    const unbindResponse = await ConversationBridge.handleControl({
      connectionId: connection.id,
      externalWorkspaceId: 'external-workspace-1',
      externalChannelId: 'external-channel-1',
      externalActorId: 'external-user-1',
      kind: 'command',
      command: '/cradle',
      text: 'unbind',
    })
    expect(unbindResponse).toMatchObject({
      visibility: 'in_channel',
      text: 'Removed the Cradle workspace binding for this channel.',
    })
    expect(db().select().from(conversationBridgeChannelBindings).all()).toHaveLength(0)
  })

  it('creates one session/thread binding for a bound channel and ignores duplicate events', async () => {
    seedCradleRuntimeTarget()
    const connection = ConversationBridge.createConnection({
      platform: 'test',
      adapterOwner: '@cradle/test-conversation-adapter',
      adapterId: 'fake',
      displayName: 'Fake',
      enabled: true,
    })
    ConversationBridge.bindChannel({
      connectionId: connection.id,
      externalWorkspaceId: 'external-workspace-1',
      externalChannelId: 'external-channel-1',
      cradleWorkspaceId: 'workspace-1',
      sessionProviderTargetId: 'target-1',
      sessionRuntimeKind: 'standard',
    })
    const inboundEvent = makeInboundEvent({ connectionId: connection.id })

    await ConversationBridge.handleInboundMessage(inboundEvent)
    await ConversationBridge.handleInboundMessage(inboundEvent)

    expect(db().select().from(sessions).all()).toEqual([
      expect.objectContaining({
        origin: 'conversation-bridge',
        workspaceId: 'workspace-1',
        providerTargetId: 'target-1',
      }),
    ])
    expect(db().select().from(conversationBridgeThreadBindings).all()).toEqual([
      expect.objectContaining({
        connectionId: connection.id,
        externalThreadId: 'external-thread-1',
      }),
    ])
    expect(db().select().from(conversationBridgeInboundEvents).all()).toHaveLength(1)
    expect(db().select().from(conversationBridgeDeliveryAttempts).all()).toEqual([
      expect.objectContaining({
        status: 'delivered',
        externalMessageId: 'delivered-1',
      }),
    ])
    expect(deliveredMessages).toEqual([
      expect.objectContaining({
        connectionId: connection.id,
        externalThreadId: 'external-thread-1',
        text: 'Bridge response',
      }),
    ])
    expect(chatRuntimeMock.streamResponse).toHaveBeenCalledTimes(1)
    expect(chatRuntimeMock.streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('hello bridge'),
      }),
    )
    expect(chatRuntimeMock.streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('External channel: external-channel-1'),
      }),
    )
  })
})
