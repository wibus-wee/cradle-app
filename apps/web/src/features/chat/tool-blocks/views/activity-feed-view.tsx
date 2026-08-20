import { Streamdown } from '@cradle/streamdown'
import { RightSmallLine as ChevronRightIcon } from '@mingcute/react'
import { m } from 'motion/react'
import { useState } from 'react'

import { cn } from '~/lib/cn'

import { BlobOverflowNotice } from '../../rendering/blob-overflow-notice'
import { hasTerminalDetails } from '../../rendering/terminal-tool-details'
import type { RenderableToolPart, ToolUiKind } from '../../rendering/tool-ui-classifier'
import {
  describeToolCallCached,
  readToolInputPayload,
  readToolPayload,
} from '../../rendering/tool-ui-classifier'
import type {
  ActivityFeedReasoningEntry,
  ActivityFeedToolEntry,
  ActivityFeedViewEntry,
  FeedDiffStats,
  FeedLabel,
} from '../lib/activity-feed-model'
import {
  composeFeedSummary,
  isActiveToolState,
  isEditKind,
  isErrorToolState,
  isFeedRunning,
  readFeedRowLabel,
} from '../lib/activity-feed-model'
import { hasHeroContent } from '../lib/tool-hero-content'
import type { ArtifactOpenInput } from './artifact-preview-view'
import type { PlanDocumentOpenInput } from './plan-document-preview-view'
import {
  FileDiffExecutionDetails,
  hasFileDiffInlineContent,
  readFileDiffPayload,
  readFileDiffTarget,
  TerminalExecutionDetails,
} from './tool-call-details'
import { ToolHeroView } from './tool-hero-view'

export type { ActivityFeedViewEntry } from '../lib/activity-feed-model'

export interface ActivityFeedViewProps {
  entries: ActivityFeedViewEntry[]
  animated?: boolean
  blobSessionId?: string | null
  onOpenWorkspaceDiff?: (path: string) => void
  onOpenPlanDocument?: (input: PlanDocumentOpenInput) => void
  onOpenArtifact?: (input: ArtifactOpenInput) => void
}

const REASONING_STREAMDOWN_OPTIONS = {
  animationPreset: 'balanced',
  animateMode: 'char',
  showCursor: false,
} as const

const CHEVRON_SPRING = { stiffness: 600, damping: 40 } as const

/**
 * The feed reads as faded prose beside the assistant's reply, so it matches body
 * type and differs only in weight of color: verbs sit one tier above their
 * objects, and both stay below normal prose.
 */
const ROW_TEXT_CLASS = 'text-sm leading-relaxed'
const VERB_CLASS = 'text-[var(--text-secondary)]'
const OBJECT_CLASS = 'text-[var(--text-tertiary)]'
const GHOST_CLASS = 'text-[var(--text-dim)]'
const ERROR_CLASS = 'text-red-600 dark:text-red-400'

function hasExpandableDetails(part: RenderableToolPart, uiKind: ToolUiKind): boolean {
  if (uiKind === 'terminal') {
    return hasTerminalDetails(part.input, part.output, part.errorText, part.argumentsText)
  }
  if (isEditKind(uiKind)) {
    if (part.errorText) {
      return true
    }
    const payload = readFileDiffPayload(part.input, part.output, part.argumentsText)
    return hasFileDiffInlineContent(payload.input, payload.output)
  }
  const descriptor = describeToolCallCached(part)
  return hasHeroContent(
    descriptor,
    readToolInputPayload(part.input, part.argumentsText),
    readToolPayload(part.output),
    part.errorText,
  )
}

function DiffStats({ stats }: { stats: FeedDiffStats }) {
  return (
    <span className="ml-1.5 shrink-0 tabular-nums">
      {stats.additions > 0 && (
        <span className="text-emerald-600 dark:text-emerald-400">
          +
          {stats.additions}
        </span>
      )}
      {stats.deletions > 0 && (
        <span className={cn('text-red-600 dark:text-red-400', stats.additions > 0 && 'ml-1')}>
          -
          {stats.deletions}
        </span>
      )}
    </span>
  )
}

