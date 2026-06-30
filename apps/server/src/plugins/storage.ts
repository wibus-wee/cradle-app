/* Provides Cradle-owned persistent KV storage for server plugins. */
import { randomUUID } from 'node:crypto'

import { pluginStorageEntries } from '@cradle/db'
import type { PluginStorage } from '@cradle/plugin-sdk/server'
import { and, eq, sql } from 'drizzle-orm'

import { db } from '../infra'

export function createPluginStorage(pluginName: string): PluginStorage {
  return {
    async get(key: string) {
      const row = db()
        .select({ value: pluginStorageEntries.value })
        .from(pluginStorageEntries)
        .where(and(
          eq(pluginStorageEntries.pluginName, pluginName),
          eq(pluginStorageEntries.key, key),
        ))
        .get()
      return row?.value ?? null
    },
    async set(key: string, value: string) {
      db()
        .insert(pluginStorageEntries)
        .values({
          id: randomUUID(),
          pluginName,
          key,
          value,
        })
        .onConflictDoUpdate({
          target: [pluginStorageEntries.pluginName, pluginStorageEntries.key],
          set: {
            value,
            updatedAt: sql`(unixepoch())`,
          },
        })
        .run()
    },
    async delete(key: string) {
      db()
        .delete(pluginStorageEntries)
        .where(and(
          eq(pluginStorageEntries.pluginName, pluginName),
          eq(pluginStorageEntries.key, key),
        ))
        .run()
    },
  }
}
