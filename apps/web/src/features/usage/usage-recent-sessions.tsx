// Recent sessions preview — MOCK. `GET /usage/cost/sessions` already returns
// real per-session cost/tokens, but not the title/agent/timestamp needed for
// a readable list. See usage-mock-data.ts for the exact backend gap. Shown
// with a persistent "Preview" badge so it never reads as real history.
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'
import { formatTokenCount, formatUsd } from '~/lib/number-format'

import { mockRecentSessions } from './usage-mock-data'
import type { UsageSummary } from './use-usage-overview'

interface UsageRecentSessionsProps {
  summary: UsageSummary | null
}

export function UsageRecentSessions({ summary }: UsageRecentSessionsProps) {
  const { t } = useTranslation('usage')
  const sessions = mockRecentSessions(summary)

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold text-foreground">{t('sessions.title')}</h2>
        <Badge variant="outline" className="h-4 px-1.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
          {t('patterns.previewBadge')}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('sessions.description')}</p>

      <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-foreground/6">
        {sessions.map((session, index) => (
          <div
            key={session.id}
            className={cn(
              'flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-foreground/[0.03]',
              index < sessions.length - 1 && 'border-b border-foreground/5',
            )}
          >
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/15" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">{session.title}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {session.agentName}
                {' · '}
                <span className="font-mono">{session.modelId}</span>
                {' · '}
                {session.relativeTime}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[13px] font-medium tabular-nums text-foreground">{formatUsd(session.costUsd)}</p>
              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                {t('sessions.tokensAndTurns', { tokens: formatTokenCount(session.tokens), turns: session.turns })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
