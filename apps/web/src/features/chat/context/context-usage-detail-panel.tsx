import { CloseLine as XIcon } from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, m } from 'motion/react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import { clampPercent, formatTokenCount } from '~/lib/number-format'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

import type {
  ChatRuntimeCompactUiSlotState,
  ChatRuntimeContextUsage,
  ChatRuntimeContextUsageSection,
} from '../capabilities/chat-capabilities'
import { getChatRuntimeContextUsage } from '../capabilities/chat-capabilities'

interface ContextUsageDetailPanelProps {
  sessionId: string | null
  compactState?: ChatRuntimeCompactUiSlotState | null
  onClose: () => void
}

interface ContextWindowAggregate {
  totalTokens: number
  maxTokens: number | null
  percentage: number | null
  source: 'details' | 'compact'
}

const SECTION_ACCENT: Record<string, { dot: string, bar: string }> = {
  'system-prompt': {
    dot: 'bg-neutral-500',
    bar: 'bg-neutral-500',
  },
  'messages': {
    dot: 'bg-blue-500',
    bar: 'bg-blue-500',
  },
  'tools': {
    dot: 'bg-violet-500',
    bar: 'bg-violet-500',
  },
  'tool-results': {
    dot: 'bg-pink-500',
    bar: 'bg-pink-500',
  },
  'memory-files': {
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-500',
  },
  'attachments': {
    dot: 'bg-sky-500',
    bar: 'bg-sky-500',
  },
  'skills': {
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
  },
  'mcp-tools': {
    dot: 'bg-rose-500',
    bar: 'bg-rose-500',
  },
  'plugins': {
    dot: 'bg-cyan-500',
    bar: 'bg-cyan-500',
  },
  'agents': {
    dot: 'bg-fuchsia-500',
    bar: 'bg-fuchsia-500',
  },
  'slash-commands': {
    dot: 'bg-indigo-500',
    bar: 'bg-indigo-500',
  },
  'others': {
    dot: 'bg-green-500',
    bar: 'bg-green-500',
  },
}

const SECTION_LABELS: Record<string, string> = {
  'system-prompt': 'System prompt',
  'messages': 'Conversation',
  'tools': 'Tool definitions',
  'tool-results': 'Tool results',
  'memory-files': 'File context',
  'attachments': 'Attachments',
  'skills': 'Skills',
  'mcp-tools': 'MCP',
  'plugins': 'Plugins',
  'agents': 'Subagent definitions',
  'slash-commands': 'Slash commands',
  'others': 'Rules',
}

