import { randomUUID } from 'node:crypto'

import type { ExternalSessionImport } from '@cradle/db'
import {
  chatMessagePayloads,
  externalSessionImports,
  externalWorkImportItems,
  messages,
  sessions,
} from '@cradle/db'
import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../infra'
import { recordImportedSessionMessagesInTransaction } from '../chat-runtime/es/commands'
import type { MessageRecordedFact } from '../chat-runtime/es/events'
import { messagePayloadJoinCondition } from '../chat-runtime/message-payload-store'
import { listDurableProviderRuntimeBindingsByProviderSession } from '../provider-runtime/service'
import * as Session from '../session/service'
import * as Workspace from '../workspace/service'
import { removeExternalSessionBundle } from './bundle-store'
import {
  resolveExternalSessionCandidates,
} from './catalog'
import { createContentHash, readMessageText, safeJsonValue } from './source-utils'
import { createExternalSessionSources } from './sources'
import type {
  ExternalSessionBundle,
  ExternalSessionDescriptor,
  ExternalSessionImportMessage,
  ExternalSessionReadResult,
  ExternalSessionSourceAdapter,
} from './types'

export type ExternalSessionImportItemStatus = 'imported' | 'duplicate' | 'error'

export interface ExternalSessionImportResultItem {
  candidateId: string
  status: ExternalSessionImportItemStatus
  sessionId: string | null
  workspaceId: string | null
  recordId: string | null
  reason: string | null
}

export interface ExternalSessionImportResult {
  imported: number
  duplicates: number
  errors: number
  items: ExternalSessionImportResultItem[]
}

export interface ExternalSessionImportDependencies {
  adapters?: ExternalSessionSourceAdapter[]
}

export interface ExternalSessionSyncResult {
  importId: string
  sessionId: string
  workspaceId: string
  status: 'unchanged' | 'synced' | 'diverged'
  appendedMessages: number
  reason: string | null
}

const ImportCheckpointSchema = z.object({
  version: z.literal(1),
  sourceRevision: z.string(),
  contentHash: z.string(),
  entries: z.array(z.object({
    sourceMessageId: z.string(),
    contentHash: z.string(),
    persistedMessageId: z.string(),
  })),
})

const LegacyPayloadSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })),
})

type ImportCheckpoint = z.infer<typeof ImportCheckpointSchema>

interface LegacyImport {
  id: string
  sessionId: string
  workspaceId: string | null
  payloadJson: string
}

export async function importExternalSessions(input: {
  scanId: string
  candidateIds: string[]
}, dependencies: ExternalSessionImportDependencies = {}): Promise<ExternalSessionImportResult> {
  const descriptors = resolveExternalSessionCandidates(input.scanId, input.candidateIds)
  const adapters = new Map<string, ExternalSessionSourceAdapter>(
    (dependencies.adapters ?? createExternalSessionSources())
      .map(adapter => [adapter.sourceApp, adapter] as const),
  )
  const result: ExternalSessionImportResult = {
    imported: 0,
    duplicates: 0,
    errors: 0,
    items: [],
  }

  for (const descriptor of descriptors) {
    const duplicate = findCurrentImport(descriptor)
    if (duplicate) {
      result.duplicates += 1
      result.items.push({
        candidateId: descriptor.candidateId,
        status: 'duplicate',
        sessionId: duplicate.sessionId,
        workspaceId: duplicate.workspaceId,
        recordId: duplicate.id,
        reason: 'Already imported',
      })
      continue
    }
    const legacy = findLegacyImport(descriptor)
    const providerDuplicate = legacy ? null : findProviderSessionDuplicate(descriptor)
    if (providerDuplicate) {
      result.duplicates += 1
      result.items.push({
        candidateId: descriptor.candidateId,
        status: 'duplicate',
        sessionId: providerDuplicate.sessionId,
        workspaceId: providerDuplicate.workspaceId,
        recordId: null,
        reason: 'Already exists in Cradle',
      })
      continue
    }

    const adapter = adapters.get(descriptor.sourceApp)
    if (!adapter) {
      result.errors += 1
      result.items.push(importError(descriptor, `No ${descriptor.sourceApp} import adapter is available`))
      continue
    }

    try {
      const bundle = await adapter.capture({ descriptor })
      let imported: ReturnType<typeof persistImportedSession>
      try {
        const source = await adapter.read({ descriptor, bundle })
        imported = persistImportedSession(source, bundle, legacy)
      }
      catch (error) {
        await removeExternalSessionBundle(bundle)
        throw error
      }
      result.imported += 1
      result.items.push({
        candidateId: descriptor.candidateId,
        status: 'imported',
        sessionId: imported.sessionId,
        workspaceId: imported.workspaceId,
        recordId: imported.recordId,
        reason: null,
      })
    }
    catch (error) {
      result.errors += 1
      result.items.push(importError(
        descriptor,
        error instanceof Error ? error.message : String(error),
      ))
    }
  }
  return result
}

