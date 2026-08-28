import { randomUUID } from 'node:crypto'

import { trustGrants } from '@cradle/db'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { db } from '../infra'

export interface PluginTrustGrant {
  pluginName: string
  checksum: string
  reason: string | null
  updatedAt: number
}

function pluginPermissionSubjectKey(pluginName: string, permissionId: string): string {
  return JSON.stringify([pluginName, permissionId])
}

function toGrant(row: typeof trustGrants.$inferSelect): PluginTrustGrant {
  return {
    pluginName: row.subjectKey,
    checksum: row.checksum,
    reason: row.reason,
    updatedAt: row.updatedAt,
  }
}

export function readPluginTrustGrant(pluginName: string, checksum: string): PluginTrustGrant | null {
  const row = db()
    .select()
    .from(trustGrants)
    .where(and(
      eq(trustGrants.subjectType, 'plugin_package'),
      eq(trustGrants.subjectKey, pluginName),
      eq(trustGrants.checksum, checksum),
    ))
    .get()
  return row ? toGrant(row) : null
}

export function grantPluginTrust(
  pluginName: string,
  checksum: string,
  reason?: string | null,
): PluginTrustGrant {
  db()
    .insert(trustGrants)
    .values({
      id: randomUUID(),
      subjectType: 'plugin_package',
      subjectKey: pluginName,
      checksum,
      reason: reason ?? null,
    })
    .onConflictDoUpdate({
      target: [trustGrants.subjectType, trustGrants.subjectKey, trustGrants.checksum],
      set: {
        reason: reason ?? null,
        updatedAt: sql`(unixepoch())`,
      },
    })
    .run()

  return readPluginTrustGrant(pluginName, checksum)!
}

export function readGrantedPluginPermissions(pluginName: string, checksum: string): string[] {
  return db()
    .select({ subjectKey: trustGrants.subjectKey })
    .from(trustGrants)
    .where(and(
      eq(trustGrants.subjectType, 'plugin_permission'),
      eq(trustGrants.checksum, checksum),
    ))
    .all()
    .flatMap(({ subjectKey }) => {
      const parsed: [string, string] = JSON.parse(subjectKey)
      return parsed[0] === pluginName ? [parsed[1]] : []
    })
    .sort()
}

export function grantPluginPermissions(
  pluginName: string,
  checksum: string,
  permissionIds: string[],
  reason?: string | null,
): void {
  db().transaction((tx) => {
    const existingGrantIds = tx
      .select({ id: trustGrants.id, subjectKey: trustGrants.subjectKey })
      .from(trustGrants)
      .where(and(
        eq(trustGrants.subjectType, 'plugin_permission'),
        eq(trustGrants.checksum, checksum),
      ))
      .all()
      .flatMap((row) => {
        const parsed: [string, string] = JSON.parse(row.subjectKey)
        return parsed[0] === pluginName ? [row.id] : []
      })
    if (existingGrantIds.length > 0) {
      tx.delete(trustGrants).where(inArray(trustGrants.id, existingGrantIds)).run()
    }

    for (const permissionId of permissionIds) {
      tx.insert(trustGrants)
        .values({
          id: randomUUID(),
          subjectType: 'plugin_permission',
          subjectKey: pluginPermissionSubjectKey(pluginName, permissionId),
          checksum,
          reason: reason ?? null,
        })
        .onConflictDoUpdate({
          target: [trustGrants.subjectType, trustGrants.subjectKey, trustGrants.checksum],
          set: {
            reason: reason ?? null,
            updatedAt: sql`(unixepoch())`,
          },
        })
        .run()
    }
  })
}

export function deletePluginTrustGrantsForPlugin(pluginName: string): void {
  db()
    .delete(trustGrants)
    .where(and(
      eq(trustGrants.subjectType, 'plugin_package'),
      eq(trustGrants.subjectKey, pluginName),
    ))
    .run()
  const permissionGrantIds = db()
    .select({ id: trustGrants.id, subjectKey: trustGrants.subjectKey })
    .from(trustGrants)
    .where(eq(trustGrants.subjectType, 'plugin_permission'))
    .all()
    .flatMap((row) => {
      const parsed: [string, string] = JSON.parse(row.subjectKey)
      return parsed[0] === pluginName ? [row.id] : []
    })
  if (permissionGrantIds.length > 0) {
    db().delete(trustGrants).where(inArray(trustGrants.id, permissionGrantIds)).run()
  }
}
