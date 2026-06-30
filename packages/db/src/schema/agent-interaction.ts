import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
import { agents } from './identity'
import { issues } from './issue'
import { providerTargets } from './provider-target'
import { createdAt, textPk, timestamps } from './shared'

export const agentSessions = sqliteTable('agent_sessions', {
  id: textPk(),
  issueId: text('issue_id')
    .notNull()
    .references(() => issues.id, { onDelete: 'cascade' }),
  providerTargetId: text('provider_target_id')
    .notNull()
    .references(() => providerTargets.id, { onDelete: 'restrict' }),
  agentId: text('agent_id')
    .references(() => agents.id, { onDelete: 'set null' }),
  chatSessionId: text('chat_session_id')
    .references(() => sessions.id, { onDelete: 'set null' }),
  status: text('status', {
    enum: ['created', 'active', 'completed', 'stopped', 'failed'],
  }).notNull().default('created'),
  ...timestamps(),
}, table => ({
  byIssue: index('agent_sessions_issue_id_idx').on(table.issueId),
  byProviderTarget: index('agent_sessions_provider_target_id_idx').on(table.providerTargetId),
  byAgent: index('agent_sessions_agent_id_idx').on(table.agentId),
  byChatSession: index('agent_sessions_chat_session_id_idx').on(table.chatSessionId),
}))

export const agentActivities = sqliteTable('agent_activities', {
  id: textPk(),
  agentSessionId: text('agent_session_id')
    .notNull()
    .references(() => agentSessions.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['thought', 'action', 'response', 'elicitation', 'error', 'prompt'],
  }).notNull(),
  content: text('content').notNull(),
  signal: text('signal'),
  signalMetadata: text('signal_metadata'),
  ...createdAt(),
}, table => ({
  byAgentSession: index('agent_activities_agent_session_id_idx').on(table.agentSessionId),
}))

export type AgentSession = typeof agentSessions.$inferSelect
export type NewAgentSession = typeof agentSessions.$inferInsert
export type AgentActivity = typeof agentActivities.$inferSelect
export type NewAgentActivity = typeof agentActivities.$inferInsert
