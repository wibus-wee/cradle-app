import { Dashboard2Line as GaugeIcon } from '@mingcute/react'
import { m } from 'motion/react'

import { cn } from '~/lib/cn'
import { clampPercent, formatTokenCount } from '~/lib/number-format'

import type {
  ChatRuntimeCompactUiSlotState,
  ChatRuntimeContextUsage,
} from '../../capabilities/chat-capabilities'
import {
  readCompactUsageRows,
  readContextUsageAggregate,
  readContextUsagePercent,
  readContextUsageSectionLabel,
  readContextUsageSections,
} from '../lib/context-usage'

interface ContextWindowViewerViewProps {
  usage: ChatRuntimeContextUsage | null
  compactState?: ChatRuntimeCompactUiSlotState | null
  loadState: 'loading' | 'error' | 'ready'
  className?: string
}

const sectionAccentClasses: Record<string, string> = {
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

export function ContextWindowViewerView({
  usage,
  compactState,
  loadState,
  className,
}: ContextWindowViewerViewProps) {
  const aggregate = readContextUsageAggregate(usage, compactState)
  const sections = readContextUsageSections(usage)
  const compactRows = readCompactUsageRows(compactState)
  const usagePercent = aggregate ? readContextUsagePercent(aggregate) : 0

  return (
    <section className={cn('space-y-2', className)} data-testid="context-window-viewer">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-(--color-neutral-6)">
          <GaugeIcon className="size-3.5" aria-hidden="true" />
          <span>Context window</span>
        </div>
        {aggregate && (
          <span className="shrink-0 rounded-md bg-(--color-neutral-3) px-1.5 py-0.5 text-[10px] tabular-nums text-(--color-neutral-6)">
            {aggregate.percentage === null ? 'unknown' : `${usagePercent}%`}
          </span>
        )}
      </div>

      <div className="space-y-2.5 rounded-lg bg-(--color-neutral-2) p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),inset_0_-1px_0_rgba(0,0,0,0.04)]">
        {aggregate
          ? (
            <>
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[18px] font-semibold tabular-nums text-foreground">{formatTokenCount(aggregate.totalTokens)}</div>
                    <div className="text-[10px] text-(--color-neutral-6)">{aggregate.source === 'details' ? 'Provider breakdown' : 'Runtime aggregate'}</div>
                  </div>
                  <div className="min-w-0 text-right">
                    <div className="text-[11px] tabular-nums text-foreground">
                      {aggregate.maxTokens === null ? 'Unknown limit' : `${formatTokenCount(aggregate.totalTokens)} / ${formatTokenCount(aggregate.maxTokens)}`}
                    </div>
                    <div className="text-[10px] tabular-nums text-(--color-neutral-6)">
                      {aggregate.maxTokens === null ? 'Remaining unknown' : `${formatTokenCount(Math.max(0, aggregate.maxTokens - aggregate.totalTokens))} remaining`}
                    </div>
                  </div>
                </div>
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-background/60">
                  <m.div
                    className="absolute inset-y-0 left-0 rounded-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${usagePercent}%` }}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                </div>
              </div>

              {sections.length > 0
                ? (
                  <div className="space-y-0.5">
                    {sections.map((section) => {
                      const percent = aggregate.totalTokens > 0
                        ? clampPercent((section.tokenCount / aggregate.totalTokens) * 100)
                        : 0
                      return (
                        <div key={section.kind} className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-background/50">
                          <span className={cn('size-2 shrink-0 rounded-full', sectionAccentClasses[section.kind] ?? sectionAccentClasses.others)} />
                          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{readContextUsageSectionLabel(section)}</span>
                          <span className="shrink-0 text-[10px] tabular-nums text-(--color-neutral-6)">{formatTokenCount(section.tokenCount)}</span>
                          <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-(--color-neutral-6)">
{percent}
%
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
                : compactRows.length > 0
                  ? (
                    <div className="space-y-0.5">
                      {compactRows.map(row => (
                        <div key={row.label} className="flex min-w-0 items-center gap-2 rounded-md bg-background/50 px-2.5 py-1.5 text-[11px]">
                          <span className="min-w-0 flex-1 truncate text-(--color-neutral-6)">{row.label}</span>
                          <span className="shrink-0 tabular-nums text-foreground">{formatTokenCount(row.value)}</span>
                        </div>
                      ))}
                    </div>
                  )
                  : <p className="rounded-md bg-background/50 px-2.5 py-2 text-[11px] text-(--color-neutral-6)">Detailed usage is unavailable for this runtime</p>}
            </>
          )
          : (
            <p className="rounded-md bg-background/50 px-2.5 py-2 text-[11px] text-(--color-neutral-6)">
              {loadState === 'loading'
                ? 'Loading context usage...'
                : loadState === 'error' ? 'Context usage failed to load' : 'Context usage is unavailable for this runtime'}
            </p>
          )}
      </div>
    </section>
  )
}
