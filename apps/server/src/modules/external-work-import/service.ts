import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import type { ExternalWorkImportItem } from '@cradle/db'
import {
  externalWorkImportItems,
  sessions,
} from '@cradle/db'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../infra'
import { recordImportedSessionMessages } from '../chat-runtime/es/commands'
import type { MessageRecordedFact } from '../chat-runtime/es/events'
import type { RuntimeKind } from '../provider-contracts/types'
import { listDurableProviderRuntimeBindingsByProviderSession } from '../provider-runtime/service'
import * as Workspace from '../workspace/service'
import { localWorkspaceLocator } from '../workspace/workspace-locator'

type SourceApp = 'claude' | 'codex' | 'cursor' | 'windsurf' | 'gemini' | 'unknown'
type SourceScope = 'server' | 'electron-upload'
type SourceKind = 'settings' | 'project' | 'session' | 'instruction' | 'mcp' | 'command' | 'hook' | 'skill' | 'plugin' | 'subagent'
type ImportStatus = 'pending' | 'imported' | 'duplicate' | 'skipped' | 'error'

interface PreviewInput {
  includeHome?: boolean
  cwds?: string[]
  sourceApps?: SourceApp[]
  limitPerSource?: number
}

interface UploadPreviewInput {
  files: Array<{
    sourceApp: SourceApp
    path: string
    content: string
    workspacePath?: string | null
    modifiedAt?: number | null
  }>
}

export interface PreviewItem {
  id: string
  sourceApp: SourceApp
  sourceScope: SourceScope
  sourceKind: SourceKind
  title: string
  summary: string | null
  sourcePath: string | null
  externalId: string
  fingerprint: string
  workspacePath: string | null
  createdAt: number | null
  updatedAt: number | null
  duplicate: boolean
  duplicateImportId: string | null
  importable: boolean
  reason: string | null
  payloadJson: string
}

interface SessionMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: number | null
}

interface CandidateDraft {
  sourceApp: SourceApp
  sourceScope: SourceScope
  sourceKind: SourceKind
  title: string
  summary: string | null
  sourcePath: string | null
  externalId: string
  workspacePath: string | null
  createdAt: number | null
  updatedAt: number | null
  importable: boolean
  reason: string | null
  payload: Record<string, unknown>
}

interface ImportResultItem {
  fingerprint: string
  status: ImportStatus
  record: PublicImportRecord | null
  sessionId: string | null
  workspaceId: string | null
  reason: string | null
}

interface ImportResult {
  imported: number
  duplicates: number
  skipped: number
  errors: number
  items: ImportResultItem[]
}

type PublicImportRecord = Omit<ExternalWorkImportItem, 'payloadJson'>

const JsonLineSchema = z.record(z.string(), z.unknown())
const DEFAULT_LIMIT_PER_SOURCE = 500
const MAX_TEXT_BYTES = 8 * 1024 * 1024
const CRADLE_SESSION_DUPLICATE_REASON = 'Already exists in Cradle'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    )
  }
  return value
}

function unixTimeFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
  }
  return null
}

