import { Dashboard2Line as GaugeIcon } from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import { m } from 'motion/react'

import { cn } from '~/lib/cn'
import { clampPercent, formatTokenCount } from '~/lib/number-format'

import type {
  ChatRuntimeCompactUiSlotState,
  ChatRuntimeContextUsage,
  ChatRuntimeContextUsageSection,
} from '../capabilities/chat-capabilities'
import { getChatRuntimeContextUsage } from '../capabilities/chat-capabilities'

interface ContextWindowViewerProps {
  sessionId: string | null
  compactState?: ChatRuntimeCompactUiSlotState | null
  className?: string
}

interface ContextWindowAggregate {
  totalTokens: number
  maxTokens: number | null
  percentage: number | null
  source: 'details' | 'compact'
}

const SECTION_ACCENT: Record<string, string> = {
  'system-prompt': 'bg-(--color-accent-session)',
  'messages': 'bg-(--color-accent)',
  'tools': 'bg-(--color-accent-diff)',
  'tool-results': 'bg-(--color-accent-summary)',
  'memory-files': 'bg-(--color-accent-scope)',
  'attachments': 'bg-(--color-accent-global)',
  'skills': 'bg-(--color-accent-agent)',
  'mcp-tools': 'bg-(--color-warning)',
  'plugins': 'bg-(--color-accent-legacy)',
  'agents': 'bg-(--color-success)',
  'slash-commands': 'bg-(--color-info)',
  'others': 'bg-(--color-neutral-5)',
}

const SECTION_LABELS: Record<string, string> = {
  'system-prompt': 'System prompt',
  'messages': 'Messages',
  'tools': 'Tool calls',
  'tool-results': 'Tool results',
  'memory-files': 'File context',
  'attachments': 'Attachments',
  'skills': 'Skills',
  'mcp-tools': 'MCP tools',
  'plugins': 'Plugins',
  'agents': 'Agents',
  'others': 'Other context',
}

export function ContextWindowViewer({
  sessionId,
  compactState,
  className,
}: ContextWindowViewerProps) {
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

  if (!sessionId) {
    return null
  }

  return (
    <section className={cn('space-y-2', className)} data-testid="context-window-viewer">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-(--color-neutral-6)">
          <GaugeIcon className="size-3.5" aria-hidden="true" />
          <span>Context window</span>
        </div>
        {aggregate && (
          <span className="shrink-0 rounded-md bg-(--color-neutral-3) px-1.5 py-0.5 text-[10px] tabular-nums text-(--color-neutral-6)">
            {formatUsagePercent(aggregate.percentage)}
          </span>
        )}
      </div>

      <div className="space-y-2.5 rounded-lg bg-(--color-neutral-2) p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),inset_0_-1px_0_rgba(0,0,0,0.04)]">
        {aggregate
          ? (
            <>
              <ContextWindowSummary aggregate={aggregate} />
              {sections.length > 0
                ? <ContextSectionList sections={sections} totalTokens={aggregate.totalTokens} />
                : <ContextAggregateFallback compactState={compactState ?? null} />}
            </>
          )
          : (
            <p className="rounded-md bg-background/50 px-2.5 py-2 text-[11px] text-(--color-neutral-6)">
              {isLoading ? 'Loading context usage...' : isError ? 'Context usage failed to load' : 'Context usage is unavailable for this runtime'}
            </p>
          )}
      </div>
    </section>
  )
}

function ContextWindowSummary({ aggregate }: { aggregate: ContextWindowAggregate }) {
  const progressValue = aggregate.percentage === null ? 0 : clampPercent(aggregate.percentage)
  const remainingTokens = aggregate.maxTokens === null
    ? null
    : Math.max(0, aggregate.maxTokens - aggregate.totalTokens)

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold tabular-nums text-foreground">
            {formatTokenCount(aggregate.totalTokens)}
          </div>
          <div className="text-[10px] text-(--color-neutral-6)">
            {aggregate.source === 'details' ? 'Provider breakdown' : 'Runtime aggregate'}
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-[11px] tabular-nums text-foreground">
            {aggregate.maxTokens === null ? 'Unknown limit' : `${formatTokenCount(aggregate.totalTokens)} / ${formatTokenCount(aggregate.maxTokens)}`}
          </div>
          <div className="text-[10px] tabular-nums text-(--color-neutral-6)">
            {remainingTokens === null ? 'Remaining unknown' : `${formatTokenCount(remainingTokens)} remaining`}
          </div>
        </div>
      </div>

      {/* Segmented bar */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-background/60">
        <m.div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${progressValue}%` }}
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        />
      </div>
    </div>
  )
}

function ContextSectionList({
  sections,
  totalTokens,
}: {
  sections: ChatRuntimeContextUsageSection[]
  totalTokens: number
}) {
  return (
    <div className="space-y-0.5">
      {sections.map((section) => {
        const percent = totalTokens > 0 ? clampPercent((section.tokenCount / totalTokens) * 100) : 0
        return (
          <div
            key={section.kind}
            className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-background/50"
          >
            <span className={cn('size-2 shrink-0 rounded-full', getSectionAccentClass(section.kind))} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
              {readSectionLabel(section)}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-(--color-neutral-6)">
              {formatTokenCount(section.tokenCount)}
            </span>
            <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-(--color-neutral-6)">
              {percent}
%
            </span>
          </div>
        )
      })}
    </div>
  )
}

function ContextAggregateFallback({ compactState }: { compactState: ChatRuntimeCompactUiSlotState | null }) {
  if (!compactState) {
    return null
  }
  const usage = readCompactWindowUsage(compactState)
  const rows = [
    { label: 'Input', value: usage.inputTokens },
    { label: 'Cached input', value: usage.cachedInputTokens },
    { label: 'Output', value: usage.outputTokens },
    { label: 'Reasoning', value: usage.reasoningOutputTokens },
  ].filter(row => row.value > 0)

  if (rows.length === 0) {
    return (
      <p className="rounded-md bg-background/50 px-2.5 py-2 text-[11px] text-(--color-neutral-6)">
        Detailed usage is unavailable for this runtime
      </p>
    )
  }

  return (
    <div className="space-y-0.5">
      {rows.map(row => (
        <div key={row.label} className="flex min-w-0 items-center gap-2 rounded-md bg-background/50 px-2.5 py-1.5 text-[11px]">
          <span className="min-w-0 flex-1 truncate text-(--color-neutral-6)">{row.label}</span>
          <span className="shrink-0 tabular-nums text-foreground">{formatTokenCount(row.value)}</span>
        </div>
      ))}
    </div>
  )
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

function formatUsagePercent(value: number | null): string {
  return value === null ? 'unknown' : `${clampPercent(value)}%`
}

function readSectionLabel(section: ChatRuntimeContextUsageSection): string {
  return SECTION_LABELS[section.kind] ?? section.label
}

function getSectionAccentClass(kind: string): string {
  return SECTION_ACCENT[kind] ?? SECTION_ACCENT.others
}
