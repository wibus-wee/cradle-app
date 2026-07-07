import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
import { agentCredentials, agents } from './identity'
import { providerTargets } from './provider-target'
import { textPk, timestamps, workspaces } from './shared'

export const conversationBridgeConnections = sqliteTable('conversation_bridge_connections', {
  id: textPk(),
  platform: text('platform').notNull(),
  adapterOwner: text('adapter_owner').notNull(),
  adapterId: text('adapter_id').notNull(),
  displayName: text('display_name').notNull(),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  secretRefsJson: text('secret_refs_json').notNull().default('{}'),
  configJson: text('config_json').notNull().default('{}'),
  healthStatus: text('health_status', {
    enum: ['unknown', 'starting', 'running', 'stopped', 'error'],
  }).notNull().default('unknown'),
  healthMessage: text('health_message'),
  lastStartedAt: int('last_started_at'),
  lastStoppedAt: int('last_stopped_at'),
  lastErrorAt: int('last_error_at'),
  ...timestamps(),
}, table => ({
  byPlatform: index('conversation_bridge_connections_platform_idx').on(table.platform),
  byAdapter: index('conversation_bridge_connections_adapter_idx').on(table.adapterOwner, table.adapterId),
  byEnabled: index('conversation_bridge_connections_enabled_idx').on(table.enabled),
}))

