import { formatShortDurationMs } from '~/lib/number-format'

import { FEED_ENTRY_COUNT_LABELS } from '../../rendering/tool-block-constants'
import { basename, readFirstLine } from '../../rendering/tool-block-utils'
import type { RenderableToolPart, ToolUiKind } from '../../rendering/tool-ui-classifier'
import {
  describeToolCallCached,
  readToolInputPayload,
  readToolPayload,
} from '../../rendering/tool-ui-classifier'

export type ActivityFeedViewEntry
  = | { entryKind: 'tool-call', key: string, part: RenderableToolPart }
    | {
      entryKind: 'reasoning'
      key: string
      text: string
      state?: 'streaming' | 'done'
      durationMs?: number
      overflowOriginalChars?: number | null
      overflowBlobId?: string | null
    }

export type ActivityFeedReasoningEntry = Extract<ActivityFeedViewEntry, { entryKind: 'reasoning' }>
export type ActivityFeedToolEntry = Extract<ActivityFeedViewEntry, { entryKind: 'tool-call' }>

export interface FeedDiffStats {
  additions: number
  deletions: number
}

/** A feed line reads as prose: a leading verb, a fainter object, trailing diff stats. */
export interface FeedLabel {
  verb: string
  object: string | null
  stats: FeedDiffStats | null
}

const EDIT_KINDS = new Set<ToolUiKind>(['file-diff', 'notebook-diff'])

export function isEditKind(kind: ToolUiKind): boolean {
  return EDIT_KINDS.has(kind)
}

export function isActiveToolState(part: RenderableToolPart): boolean {
  return (
    part.state === 'input-streaming'
    || part.state === 'input-available'
    || part.state === 'approval-requested'
  )
}

export function isErrorToolState(part: RenderableToolPart): boolean {
  return part.state === 'output-error' || part.state === 'output-denied'
}

export function isFeedRunning(entries: ActivityFeedViewEntry[]): boolean {
  return entries.some(entry =>
    entry.entryKind === 'reasoning'
      ? entry.state === 'streaming'
      : isActiveToolState(entry.part))
}

// ---------------------------------------------------------------------------
// Diff stats
// ---------------------------------------------------------------------------

/**
 * Providers report edit sizes either as a pre-summed `gitDiff` or as raw patch
 * hunks. Claude Agent's `Edit` only ships `structuredPatch`, so counting hunk
 * lines is the fallback rather than an optimization.
 */
export function readFeedDiffStats(part: RenderableToolPart): FeedDiffStats | null {
  const output = readToolPayload(part.output)
  const { additions, deletions } = output.gitDiff
  if (additions !== 0 || deletions !== 0) {
    return { additions, deletions }
  }

  let added = 0
  let removed = 0
  for (const hunk of output.structuredPatch) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        added += 1
      }
      else if (line.startsWith('-')) {
        removed += 1
      }
    }
  }
  return added === 0 && removed === 0 ? null : { additions: added, deletions: removed }
}

function addStats(left: FeedDiffStats | null, right: FeedDiffStats | null): FeedDiffStats | null {
  if (!left) {
    return right
  }
  if (!right) {
    return left
  }
  return {
    additions: left.additions + right.additions,
    deletions: left.deletions + right.deletions,
  }
}

// ---------------------------------------------------------------------------
// Row labels
// ---------------------------------------------------------------------------

export function readReasoningLabel(entry: ActivityFeedReasoningEntry): FeedLabel {
  if (entry.state === 'streaming') {
    return { verb: 'Thinking', object: null, stats: null }
  }
  if (entry.durationMs !== undefined && entry.durationMs >= 1000) {
    return {
      verb: 'Thought',
      object: `for ${formatShortDurationMs(entry.durationMs)}`,
      stats: null,
    }
  }
  return { verb: 'Thought', object: 'briefly', stats: null }
}

