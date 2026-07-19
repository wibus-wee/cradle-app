import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createdAt, timestamps } from './shared'

export const acpAgents = sqliteTable('acp_agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  /** Provenance: registry-installed vs user-declared local command agent. */
  source: text('source').notNull().default('registry'),
  distributionType: text('distribution_type').notNull(),
  installPath: text('install_path'),
  cmd: text('cmd'),
  args: text('args').notNull().default('[]'),
  env: text('env').notNull().default('{}'),
  /** User launch overrides for registry agents; null means inherit base. Always null for local. */
  overrideCmd: text('override_cmd'),
  overrideArgs: text('override_args'),
  overrideEnv: text('override_env'),
  status: text('status').notNull().default('installing'),
  ...timestamps(),
})

export const acpAuditLog = sqliteTable('acp_audit_log', {
  id: int('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id').notNull(),
  action: text('action').notNull(),
  path: text('path'),
  details: text('details').notNull().default('{}'),
  ...createdAt(),
})

export type AcpAgent = typeof acpAgents.$inferSelect
export type AcpAuditEntry = typeof acpAuditLog.$inferSelect