export async function syncExternalSessionImport(input: {
  importId: string
  scanId: string
  candidateId: string
}, dependencies: ExternalSessionImportDependencies = {}): Promise<ExternalSessionSyncResult> {
  const record = db()
    .select()
    .from(externalSessionImports)
    .where(eq(externalSessionImports.id, input.importId))
    .get()
  if (!record) {
    throw new Error('External session import was not found')
  }
  const [descriptor] = resolveExternalSessionCandidates(input.scanId, [input.candidateId])
  if (!descriptor
    || descriptor.sourceHostId !== record.sourceHostId
    || descriptor.sourceApp !== record.sourceApp
    || descriptor.externalSessionId !== record.externalSessionId) {
    throw new Error('The selected source candidate does not match this import')
  }
  const adapter = (dependencies.adapters ?? createExternalSessionSources())
    .find(candidate => candidate.sourceApp === descriptor.sourceApp)
  if (!adapter) {
    throw new Error(`No ${descriptor.sourceApp} import adapter is available`)
  }
  const bundle = await adapter.capture({ descriptor })
  let source: ExternalSessionReadResult
  try {
    source = await adapter.read({ descriptor, bundle })
  }
  catch (error) {
    await removeExternalSessionBundle(bundle)
    throw error
  }
  const checkpoint = parseCheckpoint(record.checkpointJson)
  const divergence = findCheckpointDivergence(checkpoint, source.messages)
  if (divergence) {
    await removeExternalSessionBundle(bundle)
    const now = Math.floor(Date.now() / 1000)
    db().update(externalSessionImports).set({
      status: 'error',
      statusReason: divergence,
      updatedAt: now,
    }).where(eq(externalSessionImports.id, record.id)).run()
    return {
      importId: record.id,
      sessionId: record.sessionId,
      workspaceId: record.workspaceId,
      status: 'diverged',
      appendedMessages: 0,
      reason: divergence,
    }
  }

  const appended = source.messages.slice(checkpoint.entries.length)
  const persistedMessageIds = new Map(checkpoint.entries.map(entry => [
    entry.sourceMessageId,
    entry.persistedMessageId,
  ]))
  const now = Math.floor(Date.now() / 1000)
  const updatedAt = source.descriptor.updatedAt
    ?? appended.at(-1)?.createdAt
    ?? record.updatedAt
  try {
    db().transaction((transaction) => {
      if (appended.length > 0) {
        recordImportedSessionMessagesInTransaction(transaction, {
          sessionId: record.sessionId,
          messages: appended.map((message, index) =>
            importedMessageFact(record.sessionId, message, updatedAt + index)),
        })
        Session.touchImportedSessionInTransaction(transaction, {
          sessionId: record.sessionId,
          updatedAt,
        })
      }
      transaction.update(externalSessionImports).set({
        sourcePath: source.descriptor.sourcePath,
        sourceWorkspacePath: source.descriptor.workspacePath,
        sourceRevision: source.descriptor.sourceRevision,
        contentHash: source.contentHash,
        sourceGitIdentityJson: JSON.stringify(source.descriptor.gitIdentity),
        bundlePath: bundle.storagePath,
        bundleManifestJson: JSON.stringify(bundle.manifest),
        parserVersion: bundle.manifest.parserVersion,
        fidelityJson: JSON.stringify(source.fidelity),
        checkpointJson: JSON.stringify(createCheckpoint(source, persistedMessageIds)),
        status: 'imported',
        statusReason: null,
        lastSyncedAt: now,
        updatedAt: now,
      }).where(eq(externalSessionImports.id, record.id)).run()
    })
  }
  catch (error) {
    await removeExternalSessionBundle(bundle)
    throw error
  }
  return {
    importId: record.id,
    sessionId: record.sessionId,
    workspaceId: record.workspaceId,
    status: appended.length > 0 ? 'synced' : 'unchanged',
    appendedMessages: appended.length,
    reason: null,
  }
}

