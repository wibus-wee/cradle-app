import type { ModelRegistryMapping as ModelRegistryMappingRow } from '@cradle/db'
import { modelRegistryMappings } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import type { ModelRegistryMappingEntry, ModelsDevModel } from '../model-registry/model-info-registry'
import { lookupModelRawExact, ModelsDevModelSchema } from '../model-registry/model-info-registry'

const nonEmptyTrimmedString = z.string().trim().min(1)

const MappingInputSchema = z.object({
  modelId: nonEmptyTrimmedString,
  registryModelId: nonEmptyTrimmedString.optional(),
  matchType: z.enum(['manual', 'alias']).optional(),
  model: ModelsDevModelSchema.optional(),
})

export interface ModelRegistryMapping {
  modelId: string
  registryModelId: string
  matchType: 'manual' | 'alias'
  model?: ModelsDevModel
  createdAt: number
  updatedAt: number
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

function parseModelJson(modelJson: string | null): ModelsDevModel | undefined {
  if (!modelJson) {
    return undefined
  }
  return ModelsDevModelSchema.parse(JSON.parse(modelJson))
}

function toMapping(row: ModelRegistryMappingRow): ModelRegistryMapping {
  return {
    modelId: row.modelId,
    registryModelId: row.registryModelId,
    matchType: row.matchType,
    ...(row.modelJson ? { model: parseModelJson(row.modelJson) } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listMappings(): ModelRegistryMapping[] {
  return db()
    .select()
    .from(modelRegistryMappings)
    .all()
    .map(toMapping)
    .toSorted((a, b) => a.modelId.localeCompare(b.modelId))
}

export function getMapping(modelId: string): ModelRegistryMapping | null {
  const id = nonEmptyTrimmedString.parse(modelId)
  const row = db()
    .select()
    .from(modelRegistryMappings)
    .where(eq(modelRegistryMappings.modelId, id))
    .get()
  return row ? toMapping(row) : null
}

export function listMappingEntries(): ModelRegistryMappingEntry[] {
  return listMappings().map(mapping => ({
    modelId: mapping.modelId,
    registryModelId: mapping.registryModelId,
    matchType: mapping.matchType,
    ...(mapping.model ? { model: mapping.model } : {}),
    updatedAt: mapping.updatedAt,
  }))
}

export async function upsertMapping(rawInput: {
  modelId: string
  registryModelId?: string
  matchType?: 'manual' | 'alias'
  model?: ModelsDevModel
}): Promise<ModelRegistryMapping> {
  const input = MappingInputSchema.parse(rawInput)
  const registryModelId = input.registryModelId?.trim() || input.model?.id
  if (!registryModelId) {
    throw new AppError({
      code: 'model_registry_mapping_invalid',
      status: 400,
      message: 'Registry model ID is required',
    })
  }

  const registryModel = input.model ?? (await lookupModelRawExact(registryModelId))
  const matchType = input.matchType ?? (input.model ? 'manual' : 'alias')
  const now = nowUnix()

  db()
    .insert(modelRegistryMappings)
    .values({
      modelId: input.modelId,
      registryModelId,
      matchType,
      modelJson: registryModel ? JSON.stringify(registryModel) : null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: modelRegistryMappings.modelId,
      set: {
        registryModelId,
        matchType,
        modelJson: registryModel ? JSON.stringify(registryModel) : null,
        updatedAt: now,
      },
    })
    .run()

  return getMapping(input.modelId)!
}

export function deleteMapping(modelId: string): void {
  const id = nonEmptyTrimmedString.parse(modelId)
  db().delete(modelRegistryMappings).where(eq(modelRegistryMappings.modelId, id)).run()
}
