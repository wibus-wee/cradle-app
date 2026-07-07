import { randomUUID } from 'node:crypto'

import type { PluginSource } from '@cradle/db'
import { pluginSources } from '@cradle/db'
import { eq, sql } from 'drizzle-orm'

import { db } from '../infra'

export type PluginSourceKind = PluginSource['kind']

export interface AddPluginSourceInput {
  kind: PluginSourceKind
  location: string
  ref?: string | null
  subPath?: string | null
  label?: string | null
  addedReason?: string | null
}

function trimNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

export function listPluginSources(): PluginSource[] {
  return db()
    .select()
    .from(pluginSources)
    .all()
}

export function readPluginSource(sourceId: string): PluginSource | null {
  return db()
    .select()
    .from(pluginSources)
    .where(eq(pluginSources.id, sourceId))
    .get() ?? null
}

export function addPluginSource(input: AddPluginSourceInput): PluginSource {
  const id = randomUUID()
  db()
    .insert(pluginSources)
    .values({
      id,
      kind: input.kind,
      location: input.location.trim(),
      ref: trimNullable(input.ref),
      subPath: trimNullable(input.subPath),
      label: trimNullable(input.label),
      addedReason: trimNullable(input.addedReason) ?? 'Added by operator.',
    })
    .run()

  return readPluginSource(id)!
}

export function deletePluginSource(sourceId: string): void {
  db()
    .delete(pluginSources)
    .where(eq(pluginSources.id, sourceId))
    .run()
}

export function touchPluginSource(sourceId: string): void {
  db()
    .update(pluginSources)
    .set({ updatedAt: sql`(unixepoch())` })
    .where(eq(pluginSources.id, sourceId))
    .run()
}
