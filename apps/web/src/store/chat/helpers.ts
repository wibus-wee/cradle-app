import type { UIMessage } from 'ai'
import isEqual from 'fast-deep-equal'

import type { AssistantDisplaySplit, MessagePart, MessageReconcileChange } from './types'

interface CradleMessageMetadata {
  continuation?: {
    mode?: string
    queueItemId?: unknown
    sourceMessageId?: unknown
    splitParts?: unknown
  }
}

type ReasoningMessagePart = MessagePart & {
  reasoning?: string
  state?: string
  text?: string
}

// ── Message Reconciliation ───────────────────────────────────
// Preserves object identity for unchanged messages/parts to avoid
// unnecessary React re-renders.

export function reconcileMessages(current: UIMessage[], incoming: UIMessage[]): UIMessage[] {
  if (current === incoming) {
    return current
  }

  const byId = current.length !== incoming.length
    ? new Map(current.map(m => [m.id, m]))
    : null

  let changed = false
  const next = incoming.map((msg, i) => {
    const prev = current[i]?.id === msg.id ? current[i] : byId?.get(msg.id)
    if (!prev) {
      changed = true
      return msg
    }
    const merged = reconcileMessage(prev, msg)
    if (merged !== prev) {
      changed = true
    }
    return merged
  })

  return changed ? next : current
}

export function reconcileMessage(
  current: UIMessage,
  incoming: UIMessage,
  change?: MessageReconcileChange,
): UIMessage {
  if (current === incoming) {
    return current
  }
  if (current.id !== incoming.id || current.role !== incoming.role) {
    return incoming
  }

  const currentMeta = (current as { metadata?: unknown }).metadata
  const incomingMeta = (incoming as { metadata?: unknown }).metadata
  const metadata = isEqual(currentMeta, incomingMeta) ? currentMeta : incomingMeta
  const parts = reconcileParts(current.parts, incoming.parts, change)

  if (metadata === currentMeta && parts === current.parts) {
    return current
  }

  return { ...incoming, ...(metadata === undefined ? {} : { metadata }), parts } as UIMessage
}

function reconcileParts(
  current: MessagePart[],
  incoming: MessagePart[],
  change?: MessageReconcileChange,
): MessagePart[] {
  if (current === incoming) {
    return current
  }

  let changed = false
  const next = incoming.map((part, i) => {
    const prev = current[i]
    if (!prev) {
      changed = true
      return part
    }
    if (canReusePart(prev, part, change)) {
      return prev
    }
    changed = true
    return part
  })

  return changed || current.length !== incoming.length ? next : current
}

function canReusePart(current: MessagePart, incoming: MessagePart, change?: MessageReconcileChange): boolean {
  if (current === incoming) {
    return true
  }
  if (current.type !== incoming.type) {
    return false
  }

  // Tool parts: reuse if toolCallId matches and not dirty
  if (isToolPart(current) && isToolPart(incoming)) {
    const id = getToolCallId(current)
    if (!id || id !== getToolCallId(incoming)) {
      return false
    }
    if (change?.dirtyToolCallIds && !change.dirtyToolCallIds.has(id)) {
      return true
    }
    return isEqual(current, incoming)
  }

  // Text: compare by value
  if (current.type === 'text') {
    return (current as { text: string }).text === (incoming as { text: string }).text
  }

  // Reasoning: compare text + state
  if (current.type === 'reasoning') {
    const c = current as { text?: string, reasoning?: string, state?: string }
    const n = incoming as { text?: string, reasoning?: string, state?: string }
    return c.text === n.text && c.reasoning === n.reasoning && c.state === n.state
  }

  return false
}

// ── Display Split Helpers ────────────────────────────────────

