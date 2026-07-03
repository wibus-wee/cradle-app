import { DownSmallLine as ChevronDownIcon, RightSmallLine as ChevronRightIcon } from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import { m } from 'motion/react'
import { useState } from 'react'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { cn } from '~/lib/cn'
import { clampPercent, formatTokenCount } from '~/lib/number-format'

import type { ChatRuntimeContextUsage, ChatRuntimeContextUsageItem, ChatRuntimeContextUsageSection } from '../chat/capabilities/chat-capabilities'
import {
  getChatRuntimeContextUsage,
} from '../chat/capabilities/chat-capabilities'

interface ContextUsageReportProps {
  sessionId: string
  sessionTitle: string | null
}

interface ContextUsageAggregate {
  totalTokens: number
  maxTokens: number | null
  percentage: number | null
  remainingTokens: number | null
}

const SECTION_ACCENT: Record<string, { dot: string, bar: string, stroke: string }> = {
  'system-prompt': {
    dot: 'bg-neutral-500',
    bar: 'bg-neutral-500',
    stroke: 'stroke-neutral-500',
  },
  'messages': {
    dot: 'bg-blue-500',
    bar: 'bg-blue-500',
    stroke: 'stroke-blue-500',
  },
  'tools': {
    dot: 'bg-violet-500',
    bar: 'bg-violet-500',
    stroke: 'stroke-violet-500',
  },
  'tool-results': {
    dot: 'bg-pink-500',
    bar: 'bg-pink-500',
    stroke: 'stroke-pink-500',
  },
  'memory-files': {
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-500',
    stroke: 'stroke-emerald-500',
  },
  'attachments': {
    dot: 'bg-sky-500',
    bar: 'bg-sky-500',
    stroke: 'stroke-sky-500',
  },
  'skills': {
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
    stroke: 'stroke-amber-500',
  },
  'mcp-tools': {
    dot: 'bg-rose-500',
    bar: 'bg-rose-500',
    stroke: 'stroke-rose-500',
  },
  'plugins': {
    dot: 'bg-cyan-500',
    bar: 'bg-cyan-500',
    stroke: 'stroke-cyan-500',
  },
  'agents': {
    dot: 'bg-fuchsia-500',
    bar: 'bg-fuchsia-500',
    stroke: 'stroke-fuchsia-500',
  },
  'slash-commands': {
    dot: 'bg-indigo-500',
    bar: 'bg-indigo-500',
    stroke: 'stroke-indigo-500',
  },
  'others': {
    dot: 'bg-green-500',
    bar: 'bg-green-500',
    stroke: 'stroke-green-500',
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

export function ContextUsageReport({
  sessionId,
  sessionTitle,
}: ContextUsageReportProps) {
  const [expandedSectionKinds, setExpandedSectionKinds] = useState<Set<string>>(() => new Set())
  const { data: session } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId } }),
    staleTime: 30_000,
  })
  const { data, isError, isLoading } = useQuery({
    queryKey: ['chat', 'context-window-usage', sessionId],
    queryFn: ({ signal }) => getChatRuntimeContextUsage(sessionId, signal),
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
  })

  const resolvedSessionTitle = session?.title || sessionTitle
  const usage = data?.usage ?? null
  const aggregate = readContextAggregate(usage)
  const sections = readContextSections(usage)
  const sectionShareTotal = readSectionShareTotal(sections)
  const expandedAll = sections.length > 0
    && sections.every(section => expandedSectionKinds.has(section.kind))
  const largestSection = sections[0] ?? null

  const toggleSection = (kind: string) => {
    setExpandedSectionKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) {
        next.delete(kind)
      }
      else {
        next.add(kind)
      }
      return next
    })
  }

  const toggleAll = () => {
    setExpandedSectionKinds(() => {
      if (expandedAll) {
        return new Set()
      }
      return new Set(sections.map(section => section.kind))
    })
  }

  if (isLoading || isError || !aggregate || !usage) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-background">
        <div className="text-[13px] text-text-secondary">
          {isLoading
            ? 'Loading context usage...'
            : isError
              ? 'Failed to load context usage'
              : 'Context usage unavailable'}
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 bg-card">
      <div className="h-full overflow-auto">
        <article className="mx-auto max-w-4xl px-4 py-4 lg:px-5">
          <m.header
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 42 }}
            className="border-b border-border pb-3"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-tertiary">
              <span>Context Usage Report</span>
              <span className="size-1 rounded-full bg-border" aria-hidden="true" />
              <span>{usage.runtimeKind || 'Unknown runtime'}</span>
              <span className="size-1 rounded-full bg-border" aria-hidden="true" />
              <span className="tabular-nums">
                {formatSectionCount(sections.length)}
              </span>
            </div>

            <div className="mt-1 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h1 className="min-w-0 text-balance text-[17px] font-semibold leading-6 text-foreground">
                {resolvedSessionTitle || 'Untitled Session'}
              </h1>
              <span className="shrink-0 text-[12px] tabular-nums text-text-secondary">
                {formatContextLimit(aggregate)}
              </span>
            </div>

            <p className="mt-2 max-w-2xl text-[13px] leading-5 text-text-secondary">
              {readUsageSummary(aggregate)}
            </p>
          </m.header>

          <m.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 42, delay: 0.03 }}
            className="grid grid-cols-1 gap-3 border-b border-border py-3 md:grid-cols-[minmax(0,1fr)_88px] md:items-center"
            aria-label="Context usage summary"
          >
            <div className="grid grid-cols-2 gap-y-2 md:grid-cols-4 md:divide-x md:divide-border">
              <MetricCell
                label="Used"
                value={`~${formatTokenCount(aggregate.totalTokens)}`}
                meta={`${formatUsagePercent(aggregate.percentage)} full`}
              />
              <MetricCell
                label="Limit"
                value={aggregate.maxTokens === null ? 'Unknown' : formatTokenCount(aggregate.maxTokens)}
                meta="context window"
              />
              <MetricCell
                label="Remaining"
                value={aggregate.remainingTokens === null ? 'Unknown' : formatTokenCount(aggregate.remainingTokens)}
                meta="available"
              />
              <MetricCell
                label="Largest"
                value={largestSection ? readSectionLabel(largestSection) : 'None'}
                meta={largestSection ? `${formatSectionShare(largestSection, sectionShareTotal)} of reported` : 'no sections'}
              />
            </div>
            <CompactUsageRing aggregate={aggregate} sections={sections} />
          </m.section>

          <m.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 42, delay: 0.06 }}
            className="border-b border-border py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[13px] font-medium text-foreground">Composition</h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={toggleAll}
                className="h-6 shrink-0 gap-1 rounded-md px-1.5 text-[11px] text-text-secondary hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {expandedAll
                  ? <ChevronRightIcon className="size-3.5" strokeWidth={1.7} aria-hidden="true" />
                  : <ChevronDownIcon className="size-3.5" strokeWidth={1.7} aria-hidden="true" />}
                <span>{expandedAll ? 'Collapse all' : 'Expand all'}</span>
              </Button>
            </div>

            <SegmentedUsageBar
              aggregate={aggregate}
              sections={sections}
              className="mt-2"
            />

            <div className="mt-2 grid grid-cols-1 gap-x-8 gap-y-px md:grid-cols-2">
              {sections.map(section => (
                <SectionSummaryRow
                  key={section.kind}
                  section={section}
                  shareTotal={sectionShareTotal}
                />
              ))}
            </div>
          </m.section>

          <m.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 42, delay: 0.09 }}
            className="py-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[13px] font-medium text-foreground">Breakdown</h2>
              <span className="text-[11px] tabular-nums text-text-tertiary">
                {formatApproxTokenLabel(aggregate.totalTokens)}
              </span>
            </div>

            <div className="mt-2 divide-y divide-border">
              {sections.map(section => (
                <ContextSectionRow
                  key={section.kind}
                  section={section}
                  shareTotal={sectionShareTotal}
                  open={expandedSectionKinds.has(section.kind)}
                  onToggle={() => toggleSection(section.kind)}
                />
              ))}
            </div>
          </m.section>
        </article>
      </div>
    </div>
  )
}