export function ContextUsageDetailPanel({
  sessionId,
  compactState,
  onClose,
}: ContextUsageDetailPanelProps) {
  const openContextUsageReportTab = useBrowserPanelStore(
    state => state.openContextUsageReportTab,
  )
  const browserPanelOwnerId = useLayoutStore(state => state.activeBrowserPanelOwnerId)
  const setBrowserPanelOpen = useLayoutStore(state => state.setBrowserPanelOpen)
  const { data, isError, isLoading } = useQuery({
    queryKey: ['chat', 'context-window-usage', sessionId ?? 'no-session'],
    queryFn: ({ signal }) => getChatRuntimeContextUsage(sessionId!, signal),
    enabled: Boolean(sessionId),
    staleTime: 5_000,
    refetchInterval: compactState?.isCompactRelevant ? 5_000 : false,
    retry: false,
  })
  const usage = data?.usage ?? null
  const aggregate = readContextAggregate(usage, compactState)
  const sections = readContextSections(usage)
  const sectionShareTotal = readSectionShareTotal(sections)
  const compactRows = readCompactRows(compactState)
  const handleOpenReport = () => {
    if (!sessionId) {
      return
    }
    openContextUsageReportTab({ sessionId, ownerId: browserPanelOwnerId })
    setBrowserPanelOpen(true, browserPanelOwnerId)
    onClose()
  }

  if (!sessionId) {
    return null
  }

  return (
    <m.div
      initial={{ opacity: 0, scale: 0.96, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 4 }}
      transition={{ type: 'spring', stiffness: 600, damping: 40 }}
      className="w-80 rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-[13px] font-medium leading-5 text-foreground">Context Usage</div>
          <div className="text-[11px] leading-4 text-text-tertiary">
            {readPanelSubtitle(aggregate)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={handleOpenReport}
            className="h-6 rounded-md px-1.5 text-[11px] text-text-secondary hover:bg-muted hover:text-foreground"
          >
            View Report
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            className="size-6 rounded-md text-text-tertiary hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <XIcon className="size-3.5" strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      <div className="px-3 py-2.5">
        <AnimatePresence mode="wait">
          {aggregate
            ? (
              <m.div
                key="content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[14px] font-semibold tabular-nums text-foreground">
                      {readUsageStateLabel(aggregate)}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-text-secondary">
                      {formatContextLimit(aggregate)}
                    </span>
                  </div>

                  <UsageProgressBar aggregate={aggregate} sections={sections} />

                  <div className="flex items-center justify-between gap-3 text-[11px] text-text-tertiary">
                    <span>{readUsageSourceLabel(aggregate)}</span>
                    <span className="tabular-nums">{readLimitDistanceLabel(aggregate)}</span>
                  </div>
                </div>

                {sections.length > 0
                  ? <ContextSectionList sections={sections} shareTotal={sectionShareTotal} />
                  : (
                    <CompactAggregateFallback
                      rows={compactRows}
                      isLoading={isLoading}
                      isError={isError}
                    />
                  )}
              </m.div>
            )
            : (
              <FallbackMessage key="fallback" isLoading={isLoading} isError={isError} />
            )}
        </AnimatePresence>
      </div>
    </m.div>
  )
}

function UsageProgressBar({
  aggregate,
  sections,
}: {
  aggregate: ContextWindowAggregate
  sections: ChatRuntimeContextUsageSection[]
}) {
  if (sections.length > 0) {
    return (
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="absolute inset-0 flex gap-px">
          {sections.map((section) => {
            const percent = aggregate.totalTokens > 0
              ? readSectionUsedPercent(section, sections, aggregate)
              : 0
            if (percent < 0.5) {
              return null
            }
            const accent = getSectionAccent(section.kind)
            return (
              <m.div
                key={section.kind}
                className={cn('h-full shrink-0', accent.bar)}
                initial={{ width: 0 }}
                animate={{ width: `${clampPercent(percent)}%` }}
                transition={{ type: 'spring', stiffness: 500, damping: 35, delay: 0.03 }}
              />
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <m.div
        className={cn(
          'h-full rounded-full',
          readUsageFillClassName(aggregate),
        )}
        initial={{ width: 0 }}
        animate={{ width: `${readUsageProgressPercent(aggregate)}%` }}
        transition={{ type: 'spring', stiffness: 500, damping: 35, delay: 0.03 }}
      />
    </div>
  )
}

function ContextSectionList({
  sections,
  shareTotal,
}: {
  sections: ChatRuntimeContextUsageSection[]
  shareTotal: number
}) {
  return (
    <div className="space-y-px">
      {sections.map((section, index) => {
        const accent = getSectionAccent(section.kind)
        return (
          <m.div
            key={section.kind}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 40, delay: index * 0.015 }}
            className="grid min-h-6 grid-cols-[minmax(0,1fr)_64px_34px] items-center gap-2 rounded-md px-1 text-[12px] transition-colors hover:bg-muted"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn('size-1.5 shrink-0 rounded-full', accent.dot)} />
              <span className="truncate text-foreground">
                {readSectionLabel(section)}
              </span>
            </span>
            <span className="text-right tabular-nums text-text-secondary">
              {formatApproxTokenCount(section.tokenCount)}
            </span>
            <span className="text-right tabular-nums text-text-tertiary">
              {formatSectionShare(section, shareTotal)}
            </span>
          </m.div>
        )
      })}
    </div>
  )
}

function CompactAggregateFallback({
  rows,
  isLoading,
  isError,
}: {
  rows: Array<{ label: string, value: number }>
  isLoading: boolean
  isError: boolean
}) {
  if (rows.length > 0) {
    return (
      <div className="space-y-1">
        <div className="grid grid-cols-2 gap-1.5">
          {rows.map(row => (
            <div key={row.label} className="min-w-0 rounded-md bg-muted px-2 py-1.5">
              <div className="truncate text-[10px] leading-3 text-text-tertiary">
                {row.label}
              </div>
              <div className="mt-1 truncate text-[12px] font-medium tabular-nums text-foreground">
                {formatTokenCount(row.value)}
              </div>
            </div>
          ))}
        </div>
        <p className="px-1 text-[11px] leading-4 text-text-tertiary">
          Detailed provider sections are unavailable for this runtime.
        </p>
      </div>
    )
  }

  return (
    <p className="rounded-md bg-muted px-2 py-1.5 text-[12px] leading-4 text-text-secondary">
      {isLoading
        ? 'Loading provider breakdown...'
        : isError
          ? 'Provider breakdown failed to load'
          : 'Detailed provider sections are unavailable for this runtime.'}
    </p>
  )
}

function FallbackMessage({ isLoading, isError }: { isLoading: boolean, isError: boolean }) {
  return (
    <p className="rounded-md bg-muted px-2 py-1.5 text-[12px] leading-4 text-text-secondary">
      {isLoading
        ? 'Loading context usage...'
        : isError
          ? 'Failed to load context usage'
          : 'Context usage unavailable'}
    </p>
  )
}

function readCompactRows(compactState: ChatRuntimeCompactUiSlotState | null | undefined): Array<{ label: string, value: number }> {
  if (!compactState) {
    return []
  }
  const usage = readCompactWindowUsage(compactState)
  return [
    { label: 'Input', value: usage.inputTokens },
    { label: 'Cached input', value: usage.cachedInputTokens },
    { label: 'Output', value: usage.outputTokens },
    { label: 'Reasoning', value: usage.reasoningOutputTokens },
  ].filter(row => row.value > 0)
}

function readUsageStateLabel(aggregate: ContextWindowAggregate): string {
  if (aggregate.maxTokens !== null && aggregate.totalTokens > aggregate.maxTokens) {
    return 'Over limit'
  }
  return aggregate.percentage === null ? 'Unknown usage' : `${clampPercent(aggregate.percentage)}% full`
}

function readPanelSubtitle(aggregate: ContextWindowAggregate | null): string {
  if (!aggregate) {
    return 'Context window'
  }
  return aggregate.source === 'details' ? 'Provider breakdown' : 'Runtime aggregate'
}

function readUsageSourceLabel(aggregate: ContextWindowAggregate): string {
  return aggregate.source === 'details' ? 'Provider sections' : 'Runtime total'
}

function readLimitDistanceLabel(aggregate: ContextWindowAggregate): string {
  if (aggregate.maxTokens === null) {
    return 'Limit unknown'
  }
  const remainingTokens = aggregate.maxTokens - aggregate.totalTokens
  if (remainingTokens >= 0) {
    return `${formatTokenCount(remainingTokens)} remaining`
  }
  return `${formatTokenCount(Math.abs(remainingTokens))} over`
}

function readUsageProgressPercent(aggregate: ContextWindowAggregate): number {
  if (aggregate.percentage !== null) {
    return clampPercent(aggregate.percentage)
  }
  if (!aggregate.maxTokens || aggregate.totalTokens <= 0) {
    return 0
  }
  return clampPercent((aggregate.totalTokens / aggregate.maxTokens) * 100)
}

function readSectionUsedPercent(
  section: ChatRuntimeContextUsageSection,
  sections: ChatRuntimeContextUsageSection[],
  aggregate: ContextWindowAggregate,
): number {
  const sectionShareTotal = readSectionShareTotal(sections)
  if (sectionShareTotal <= 0) {
    return 0
  }
  return (section.tokenCount / sectionShareTotal) * readUsageProgressPercent(aggregate)
}

function readSectionShareTotal(sections: ChatRuntimeContextUsageSection[]): number {
  return sections.reduce((total, section) => total + Math.max(0, section.tokenCount), 0)
}

function readUsageFillClassName(aggregate: ContextWindowAggregate): string {
  const percent = readUsageProgressPercent(aggregate)
  if (aggregate.maxTokens !== null && aggregate.totalTokens > aggregate.maxTokens) {
    return 'bg-destructive'
  }
  if (percent >= 90) {
    return 'bg-destructive'
  }
  if (percent >= 70) {
    return 'bg-warning'
  }
  return 'bg-primary'
}

function formatContextLimit(aggregate: ContextWindowAggregate): string {
  if (aggregate.maxTokens === null) {
    return formatApproxTokenLabel(aggregate.totalTokens)
  }
  return `${formatApproxTokenCount(aggregate.totalTokens)} / ${formatTokenCount(aggregate.maxTokens)}`
}

function formatApproxTokenCount(value: number): string {
  return `~${formatTokenCount(value)}`
}

function formatApproxTokenLabel(value: number): string {
  return `${formatApproxTokenCount(value)} tokens`
}

function formatSectionShare(section: ChatRuntimeContextUsageSection, totalTokens: number): string {
  if (totalTokens <= 0) {
    return '0%'
  }
  return `${clampPercent((section.tokenCount / totalTokens) * 100)}%`
}

function readContextAggregate(
  usage: ChatRuntimeContextUsage | null,
  compactState: ChatRuntimeCompactUiSlotState | null | undefined,
): ContextWindowAggregate | null {
  if (usage) {
    return {
      totalTokens: usage.totalTokens,
      maxTokens: usage.maxTokens,
      percentage: usage.percentage,
      source: 'details',
    }
  }
  if (!compactState) {
    return null
  }
  const displayUsage = readCompactWindowUsage(compactState)
  if (displayUsage.totalTokens <= 0) {
    return null
  }
  return {
    totalTokens: displayUsage.totalTokens,
    maxTokens: compactState.modelContextWindow,
    percentage: compactState.modelContextWindow && compactState.modelContextWindow > 0
      ? (displayUsage.totalTokens / compactState.modelContextWindow) * 100
      : null,
    source: 'compact',
  }
}

function readCompactWindowUsage(compactState: ChatRuntimeCompactUiSlotState) {
  return compactState.last.totalTokens > 0 ? compactState.last : compactState.total
}

function readContextSections(usage: ChatRuntimeContextUsage | null): ChatRuntimeContextUsageSection[] {
  return [...(usage?.sections ?? [])]
    .filter(section => section.tokenCount > 0 || section.items.some(item => item.tokenCount > 0))
    .sort((left, right) => right.tokenCount - left.tokenCount)
}

function readSectionLabel(section: ChatRuntimeContextUsageSection): string {
  return SECTION_LABELS[section.kind] ?? section.label
}

function getSectionAccent(kind: string) {
  return SECTION_ACCENT[kind] ?? SECTION_ACCENT.others
}
