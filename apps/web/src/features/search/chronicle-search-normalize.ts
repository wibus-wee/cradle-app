import { z } from 'zod'

const MatchRangeSchema = z.object({
  start: z.number(),
  end: z.number(),
})

const ChronicleSearchSnippetSchema = z.object({
  text: z.string().default(''),
  ranges: z.array(MatchRangeSchema).default([]),
})

export const ChronicleSearchHitSchema = z.object({
  type: z.enum(['memory', 'knowledge']),
  id: z.string().min(1),
  workspaceId: z.string().nullable().default(null),
  workspaceName: z.string().nullable().default(null),
  title: z.string().default(''),
  titleRanges: z.array(MatchRangeSchema).default([]),
  snippet: ChronicleSearchSnippetSchema.default({ text: '', ranges: [] }),
  matchCount: z.number().default(0),
  score: z.number().default(0),
  updatedAt: z.number().default(0),
  memoryType: z.enum(['10min', '6h']).optional(),
  memorySource: z.enum(['llm', 'local', 'imported']).optional(),
  cardType: z.enum(['fact', 'insight', 'decision', 'task', 'pattern']).optional(),
  dimension: z.enum(['technical', 'business', 'personal', 'project', 'general']).optional(),
  status: z.enum(['active', 'merged', 'archived', 'deleted']).optional(),
})

export const ChronicleSearchHitsSchema = z.array(ChronicleSearchHitSchema).default([])