function MetricCell({
  label,
  value,
  meta,
}: {
  label: string
  value: string
  meta: string
}) {
  return (
    <div className="min-w-0 md:px-3 md:first:pl-0 md:last:pr-0">
      <div className="text-[11px] text-text-tertiary">{label}</div>
      <div className="mt-0.5 truncate text-[14px] font-medium tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-px truncate text-[11px] tabular-nums text-text-secondary">{meta}</div>
    </div>
  )
}

function CompactUsageRing({
  aggregate,
  sections,
}: {
  aggregate: ContextUsageAggregate
  sections: ChatRuntimeContextUsageSection[]
}) {
  const size = 82
  const strokeWidth = 7
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const sectionShareTotal = readSectionShareTotal(sections)
  const usagePercent = aggregate.percentage === null ? null : clampPercent(aggregate.percentage)
  const usedCircumference = circumference * (readUsageProgressPercent(aggregate) / 100)
  const arcs: Array<{ kind: string, arcLength: number, startArc: number }> = []
  let nextArcStart = 0

  if (sectionShareTotal > 0) {
    for (const section of sections) {
      const startArc = nextArcStart
      const arcLength = (section.tokenCount / sectionShareTotal) * usedCircumference
      nextArcStart += arcLength

      if (arcLength > 0.8) {
        arcs.push({
          kind: section.kind,
          arcLength,
          startArc,
        })
      }
    }
  }

  return (
    <div className="relative mx-auto size-[82px] shrink-0 md:mx-0">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-muted"
        />

        {arcs.map((arc) => {
          const dash = Math.max(0, arc.arcLength - 1.2)
          const dashOffset = circumference - arc.startArc
          return (
            <circle
              key={arc.kind}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
              className={getSectionAccent(arc.kind).stroke}
            />
          )
        })}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[14px] font-semibold tabular-nums leading-4 text-foreground">
          {usagePercent === null ? 'n/a' : `${usagePercent}%`}
        </span>
        <span className="text-[10px] leading-3 text-text-tertiary">Full</span>
      </div>
    </div>
  )
}