export type ExternalSessionImportView = Omit<
  ExternalSessionImport,
  'bundlePath' | 'bundleManifestJson' | 'parserVersion'
>

export function listExternalSessionImports(): ExternalSessionImportView[] {
  return db()
    .select()
    .from(externalSessionImports)
    .orderBy(desc(externalSessionImports.lastSyncedAt))
    .all()
    .map(({ bundlePath: _bundlePath, bundleManifestJson: _bundleManifestJson, parserVersion: _parserVersion, ...record }) => record)
}

function persistImportedSession(
  source: ExternalSessionReadResult,
  bundle: ExternalSessionBundle,
  legacy: LegacyImport | null,
): {
  recordId: string
  sessionId: string
  workspaceId: string
} {
  if (source.messages.length === 0) {
    throw new Error('External session contains no importable user or assistant messages')
  }
  const now = Math.floor(Date.now() / 1000)
  const createdAt = source.descriptor.createdAt
    ?? source.messages[0]?.createdAt
    ?? now
  const updatedAt = source.descriptor.updatedAt
    ?? source.messages.at(-1)?.createdAt
    ?? createdAt
  return db().transaction((transaction) => {
    const workspace = Workspace.recoverHistoricalWorkspaceInTransaction(transaction, {
      sourceHostId: source.descriptor.sourceHostId,
      workspacePath: source.descriptor.workspacePath,
      gitIdentity: source.descriptor.gitIdentity,
    })
    const configJson = JSON.stringify({
      importedFrom: {
        sourceHostId: source.descriptor.sourceHostId,
        sourceApp: source.descriptor.sourceApp,
        externalSessionId: source.descriptor.externalSessionId,
        sourcePath: source.descriptor.sourcePath,
        sourceRevision: source.descriptor.sourceRevision,
        contentHash: source.contentHash,
      },
    })
    const session = legacy
      ? Session.adoptLegacyImportedSessionInTransaction(transaction, {
          sessionId: legacy.sessionId,
          workspaceId: workspace.id,
          title: source.descriptor.title,
          runtimeKind: source.descriptor.sourceApp === 'codex' ? 'codex' : 'claude-agent',
          configJson,
          updatedAt,
        })
      : Session.createImportedSessionInTransaction(transaction, {
          workspaceId: workspace.id,
          title: source.descriptor.title,
          runtimeKind: source.descriptor.sourceApp === 'codex' ? 'codex' : 'claude-agent',
          configJson,
          createdAt,
          updatedAt,
        })
    const legacyProjection = legacy
      ? mapLegacyMessagesToSource(transaction, legacy, source)
      : new Map<string, string>()
    const newMessages = source.messages.filter(message => !legacyProjection.has(message.message.id))
    recordImportedSessionMessagesInTransaction(transaction, {
      sessionId: session.id,
      messages: newMessages.map((message, index) =>
        importedMessageFact(session.id, message, createdAt + index)),
    })
    const checkpoint = createCheckpoint(source, legacyProjection)
    if (legacy) {
      transaction.update(externalWorkImportItems).set({
        workspaceId: workspace.id,
        status: 'imported',
        statusReason: null,
        updatedAt: now,
      }).where(eq(externalWorkImportItems.id, legacy.id)).run()
    }
    const record = transaction.insert(externalSessionImports).values({
      id: randomUUID(),
      sourceHostId: source.descriptor.sourceHostId,
      sourceApp: source.descriptor.sourceApp,
      externalSessionId: source.descriptor.externalSessionId,
      sourcePath: source.descriptor.sourcePath,
      sourceWorkspacePath: source.descriptor.workspacePath,
      sourceRevision: source.descriptor.sourceRevision,
      contentHash: source.contentHash,
      sourceGitIdentityJson: JSON.stringify(source.descriptor.gitIdentity),
      bundlePath: bundle.storagePath,
      bundleManifestJson: JSON.stringify(bundle.manifest),
      parserVersion: bundle.manifest.parserVersion,
      workspaceId: workspace.id,
      sessionId: session.id,
      fidelityJson: JSON.stringify(source.fidelity),
      checkpointJson: JSON.stringify(checkpoint),
      status: 'imported',
      statusReason: null,
      importedAt: now,
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    }).returning().get()
    return {
      recordId: record.id,
      sessionId: session.id,
      workspaceId: workspace.id,
    }
  })
}

