import { randomUUID } from 'node:crypto'

import { pluginActivationPolicies } from '@cradle/db'
import { eq, sql } from 'drizzle-orm'

import { db } from '../infra'

export interface PluginActivationPolicy {
  pluginName: string
  enabled: boolean
  reason: string | null
  updatedAt: number
}

export interface SetPluginActivationPolicyInput {
  enabled: boolean
  reason?: string | null
}

function toPolicy(row: typeof pluginActivationPolicies.$inferSelect): PluginActivationPolicy {
  return {
    pluginName: row.pluginName,
    enabled: row.enabled,
    reason: row.reason,
    updatedAt: row.updatedAt,
  }
}

export function listPluginActivationPolicies(): PluginActivationPolicy[] {
  return db()
    .select()
    .from(pluginActivationPolicies)
    .all()
    .map(toPolicy)
}

export function readPluginActivationPolicy(pluginName: string): PluginActivationPolicy | null {
  const row = db()
    .select()
    .from(pluginActivationPolicies)
    .where(eq(pluginActivationPolicies.pluginName, pluginName))
    .get()
  return row ? toPolicy(row) : null
}

export function isPluginEnabled(pluginName: string): boolean {
  return readPluginActivationPolicy(pluginName)?.enabled ?? true
}

export function setPluginActivationPolicy(
  pluginName: string,
  input: SetPluginActivationPolicyInput,
): PluginActivationPolicy {
  db()
    .insert(pluginActivationPolicies)
    .values({
      id: randomUUID(),
      pluginName,
      enabled: input.enabled,
      reason: input.reason ?? null,
    })
    .onConflictDoUpdate({
      target: pluginActivationPolicies.pluginName,
      set: {
        enabled: input.enabled,
        reason: input.reason ?? null,
        updatedAt: sql`(unixepoch())`,
      },
    })
    .run()

  return readPluginActivationPolicy(pluginName)!
}