function SegmentedUsageBar({
  aggregate,
  sections,
  className,
}: {
  aggregate: ContextUsageAggregate
  sections: ChatRuntimeContextUsageSection[]
  className?: string
}) {
  const sectionShareTotal = readSectionShareTotal(sections)
  const usedPercent = readUsageProgressPercent(aggregate)

  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}>
      <div className="flex h-full gap-px">
        {sections.map((section) => {
          const percent = sectionShareTotal > 0
            ? (section.tokenCount / sectionShareTotal) * usedPercent
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
              transition={{ type: 'spring', stiffness: 520, damping: 38 }}
            />
          )
        })}
      </div>
    </div>
  )
}

function SectionSummaryRow({
  section,
  shareTotal,
}: {
  section: ChatRuntimeContextUsageSection
  shareTotal: number
}) {
  const accent = getSectionAccent(section.kind)

  return (
    <div className="grid min-h-7 grid-cols-[minmax(0,1fr)_72px_44px] items-center gap-2 rounded-md px-1.5 text-[12px] transition-colors hover:bg-muted">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('size-1.5 shrink-0 rounded-full', accent.dot)} />
        <span className="truncate text-foreground">{readSectionLabel(section)}</span>
      </div>
      <span className="text-right tabular-nums text-text-secondary">
        {formatApproxTokenCount(section.tokenCount)}
      </span>
      <span className="text-right tabular-nums text-text-tertiary">
        {formatSectionShare(section, shareTotal)}
      </span>
    </div>
  )
}