function importedMessageFact(
  sessionId: string,
  imported: ExternalSessionImportMessage,
  fallbackCreatedAt: number,
): MessageRecordedFact & { status: 'complete' } {
  const createdAt = imported.createdAt ?? fallbackCreatedAt
  if (imported.message.role !== 'user' && imported.message.role !== 'assistant') {
    throw new Error(`Unsupported imported message role: ${imported.message.role}`)
  }
  return {
    id: imported.message.id,
    sessionId,
    parentMessageId: null,
    parentToolCallId: null,
    taskId: null,
    depth: 0,
    role: imported.message.role,
    status: 'complete',
    content: readMessageText(imported.message),
    messageJson: JSON.stringify(imported.message),
    errorText: null,
    createdAt,
    updatedAt: createdAt,
  }
}

function createCheckpoint(
  source: ExternalSessionReadResult,
  persistedMessageIds: ReadonlyMap<string, string> = new Map(),
): ImportCheckpoint {
  return {
    version: 1,
    sourceRevision: source.descriptor.sourceRevision,
    contentHash: source.contentHash,
    entries: source.messages.map(message => ({
      sourceMessageId: message.message.id,
      contentHash: createContentHash([message]),
      persistedMessageId: persistedMessageIds.get(message.message.id) ?? message.message.id,
    })),
  }
}

function parseCheckpoint(value: string): ImportCheckpoint {
  return ImportCheckpointSchema.parse(JSON.parse(value))
}

function findCheckpointDivergence(
  checkpoint: ImportCheckpoint,
  messagesToSync: ExternalSessionImportMessage[],
): string | null {
  if (messagesToSync.length < checkpoint.entries.length) {
    return 'The provider source is shorter than the imported checkpoint'
  }
  for (let index = 0; index < checkpoint.entries.length; index += 1) {
    const expected = checkpoint.entries[index]!
    const actual = messagesToSync[index]!
    if (actual.message.id !== expected.sourceMessageId
      || createContentHash([actual]) !== expected.contentHash) {
      return `The provider source changed before the import checkpoint at message ${index + 1}`
    }
  }
  return null
}

