import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { ConversationBridgeModel } from './model'
import {
  restartConversationBridgeConnection,
  startConversationBridgeConnection,
  stopConversationBridgeConnection,
} from './runtime-supervisor'
import * as ConversationBridge from './service'

function requireConnection<T>(connection: T | null, id: string): T {
  if (!connection) {
    throw new AppError({
      code: 'conversation_bridge_connection_not_found',
      status: 404,
      message: 'Conversation bridge connection not found',
      details: { id },
    })
  }
  return connection
}

export const conversationBridge = new Elysia({
  prefix: '/conversation-bridge',
  detail: { tags: ['conversation-bridge'] },
})
  .get(
    '/adapters',
    () => ConversationBridge.listAdapters(),
    {
      detail: { summary: 'List registered conversation bridge adapters' },
      response: { 200: t.Array(ConversationBridgeModel.adapter) },
    },
  )
  .get(
    '/connections',
    () => ConversationBridge.listConnections(),
    {
      detail: { summary: 'List conversation bridge connections' },
      response: { 200: t.Array(ConversationBridgeModel.connection) },
    },
  )
  .post(
    '/connections',
    async ({ body }) => {
      const connection = ConversationBridge.createConnection(body)
      if (connection.enabled) {
        await startConversationBridgeConnection(connection.id)
      }
      return requireConnection(ConversationBridge.getConnection(connection.id), connection.id)
    },
    {
      detail: { summary: 'Create a conversation bridge connection' },
      body: ConversationBridgeModel.createConnectionBody,
      response: { 200: ConversationBridgeModel.connection },
    },
  )
  .get(
    '/connections/:id',
    ({ params }) => requireConnection(ConversationBridge.getConnection(params.id), params.id),
    {
      detail: { summary: 'Get a conversation bridge connection' },
      params: ConversationBridgeModel.idParams,
      response: { 200: ConversationBridgeModel.connection },
    },
  )
  .patch(
    '/connections/:id',
    async ({ params, body }) => {
      const connection = requireConnection(ConversationBridge.updateConnection({
        id: params.id,
        ...body,
      }), params.id)
      if (connection.enabled) {
        await restartConversationBridgeConnection(connection.id)
      }
      else {
        await stopConversationBridgeConnection(connection.id)
      }
      return requireConnection(ConversationBridge.getConnection(connection.id), connection.id)
    },
    {
      detail: { summary: 'Update a conversation bridge connection' },
      params: ConversationBridgeModel.idParams,
      body: ConversationBridgeModel.updateConnectionBody,
      response: { 200: ConversationBridgeModel.connection },
    },
  )
  .delete(
    '/connections/:id',
    async ({ params }) => {
      await stopConversationBridgeConnection(params.id)
      ConversationBridge.deleteConnection(params.id)
      return { ok: true as const }
    },
    {
      detail: { summary: 'Delete a conversation bridge connection' },
      params: ConversationBridgeModel.idParams,
      response: { 200: ConversationBridgeModel.ok },
    },
  )
  .post(
    '/connections/:id/start',
    async ({ params }) => {
      await startConversationBridgeConnection(params.id)
      return requireConnection(ConversationBridge.getConnection(params.id), params.id)
    },
    {
      detail: { summary: 'Start a conversation bridge connection runtime' },
      params: ConversationBridgeModel.idParams,
      response: { 200: ConversationBridgeModel.connection },
    },
  )
  .post(
    '/connections/:id/stop',
    async ({ params }) => {
      await stopConversationBridgeConnection(params.id)
      return requireConnection(ConversationBridge.getConnection(params.id), params.id)
    },
    {
      detail: { summary: 'Stop a conversation bridge connection runtime' },
      params: ConversationBridgeModel.idParams,
      response: { 200: ConversationBridgeModel.connection },
    },
  )
  .get(
    '/connections/:id/channel-bindings',
    ({ params }) => ConversationBridge.listChannelBindings(params.id),
    {
      detail: { summary: 'List conversation bridge channel bindings for a connection' },
      params: ConversationBridgeModel.idParams,
      response: { 200: t.Array(ConversationBridgeModel.channelBinding) },
    },
  )
  .put(
    '/connections/:id/workspaces/:externalWorkspaceId/channels/:externalChannelId/binding',
    ({ params, body }) => ConversationBridge.bindChannel({
      connectionId: params.id,
      externalWorkspaceId: params.externalWorkspaceId,
      externalChannelId: params.externalChannelId,
      ...body,
    }),
    {
      detail: { summary: 'Create or update a conversation bridge channel binding' },
      params: ConversationBridgeModel.connectionChannelParams,
      body: ConversationBridgeModel.bindChannelBody,
      response: { 200: ConversationBridgeModel.channelBinding },
    },
  )
  .delete(
    '/connections/:id/workspaces/:externalWorkspaceId/channels/:externalChannelId/binding',
    ({ params }) => {
      ConversationBridge.unbindChannel(
        params.id,
        params.externalWorkspaceId,
        params.externalChannelId,
      )
      return { ok: true as const }
    },
    {
      detail: { summary: 'Remove a conversation bridge channel binding' },
      params: ConversationBridgeModel.connectionChannelParams,
      response: { 200: ConversationBridgeModel.ok },
    },
  )
  .get(
    '/connections/:id/threads',
    ({ params, query }) => ConversationBridge.listRecentThreadBindings(params.id, query.limit),
    {
      detail: { summary: 'List recent conversation bridge thread bindings for a connection' },
      params: ConversationBridgeModel.idParams,
      query: ConversationBridgeModel.limitQuery,
      response: { 200: t.Array(ConversationBridgeModel.threadBinding) },
    },
  )
  .get(
    '/delivery-attempts/retryable',
    ({ query }) => ConversationBridge.listRetryableDeliveryAttempts(query.limit),
    {
      detail: { summary: 'List retryable conversation bridge delivery attempts' },
      query: ConversationBridgeModel.limitQuery,
      response: { 200: t.Array(ConversationBridgeModel.deliveryAttempt) },
    },
  )
  .post(
    '/delivery-attempts/retry',
    ({ query }) => ConversationBridge.retryFailedDeliveries(query.limit),
    {
      detail: { summary: 'Retry failed conversation bridge delivery attempts' },
      query: ConversationBridgeModel.limitQuery,
      response: { 200: ConversationBridgeModel.retryResult },
    },
  )