function ContextSectionRow({
  section,
  shareTotal,
  open,
  onToggle,
}: {
  section: ChatRuntimeContextUsageSection
  shareTotal: number
  open: boolean
  onToggle: () => void
}) {
  const hasItems = section.items.length > 0
  const accent = getSectionAccent(section.kind)

  return (
    <Collapsible open={open} onOpenChange={hasItems ? onToggle : undefined}>
      <CollapsibleTrigger asChild disabled={!hasItems}>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            'grid h-auto min-h-10 w-full grid-cols-[16px_minmax(0,1fr)_86px_48px] items-center justify-normal gap-2 rounded-md px-1.5 py-1.5 text-left font-normal hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
            !hasItems && 'cursor-default hover:bg-transparent',
          )}
        >
          {hasItems
            ? open
              ? <ChevronDownIcon className="size-3.5 !text-text-secondary" strokeWidth={1.7} aria-hidden="true" />
              : <ChevronRightIcon className="size-3.5 !text-text-secondary" strokeWidth={1.7} aria-hidden="true" />
            : <span className="size-3.5" />}

          <span className="flex min-w-0 items-center gap-2">
            <span className={cn('size-1.5 shrink-0 rounded-full', accent.dot)} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-foreground">
                {readSectionLabel(section)}
              </span>
              <span className="block truncate text-[11px] tabular-nums text-text-tertiary">
                {formatItemCount(section.items.length)}
              </span>
            </span>
          </span>

          <span className="text-right text-[12px] tabular-nums text-text-secondary">
            {formatApproxTokenCount(section.tokenCount)}
          </span>
          <span className="text-right text-[12px] tabular-nums text-text-tertiary">
            {formatSectionShare(section, shareTotal)}
          </span>
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="pb-1 pl-6">
          <div className="divide-y divide-border/70 border-l border-border pl-2">
            {section.items.map(item => (
              <ContextItemRow
                key={readContextItemKey(item)}
                item={item}
              />
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ContextItemRow({
  item,
}: {
  item: ChatRuntimeContextUsageItem
}) {
  const [expanded, setExpanded] = useState(false)
  const metadataEntries = Object.entries(item.metadata ?? {})
  const hasMetadata = metadataEntries.length > 0

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        className={cn(
          'grid h-auto min-h-8 w-full grid-cols-[14px_minmax(0,1fr)_72px] items-center justify-normal gap-2 rounded-md px-1.5 py-1 text-left font-normal hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
          !hasMetadata && 'cursor-default hover:bg-transparent',
        )}
        onClick={() => hasMetadata && setExpanded(current => !current)}
      >
        {hasMetadata
          ? expanded
            ? <ChevronDownIcon className="size-3 !text-text-tertiary" strokeWidth={1.7} aria-hidden="true" />
            : <ChevronRightIcon className="size-3 !text-text-tertiary" strokeWidth={1.7} aria-hidden="true" />
          : <span className="size-3" />}

        <span className="min-w-0 truncate text-[12px] text-foreground">{item.label}</span>

        <span className="text-right text-[11px] tabular-nums text-text-secondary">
          {formatApproxTokenCount(item.tokenCount)}
        </span>
      </Button>

      {expanded && hasMetadata && (
        <div className="overflow-hidden">
          <MetadataDetails entries={metadataEntries} />
        </div>
      )}
    </div>
  )
}

function MetadataDetails({
  entries,
}: {
  entries: Array<[string, unknown]>
}) {
  const metricEntries = entries.filter(([, value]) => isMetricMetadataValue(value))
  const detailEntries = entries.filter(([, value]) => !isMetricMetadataValue(value))

  return (
    <div className="space-y-2 px-6 pb-2 pt-1">
      {metricEntries.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
          {metricEntries.map(([key, value]) => (
            <div key={key} className="min-w-0 rounded-md bg-muted px-2 py-1.5">
              <div className="truncate text-[10px] leading-3 text-text-tertiary">
                {readMetadataLabel(key)}
              </div>
              <div className="mt-1 truncate text-[12px] font-medium tabular-nums text-foreground">
                <MetadataValue metadataKey={key} value={value} />
              </div>
            </div>
          ))}
        </div>
      )}

      {detailEntries.length > 0 && (
        <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[11px] leading-4">
          {detailEntries.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="truncate font-medium text-text-secondary">
                {readMetadataLabel(key)}
              </dt>
              <dd className="min-w-0 font-mono tabular-nums text-text-tertiary">
                <MetadataValue metadataKey={key} value={value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function MetadataValue({
  metadataKey,
  value,
}: {
  metadataKey: string
  value: unknown
}) {
  if (typeof value === 'number') {
    return <>{formatMetadataNumber(metadataKey, value)}</>
  }
  if (typeof value === 'boolean') {
    return <>{value ? 'Yes' : 'No'}</>
  }
  if (typeof value === 'string') {
    return <span className="break-all">{value}</span>
  }
  if (value === null || value === undefined) {
    return <span className="text-text-dim">None</span>
  }
  if (Array.isArray(value)) {
    return (
      <span className="break-all">
        {formatMetadataArray(value)}
      </span>
    )
  }
  if (typeof value === 'object') {
    return (
      <code className="block max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1 text-[10px] leading-4 text-text-secondary">
        {formatMetadataJson(value)}
      </code>
    )
  }
  return <>{String(value)}</>
}

function readContextAggregate(usage: ChatRuntimeContextUsage | null): ContextUsageAggregate | null {
  if (!usage) {
    return null
  }
  return {
    totalTokens: usage.totalTokens,
    maxTokens: usage.maxTokens,
    percentage: usage.percentage,
    remainingTokens: usage.maxTokens === null ? null : Math.max(0, usage.maxTokens - usage.totalTokens),
  }
}

function readContextSections(usage: ChatRuntimeContextUsage | null): ChatRuntimeContextUsageSection[] {
  return [...(usage?.sections ?? [])]
    .filter(section => section.tokenCount > 0 || section.items.some(item => item.tokenCount > 0))
    .sort((left, right) => right.tokenCount - left.tokenCount)
}

function readUsageSummary(aggregate: ContextUsageAggregate): string {
  if (aggregate.maxTokens === null) {
    return `Using ~${formatTokenCount(aggregate.totalTokens)} tokens. The runtime did not report a context limit.`
  }
  return `Using ~${formatTokenCount(aggregate.totalTokens)} tokens, ${formatUsagePercent(aggregate.percentage)} of a ${formatTokenCount(aggregate.maxTokens)} context window. ${formatTokenCount(aggregate.remainingTokens ?? 0)} tokens remain.`
}

function formatContextLimit(aggregate: ContextUsageAggregate): string {
  if (aggregate.maxTokens === null) {
    return `~${formatTokenCount(aggregate.totalTokens)} tokens`
  }
  return `~${formatTokenCount(aggregate.totalTokens)} / ${formatTokenCount(aggregate.maxTokens)} tokens`
}

function formatUsagePercent(value: number | null): string {
  return value === null ? 'unknown' : `${clampPercent(value)}%`
}

function readUsageProgressPercent(aggregate: ContextUsageAggregate): number {
  if (aggregate.percentage !== null) {
    return clampPercent(aggregate.percentage)
  }
  if (!aggregate.maxTokens || aggregate.totalTokens <= 0) {
    return 0
  }
  return clampPercent((aggregate.totalTokens / aggregate.maxTokens) * 100)
}

function readSectionShareTotal(sections: ChatRuntimeContextUsageSection[]): number {
  return sections.reduce((total, section) => total + Math.max(0, section.tokenCount), 0)
}

function formatSectionCount(value: number): string {
  return value === 1 ? '1 section' : `${value} sections`
}

function formatItemCount(value: number): string {
  return value === 1 ? '1 item' : `${value} items`
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

function isMetricMetadataValue(value: unknown): boolean {
  return typeof value === 'number' || typeof value === 'boolean'
}

function formatMetadataNumber(key: string, value: number): string {
  if (key.toLowerCase().includes('tokens')) {
    return formatTokenCount(value)
  }
  return value.toLocaleString('en-US')
}

function formatMetadataArray(value: unknown[]): string {
  if (value.length === 0) {
    return '0 items'
  }
  if (value.every(isPrimitiveMetadataValue)) {
    const visibleValues = value.slice(0, 4).map(item => String(item))
    const remainingCount = value.length - visibleValues.length
    return remainingCount > 0
      ? `${visibleValues.join(', ')} +${remainingCount} more`
      : visibleValues.join(', ')
  }
  return `${value.length} records ${formatMetadataJson(value.slice(0, 2))}`
}

function formatMetadataJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

function readMetadataLabel(key: string): string {
  const knownLabels: Record<string, string> = {
    agentType: 'Agent type',
    callTokens: 'Call tokens',
    includedCommands: 'Included commands',
    includedSkills: 'Included skills',
    isLoaded: 'Loaded',
    resultTokens: 'Result tokens',
    serverName: 'Server name',
    totalCommands: 'Total commands',
    totalSkills: 'Total skills',
  }
  if (knownLabels[key]) {
    return knownLabels[key]
  }
  const label = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function isPrimitiveMetadataValue(value: unknown): boolean {
  return value === null
    || ['string', 'number', 'boolean'].includes(typeof value)
}

function readContextItemKey(item: ChatRuntimeContextUsageItem): string {
  return [
    item.kind,
    item.label,
    item.tokenCount,
    JSON.stringify(item.metadata ?? {}),
  ].join(':')
}

function readSectionLabel(section: ChatRuntimeContextUsageSection): string {
  return SECTION_LABELS[section.kind] ?? section.label
}

function getSectionAccent(kind: string) {
  return SECTION_ACCENT[kind] ?? SECTION_ACCENT.others
}