function FeedChevron({ expanded, animated }: { expanded: boolean, animated: boolean }) {
  const icon = (
    <ChevronRightIcon
      className={cn('size-3 !text-[var(--text-dim)]', !animated && expanded && 'rotate-90')}
      aria-hidden
    />
  )
  if (!animated) {
    return <span className="ml-1 inline-flex shrink-0 items-center">{icon}</span>
  }
  return (
    <m.span
      className="ml-1 inline-flex shrink-0 items-center"
      initial={false}
      animate={{ rotate: expanded ? 90 : 0 }}
      transition={CHEVRON_SPRING}
    >
      {icon}
    </m.span>
  )
}

/**
 * A row is a text line, not a control: no background, border, or padding box.
 * The chevron rides inline right after the words instead of anchoring right,
 * so a short row stays short.
 */
function FeedRow({
  label,
  interactive,
  expandable,
  expanded,
  errored,
  muted,
  pulsing,
  animated,
  onClick,
}: {
  label: FeedLabel
  interactive: boolean
  expandable: boolean
  expanded: boolean
  errored?: boolean
  muted?: boolean
  pulsing?: boolean
  animated: boolean
  onClick: () => void
}) {
  const verbTone = errored ? ERROR_CLASS : muted ? GHOST_CLASS : VERB_CLASS
  const objectTone = errored ? ERROR_CLASS : muted ? GHOST_CLASS : OBJECT_CLASS

  const content = (
    <>
      <span className={verbTone}>{label.verb}</span>
      {label.object && (
        <span className={cn('ml-1 min-w-0 line-clamp-1', objectTone)}>{label.object}</span>
      )}
      {label.stats && <DiffStats stats={label.stats} />}
      {expandable && <FeedChevron expanded={expanded} animated={animated} />}
    </>
  )

  const shared = cn(
    'flex w-full min-w-0 items-baseline text-left',
    ROW_TEXT_CLASS,
    pulsing && animated && 'animate-pulse',
  )

  if (!interactive) {
    return <div className={shared}>{content}</div>
  }

  return (
    <button
      type="button"
      className={cn(
        shared,
        'cursor-default transition-opacity duration-[var(--duration-quick)] hover:opacity-80',
      )}
      aria-expanded={expandable ? expanded : undefined}
      onClick={onClick}
    >
      {content}
    </button>
  )
}

