import { z } from 'zod'

const FTS_MARK_TAG_RE = /<\/?mark>/g

const MatchRangeSchema = z.object({
  start: z.number(),
  end: z.number(),
})

const ThreadSearchSnippetSchema = z.object({
  text: z.string().default(''),
  ranges: z.array(MatchRangeSchema).default([]),
  messageRole: z.enum(['user', 'assistant']).default('user'),
  messageId: z.string().min(1),
  createdAt: z.number().default(0),
}).transform(snippet => ({
  ...snippet,
  text: snippet.ranges.length > 0 ? snippet.text.replace(FTS_MARK_TAG_RE, '') : snippet.text,
}))

export const ThreadSearchHitSchema = z.object({
  sessionId: z.string().min(1),
  workspaceId: z.string().min(1),
  workspaceName: z.string().nullable().default(null),
  sessionTitle: z.string().default(''),
  origin: z.string().default('manual'),
  titleRanges: z.array(MatchRangeSchema).default([]),
  snippets: z.array(ThreadSearchSnippetSchema).default([]),
  matchCount: z.number().optional(),
  score: z.number().default(0),
  updatedAt: z.number().default(0),
}).transform(hit => ({
  ...hit,
  matchCount: hit.matchCount ?? hit.snippets.length,
}))

export const ThreadSearchHitsSchema = z.array(ThreadSearchHitSchema).default([])
