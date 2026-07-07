import type { ConversationBridgeConnection } from '@cradle/db'
import {
  conversationBridgeConnections,
  conversationBridgeConnectionSecrets,
} from '@cradle/db'
import type {
  ConversationBridgeAdapterRuntime,
  ConversationBridgeConnectionRuntimeConfig,
  ConversationBridgeDeliveryInput,
  ConversationBridgeDeliveryResult,
  ConversationBridgeHost,
} from '@cradle/plugin-sdk/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { parseJsonObjectOrEmpty } from '../../helpers/json-record'
import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { getConversationBridgeAdapter } from '../../plugins/conversation-adapter-registry'
import { readSecret } from '../secrets/service'

const SecretRefsSchema = z.record(z.string(), z.string().trim().min(1))

interface RunningConnection {
  connectionId: string
  adapterOwner: string
  adapterId: string
  runtime: ConversationBridgeAdapterRuntime
  abortController: AbortController
}

const runningConnections = new Map<string, RunningConnection>()
const logger = createChildLogger({ module: 'conversation-bridge-supervisor' })

function readSharedPluginConfig(): ReadonlyMap<string, string> {
  const sharedConfig = new Map<string, string>()
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CRADLE_PLUGIN_') && value !== undefined) {
      sharedConfig.set(key.replace('CRADLE_PLUGIN_', ''), value)
    }
  }
  return sharedConfig
}

function readConnectionRow(connectionId: string): ConversationBridgeConnection {
  const row = db()
    .select()
    .from(conversationBridgeConnections)
    .where(eq(conversationBridgeConnections.id, connectionId))
    .get()
  if (!row) {
    throw new AppError({
      code: 'conversation_bridge_connection_not_found',
      status: 404,
      message: 'Conversation bridge connection not found',
      details: { connectionId },
    })
  }
  return row
}

function readConnectionSecrets(connection: ConversationBridgeConnection): Record<string, string> {
  const secretRefs = SecretRefsSchema.parse(parseJsonObjectOrEmpty(connection.secretRefsJson))
  for (const row of db()
    .select()
    .from(conversationBridgeConnectionSecrets)
    .where(eq(conversationBridgeConnectionSecrets.connectionId, connection.id))
    .all()) {
    secretRefs[row.name] = row.secretRef
  }

  const secrets: Record<string, string> = {}
  for (const [name, secretRef] of Object.entries(secretRefs)) {
    secrets[name] = readSecret(secretRef)
  }
  return secrets
}

function toRuntimeConfig(connection: ConversationBridgeConnection): ConversationBridgeConnectionRuntimeConfig {
  return {
    id: connection.id,
    platform: connection.platform,
    displayName: connection.displayName,
    config: parseJsonObjectOrEmpty(connection.configJson),
    secrets: readConnectionSecrets(connection),
  }
}

function createHost(): ConversationBridgeHost {
  return {
    async handleInboundMessage(event) {
      const service = await import('./service')
      await service.handleInboundMessage(event)
    },
    async handleControl(input) {
      const service = await import('./service')
      return await service.handleControl(input)
    },
    reportConnectionHealth(input) {
      void import('./service')
        .then(service => service.updateConnectionHealth(input))
        .catch((error) => {
          logger.error('failed to record conversation bridge health', {
            connectionId: input.connectionId,
            err: error,
          })
        })
    },
  }
}

function createRuntimeLogger(connection: ConversationBridgeConnection) {
  const child = createChildLogger({
    module: 'conversation-bridge-adapter',
    owner: connection.adapterOwner,
    adapter: connection.adapterId,
    connectionId: connection.id,
  })
  return {
    info: (message: string, ...args: unknown[]) => child.info(message, { args }),
    warn: (message: string, ...args: unknown[]) => child.warn(message, { args }),
    error: (message: string, ...args: unknown[]) => child.error(message, { args }),
    debug: (message: string, ...args: unknown[]) => child.debug(message, { args }),
  }
}