/** Props-only chronological activity feed. Browser-panel orchestration stays in the container. */
export function ActivityFeedView({
  entries,
  animated = true,
  blobSessionId,
  onOpenWorkspaceDiff,
  onOpenPlanDocument,
  onOpenArtifact,
}: ActivityFeedViewProps) {
  const [listExpanded, setListExpanded] = useState(false)
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(() => new Set())

  const running = isFeedRunning(entries)
  const summary = composeFeedSummary(entries)

  const toggleEntry = (key: string) => {
    setExpandedEntries((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      }
      else {
        next.add(key)
      }
      return next
    })
  }

  const renderToolEntry = (entry: ActivityFeedToolEntry) => {
    const { part } = entry
    const descriptor = describeToolCallCached(part)
    const uiKind = descriptor.kind
    const inputPayload = readToolInputPayload(part.input, part.argumentsText)
    const outputPayload = readToolPayload(part.output)
    const hasTruncatedPayload = inputPayload.truncatedOriginalChars !== null
      || outputPayload.truncatedOriginalChars !== null
    const expandable = hasTruncatedPayload || hasExpandableDetails(part, uiKind)
    const workspaceDiffPath = isEditKind(uiKind)
      ? readFileDiffTarget(part.input, part.output, part.argumentsText)
      : null
    const canOpenWorkspaceDiff = !!onOpenWorkspaceDiff && !!workspaceDiffPath
    const expanded = expandedEntries.has(entry.key)

    const handleClick = () => {
      if (expandable) {
        toggleEntry(entry.key)
        return
      }
      if (workspaceDiffPath) {
        onOpenWorkspaceDiff?.(workspaceDiffPath)
      }
    }

    return (
      <div key={entry.key}>
        <FeedRow
          label={readFeedRowLabel(entry)}
          interactive={expandable || canOpenWorkspaceDiff}
          expandable={expandable}
          expanded={expanded}
          errored={isErrorToolState(part)}
          pulsing={isActiveToolState(part)}
          animated={animated}
          onClick={handleClick}
        />
        {expandable && expanded && (
          <div className="mb-1 mt-0.5">
            {hasTruncatedPayload
              ? (
                  <ToolHeroView
                    descriptor={descriptor}
                    state={part.state}
                    input={inputPayload}
                    output={outputPayload}
                    errorText={part.errorText}
                    toolCallId={part.toolCallId}
                    onOpenPlanDocument={onOpenPlanDocument}
                    onOpenArtifact={onOpenArtifact}
                    blobSessionId={blobSessionId}
                  />
                )
              : uiKind === 'terminal' && (
              <TerminalExecutionDetails
                input={part.input}
                output={part.output}
                errorText={part.errorText}
                argumentsText={part.argumentsText}
              />
            )}
            {!hasTruncatedPayload && isEditKind(uiKind) && (
              <FileDiffExecutionDetails
                input={part.input}
                output={part.output}
                errorText={part.errorText}
                argumentsText={part.argumentsText}
                state={part.state}
              />
            )}
            {!hasTruncatedPayload && uiKind !== 'terminal' && !isEditKind(uiKind) && (
              <ToolHeroView
                descriptor={descriptor}
                state={part.state}
                input={inputPayload}
                output={outputPayload}
                errorText={part.errorText}
                toolCallId={part.toolCallId}
                onOpenPlanDocument={onOpenPlanDocument}
                onOpenArtifact={onOpenArtifact}
                blobSessionId={blobSessionId}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  const renderReasoningEntry = (entry: ActivityFeedReasoningEntry) => {
    const expanded = expandedEntries.has(entry.key)
    const hasOverflow = entry.overflowBlobId != null && entry.overflowOriginalChars != null
    const expandable = entry.text.length > 0 || hasOverflow
    const streaming = entry.state === 'streaming'
    return (
      <div key={entry.key}>
        <FeedRow
          label={readFeedRowLabel(entry)}
          interactive={expandable}
          expandable={expandable}
          expanded={expanded}
          pulsing={streaming}
          animated={animated}
          onClick={() => toggleEntry(entry.key)}
        />
        {expandable && expanded && (
          <div className={cn('flex max-h-82 flex-col gap-1 overflow-y-auto py-0.5', ROW_TEXT_CLASS, GHOST_CLASS)}>
            {entry.text.length > 0 && (
              <Streamdown
                content={entry.text}
                streaming={streaming}
                animationPreset={REASONING_STREAMDOWN_OPTIONS.animationPreset}
                animateMode={REASONING_STREAMDOWN_OPTIONS.animateMode}
                showCursor={REASONING_STREAMDOWN_OPTIONS.showCursor}
              />
            )}
            {hasOverflow && (
              <BlobOverflowNotice
                truncatedOriginalChars={entry.overflowOriginalChars ?? null}
                blobId={entry.overflowBlobId ?? null}
                sessionId={blobSessionId}
                fullLabel="open full reasoning"
              />
            )}
          </div>
        )}
      </div>
    )
  }

  const renderEntry = (entry: ActivityFeedViewEntry) => (
    entry.entryKind === 'tool-call' ? renderToolEntry(entry) : renderReasoningEntry(entry)
  )

  const renderExpandedList = () => (
    <m.div
      className="flex flex-col gap-0.5"
      initial={animated ? { opacity: 0, y: -2 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={CHEVRON_SPRING}
    >
      {entries.map(renderEntry)}
    </m.div>
  )

  // A single activity is already its own row — a collapsed "Ran 1 command"
  // summary wrapped around one entry would just duplicate it, so skip it.
  const showSummaryHeader = entries.length !== 1

  return (
    <div className="flex flex-col gap-0.5 py-1" data-testid="chat-activity-feed">
      {showSummaryHeader
        ? (
            <>
              <FeedRow
                label={summary}
                interactive
                expandable
                expanded={listExpanded}
                pulsing={running}
                animated={animated}
                onClick={() => setListExpanded(value => !value)}
              />
              {listExpanded && renderExpandedList()}
            </>
          )
        : (
            renderEntry(entries[0])
          )}
    </div>
  )
}
