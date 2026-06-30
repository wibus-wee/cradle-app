import { useSyncExternalStore } from 'react'

import type { ContextItem, ContextReference, ContextSensitivity } from '~/features/context/context-items'
import { estimateContextTokens } from '~/features/context/context-items'
import type { ContextProvider } from '~/features/context/context-registry'

const MAX_TEXT_SELECTION_CHARS = 2_000
const MAX_REFERENCE_CONTENT_CHARS = 4_000

export interface ExplicitContextAttachmentInput {
  id?: string
  owner: string
  title: string
  summary: string
  content?: string
  reference: ContextReference
  sensitivity?: ContextSensitivity
  priority?: number
}

export interface ExplicitContextAttachment extends Required<Omit<ExplicitContextAttachmentInput, 'id' | 'content' | 'sensitivity' | 'priority'>> {
  id: string
  content?: string
  sensitivity: ContextSensitivity
  priority: number
  createdAt: number
}

const attachmentsById = new Map<string, ExplicitContextAttachment>()
const listeners = new Set<() => void>()
let attachmentsSnapshot: ExplicitContextAttachment[] = []

function emitChange(): void {
  attachmentsSnapshot = [...attachmentsById.values()].toSorted((a, b) => b.priority - a.priority || b.createdAt - a.createdAt)
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function readAttachmentsSnapshot(): ExplicitContextAttachment[] {
  return attachmentsSnapshot
}

function createAttachmentId(input: ExplicitContextAttachmentInput): string {
  return `${input.owner}:${input.reference.kind}:${input.reference.id}`
}

function truncateContent(text: string, limit: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= limit) {
    return trimmed
  }
  return `${trimmed.slice(0, limit).trimEnd()}...`
}

function createContextItem(attachment: ExplicitContextAttachment, now: number): ContextItem {
  const content = attachment.content
    ? truncateContent(attachment.content, MAX_REFERENCE_CONTENT_CHARS)
    : undefined
  const tokenText = [attachment.summary, content].filter((part): part is string => Boolean(part)).join('\n')

  return {
    id: `explicit:${attachment.id}`,
    kind: 'selection',
    owner: attachment.owner,
    title: attachment.title,
    summary: attachment.summary,
    content,
    references: [attachment.reference],
    priority: attachment.priority,
    freshness: now - attachment.createdAt <= 60_000 ? 'live' : 'recent',
    sensitivity: attachment.sensitivity,
    tokenEstimate: estimateContextTokens(tokenText),
    createdAt: attachment.createdAt,
  }
}

export function useExplicitContextAttachments(): ExplicitContextAttachment[] {
  return useSyncExternalStore(subscribe, readAttachmentsSnapshot, readAttachmentsSnapshot)
}

export function listExplicitContextAttachments(): ExplicitContextAttachment[] {
  return readAttachmentsSnapshot()
}

export function addExplicitContextAttachment(input: ExplicitContextAttachmentInput): ExplicitContextAttachment {
  const content = input.content ? truncateContent(input.content, MAX_REFERENCE_CONTENT_CHARS) : undefined
  const attachment: ExplicitContextAttachment = {
    id: input.id ?? createAttachmentId(input),
    owner: input.owner,
    title: input.title,
    summary: input.summary,
    content,
    reference: input.reference,
    sensitivity: input.sensitivity ?? 'private',
    priority: input.priority ?? 120,
    createdAt: Date.now(),
  }

  attachmentsById.set(attachment.id, attachment)
  emitChange()
  return attachment
}

export function removeExplicitContextAttachment(id: string): void {
  if (attachmentsById.delete(id)) {
    emitChange()
  }
}

export function clearExplicitContextAttachments(): void {
  if (attachmentsById.size === 0) {
    return
  }

  attachmentsById.clear()
  emitChange()
}

export function addCurrentTextSelectionAttachment(): ExplicitContextAttachment | null {
  const selection = document.getSelection()
  const selectedText = truncateContent(selection?.toString() ?? '', MAX_TEXT_SELECTION_CHARS)
  if (!selectedText) {
    return null
  }

  return addExplicitContextAttachment({
    owner: 'system-agent',
    title: 'Selected text',
    summary: `User explicitly attached selected text (${selectedText.length} chars).`,
    content: selectedText,
    reference: {
      kind: 'text-selection',
      id: `selection:${Date.now()}`,
      label: selectedText.length > 80 ? `${selectedText.slice(0, 80).trimEnd()}...` : selectedText,
    },
    sensitivity: 'private',
    priority: 130,
  })
}

export function createExplicitContextProvider(): ContextProvider {
  return {
    owner: 'system-agent:explicit',
    readContext(input) {
      return readAttachmentsSnapshot().map(attachment => createContextItem(attachment, input.now))
    },
  }
}
