import {
  chatMessagePayloads,
  messages,
  sessions,
  workspaces,
} from '@cradle/db'
import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict.js'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../infra'
import { messagePayloadJoinCondition } from '../chat-runtime/message-payload-store'

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
const MAX_LEGACY_SCAN_SESSIONS = 250
const MAX_LEGACY_SCAN_MESSAGES = 2_000
const MAX_SEARCH_LIMIT = 100
const MAX_SNIPPETS_PER_HIT = 10
const MATCH_START = '\u0001'
const MATCH_END = '\u0002'

const ThreadSearchParamsSchema = z.object({
  query: z.string(),
  workspaceId: z.string().optional(),
  origin: z.string().optional(),
  limit: z.number().finite().int().positive().max(MAX_SEARCH_LIMIT).default(DEFAULT_LIMIT),
  snippetsPerHit: z.number().finite().int().positive().max(MAX_SNIPPETS_PER_HIT).default(DEFAULT_SNIPPETS_PER_HIT),
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

function hasFtsTables(): boolean {
  const rows = db().all<{ name: string }>(sql`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('messages_fts', 'sessions_fts')
  `)
  return rows.length === 2
}

function buildFtsQuery(query: string): string {
  const jieba = getJieba()
  const terms = jieba ? (jieba.cutForSearch(query.trim(), true) as string[]) : [query.trim()]
  return terms
    .map(term => term.trim())
    .filter(Boolean)
    .map(term => `"${term.replaceAll('"', '""')}"`)
    .join(' AND ')
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
    if (!hasFtsTables()) {
      return
    }

    const indexedValues = buildIndexedValues(sessionTitle, content)
    if (!indexedValues) {
      return
    }

    const d = db()
    d.run(sql`DELETE FROM sessions_fts WHERE session_id = ${sessionId}`)
    d.run(sql`INSERT INTO sessions_fts(session_id, title)
      VALUES (${sessionId}, ${indexedValues.segmentedTitle})`)
    d.run(sql`DELETE FROM messages_fts WHERE message_id = ${messageId}`)
    d.run(sql`INSERT INTO messages_fts(message_id, session_id, session_title, searchable_text)
      VALUES (${messageId}, ${sessionId}, ${indexedValues.segmentedTitle}, ${indexedValues.segmentedText})`)
  }

  removeSessionFromIndex(sessionId: string): void {
    if (!hasFtsTables()) {
      return
    }

    const d = db()
    d.run(sql`DELETE FROM messages_fts WHERE session_id = ${sessionId}`)
    d.run(sql`DELETE FROM sessions_fts WHERE session_id = ${sessionId}`)
  }

  rebuildIndex(): void {
    if (!hasFtsTables()) {
      return
    }

    const d = db()
    d.run(sql`DELETE FROM messages_fts`)
    d.run(sql`DELETE FROM sessions_fts`)

    const sessionRows = d.select().from(sessions).all()
    const sessionTitleById = new Map(sessionRows.map(session => [session.id, session.title]))
    const jieba = getJieba()
    for (const session of sessionRows) {
      const title = jieba ? (jieba.cutForSearch(session.title, true) as string[]).join(' ') : session.title
      d.run(sql`INSERT INTO sessions_fts(session_id, title) VALUES (${session.id}, ${title})`)
    }
    const messageRows = d
      .select({
        id: messages.id,
        sessionId: messages.sessionId,
        content: chatMessagePayloads.content,
      })
      .from(messages)
      .innerJoin(chatMessagePayloads, messagePayloadJoinCondition())
      .all()

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
  const ftsQuery = buildFtsQuery(params.query)

  if (!ftsQuery) {
    return []
  }

  const contentFtsQuery = `searchable_text : (${ftsQuery})`
  const conditions = [sql`messages_fts MATCH ${contentFtsQuery}`]
  if (params.workspaceId) {
    conditions.push(sql`session.workspace_id = ${params.workspaceId}`)
  }
  if (params.origin) {
    conditions.push(sql`session.origin = ${params.origin}`)
  }
  const rows = d.all<{
    message_id: string
    session_id: string
    session_title: string
    workspace_id: string | null
    workspace_name: string | null
    origin: string
    session_updated_at: number
    message_role: 'user' | 'assistant'
    message_created_at: number
    snippet: string
    rank: number
  }>(sql`
    SELECT
      messages_fts.message_id,
      messages_fts.session_id,
      session.title AS session_title,
      session.workspace_id,
      workspace.name AS workspace_name,
      session.origin,
      session.updated_at AS session_updated_at,
      message.role AS message_role,
      message.created_at AS message_created_at,
      snippet(messages_fts, 3, ${MATCH_START}, ${MATCH_END}, '…', 48) AS snippet,
      bm25(messages_fts, 0.0, 0.0, 0.0, 1.0) AS rank
    FROM messages_fts
    INNER JOIN messages AS message ON message.id = messages_fts.message_id
    INNER JOIN sessions AS session ON session.id = messages_fts.session_id
    LEFT JOIN workspaces AS workspace ON workspace.id = session.workspace_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY rank
    LIMIT ${params.limit * Math.max(params.snippetsPerHit, 3)}
  `)

  const sessionMap = new Map<string, {
    sessionTitle: string
    workspaceId: string | null
    workspaceName: string | null
    origin: string
    updatedAt: number
    snippets: Array<{
      text: string
      rank: number
      messageId: string
      messageRole: 'user' | 'assistant'
      createdAt: number
    }>
    bestRank: number
  }>()

  for (const row of rows) {
    const entry = sessionMap.get(row.session_id) ?? {
      sessionTitle: row.session_title,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      origin: row.origin,
      updatedAt: row.session_updated_at,
      snippets: [],
      bestRank: row.rank,
    }
    entry.snippets.push({
      text: row.snippet,
      rank: row.rank,
      messageId: row.message_id,
      messageRole: row.message_role,
      createdAt: row.message_created_at,
    })
    if (row.rank < entry.bestRank) {
      entry.bestRank = row.rank
    }
    sessionMap.set(row.session_id, entry)
  }

  const hitsBySessionId = new Map<string, ThreadSearchHit>()
  for (const [sessionId, entry] of sessionMap) {
    const snippets: ThreadSearchSnippet[] = entry.snippets.slice(0, params.snippetsPerHit).map((snippet) => {
      const parsed = parseMarkedSnippet(snippet.text)
      return {
        text: parsed.text,
        ranges: parsed.ranges,
        messageRole: snippet.messageRole,
        messageId: snippet.messageId,
        createdAt: snippet.createdAt,
      }
    })

    hitsBySessionId.set(sessionId, {
      sessionId,
      workspaceId: entry.workspaceId,
      workspaceName: entry.workspaceName,
      sessionTitle: entry.sessionTitle,
      origin: entry.origin,
      titleRanges: [],
      snippets,
      matchCount: entry.snippets.length,
      score: -entry.bestRank * 100,
      updatedAt: entry.updatedAt,
    })
  }

  for (const titleHit of searchSessionTitlesFts(params, tokens, ftsQuery)) {
    const existing = hitsBySessionId.get(titleHit.sessionId)
    if (existing) {
      existing.titleRanges = titleHit.titleRanges
      existing.matchCount += titleHit.matchCount
      existing.score += titleHit.score
    }
    else {
      hitsBySessionId.set(titleHit.sessionId, titleHit)
    }
  }

  const hits = [...hitsBySessionId.values()]
  hits.sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt)
  return hits.slice(0, params.limit)
}

function searchSessionTitlesFts(
  params: ParsedThreadSearchParams,
  tokens: string[],
  ftsQuery: string,
): ThreadSearchHit[] {
  const conditions = [sql`sessions_fts MATCH ${ftsQuery}`]
  if (params.workspaceId) {
    conditions.push(sql`session.workspace_id = ${params.workspaceId}`)
  }
  if (params.origin) {
    conditions.push(sql`session.origin = ${params.origin}`)
  }
  const rows = db().all<{
    session_id: string
    session_title: string
    workspace_id: string | null
    workspace_name: string | null
    origin: string
    updated_at: number
    rank: number
  }>(sql`
    SELECT
      session.id AS session_id,
      session.title AS session_title,
      session.workspace_id,
      workspace.name AS workspace_name,
      session.origin,
      session.updated_at,
      bm25(sessions_fts, 0.0, 1.0) AS rank
    FROM sessions_fts
    INNER JOIN sessions AS session ON session.id = sessions_fts.session_id
    LEFT JOIN workspaces AS workspace ON workspace.id = session.workspace_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY rank
    LIMIT ${params.limit}
  `)

  return rows.flatMap((row) => {
    const titleRanges = findMatches(row.session_title, tokens)
    if (titleRanges.length === 0) {
      return []
    }
    return [{
      sessionId: row.session_id,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      sessionTitle: row.session_title,
      origin: row.origin,
      titleRanges,
      snippets: [],
      matchCount: titleRanges.length,
      score: -row.rank * 100 + titleRanges.length * TITLE_WEIGHT,
      updatedAt: row.updated_at,
    }]
  })
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
    )).orderBy(desc(sessions.updatedAt)).limit(MAX_LEGACY_SCAN_SESSIONS).all()
    : params.workspaceId
      ? d.select().from(sessions).where(eq(sessions.workspaceId, params.workspaceId)).orderBy(desc(sessions.updatedAt)).limit(MAX_LEGACY_SCAN_SESSIONS).all()
      : params.origin
        ? d.select().from(sessions).where(eq(sessions.origin, params.origin)).orderBy(desc(sessions.updatedAt)).limit(MAX_LEGACY_SCAN_SESSIONS).all()
        : d.select().from(sessions).orderBy(desc(sessions.updatedAt)).limit(MAX_LEGACY_SCAN_SESSIONS).all()

  if (sessionRows.length === 0) {
    return []
  }

  const workspaceIds = [...new Set(sessionRows.map(session => session.workspaceId).filter((id): id is string => !!id))]
  const workspaceRows = workspaceIds.length > 0
    ? d.select().from(workspaces).where(inArray(workspaces.id, workspaceIds)).all()
    : []
  const workspaceNameById = new Map(workspaceRows.map(workspace => [workspace.id, workspace.name]))
  const sessionIds = sessionRows.map(session => session.id)
  const messageRows = d
    .select({
      id: messages.id,
      sessionId: messages.sessionId,
      role: messages.role,
      createdAt: messages.createdAt,
      content: chatMessagePayloads.content,
    })
    .from(messages)
    .innerJoin(chatMessagePayloads, messagePayloadJoinCondition())
    .where(inArray(messages.sessionId, sessionIds))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_LEGACY_SCAN_MESSAGES)
    .all()

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

function parseMarkedSnippet(marked: string): { text: string, ranges: MatchRange[] } {
  const ranges: MatchRange[] = []
  let text = ''
  let index = 0
  while (index < marked.length) {
    if (marked[index] === MATCH_START) {
      index++
      const start = text.length
      while (index < marked.length && marked[index] !== MATCH_END) {
        text += marked[index]
        index++
      }
      ranges.push({ start, end: text.length })
      if (marked[index] === MATCH_END) {
        index++
      }
    }
    else {
      text += marked[index]
      index++
    }
  }
  return { text, ranges }
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
