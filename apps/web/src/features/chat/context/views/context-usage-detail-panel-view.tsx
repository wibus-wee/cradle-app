import { CloseLine as XIcon } from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'

import { Button } from '~/components/ui/button'
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
  readContextUsageSectionShareTotal,
} from '../lib/context-usage'

interface ContextUsageDetailPanelViewProps {
  usage: ChatRuntimeContextUsage | null
  compactState?: ChatRuntimeCompactUiSlotState | null
  loadState: 'loading' | 'error' | 'ready'
  onClose: () => void
  onOpenReport: () => void
}

const sectionAccentClasses: Record<string, { dot: string, bar: string }> = {
  'system-prompt': { dot: 'bg-neutral-500', bar: 'bg-neutral-500' },
  'messages': { dot: 'bg-blue-500', bar: 'bg-blue-500' },
  'tools': { dot: 'bg-violet-500', bar: 'bg-violet-500' },
  'tool-results': { dot: 'bg-pink-500', bar: 'bg-pink-500' },
  'memory-files': { dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  'attachments': { dot: 'bg-sky-500', bar: 'bg-sky-500' },
  'skills': { dot: 'bg-amber-500', bar: 'bg-amber-500' },
  'mcp-tools': { dot: 'bg-rose-500', bar: 'bg-rose-500' },
  'plugins': { dot: 'bg-cyan-500', bar: 'bg-cyan-500' },
  'agents': { dot: 'bg-fuchsia-500', bar: 'bg-fuchsia-500' },
  'slash-commands': { dot: 'bg-indigo-500', bar: 'bg-indigo-500' },
  'others': { dot: 'bg-green-500', bar: 'bg-green-500' },
}

export function ContextUsageDetailPanelView({
  usage,
  compactState,
  loadState,
  onClose,
  onOpenReport,
}: ContextUsageDetailPanelViewProps) {
  const aggregate = readContextUsageAggregate(usage, compactState)
  const sections = readContextUsageSections(usage)
  const compactRows = readCompactUsageRows(compactState)
  const sectionShareTotal = readContextUsageSectionShareTotal(sections)
  const usagePercent = aggregate ? readContextUsagePercent(aggregate) : 0
  const subtitle = !aggregate
    ? 'Context window'
    : aggregate.source === 'details' ? 'Provider breakdown' : 'Runtime aggregate'

  return (
    <m.div
      initial={{ opacity: 0, scale: 0.96, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 4 }}
      transition={{ type: 'spring', stiffness: 600, damping: 40 }}
      className="w-80 rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
      data-testid="context-usage-detail-panel"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-[13px] font-medium leading-5 text-foreground">Context Usage</div>
          <div className="text-[11px] leading-4 text-text-tertiary">{subtitle}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onOpenReport}
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
                      {aggregate.maxTokens !== null && aggregate.totalTokens > aggregate.maxTokens
                        ? 'Over limit'
                        : aggregate.percentage === null ? 'Unknown usage' : `${usagePercent}% full`}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-text-secondary">
                      {aggregate.maxTokens === null
                        ? `~${formatTokenCount(aggregate.totalTokens)} tokens`
                        : `~${formatTokenCount(aggregate.totalTokens)} / ${formatTokenCount(aggregate.maxTokens)}`}
                    </span>
                  </div>

                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    {sections.length > 0
                      ? (
                        <div className="absolute inset-0 flex gap-px">
                          {sections.map((section) => {
                            const percent = sectionShareTotal > 0
                              ? (section.tokenCount / sectionShareTotal) * usagePercent
                              : 0
                            if (percent < 0.5) {
                              return null
                            }
                            const accent = sectionAccentClasses[section.kind] ?? sectionAccentClasses.others
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
                      )
                      : (
                        <m.div
                          className={cn(
                            'h-full rounded-full',
                            aggregate.maxTokens !== null && aggregate.totalTokens > aggregate.maxTokens
                              ? 'bg-destructive'
                              : usagePercent >= 90
                                ? 'bg-destructive'
                                : usagePercent >= 70 ? 'bg-warning' : 'bg-primary',
                          )}
                          initial={{ width: 0 }}
                          animate={{ width: `${usagePercent}%` }}
                          transition={{ type: 'spring', stiffness: 500, damping: 35, delay: 0.03 }}
                        />
                      )}
                  </div>

                  <div className="flex items-center justify-between gap-3 text-[11px] text-text-tertiary">
                    <span>{aggregate.source === 'details' ? 'Provider sections' : 'Runtime total'}</span>
                    <span className="tabular-nums">
                      {aggregate.maxTokens === null
                        ? 'Limit unknown'
                        : aggregate.maxTokens >= aggregate.totalTokens
                          ? `${formatTokenCount(aggregate.maxTokens - aggregate.totalTokens)} remaining`
                          : `${formatTokenCount(aggregate.totalTokens - aggregate.maxTokens)} over`}
                    </span>
                  </div>
                </div>

                {sections.length > 0
                  ? (
                    <div className="space-y-px">
                      {sections.map((section, index) => {
                        const accent = sectionAccentClasses[section.kind] ?? sectionAccentClasses.others
                        const share = sectionShareTotal <= 0
                          ? '0%'
                          : `${clampPercent((section.tokenCount / sectionShareTotal) * 100)}%`
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
                              <span className="truncate text-foreground">{readContextUsageSectionLabel(section)}</span>
                            </span>
                            <span className="text-right tabular-nums text-text-secondary">
~
{formatTokenCount(section.tokenCount)}
                            </span>
                            <span className="text-right tabular-nums text-text-tertiary">{share}</span>
                          </m.div>
                        )
                      })}
                    </div>
                  )
                  : compactRows.length > 0
                    ? (
                      <div className="space-y-1">
                        <div className="grid grid-cols-2 gap-1.5">
                          {compactRows.map(row => (
                            <div key={row.label} className="min-w-0 rounded-md bg-muted px-2 py-1.5">
                              <div className="truncate text-[10px] leading-3 text-text-tertiary">{row.label}</div>
                              <div className="mt-1 truncate text-[12px] font-medium tabular-nums text-foreground">{formatTokenCount(row.value)}</div>
                            </div>
                          ))}
                        </div>
                        <p className="px-1 text-[11px] leading-4 text-text-tertiary">Detailed provider sections are unavailable for this runtime.</p>
                      </div>
                    )
                    : (
                      <p className="rounded-md bg-muted px-2 py-1.5 text-[12px] leading-4 text-text-secondary">
                        {loadState === 'loading'
                          ? 'Loading provider breakdown...'
                          : loadState === 'error' ? 'Provider breakdown failed to load' : 'Detailed provider sections are unavailable for this runtime.'}
                      </p>
                    )}
              </m.div>
            )
            : (
              <p key="fallback" className="rounded-md bg-muted px-2 py-1.5 text-[12px] leading-4 text-text-secondary">
                {loadState === 'loading'
                  ? 'Loading context usage...'
                  : loadState === 'error' ? 'Failed to load context usage' : 'Context usage unavailable'}
              </p>
            )}
        </AnimatePresence>
      </div>
    </m.div>
  )
}
