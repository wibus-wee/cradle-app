/**
 * Shared Zod schemas and types for the model registry feature.
 *
 * These schemas are consumed by both the agent-management and settings
 * feature modules, so they live in a neutral namespace.
 */
import { z } from 'zod'

import type { ModelCapabilities } from '~/features/agent-runtime/types'

// ── models.dev model shape ───────────────────────────────────────────────────

export const ModelsDevModelSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().optional(),
    limit: z
      .object({
        context: z.number().optional(),
        output: z.number().optional(),
      })
      .optional(),
    modalities: z
      .object({
        input: z.array(z.string()).optional(),
        output: z.array(z.string()).optional(),
      })
      .optional(),
    reasoning: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    temperature: z.boolean().optional(),
    structured_output: z.boolean().optional(),
    cost: z
      .object({
        input: z.number().optional(),
        output: z.number().optional(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
      })
      .optional(),
    family: z.string().optional(),
    knowledge: z.string().optional(),
    release_date: z.string().optional(),
  })
  .passthrough()

export type ModelsDevModel = z.infer<typeof ModelsDevModelSchema>

// ── Model registry mapping ───────────────────────────────────────────────────

export const ModelRegistryMappingSchema = z.object({
  modelId: z.string(),
  registryModelId: z.string(),
  matchType: z.enum(['manual', 'alias']),
  model: ModelsDevModelSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const ModelRegistryMappingListSchema = z.array(ModelRegistryMappingSchema)

export type ModelRegistryMapping = z.infer<typeof ModelRegistryMappingSchema>

// ── Search result (from models.dev API / registry) ───────────────────────────

export const SearchResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  capabilities: z.custom<ModelCapabilities>().default({} as ModelCapabilities),
})

export const SearchResultListSchema = z.array(SearchResultSchema).default([])

export type SearchResult = z.infer<typeof SearchResultSchema>

// ── Search result with source indicator ──────────────────────────────────────

export type SearchResultSource = 'models-dev' | 'registry'

export interface SearchResultWithSource extends SearchResult {
  source: SearchResultSource
}