export async function startConversationBridgeConnection(connectionId: string): Promise<void> {
  if (runningConnections.has(connectionId)) {
    return
  }

  const connection = readConnectionRow(connectionId)
  if (!connection.enabled) {
    throw new AppError({
      code: 'conversation_bridge_connection_disabled',
      status: 409,
      message: 'Conversation bridge connection is disabled',
      details: { connectionId },
    })
  }

  const registered = getConversationBridgeAdapter(connection.adapterOwner, connection.adapterId)
  if (!registered) {
    throw new AppError({
      code: 'conversation_bridge_adapter_not_registered',
      status: 409,
      message: 'Conversation bridge adapter is not registered',
      details: {
        connectionId,
        adapterOwner: connection.adapterOwner,
        adapterId: connection.adapterId,
      },
    })
  }

  const abortController = new AbortController()
  const runtime = registered.adapter.createRuntime({
    logger: createRuntimeLogger(connection),
    sharedConfig: readSharedPluginConfig(),
    signal: abortController.signal,
  })

  const running: RunningConnection = {
    connectionId,
    adapterOwner: connection.adapterOwner,
    adapterId: connection.adapterId,
    runtime,
    abortController,
  }
  runningConnections.set(connectionId, running)

  try {
    const service = await import('./service')
    service.updateConnectionHealth({
      connectionId,
      status: 'starting',
      message: null,
    })
    await runtime.start(toRuntimeConfig(connection), createHost())
    service.updateConnectionHealth({
      connectionId,
      status: 'running',
      message: null,
    })
    void service.retryFailedDeliveries().catch((error) => {
      logger.warn('conversation bridge delivery retry failed on connection start', {
        connectionId,
        err: error,
      })
    })
  }
  catch (error) {
    runningConnections.delete(connectionId)
    abortController.abort()
    const message = error instanceof Error ? error.message : String(error)
    const service = await import('./service')
    service.updateConnectionHealth({
      connectionId,
      status: 'error',
      message,
    })
    throw error
  }
}

export async function restartConversationBridgeConnection(connectionId: string): Promise<void> {
  await stopConversationBridgeConnection(connectionId)
  await startConversationBridgeConnection(connectionId)
}

export async function stopConversationBridgeConnection(connectionId: string): Promise<void> {
  const running = runningConnections.get(connectionId)
  if (!running) {
    return
  }
  runningConnections.delete(connectionId)
  running.abortController.abort()
  await running.runtime.stop(connectionId)
  const service = await import('./service')
  service.updateConnectionHealth({
    connectionId,
    status: 'stopped',
    message: null,
  })
}

export async function stopConversationBridgeConnectionsForOwner(owner: string): Promise<void> {
  const connectionIds = [...runningConnections.values()]
    .filter(connection => connection.adapterOwner === owner)
    .map(connection => connection.connectionId)
  for (const connectionId of connectionIds) {
    await stopConversationBridgeConnection(connectionId)
  }
}

export async function stopAllConversationBridgeConnections(): Promise<void> {
  const connectionIds = [...runningConnections.keys()]
  for (const connectionId of connectionIds) {
    await stopConversationBridgeConnection(connectionId)
  }
}

export async function startEnabledConversationBridgeConnections(): Promise<void> {
  const rows = db()
    .select()
    .from(conversationBridgeConnections)
    .where(eq(conversationBridgeConnections.enabled, true))
    .all()
  for (const row of rows) {
    try {
      await startConversationBridgeConnection(row.id)
    }
    catch (error) {
      logger.warn('conversation bridge connection failed to start', {
        connectionId: row.id,
        err: error,
      })
    }
  }
}

export async function deliverBridgeMessage(
  input: ConversationBridgeDeliveryInput,
): Promise<ConversationBridgeDeliveryResult> {
  if (!runningConnections.has(input.connectionId)) {
    await startConversationBridgeConnection(input.connectionId)
  }
  const running = runningConnections.get(input.connectionId)
  if (!running) {
    throw new AppError({
      code: 'conversation_bridge_connection_not_running',
      status: 409,
      message: 'Conversation bridge connection is not running',
      details: { connectionId: input.connectionId },
    })
  }
  return running.runtime.sendMessage(input)
}

export function listRunningConversationBridgeConnectionIds(): string[] {
  return [...runningConnections.keys()]
}
