import {
  chronicleKnowledgeCards,
  chronicleMemories,
  workspaces,
} from '@cradle/db'
import { desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../infra'
import type { MatchRange } from './thread-search.engine'

export interface ChronicleSearchSnippet {
  text: string
  ranges: MatchRange[]
}

export interface ChronicleSearchHit {
  type: 'memory' | 'knowledge'
  id: string
  workspaceId: string | null
  workspaceName: string | null
  title: string
  titleRanges: MatchRange[]
  snippet: ChronicleSearchSnippet
  matchCount: number
  score: number
  updatedAt: number
  memoryType?: '10min' | '6h'
  memorySource?: 'llm' | 'local' | 'imported'
  cardType?: 'fact' | 'insight' | 'decision' | 'task' | 'pattern'
  dimension?: 'technical' | 'business' | 'personal' | 'project' | 'general'
  status?: 'active' | 'merged' | 'archived' | 'deleted'
}

export interface ChronicleSearchParams {
  query: string
  workspaceId?: string
  limit?: number
}

const DEFAULT_LIMIT = 50
const SNIPPET_BEFORE = 56
const SNIPPET_AFTER = 160
const ELLIPSIS = '...'
const TITLE_WEIGHT = 12
const CONTENT_WEIGHT = 2
const RECENCY_WEIGHT = 0.000001
const TagListTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(z.string()))
const ChronicleSearchParamsSchema = z.object({
  query: z.string(),
  workspaceId: z.string().optional(),
  limit: z.number().finite().positive().default(DEFAULT_LIMIT).transform(value => Math.max(1, Math.min(value, 100))),
})

export function searchChronicle(params: ChronicleSearchParams): ChronicleSearchHit[] {
  const input = ChronicleSearchParamsSchema.parse(params)
  const tokens = tokenize(input.query)
  if (tokens.length === 0) {
    return []
  }

  const d = db()
  const memoryRows = input.workspaceId
    ? d.select().from(chronicleMemories).where(eq(chronicleMemories.workspaceId, input.workspaceId)).orderBy(desc(chronicleMemories.updatedAt)).limit(input.limit * 4).all()
    : d.select().from(chronicleMemories).orderBy(desc(chronicleMemories.updatedAt)).limit(input.limit * 4).all()
  const knowledgeRows = input.workspaceId
    ? d.select().from(chronicleKnowledgeCards).where(eq(chronicleKnowledgeCards.workspaceId, input.workspaceId)).orderBy(desc(chronicleKnowledgeCards.updatedAt)).limit(input.limit * 4).all()
    : d.select().from(chronicleKnowledgeCards).orderBy(desc(chronicleKnowledgeCards.updatedAt)).limit(input.limit * 4).all()

  const workspaceIds = [...new Set([
    ...memoryRows.map(row => row.workspaceId),
    ...knowledgeRows.map(row => row.workspaceId),
  ].filter((id): id is string => Boolean(id)))]
  const workspaceRows = workspaceIds.length > 0
    ? d.select().from(workspaces).where(inArray(workspaces.id, workspaceIds)).all()
    : []
  const workspaceNameById = new Map(workspaceRows.map(workspace => [workspace.id, workspace.name]))

  const hits: ChronicleSearchHit[] = []

  for (const row of memoryRows) {
    const title = readMemoryTitle(row.content)
    const titleRanges = findMatches(title, tokens)
    const contentRanges = findMatches(row.content, tokens)
    const matchCount = titleRanges.length + contentRanges.length
    if (matchCount === 0) {
      continue
    }

    const snippet = extractSnippet(row.content, contentRanges.length > 0 ? contentRanges : titleRanges)
    hits.push({
      type: 'memory',
      id: row.id,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceId ? workspaceNameById.get(row.workspaceId) ?? null : null,
      title,
      titleRanges,
      snippet,
      matchCount,
      score: titleRanges.length * TITLE_WEIGHT + contentRanges.length * CONTENT_WEIGHT + row.updatedAt * RECENCY_WEIGHT,
      updatedAt: row.updatedAt,
      memoryType: row.type,
      memorySource: row.source,
    })
  }

  for (const row of knowledgeRows) {
    if (row.status === 'deleted') {
      continue
    }

    const searchable = `${row.title}\n${row.content}\n${readTags(row.tagsJson).join(' ')}`
    const titleRanges = findMatches(row.title, tokens)
    const contentRanges = findMatches(searchable, tokens)
    const matchCount = titleRanges.length + contentRanges.length
    if (matchCount === 0) {
      continue
    }

    const snippet = extractSnippet(row.content, findMatches(row.content, tokens))
    hits.push({
      type: 'knowledge',
      id: row.id,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceId ? workspaceNameById.get(row.workspaceId) ?? null : null,
      title: row.title,
      titleRanges,
      snippet,
      matchCount,
      score: titleRanges.length * TITLE_WEIGHT + contentRanges.length * CONTENT_WEIGHT + row.updatedAt * RECENCY_WEIGHT,
      updatedAt: row.updatedAt,
      cardType: row.cardType,
      dimension: row.dimension,
      status: row.status,
    })
  }

  hits.sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt)
  return hits.slice(0, input.limit)
}

function tokenize(query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }

  const rawTokens = [trimmed, ...trimmed.split(/\s+/)]
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const token of rawTokens) {
    const clean = token.trim()
    if (!clean) {
      continue
    }
    const key = clean.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    tokens.push(clean)
  }
  return tokens
}

function readMemoryTitle(content: string): string {
  const firstHeading = content.split('\n').map(line => line.trim()).find(line => line.length > 0)
  if (!firstHeading) {
    return 'Chronicle memory'
  }
  return firstHeading.replace(/^#+\s*/, '').slice(0, 120)
}

function readTags(tagsJson: string): string[] {
  return TagListTextSchema.parse(tagsJson)
}

function findMatches(text: string, tokens: string[]): MatchRange[] {
  const lowerText = text.toLowerCase()
  const raw: MatchRange[] = []
  for (const token of tokens) {
    const lowerToken = token.toLowerCase()
    let cursor = 0
    while (true) {
      const position = lowerText.indexOf(lowerToken, cursor)
      if (position === -1) {
        break
      }
      raw.push({ start: position, end: position + token.length })
      cursor = position + Math.max(token.length, 1)
    }
  }

  raw.sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: MatchRange[] = []
  for (const range of raw) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    }
    else {
      merged.push({ ...range })
    }
  }
  return merged
}

function extractSnippet(text: string, ranges: MatchRange[]): ChronicleSearchSnippet {
  if (ranges.length === 0) {
    return {
      text: text.length > SNIPPET_BEFORE + SNIPPET_AFTER ? `${text.slice(0, SNIPPET_BEFORE + SNIPPET_AFTER)}${ELLIPSIS}` : text,
      ranges: [],
    }
  }

  const first = ranges[0]
  const rawStart = Math.max(0, first.start - SNIPPET_BEFORE)
  const rawEnd = Math.min(text.length, first.start + SNIPPET_AFTER)
  const leading = rawStart > 0 ? ELLIPSIS : ''
  const trailing = rawEnd < text.length ? ELLIPSIS : ''
  const snippetText = `${leading}${text.slice(rawStart, rawEnd)}${trailing}`
  const offset = leading.length

  return {
    text: snippetText,
    ranges: ranges.flatMap((range) => {
      if (range.end <= rawStart || range.start >= rawEnd) {
        return []
      }
      const start = Math.max(range.start, rawStart) - rawStart + offset
      const end = Math.min(range.end, rawEnd) - rawStart + offset
      return end > start ? [{ start, end }] : []
    }),
  }
}