function compactText(value: string, maxLength = 180): string {
  const compacted = value.replace(/\s+/g, ' ').trim()
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 1)}...` : compacted
}

function fileExtension(path: string): string {
  const name = basename(path)
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

function titleFromText(value: string, fallback: string): string {
  const compacted = compactText(value, 80)
  return compacted.length > 0 ? compacted : fallback
}

function readTextFile(path: string): string | null {
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) {
      return null
    }
    return readFileSync(path, 'utf8')
  }
 catch {
    return null
  }
}

function readJsonLines(content: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    try {
      rows.push(JsonLineSchema.parse(JSON.parse(trimmed)))
    }
 catch {
      continue
    }
  }
  return rows
}

function extractText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry
        }
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>
          return extractText(record.text ?? record.content ?? record.input_text ?? record.output_text)
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return extractText(record.text ?? record.content)
  }
  return ''
}

function createFingerprint(input: {
  sourceApp: SourceApp
  sourceKind: SourceKind
  externalId: string
  payload: Record<string, unknown>
}): string {
  if (input.sourceKind === 'session') {
    return sha256(stableJson({
      sourceKind: input.sourceKind,
      payload: input.payload,
    }))
  }

  return sha256(stableJson({
    sourceApp: input.sourceApp,
    sourceKind: input.sourceKind,
    externalId: input.externalId,
    payload: input.payload,
  }))
}

function candidateFromDraft(draft: CandidateDraft, duplicate: ExternalWorkImportItem | null): PreviewItem {
  const payloadJson = stableJson(draft.payload)
  const fingerprint = createFingerprint({
    sourceApp: draft.sourceApp,
    sourceKind: draft.sourceKind,
    externalId: draft.externalId,
    payload: draft.payload,
  })

  return {
    id: `${draft.sourceApp}:${draft.sourceKind}:${fingerprint.slice(0, 16)}`,
    sourceApp: draft.sourceApp,
    sourceScope: draft.sourceScope,
    sourceKind: draft.sourceKind,
    title: draft.title,
    summary: draft.summary,
    sourcePath: draft.sourcePath,
    externalId: draft.externalId,
    fingerprint,
    workspacePath: draft.workspacePath,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    duplicate: Boolean(duplicate),
    duplicateImportId: duplicate?.id ?? null,
    importable: draft.importable && !duplicate,
    reason: duplicate ? 'Already imported' : draft.reason,
    payloadJson,
  }
}

function duplicateRecord(fingerprint: string): ExternalWorkImportItem | null {
  return db()
    .select()
    .from(externalWorkImportItems)
    .where(eq(externalWorkImportItems.fingerprint, fingerprint))
    .get() ?? null
}

function runtimeKindForSourceApp(sourceApp: SourceApp): RuntimeKind | null {
  if (sourceApp === 'claude') {
    return 'claude-agent'
  }
  if (sourceApp === 'codex') {
    return 'codex'
  }
  return null
}

function cradleSessionDuplicate(input: Pick<CandidateDraft, 'sourceApp' | 'sourceKind' | 'externalId'>): {
  sessionId: string
  workspaceId: string | null
} | null {
  if (input.sourceKind !== 'session') {
    return null
  }

  const runtimeKind = runtimeKindForSourceApp(input.sourceApp)
  if (!runtimeKind || input.externalId.startsWith('history:')) {
    return null
  }

  const bindings = listDurableProviderRuntimeBindingsByProviderSession({
    providerSessionId: input.externalId,
    runtimeKind,
  })

  for (const binding of bindings) {
    const session = db()
      .select({
        sessionId: sessions.id,
        workspaceId: sessions.workspaceId,
      })
      .from(sessions)
      .where(eq(sessions.id, binding.chatSessionId))
      .get()
    if (session) {
      return session
    }
  }

  return null
}

function applyDuplicates(drafts: CandidateDraft[]): PreviewItem[] {
  const items = drafts.flatMap((draft) => {
    const fingerprint = createFingerprint({
      sourceApp: draft.sourceApp,
      sourceKind: draft.sourceKind,
      externalId: draft.externalId,
      payload: draft.payload,
    })
    const duplicate = duplicateRecord(fingerprint)
    const item = candidateFromDraft(draft, duplicate)
    if (duplicate) {
      return [item]
    }

    if (cradleSessionDuplicate(draft)) {
      return []
    }

    return [item]
  })

  const byFingerprint = new Map<string, PreviewItem>()
  for (const item of items) {
    const existing = byFingerprint.get(item.fingerprint)
    if (!existing) {
      byFingerprint.set(item.fingerprint, item)
      continue
    }
    if (existing.sourceScope === 'electron-upload' && item.sourceScope === 'server') {
      byFingerprint.set(item.fingerprint, item)
    }
  }
  return Array.from(byFingerprint.values())
}

function createClaudeSessionDraft(input: {
  sourceScope: SourceScope
  path: string
  content: string
  workspacePath?: string | null
  modifiedAt?: number | null
}): CandidateDraft | null {
  const rows = readJsonLines(input.content)
  const messagesForImport: SessionMessage[] = []
  let sessionId: string | null = null
  let workspacePath: string | null = input.workspacePath ?? null
  let firstAt: number | null = null
  let lastAt: number | null = input.modifiedAt ?? null

  for (const row of rows) {
    const type = row.type
    const nested = row.message && typeof row.message === 'object'
      ? row.message as Record<string, unknown>
      : null
    const role = nested?.role === 'assistant' || nested?.role === 'user'
      ? nested.role
      : type === 'assistant' || type === 'user'
        ? type
        : null
    if (role !== 'assistant' && role !== 'user') {
      continue
    }

    const text = extractText(nested?.content ?? row.content)
    if (!text.trim()) {
      continue
    }
    const createdAt = unixTimeFromUnknown(row.timestamp)
    firstAt ??= createdAt
    lastAt = createdAt ?? lastAt
    sessionId = typeof row.sessionId === 'string' ? row.sessionId : sessionId
    workspacePath = typeof row.cwd === 'string' ? row.cwd : workspacePath
    messagesForImport.push({
      role,
      content: text,
      createdAt,
    })
  }

  if (messagesForImport.length === 0) {
    return null
  }

  const externalId = sessionId ?? basename(input.path, '.jsonl')
  const firstUserMessage = messagesForImport.find(message => message.role === 'user')?.content ?? messagesForImport[0]?.content ?? ''
  return {
    sourceApp: 'claude',
    sourceScope: input.sourceScope,
    sourceKind: 'session',
    title: titleFromText(firstUserMessage, `Claude session ${externalId}`),
    summary: `${messagesForImport.length} messages`,
    sourcePath: input.path,
    externalId,
    workspacePath,
    createdAt: firstAt,
    updatedAt: lastAt,
    importable: true,
    reason: null,
    payload: {
      kind: 'session',
      messages: messagesForImport,
    },
  }
}

function createCodexSessionDraft(input: {
  sourceScope: SourceScope
  path: string
  content: string
  workspacePath?: string | null
  modifiedAt?: number | null
}): CandidateDraft | null {
  const rows = readJsonLines(input.content)
  const messagesForImport: SessionMessage[] = []
  let sessionId: string | null = null
  let workspacePath: string | null = input.workspacePath ?? null
  let firstAt: number | null = null
  let lastAt: number | null = input.modifiedAt ?? null

  for (const row of rows) {
    if (row.type === 'session_meta' && row.payload && typeof row.payload === 'object') {
      const payload = row.payload as Record<string, unknown>
      sessionId = typeof payload.id === 'string' ? payload.id : sessionId
      workspacePath = typeof payload.cwd === 'string' ? payload.cwd : workspacePath
      continue
    }
    if (row.type !== 'response_item' || !row.payload || typeof row.payload !== 'object') {
      continue
    }

    const payload = row.payload as Record<string, unknown>
    const role = payload.role === 'assistant' || payload.role === 'user' ? payload.role : null
    if (role !== 'assistant' && role !== 'user') {
      continue
    }
    const text = extractText(payload.content)
    if (!text.trim()) {
      continue
    }
    const createdAt = unixTimeFromUnknown(row.timestamp)
    firstAt ??= createdAt
    lastAt = createdAt ?? lastAt
    messagesForImport.push({ role, content: text, createdAt })
  }

  if (messagesForImport.length === 0) {
    return null
  }

  const externalId = sessionId ?? basename(input.path, '.jsonl')
  const firstUserMessage = messagesForImport.find(message => message.role === 'user')?.content ?? messagesForImport[0]?.content ?? ''
  return {
    sourceApp: 'codex',
    sourceScope: input.sourceScope,
    sourceKind: 'session',
    title: titleFromText(firstUserMessage, `Codex session ${externalId}`),
    summary: `${messagesForImport.length} messages`,
    sourcePath: input.path,
    externalId,
    workspacePath,
    createdAt: firstAt,
    updatedAt: lastAt,
    importable: true,
    reason: null,
    payload: {
      kind: 'session',
      messages: messagesForImport,
    },
  }
}

function createCodexHistoryDraft(input: {
  sourceScope: SourceScope
  path: string
  content: string
  modifiedAt?: number | null
}): CandidateDraft[] {
  const rows = readJsonLines(input.content)
  const bySession = new Map<string, SessionMessage[]>()
  for (const row of rows) {
    if (typeof row.session_id !== 'string' || typeof row.text !== 'string') {
      continue
    }
    const createdAt = unixTimeFromUnknown(row.ts)
    const list = bySession.get(row.session_id) ?? []
    list.push({
      role: 'user',
      content: row.text,
      createdAt,
    })
    bySession.set(row.session_id, list)
  }

  return Array.from(bySession.entries()).map(([sessionId, sessionMessages]) => {
    const first = sessionMessages[0]?.content ?? ''
    const timestamps = sessionMessages.map(message => message.createdAt).filter((value): value is number => value !== null)
    return {
      sourceApp: 'codex',
      sourceScope: input.sourceScope,
      sourceKind: 'session',
      title: titleFromText(first, `Codex history ${sessionId}`),
      summary: `${sessionMessages.length} prompts`,
      sourcePath: input.path,
      externalId: `history:${sessionId}`,
      workspacePath: null,
      createdAt: timestamps.length > 0 ? Math.min(...timestamps) : null,
      updatedAt: timestamps.length > 0 ? Math.max(...timestamps) : input.modifiedAt ?? null,
      importable: true,
      reason: null,
      payload: {
        kind: 'session',
        messages: sessionMessages,
      },
    }
  })
}

function statModifiedAt(path: string): number | null {
  try {
    return Math.floor(statSync(path).mtimeMs / 1000)
  }
 catch {
    return null
  }
}

function collectFiles(root: string, extensions: string | Set<string>, limit: number): string[] {
  const allowedExtensions = typeof extensions === 'string' ? new Set([extensions]) : extensions
  const entries: Array<{ path: string, modifiedAt: number }> = []
  const visit = (dir: string, depth: number) => {
    if (depth > 4) {
      return
    }
    let children: string[]
    try {
      children = readdirSync(dir)
    }
 catch {
      return
    }
    for (const child of children) {
      const path = join(dir, child)
      try {
        const stat = statSync(path)
        if (stat.isDirectory()) {
          visit(path, depth + 1)
        }
 else if (stat.isFile() && allowedExtensions.has(fileExtension(path))) {
          entries.push({ path, modifiedAt: Math.floor(stat.mtimeMs / 1000) })
        }
      }
 catch {
        continue
      }
    }
  }
  visit(root, 0)
  return entries
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, limit)
    .map(entry => entry.path)
}

function scanServerDrafts(input: PreviewInput): { drafts: CandidateDraft[], warnings: string[] } {
  const limit = input.limitPerSource ?? DEFAULT_LIMIT_PER_SOURCE
  const apps = new Set(input.sourceApps ?? ['claude', 'codex'])
  const drafts: CandidateDraft[] = []
  const warnings: string[] = []
  const home = homedir()

  if (input.includeHome !== false && apps.has('claude')) {
    const claudeDir = join(home, '.claude')
    for (const path of collectFiles(join(claudeDir, 'projects'), '.jsonl', limit)) {
      const content = readTextFile(path)
      if (!content) {
        continue
      }
      const draft = createClaudeSessionDraft({
        sourceScope: 'server',
        path,
        content,
        modifiedAt: statModifiedAt(path),
      })
      if (draft) {
        drafts.push(draft)
      }
    }
  }

  if (input.includeHome !== false && apps.has('codex')) {
    const codexDir = join(home, '.codex')
    const historyPath = join(codexDir, 'history.jsonl')
    const historyContent = readTextFile(historyPath)
    if (historyContent) {
      drafts.push(...createCodexHistoryDraft({
        sourceScope: 'server',
        path: historyPath,
        content: historyContent,
        modifiedAt: statModifiedAt(historyPath),
      }).slice(0, limit))
    }

    for (const path of collectFiles(join(codexDir, 'archived_sessions'), '.jsonl', limit)) {
      const content = readTextFile(path)
      if (!content) {
        continue
      }
      const draft = createCodexSessionDraft({
        sourceScope: 'server',
        path,
        content,
        modifiedAt: statModifiedAt(path),
      })
      if (draft) {
        drafts.push(draft)
      }
    }
  }

  for (const cwd of input.cwds ?? []) {
    if (!existsSync(cwd)) {
      warnings.push(`Skipped missing workspace path: ${cwd}`)
      continue
    }
  }

  return { drafts, warnings }
}

export function preview(input: PreviewInput = {}): { items: PreviewItem[], warnings: string[] } {
  const { drafts, warnings } = scanServerDrafts(input)
  return {
    items: applyDuplicates(drafts.filter(draft => draft.sourceKind === 'session')),
    warnings,
  }
}

export function uploadPreview(input: UploadPreviewInput): { items: PreviewItem[], warnings: string[] } {
  const drafts: CandidateDraft[] = []
  for (const file of input.files) {
    if (!file.path.endsWith('.jsonl')) {
      continue
    }
    if (file.sourceApp === 'claude') {
      const draft = createClaudeSessionDraft({
        sourceScope: 'electron-upload',
        path: file.path,
        content: file.content,
        workspacePath: file.workspacePath ?? null,
        modifiedAt: file.modifiedAt ?? null,
      })
      if (draft) {
        drafts.push(draft)
      }
      continue
    }
    if (file.sourceApp === 'codex' && basename(file.path) === 'history.jsonl') {
      drafts.push(...createCodexHistoryDraft({
        sourceScope: 'electron-upload',
        path: file.path,
        content: file.content,
        modifiedAt: file.modifiedAt ?? null,
      }))
      continue
    }
    if (file.sourceApp === 'codex') {
      const draft = createCodexSessionDraft({
        sourceScope: 'electron-upload',
        path: file.path,
        content: file.content,
        workspacePath: file.workspacePath ?? null,
        modifiedAt: file.modifiedAt ?? null,
      })
      if (draft) {
        drafts.push(draft)
      }
    }
  }

  return {
    items: applyDuplicates(drafts.filter(draft => draft.sourceKind === 'session')),
    warnings: [],
  }
}

function resolveWorkspaceId(workspacePath: string | null): string | null {
  if (!workspacePath || !existsSync(workspacePath)) {
    return null
  }
  const existing = Workspace.resolveByPath(workspacePath)
  if (existing) {
    return existing.id
  }
  try {
    return Workspace.create({ name: basename(workspacePath), locator: localWorkspaceLocator(workspacePath) }).id
  }
 catch {
    return Workspace.resolveByPath(workspacePath)?.id ?? null
  }
}

async function insertImportedSession(item: PreviewItem, workspaceId: string | null): Promise<string | null> {
  const payload = z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      createdAt: z.number().nullable(),
    })),
  }).passthrough().parse(JSON.parse(item.payloadJson))

  if (payload.messages.length === 0) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const createdAt = item.createdAt ?? payload.messages[0]?.createdAt ?? now
  const updatedAt = item.updatedAt ?? payload.messages.at(-1)?.createdAt ?? createdAt
  const sessionId = randomUUID()

  db().insert(sessions).values({
    id: sessionId,
    workspaceId,
    title: item.title,
    providerTargetId: null,
    runtimeKind: item.sourceApp === 'codex' ? 'codex' : item.sourceApp === 'claude' ? 'claude-agent' : 'standard',
    agentId: null,
    configJson: stableJson({
      importedFrom: {
        sourceApp: item.sourceApp,
        sourceScope: item.sourceScope,
        sourcePath: item.sourcePath,
        externalId: item.externalId,
        fingerprint: item.fingerprint,
      },
    }),
    createdAt,
    updatedAt,
  }).run()

  const importedMessages: Array<MessageRecordedFact & { status: 'complete' }> = payload.messages.map((message, index) => {
    const messageId = randomUUID()
    const messageCreatedAt = message.createdAt ?? createdAt + index
    const snapshot = {
      id: messageId,
      role: message.role,
      parts: [
        { type: 'text', text: message.content },
      ],
    }
    return {
      id: messageId,
      sessionId,
      parentMessageId: null,
      parentToolCallId: null,
      taskId: null,
      depth: 0,
      role: message.role,
      status: 'complete',
      content: message.content,
      messageJson: stableJson(snapshot),
      errorText: null,
      createdAt: messageCreatedAt,
      updatedAt: messageCreatedAt,
    }
  })

  await recordImportedSessionMessages({ sessionId, messages: importedMessages })

  return sessionId
}

function insertRecord(input: {
  item: PreviewItem
  workspaceId: string | null
  sessionId: string | null
  messageId: string | null
  status: 'imported' | 'skipped' | 'error'
  statusReason: string | null
}): ExternalWorkImportItem {
  const now = Math.floor(Date.now() / 1000)
  return db().insert(externalWorkImportItems).values({
    id: randomUUID(),
    sourceApp: input.item.sourceApp,
    sourceScope: input.item.sourceScope,
    sourceKind: input.item.sourceKind,
    sourcePath: input.item.sourcePath,
    externalId: input.item.externalId,
    fingerprint: input.item.fingerprint,
    title: input.item.title,
    summary: input.item.summary,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    payloadJson: input.item.payloadJson,
    status: input.status,
    statusReason: input.statusReason,
    importedAt: now,
    createdAt: now,
    updatedAt: now,
  }).returning().get()
}

function publicRecord(record: ExternalWorkImportItem): PublicImportRecord {
  const { payloadJson: _payloadJson, ...publicFields } = record
  return publicFields
}

export async function importItems(items: PreviewItem[]): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    duplicates: 0,
    skipped: 0,
    errors: 0,
    items: [],
  }

  for (const item of items) {
    if (item.sourceKind !== 'session') {
      result.skipped += 1
      result.items.push({
        fingerprint: item.fingerprint,
        status: 'skipped',
        record: null,
        sessionId: null,
        workspaceId: null,
        reason: 'Only session imports are supported',
      })
      continue
    }

    const duplicate = duplicateRecord(item.fingerprint)
    if (duplicate) {
      result.duplicates += 1
      result.items.push({
        fingerprint: item.fingerprint,
        status: 'duplicate',
        record: publicRecord(duplicate),
        sessionId: duplicate.sessionId,
        workspaceId: duplicate.workspaceId,
        reason: 'Already imported',
      })
      continue
    }

    const existingCradleSession = cradleSessionDuplicate(item)
    if (existingCradleSession) {
      result.duplicates += 1
      result.items.push({
        fingerprint: item.fingerprint,
        status: 'duplicate',
        record: null,
        sessionId: existingCradleSession.sessionId,
        workspaceId: existingCradleSession.workspaceId,
        reason: CRADLE_SESSION_DUPLICATE_REASON,
      })
      continue
    }

    if (!item.importable) {
      const record = insertRecord({
        item,
        workspaceId: null,
        sessionId: null,
        messageId: null,
        status: 'skipped',
        statusReason: item.reason ?? 'Item is not importable',
      })
      result.skipped += 1
      result.items.push({
        fingerprint: item.fingerprint,
        status: 'skipped',
        record: publicRecord(record),
        sessionId: null,
        workspaceId: null,
        reason: record.statusReason,
      })
      continue
    }

    try {
      const workspaceId = resolveWorkspaceId(item.workspacePath)
      const sessionId = await insertImportedSession(item, workspaceId)
      const record = insertRecord({
        item,
        workspaceId,
        sessionId,
        messageId: null,
        status: 'imported',
        statusReason: null,
      })
      result.imported += 1
      result.items.push({
        fingerprint: item.fingerprint,
        status: 'imported',
        record: publicRecord(record),
        sessionId,
        workspaceId,
        reason: null,
      })
    }
 catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const record = insertRecord({
        item,
        workspaceId: null,
        sessionId: null,
        messageId: null,
        status: 'error',
        statusReason: message,
      })
      result.errors += 1
      result.items.push({
        fingerprint: item.fingerprint,
        status: 'error',
        record: publicRecord(record),
        sessionId: null,
        workspaceId: null,
        reason: message,
      })
    }
  }

  return result
}

export function listRecords(): PublicImportRecord[] {
  return db()
    .select()
    .from(externalWorkImportItems)
    .orderBy(desc(externalWorkImportItems.importedAt))
    .limit(100)
    .all()
    .map(publicRecord)
}