export const conversationBridgeChannelBindings = sqliteTable('conversation_bridge_channel_bindings', {
  id: textPk(),
  connectionId: text('connection_id').notNull().references(() => conversationBridgeConnections.id, { onDelete: 'cascade' }),
  externalWorkspaceId: text('external_workspace_id').notNull(),
  externalChannelId: text('external_channel_id').notNull(),
  cradleWorkspaceId: text('cradle_workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  sessionAgentId: text('session_agent_id')
    .references(() => agents.id, { onDelete: 'set null' }),
  sessionProviderTargetId: text('session_provider_target_id')
    .references(() => providerTargets.id, { onDelete: 'set null' }),
  sessionRuntimeKind: text('session_runtime_kind'),
  sessionModelId: text('session_model_id'),
  boundByExternalActorId: text('bound_by_external_actor_id'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byConnectionChannel: uniqueIndex('conversation_bridge_channel_bindings_connection_channel_unique')
    .on(table.connectionId, table.externalWorkspaceId, table.externalChannelId),
  byWorkspace: index('conversation_bridge_channel_bindings_workspace_idx').on(table.cradleWorkspaceId),
}))

export const conversationBridgeThreadBindings = sqliteTable('conversation_bridge_thread_bindings', {
  id: textPk(),
  connectionId: text('connection_id').notNull().references(() => conversationBridgeConnections.id, { onDelete: 'cascade' }),
  externalWorkspaceId: text('external_workspace_id').notNull(),
  externalChannelId: text('external_channel_id').notNull(),
  externalThreadId: text('external_thread_id').notNull(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  cradleWorkspaceId: text('cradle_workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  createdByExternalActorId: text('created_by_external_actor_id'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byConnectionThread: uniqueIndex('conversation_bridge_thread_bindings_connection_thread_unique')
    .on(table.connectionId, table.externalWorkspaceId, table.externalChannelId, table.externalThreadId),
  bySession: index('conversation_bridge_thread_bindings_session_idx').on(table.sessionId),
  byChannel: index('conversation_bridge_thread_bindings_channel_idx')
    .on(table.connectionId, table.externalWorkspaceId, table.externalChannelId),
}))

export const conversationBridgeInboundEvents = sqliteTable('conversation_bridge_inbound_events', {
  id: textPk(),
  connectionId: text('connection_id').notNull().references(() => conversationBridgeConnections.id, { onDelete: 'cascade' }),
  externalEventId: text('external_event_id').notNull(),
  externalWorkspaceId: text('external_workspace_id'),
  externalChannelId: text('external_channel_id'),
  externalThreadId: text('external_thread_id'),
  externalMessageId: text('external_message_id'),
  eventType: text('event_type').notNull(),
  status: text('status', {
    enum: ['received', 'processed', 'ignored', 'failed'],
  }).notNull().default('received'),
  reason: text('reason'),
  payloadJson: text('payload_json').notNull().default('{}'),
  receivedAt: int('received_at').notNull(),
  processedAt: int('processed_at'),
}, table => ({
  byConnectionEvent: uniqueIndex('conversation_bridge_inbound_events_connection_event_unique')
    .on(table.connectionId, table.externalEventId),
  byStatus: index('conversation_bridge_inbound_events_status_idx').on(table.status),
  byThread: index('conversation_bridge_inbound_events_thread_idx')
    .on(table.connectionId, table.externalWorkspaceId, table.externalChannelId, table.externalThreadId),
}))

export const conversationBridgeDeliveryAttempts = sqliteTable('conversation_bridge_delivery_attempts', {
  id: textPk(),
  connectionId: text('connection_id').notNull().references(() => conversationBridgeConnections.id, { onDelete: 'cascade' }),
  externalWorkspaceId: text('external_workspace_id').notNull(),
  externalChannelId: text('external_channel_id').notNull(),
  externalThreadId: text('external_thread_id').notNull(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  cradleMessageId: text('cradle_message_id'),
  runId: text('run_id'),
  payloadJson: text('payload_json').notNull().default('{}'),
  status: text('status', {
    enum: ['pending', 'delivered', 'failed'],
  }).notNull().default('pending'),
  attemptCount: int('attempt_count').notNull().default(0),
  externalMessageId: text('external_message_id'),
  errorText: text('error_text'),
  ...timestamps(),
}, table => ({
  byStatus: index('conversation_bridge_delivery_attempts_status_idx').on(table.status),
  byThread: index('conversation_bridge_delivery_attempts_thread_idx')
    .on(table.connectionId, table.externalWorkspaceId, table.externalChannelId, table.externalThreadId),
  bySession: index('conversation_bridge_delivery_attempts_session_idx').on(table.sessionId),
}))

export const conversationBridgeConnectionSecrets = sqliteTable('conversation_bridge_connection_secrets', {
  id: textPk(),
  connectionId: text('connection_id').notNull().references(() => conversationBridgeConnections.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  secretRef: text('secret_ref').notNull().references(() => agentCredentials.id, { onDelete: 'restrict' }),
  ...timestamps(),
}, table => ({
  byConnectionName: uniqueIndex('conversation_bridge_connection_secrets_connection_name_unique')
    .on(table.connectionId, table.name),
  bySecret: index('conversation_bridge_connection_secrets_secret_idx').on(table.secretRef),
}))

export type ConversationBridgeConnection = typeof conversationBridgeConnections.$inferSelect
export type NewConversationBridgeConnection = typeof conversationBridgeConnections.$inferInsert
export type ConversationBridgeChannelBinding = typeof conversationBridgeChannelBindings.$inferSelect
export type NewConversationBridgeChannelBinding = typeof conversationBridgeChannelBindings.$inferInsert
export type ConversationBridgeThreadBinding = typeof conversationBridgeThreadBindings.$inferSelect
export type NewConversationBridgeThreadBinding = typeof conversationBridgeThreadBindings.$inferInsert
export type ConversationBridgeInboundEvent = typeof conversationBridgeInboundEvents.$inferSelect
export type NewConversationBridgeInboundEvent = typeof conversationBridgeInboundEvents.$inferInsert
export type ConversationBridgeDeliveryAttempt = typeof conversationBridgeDeliveryAttempts.$inferSelect
export type NewConversationBridgeDeliveryAttempt = typeof conversationBridgeDeliveryAttempts.$inferInsert
export type ConversationBridgeConnectionSecret = typeof conversationBridgeConnectionSecrets.$inferSelect
export type NewConversationBridgeConnectionSecret = typeof conversationBridgeConnectionSecrets.$inferInsert