export function hydrateDisplaySplits(
  messages: UIMessage[],
  currentSplits: Map<string, AssistantDisplaySplit>,
): Map<string, AssistantDisplaySplit> {
  const groups = new Map<string, Array<{ message: UIMessage, queueItemId: string | null, sourceMessageId: string, splitParts: MessagePart[], order: number }>>()

  for (let order = 0; order < messages.length; order++) {
    const msg = messages[order]
    if (msg.role !== 'user') {
      continue
    }
    const meta = readCradleMetadata(msg)
    if (meta?.continuation?.mode !== 'steer') {
      continue
    }
    const sourceMessageId = meta.continuation.sourceMessageId
    if (typeof sourceMessageId !== 'string' || !sourceMessageId) {
      continue
    }
    const splitParts = meta.continuation.splitParts
    if (!Array.isArray(splitParts) || !splitParts.every(p => p && typeof p === 'object' && typeof p.type === 'string')) {
      continue
    }

    const entry = { message: msg, queueItemId: getQueueItemId(msg), sourceMessageId, splitParts: splitParts as MessagePart[], order }
    const existing = groups.get(sourceMessageId)
    if (existing) {
      existing.push(entry)
    }
 else {
      groups.set(sourceMessageId, [entry])
    }
  }

  if (groups.size === 0) {
    return currentSplits
  }

  let nextSplits: Map<string, AssistantDisplaySplit> | null = null
  const writable = () => (nextSplits ??= new Map(currentSplits))

  for (const [sourceMessageId, splits] of groups) {
    let currentSourceId = sourceMessageId
    let prevSplitParts: MessagePart[] | null = null

    for (const split of splits.sort((a, b) => a.order - b.order)) {
      const relativeParts = prevSplitParts ? projectTailParts(split.splitParts, prevSplitParts) : split.splitParts
      const tailMessageId = `${currentSourceId}:steer-tail`
      const existing = writable().get(currentSourceId)
      const insertedMessageIds = addUnique(existing?.insertedMessageIds ?? [], split.message.id)
      const insertedQueueItemIds = split.queueItemId
        ? addUnique(existing?.insertedQueueItemIds ?? [], split.queueItemId)
        : existing?.insertedQueueItemIds ?? []

      writable().set(currentSourceId, {
        sourceMessageId: currentSourceId,
        tailMessageId,
        splitParts: trimTrailingEmpty(structuredClone(relativeParts) as MessagePart[]),
        insertedMessageIds,
        insertedQueueItemIds,
      })

      prevSplitParts = split.splitParts
      currentSourceId = tailMessageId
    }
  }

  return nextSplits ?? currentSplits
}

export function applyDisplaySplits(messages: UIMessage[], splits: Map<string, AssistantDisplaySplit>): UIMessage[] {
  if (splits.size === 0) {
    return messages
  }

  const splitSourceIds = new Set(splits.keys())
  const insertedIds = new Set([...splits.values()].flatMap(s => s.insertedMessageIds))
  const insertedQueueIds = new Set([...splits.values()].flatMap(s => s.insertedQueueItemIds))
  const sourceMessages = new Map(messages.filter(m => splitSourceIds.has(m.id)).map(m => [m.id, m]))
  const result: UIMessage[] = []

  for (const msg of messages) {
    if (msg.id.includes(':steer-tail')) {
      continue
    }

    const queueItemId = getQueueItemId(msg)
    if (insertedIds.has(msg.id) || (queueItemId && insertedQueueIds.has(queueItemId))) {
      const sourceIdx = findSplitSourceIndex(result, splits, msg)
      if (sourceIdx !== -1) {
        const split = splits.get(result[sourceIdx].id)
        if (split) {
          const fullSource = sourceMessages.get(result[sourceIdx].id) ?? result[sourceIdx]
          const tail = buildTailMessage(fullSource, split.splitParts, split.tailMessageId)
          const toInsert = hasVisibleParts(tail.parts) ? [msg, tail] : [msg]
          result.splice(sourceIdx + 1, 0, ...toInsert)
          continue
        }
      }
    }

    if (splitSourceIds.has(msg.id)) {
      const split = splits.get(msg.id)
      result.push(split ? { ...msg, parts: structuredClone(split.splitParts) as MessagePart[] } : msg)
      continue
    }

    result.push(msg)
  }

  return result
}

export function projectStreamingThroughSplits(
  message: UIMessage,
  splits: Map<string, AssistantDisplaySplit>,
): UIMessage {
  const seen = new Set<string>()
  let current = message
  while (true) {
    const split = splits.get(current.id)
    if (!split || seen.has(current.id)) {
      return current
    }
    seen.add(current.id)
    current = buildTailMessage(current, split.splitParts, split.tailMessageId)
  }
}

// ── Shared Utilities ─────────────────────────────────────────

export function isToolPart(part: MessagePart): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-')
}

export function getToolCallId(part: MessagePart): string | undefined {
  return (part as { toolCallId?: string }).toolCallId
}

