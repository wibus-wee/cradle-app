import {
  messages,
  sessions,
  workspaces,
} from '@cradle/db'
import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict.js'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../infra'

export interface MatchRange {
  start: number
  end: number
}

export interface ThreadSearchSnippet {
  text: string
  ranges: MatchRange[]
  messageRole: 'user' | 'assistant'
  messageId: string
  createdAt: number
}

export interface ThreadSearchHit {
  sessionId: string
  workspaceId: string | null
  workspaceName: string | null
  sessionTitle: string
  origin: string
  titleRanges: MatchRange[]
  snippets: ThreadSearchSnippet[]
  matchCount: number
  score: number
  updatedAt: number
}

export interface ThreadSearchParams {
  query: string
  workspaceId?: string
  origin?: string
  limit?: number
  snippetsPerHit?: number
}

const DEFAULT_LIMIT = 50
const DEFAULT_SNIPPETS_PER_HIT = 3
const SNIPPET_BEFORE = 40
const SNIPPET_AFTER = 120
const ELLIPSIS = '…'
const TITLE_WEIGHT = 10
const CONTENT_WEIGHT = 1

const ThreadSearchParamsSchema = z.object({
  query: z.string(),
  workspaceId: z.string().optional(),
  origin: z.string().optional(),
  limit: z.number().finite().positive().default(DEFAULT_LIMIT),
  snippetsPerHit: z.number().finite().positive().default(DEFAULT_SNIPPETS_PER_HIT),
})
type ParsedThreadSearchParams = z.infer<typeof ThreadSearchParamsSchema>

let _jieba: Jieba | null = null

function getJieba(): Jieba | null {
  if (_jieba) {
    return _jieba
  }
  try {
    _jieba = Jieba.withDict(dict)
  }
  catch {
    _jieba = null
  }
  return _jieba
}