export function readToolRowLabel(part: RenderableToolPart): FeedLabel {
  const descriptor = describeToolCallCached(part)
  const input = readToolInputPayload(part.input, part.argumentsText)
  const output = readToolPayload(part.output)
  const { kind, target, displayName } = descriptor

  switch (kind) {
    case 'file-diff':
    case 'notebook-diff':
      return {
        verb: 'Edited',
        object: target ? basename(target) : null,
        stats: readFeedDiffStats(part),
      }
    case 'file-read':
      return { verb: 'Read', object: target ? basename(target) : null, stats: null }
    case 'terminal':
      return {
        verb: 'Ran',
        object: input.description ?? readFirstLine(input.command ?? output.command) ?? target,
        stats: null,
      }
    case 'search':
      return displayName.includes('Glob')
        ? { verb: 'Searched files', object: readGlobObject(target, input.filePath), stats: null }
        : { verb: 'Grepped', object: target, stats: null }
    case 'web':
      return displayName.includes('Search')
        ? { verb: 'Searched web', object: target, stats: null }
        : { verb: 'Fetched', object: target, stats: null }
    case 'subagent':
      return displayName.includes('Workflow')
        ? { verb: 'Ran workflow', object: target, stats: null }
        : { verb: 'Delegated', object: target, stats: null }
    case 'task-control':
      return { verb: 'Checked task', object: target, stats: null }
    case 'todo':
      return { verb: 'Updated todos', object: target, stats: null }
    case 'plan':
      return { verb: 'Planned', object: target, stats: null }
    case 'plan-implementation':
      return { verb: 'Proposed', object: 'this plan', stats: null }
    case 'question':
      return { verb: 'Asked', object: target, stats: null }
    case 'mcp':
      return { verb: 'Called', object: target ?? displayName, stats: null }
    case 'worktree':
      return {
        verb: displayName.includes('Exit') ? 'Exited worktree' : 'Entered worktree',
        object: target,
        stats: null,
      }
    case 'generic':
      return {
        verb: 'Used',
        object: target ? `${displayName} ${target}` : displayName,
        stats: null,
      }
  }
}

function readGlobObject(pattern: string | null, path: string | null): string | null {
  if (!pattern) {
    return path ? `in ${basename(path)}` : null
  }
  return path ? `${pattern} in ${basename(path)}` : pattern
}

export function readFeedRowLabel(entry: ActivityFeedViewEntry): FeedLabel {
  return entry.entryKind === 'reasoning'
    ? readReasoningLabel(entry)
    : readToolRowLabel(entry.part)
}

// ---------------------------------------------------------------------------
// Collapsed header summary
// ---------------------------------------------------------------------------

function pluralize(count: number, [singular, plural]: readonly [string, string]): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * The header reads as one sentence — "Edited 8 files, explored 13 files, 7
 * searches, ran 1 command" — so kinds collapse into three verb groups and
 * explore nouns merge by label (an MCP call and a generic call are both "tools").
 */
export function composeFeedSummary(entries: ActivityFeedViewEntry[]): FeedLabel {
  const exploreCounts = new Map<string, { count: number, labels: readonly [string, string] }>()
  const editedFiles = new Set<string>()
  let editCount = 0
  let terminalCount = 0
  let stats: FeedDiffStats | null = null

  for (const entry of entries) {
    if (entry.entryKind !== 'tool-call') {
      continue
    }
    const descriptor = describeToolCallCached(entry.part)
    const kind = descriptor.kind

    if (isEditKind(kind)) {
      editCount += 1
      if (descriptor.target) {
        editedFiles.add(basename(descriptor.target))
      }
      stats = addStats(stats, readFeedDiffStats(entry.part))
      continue
    }
    if (kind === 'terminal') {
      terminalCount += 1
      continue
    }

    const labels = FEED_ENTRY_COUNT_LABELS[kind]
    const existing = exploreCounts.get(labels[0])
    if (existing) {
      existing.count += 1
    }
    else {
      exploreCounts.set(labels[0], { count: 1, labels })
    }
  }

  const phrases: string[] = []
  if (editCount > 0) {
    const onlyFile = editedFiles.size === 1 ? [...editedFiles][0] : null
    phrases.push(
      editCount === 1 && onlyFile
        ? `Edited ${onlyFile}`
        : `Edited ${pluralize(editCount, ['file', 'files'])}`,
    )
  }
  if (exploreCounts.size > 0) {
    const nouns = Array.from(exploreCounts.values(), entry => pluralize(entry.count, entry.labels))
    phrases.push(`explored ${nouns.join(', ')}`)
  }
  if (terminalCount > 0) {
    phrases.push(`ran ${pluralize(terminalCount, ['command', 'commands'])}`)
  }

  if (phrases.length === 0) {
    return {
      verb: isFeedRunning(entries) ? 'Thinking' : 'Thought',
      object: null,
      stats: null,
    }
  }

  // First phrase leads the sentence, so its verb carries the prominent tone.
  const sentence = capitalizeFirst(phrases.join(', '))
  const separator = sentence.indexOf(' ')
  return separator === -1
    ? { verb: sentence, object: null, stats }
    : { verb: sentence.slice(0, separator), object: sentence.slice(separator + 1), stats }
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