export function getQueueItemId(message: UIMessage): string | null {
  const meta = readCradleMetadata(message)
  const id = meta?.continuation?.queueItemId
  return typeof id === 'string' && id ? id : null
}

export function hasVisibleParts(parts: MessagePart[]): boolean {
  return parts.some(p => !isEmptyPart(p))
}

export function findActiveAssistantId(
  messages: UIMessage[],
  streamingIds: Set<string>,
  activeMessageId?: string | null,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && (streamingIds.has(m.id) || activeMessageId === m.id)) {
      return m.id
    }
  }
  // Fallback: latest assistant
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      return messages[i].id
    }
  }
  return null
}

// ── Internal Helpers ─────────────────────────────────────────

function readCradleMetadata(msg: UIMessage): CradleMessageMetadata | null {
  const metadata = (msg as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }
  const cradle = (metadata as Record<string, unknown>).cradle
  if (!cradle || typeof cradle !== 'object' || Array.isArray(cradle)) {
    return null
  }
  return cradle as CradleMessageMetadata
}

function buildTailMessage(source: UIMessage, splitParts: MessagePart[], tailId: string): UIMessage {
  return { ...source, id: tailId, parts: projectTailParts(source.parts, splitParts) }
}

function projectTailParts(source: MessagePart[], split: MessagePart[]): MessagePart[] {
  let sourceIdx = 0

  for (const splitPart of split) {
    const sourcePart = source[sourceIdx]
    if (!sourcePart || !isSameStreamPart(sourcePart, splitPart)) {
      break
    }
    const remainder = getPartRemainder(sourcePart, splitPart)
    if (remainder) {
      return trimLeadingEmpty([remainder, ...source.slice(sourceIdx + 1)])
    }
    sourceIdx++
  }

  return trimLeadingEmpty(source.slice(sourceIdx))
}

function isSameStreamPart(a: MessagePart, b: MessagePart): boolean {
  if (a.type !== b.type) {
    return false
  }
  if (isToolPart(a)) {
    return getToolCallId(a) === getToolCallId(b)
  }
  return true
}

function getPartRemainder(source: MessagePart, split: MessagePart): MessagePart | null {
  if (source.type === 'text' && split.type === 'text') {
    const s = (source as { text: string }).text
    const p = (split as { text: string }).text
    const rest = s.startsWith(p) ? s.slice(p.length) : s
    return rest ? { ...source, text: rest } as MessagePart : null
  }
  if (source.type === 'reasoning' && split.type === 'reasoning') {
    const sourceReasoningPart = source as ReasoningMessagePart
    const splitReasoningPart = split as ReasoningMessagePart
    const sText = sourceReasoningPart.text ?? sourceReasoningPart.reasoning ?? ''
    const pText = splitReasoningPart.text ?? splitReasoningPart.reasoning ?? ''
    const rest = sText.startsWith(pText) ? sText.slice(pText.length) : sText
    if (!rest) {
      return null
    }
    return sourceReasoningPart.text !== undefined
      ? { ...source, text: rest } as MessagePart
      : { ...source, reasoning: rest } as MessagePart
  }
  return null
}

function isEmptyPart(part: MessagePart): boolean {
  if (part.type === 'text') {
    return !(part as { text: string }).text
  }
  if (part.type === 'reasoning') {
    const reasoningPart = part as ReasoningMessagePart
    return !(reasoningPart.text || reasoningPart.reasoning)
  }
  return false
}

function trimTrailingEmpty(parts: MessagePart[]): MessagePart[] {
  let end = parts.length
  while (end > 0 && isEmptyPart(parts[end - 1])) {
    end--
  }
  return end === parts.length ? parts : parts.slice(0, end)
}

function trimLeadingEmpty(parts: MessagePart[]): MessagePart[] {
  let start = 0
  while (start < parts.length && isEmptyPart(parts[start])) {
    start++
  }
  return start === 0 ? parts : parts.slice(start)
}

function addUnique(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr : [...arr, value]
}

function findSplitSourceIndex(messages: UIMessage[], splits: Map<string, AssistantDisplaySplit>, inserted: UIMessage): number {
  const queueItemId = getQueueItemId(inserted)
  for (let i = messages.length - 1; i >= 0; i--) {
    const split = splits.get(messages[i].id)
    if (split?.insertedMessageIds.includes(inserted.id) || (queueItemId && split?.insertedQueueItemIds.includes(queueItemId))) {
      return i
    }
  }
  return -1
}