function tokenize(query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }

  const jieba = getJieba()
  const segments = jieba ? jieba.cutForSearch(trimmed, true) : [trimmed]
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const token of [trimmed, ...segments]) {
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

function hashId(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index++) {
    hash = ((hash << 5) - hash + id.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function hasFtsTable(): boolean {
  const rows = db().all<{ name: string }>(sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages_fts' LIMIT 1
  `)
  return rows.length > 0
}

function buildIndexedValues(sessionTitle: string, content: string): { segmentedTitle: string, segmentedText: string } | null {
  if (!content.trim()) {
    return null
  }

  const jieba = getJieba()
  const segmentedText = jieba ? (jieba.cutForSearch(content, true) as string[]).join(' ') : content
  const segmentedTitle = jieba ? (jieba.cutForSearch(sessionTitle, true) as string[]).join(' ') : sessionTitle
  return { segmentedTitle, segmentedText }
}

// ── public class (kept as stateless wrapper for compatibility) ──

export class ThreadSearchEngine {
  search(params: ThreadSearchParams): ThreadSearchHit[] {
    const input = ThreadSearchParamsSchema.parse(params)
    try {
      return searchFts(input)
    }
    catch {
      return searchLegacy(input)
    }
  }

  indexMessage(sessionId: string, sessionTitle: string, messageId: string, content: string): void {
    if (!hasFtsTable()) {
      return
    }

    const indexedValues = buildIndexedValues(sessionTitle, content)
    if (!indexedValues) {
      return
    }

    const rowid = hashId(messageId)
    db().run(sql`INSERT OR REPLACE INTO messages_fts(rowid, session_id, session_title, searchable_text)
      VALUES (${rowid}, ${sessionId}, ${indexedValues.segmentedTitle}, ${indexedValues.segmentedText})`)
  }

  removeSessionFromIndex(sessionId: string): void {
    if (!hasFtsTable()) {
      return
    }

    const d = db()
    const rows = d.select({ id: messages.id }).from(messages).where(eq(messages.sessionId, sessionId)).all()
    for (const row of rows) {
      d.run(sql`DELETE FROM messages_fts WHERE rowid = ${hashId(row.id)}`)
    }
  }

  rebuildIndex(): void {
    if (!hasFtsTable()) {
      return
    }

    const d = db()
    d.run(sql`DELETE FROM messages_fts`)

    const sessionRows = d.select().from(sessions).all()
    const sessionTitleById = new Map(sessionRows.map(session => [session.id, session.title]))
    const messageRows = d.select().from(messages).where(eq(messages.status, 'complete')).all()

    for (const message of messageRows) {
      const title = sessionTitleById.get(message.sessionId) ?? ''
      this.indexMessage(message.sessionId, title, message.id, message.content)
    }
  }
}

// ── search implementations ──

function searchFts(params: ParsedThreadSearchParams): ThreadSearchHit[] {
  const tokens = tokenize(params.query)
  if (tokens.length === 0) {
    return []
  }

  const d = db()
  const jieba = getJieba()
  const ftsQuery = jieba
    ? (jieba.cutForSearch(params.query.trim(), true) as string[]).filter(token => token.trim()).join(' ')
    : params.query.trim()

  if (!ftsQuery) {
    return []
  }

  const rows = d.all<{
    rowid: number
    session_id: string
    session_title: string
    snippet: string
    rank: number
  }>(sql`
    SELECT rowid, session_id, session_title,
           snippet(messages_fts, 2, '<mark>', '</mark>', '…', 48) AS snippet,
           rank
    FROM messages_fts
    WHERE messages_fts MATCH ${ftsQuery}
    ORDER BY rank
    LIMIT ${params.limit * 3}
  `)

  if (rows.length === 0) {
    return searchLegacy(params)
  }

  const sessionMap = new Map<string, {
    sessionTitle: string
    snippets: Array<{ text: string, rank: number, rowid: number }>
    bestRank: number
  }>()

  for (const row of rows) {
    if (params.workspaceId || params.origin) {
      const session = d.select().from(sessions).where(eq(sessions.id, row.session_id)).get()
      if (
        !session
        || (params.workspaceId && session.workspaceId !== params.workspaceId)
        || (params.origin && session.origin !== params.origin)
      ) {
        continue
      }
    }

    const entry = sessionMap.get(row.session_id) ?? {
      sessionTitle: row.session_title,
      snippets: [],
      bestRank: row.rank,
    }
    entry.snippets.push({ text: row.snippet, rank: row.rank, rowid: row.rowid })
    if (row.rank < entry.bestRank) {
      entry.bestRank = row.rank
    }
    sessionMap.set(row.session_id, entry)
  }

  const sessionIds = [...sessionMap.keys()]
  const sessionRows = d.select().from(sessions).where(inArray(sessions.id, sessionIds)).all()
  const sessionById = new Map(sessionRows.map(session => [session.id, session]))
  const workspaceIds = [...new Set(sessionRows.map(session => session.workspaceId).filter((id): id is string => !!id))]
  const workspaceRows = workspaceIds.length > 0
    ? d.select().from(workspaces).where(inArray(workspaces.id, workspaceIds)).all()
    : []
  const workspaceNameById = new Map(workspaceRows.map(workspace => [workspace.id, workspace.name]))

  const hits: ThreadSearchHit[] = []
  for (const [sessionId, entry] of sessionMap) {
    const session = sessionById.get(sessionId)
    if (!session) {
      continue
    }

    const titleRanges = findMatches(session.title, tokens)
    const snippets: ThreadSearchSnippet[] = entry.snippets.slice(0, params.snippetsPerHit).map(snippet => ({
      text: snippet.text,
      ranges: extractMarkRanges(snippet.text),
      messageRole: 'assistant',
      messageId: String(snippet.rowid),
      createdAt: session.updatedAt,
    }))

    hits.push({
      sessionId,
      workspaceId: session.workspaceId,
      workspaceName: session.workspaceId ? workspaceNameById.get(session.workspaceId) ?? null : null,
      sessionTitle: session.title,
      origin: session.origin,
      titleRanges,
      snippets,
      matchCount: titleRanges.length + entry.snippets.length,
      score: Math.abs(entry.bestRank) * 100 + titleRanges.length * TITLE_WEIGHT,
      updatedAt: session.updatedAt,
    })
  }

  hits.sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt)
  return hits.slice(0, params.limit)
}

function searchLegacy(params: ParsedThreadSearchParams): ThreadSearchHit[] {
  const tokens = tokenize(params.query)
  if (tokens.length === 0) {
    return []
  }

  const d = db()

  const sessionRows = params.workspaceId && params.origin
    ? d.select().from(sessions).where(and(
      eq(sessions.workspaceId, params.workspaceId),
      eq(sessions.origin, params.origin),
    )).orderBy(desc(sessions.updatedAt)).all()
    : params.workspaceId
      ? d.select().from(sessions).where(eq(sessions.workspaceId, params.workspaceId)).orderBy(desc(sessions.updatedAt)).all()
      : params.origin
        ? d.select().from(sessions).where(eq(sessions.origin, params.origin)).orderBy(desc(sessions.updatedAt)).all()
        : d.select().from(sessions).orderBy(desc(sessions.updatedAt)).all()

  if (sessionRows.length === 0) {
    return []
  }

  const workspaceIds = [...new Set(sessionRows.map(session => session.workspaceId).filter((id): id is string => !!id))]
  const workspaceRows = workspaceIds.length > 0
    ? d.select().from(workspaces).where(inArray(workspaces.id, workspaceIds)).all()
    : []
  const workspaceNameById = new Map(workspaceRows.map(workspace => [workspace.id, workspace.name]))
  const sessionIds = sessionRows.map(session => session.id)
  const messageRows = d.select().from(messages).where(inArray(messages.sessionId, sessionIds)).all()

  const messagesBySession = new Map<string, typeof messageRows>()
  for (const row of messageRows) {
    const bucket = messagesBySession.get(row.sessionId) ?? []
    bucket.push(row)
    messagesBySession.set(row.sessionId, bucket)
  }

  const hits: ThreadSearchHit[] = []
  for (const session of sessionRows) {
    const titleRanges = findMatches(session.title, tokens)
    const messageCandidates = messagesBySession.get(session.id) ?? []
    const candidateSnippets: Array<ThreadSearchSnippet & { matchCount: number }> = []
    let contentMatchCount = 0

    for (const message of messageCandidates) {
      const text = message.content
      if (!text) {
        continue
      }

      const ranges = findMatches(text, tokens)
      if (ranges.length === 0) {
        continue
      }
      contentMatchCount += ranges.length
      const snippet = extractSnippet(text, ranges)
      candidateSnippets.push({
        text: snippet.text,
        ranges: snippet.ranges,
        messageRole: message.role,
        messageId: message.id,
        createdAt: message.createdAt,
        matchCount: ranges.length,
      })
    }

    const matchCount = titleRanges.length + contentMatchCount
    if (matchCount === 0) {
      continue
    }

    candidateSnippets.sort((left, right) => {
      if (right.matchCount !== left.matchCount) {
        return right.matchCount - left.matchCount
      }
      return right.createdAt - left.createdAt
    })

    hits.push({
      sessionId: session.id,
      workspaceId: session.workspaceId,
      workspaceName: session.workspaceId ? workspaceNameById.get(session.workspaceId) ?? null : null,
      sessionTitle: session.title,
      origin: session.origin,
      titleRanges,
      snippets: candidateSnippets.slice(0, params.snippetsPerHit).map(({ matchCount: _ignored, ...snippet }) => snippet),
      matchCount,
      score: titleRanges.length * TITLE_WEIGHT + contentMatchCount * CONTENT_WEIGHT,
      updatedAt: session.updatedAt,
    })
  }

  hits.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }
    return right.updatedAt - left.updatedAt
  })
  return hits.slice(0, params.limit)
}

// ── utility functions ──

function extractMarkRanges(html: string): MatchRange[] {
  const ranges: MatchRange[] = []
  let plainIndex = 0
  let index = 0
  while (index < html.length) {
    if (html.startsWith('<mark>', index)) {
      index += 6
      const start = plainIndex
      while (index < html.length && !html.startsWith('</mark>', index)) {
        plainIndex++
        index++
      }
      ranges.push({ start, end: plainIndex })
      if (html.startsWith('</mark>', index)) {
        index += 7
      }
    }
    else {
      plainIndex++
      index++
    }
  }
  return ranges
}

function findMatches(text: string, tokens: string[]): MatchRange[] {
  if (!text) {
    return []
  }

  const lowerText = text.toLowerCase()
  const raw: MatchRange[] = []
  for (const token of tokens) {
    if (!token) {
      continue
    }
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

  if (raw.length === 0) {
    return []
  }

  raw.sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: MatchRange[] = []
  for (const range of raw) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    }
    else {
      merged.push({ start: range.start, end: range.end })
    }
  }
  return merged
}

function extractSnippet(text: string, ranges: MatchRange[]): { text: string, ranges: MatchRange[] } {
  if (ranges.length === 0) {
    const truncated = text.length > SNIPPET_BEFORE + SNIPPET_AFTER
      ? `${text.slice(0, SNIPPET_BEFORE + SNIPPET_AFTER)}${ELLIPSIS}`
      : text
    return { text: truncated, ranges: [] }
  }

  const first = ranges[0]
  const rawStart = Math.max(0, first.start - SNIPPET_BEFORE)
  const rawEnd = Math.min(text.length, first.start + SNIPPET_AFTER)
  const leading = rawStart > 0 ? ELLIPSIS : ''
  const trailing = rawEnd < text.length ? ELLIPSIS : ''
  const snippetText = `${leading}${text.slice(rawStart, rawEnd)}${trailing}`
  const offset = leading.length

  const shifted: MatchRange[] = []
  for (const range of ranges) {
    if (range.end <= rawStart || range.start >= rawEnd) {
      continue
    }
    const start = Math.max(range.start, rawStart) - rawStart + offset
    const end = Math.min(range.end, rawEnd) - rawStart + offset
    if (end > start) {
      shifted.push({ start, end })
    }
  }

  return { text: snippetText, ranges: shifted }
}
