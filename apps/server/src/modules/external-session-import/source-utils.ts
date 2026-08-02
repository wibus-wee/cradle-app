import { createHash } from 'node:crypto'

import type { UIMessage } from 'ai'

import type {
  ExternalSessionDescriptor,
  ExternalSessionGitIdentity,
  ExternalSessionImportMessage,
  ExternalSessionSourceApp,
  ExternalSessionSourceFile,
} from './types'

export function mergeExternalSessionDescriptors(
  descriptors: ExternalSessionDescriptor[],
): ExternalSessionDescriptor[] {
  const byCandidateId = new Map<string, ExternalSessionDescriptor>()
  for (const descriptor of descriptors) {
    const existing = byCandidateId.get(descriptor.candidateId)
    if (!existing || (descriptor.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      byCandidateId.set(descriptor.candidateId, descriptor)
    }
  }
  return [...byCandidateId.values()]
}

export function createCandidateId(input: {
  sourceHostId: string
  sourceApp: ExternalSessionSourceApp
  externalSessionId: string
}): string {
  return createHash('sha256')
    .update(`${input.sourceHostId}\0${input.sourceApp}\0${input.externalSessionId}`)
    .digest('hex')
}

export function createSourceRevision(input: {
  externalSessionId: string
  modifiedAt: number | null
  size: number | null
}): string {
  return createHash('sha256')
    .update(`${input.externalSessionId}\0${input.modifiedAt ?? ''}\0${input.size ?? ''}`)
    .digest('hex')
}

export function createSourceFilesRevision(input: {
  externalSessionId: string
  files: ExternalSessionSourceFile[]
}): string {
  const hash = createHash('sha256').update(input.externalSessionId)
  for (const file of [...input.files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(`\0${file.path}\0${file.kind}\0${file.sourceId}\0${file.modifiedAtMs}\0${file.size}`)
  }
  return hash.digest('hex')
}

export function createContentHash(messages: ExternalSessionImportMessage[]): string {
  return createHash('sha256')
    .update(JSON.stringify(messages.map(message => ({
      sourceEntryIds: message.sourceEntryIds,
      createdAt: message.createdAt,
      message: message.message,
    }))))
    .digest('hex')
}

export function createImportedMessageId(input: {
  sourceApp: ExternalSessionSourceApp
  externalSessionId: string
  sourceEntryId: string
}): string {
  return `external-${createHash('sha256')
    .update(`${input.sourceApp}\0${input.externalSessionId}\0${input.sourceEntryId}`)
    .digest('hex')}`
}

export function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim()
  return compacted.length > maxLength
    ? `${compacted.slice(0, Math.max(0, maxLength - 1))}…`
    : compacted
}

export function titleFromText(value: string, fallback: string): string {
  return compactText(value, 80) || fallback
}

export function unixSeconds(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
}

export function emptyGitIdentity(): ExternalSessionGitIdentity {
  return {
    originUrl: null,
    repoRoot: null,
    branch: null,
    headSha: null,
  }
}

export function importedMessage(input: {
  id: string
  role: UIMessage['role']
  parts: UIMessage['parts']
  sourceEntryIds: string[]
  createdAt: number | null
  descriptor: Pick<ExternalSessionDescriptor, 'sourceApp' | 'externalSessionId'>
}): ExternalSessionImportMessage {
  return {
    sourceEntryIds: input.sourceEntryIds,
    createdAt: input.createdAt,
    message: {
      id: input.id,
      role: input.role,
      parts: input.parts,
      metadata: {
        externalImport: {
          sourceApp: input.descriptor.sourceApp,
          externalSessionId: input.descriptor.externalSessionId,
          sourceEntryIds: input.sourceEntryIds,
        },
      },
    },
  }
}

export function readMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessage['parts'][number], { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('\n')
}

export function safeJsonValue(value: string): unknown {
  try {
    return JSON.parse(value)
  }
  catch {
    return value
  }
}