function mapLegacyMessagesToSource(
  transaction: Workspace.WorkspaceTransaction,
  legacy: LegacyImport,
  source: ExternalSessionReadResult,
): Map<string, string> {
  const parsedPayload = LegacyPayloadSchema.safeParse(safeJsonValue(legacy.payloadJson))
  if (!parsedPayload.success) {
    return new Map()
  }
  const legacyRows = transaction
    .select({
      id: messages.id,
      role: messages.role,
      content: chatMessagePayloads.content,
    })
    .from(messages)
    .innerJoin(chatMessagePayloads, messagePayloadJoinCondition())
    .where(eq(messages.sessionId, legacy.sessionId))
    .orderBy(asc(messages.createdAt))
    .all()
  const mapped = new Map<string, string>()
  let sourceIndex = 0
  let rowIndex = 0
  for (const payloadMessage of parsedPayload.data.messages) {
    const sourceIndexOffset = source.messages.slice(sourceIndex).findIndex(message =>
      message.message.role === payloadMessage.role
      && readMessageText(message.message) === payloadMessage.content)
    const rowIndexOffset = legacyRows.slice(rowIndex).findIndex(message =>
      message.role === payloadMessage.role
      && message.content === payloadMessage.content)
    if (sourceIndexOffset < 0 || rowIndexOffset < 0) {
      continue
    }
    sourceIndex += sourceIndexOffset
    rowIndex += rowIndexOffset
    mapped.set(source.messages[sourceIndex]!.message.id, legacyRows[rowIndex]!.id)
    sourceIndex += 1
    rowIndex += 1
  }
  return mapped
}

function findCurrentImport(descriptor: ExternalSessionDescriptor): {
  id: string
  sessionId: string
  workspaceId: string
} | null {
  return db()
    .select({
      id: externalSessionImports.id,
      sessionId: externalSessionImports.sessionId,
      workspaceId: externalSessionImports.workspaceId,
    })
    .from(externalSessionImports)
    .where(and(
      eq(externalSessionImports.sourceHostId, descriptor.sourceHostId),
      eq(externalSessionImports.sourceApp, descriptor.sourceApp),
      eq(externalSessionImports.externalSessionId, descriptor.externalSessionId),
    ))
    .get() ?? null
}

function findLegacyImport(descriptor: ExternalSessionDescriptor): LegacyImport | null {
  const records = db()
    .select({
      id: externalWorkImportItems.id,
      sessionId: externalWorkImportItems.sessionId,
      workspaceId: externalWorkImportItems.workspaceId,
      externalId: externalWorkImportItems.externalId,
      payloadJson: externalWorkImportItems.payloadJson,
    })
    .from(externalWorkImportItems)
    .where(and(
      eq(externalWorkImportItems.sourceApp, descriptor.sourceApp),
      eq(externalWorkImportItems.sourceKind, 'session'),
    ))
    .all()
  const record = records.find(candidate =>
    normalizeLegacyExternalId(candidate.externalId) === descriptor.externalSessionId)
  return record?.sessionId
    ? {
        id: record.id,
        sessionId: record.sessionId,
        workspaceId: record.workspaceId,
        payloadJson: record.payloadJson,
      }
    : null
}

function normalizeLegacyExternalId(externalId: string): string {
  return externalId.startsWith('history:') ? externalId.slice('history:'.length) : externalId
}

function findProviderSessionDuplicate(descriptor: ExternalSessionDescriptor): {
  sessionId: string
  workspaceId: string | null
} | null {
  const runtimeKind = descriptor.sourceApp === 'codex' ? 'codex' : 'claude-agent'
  const bindings = listDurableProviderRuntimeBindingsByProviderSession({
    providerSessionId: descriptor.externalSessionId,
    runtimeKind,
  })
  for (const binding of bindings) {
    const session = db()
      .select({ sessionId: sessions.id, workspaceId: sessions.workspaceId })
      .from(sessions)
      .where(eq(sessions.id, binding.chatSessionId))
      .get()
    if (session) {
      return session
    }
  }
  return null
}

function importError(
  descriptor: ExternalSessionDescriptor,
  reason: string,
): ExternalSessionImportResultItem {
  return {
    candidateId: descriptor.candidateId,
    status: 'error',
    sessionId: null,
    workspaceId: null,
    recordId: null,
    reason,
  }
}
