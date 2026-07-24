import {
  ExternalLinkLine as ExternalLinkIcon,
  Refresh1Line as RefreshIcon,
} from '@mingcute/react'
import { m } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

import type { PullRequestDetail } from './api/pull-requests'
import { PullRequestCodeView } from './pull-request-code-view'
import { PullRequestDetailSkeletonView } from './pull-request-detail-skeleton-view'
import { PullRequestSummaryView } from './pull-request-summary-view'
import { PullRequestTimelineView } from './pull-request-timeline-view'

export type PullRequestDetailTab = 'summary' | 'timeline' | 'code'

export interface PullRequestDetailPanelViewProps {
  detail: PullRequestDetail | null
  owner: string
  repo: string
  number: number
  locale: string
  isFetching: boolean
  initialTab?: PullRequestDetailTab
  now?: number
  onRefresh: () => void
  onOpenWork?: () => void
}

export function PullRequestDetailPanelView({
  detail,
  owner,
  repo,
  number,
  locale,
  isFetching,
  initialTab = 'summary',
  now = Date.now(),
  onRefresh,
  onOpenWork,
}: PullRequestDetailPanelViewProps) {
  const { t } = useTranslation('pull-requests')
  const [activeTab, setActiveTab] = useState<PullRequestDetailTab>(initialTab)

  if (!detail) {
    return <PullRequestDetailSkeletonView />
  }

  const tabs: Array<{ id: PullRequestDetailTab, label: string }> = [
    { id: 'summary', label: t('detail.tab.summary') },
    { id: 'timeline', label: t('detail.tab.timeline') },
    { id: 'code', label: t('detail.tab.code') },
  ]

  return (
    <div
      className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-background"
      data-testid="pull-request-detail-panel"
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-2">
        <div className="flex min-w-0 items-center gap-0.5" role="tablist">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative z-10 flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] whitespace-nowrap transition-colors select-none',
                activeTab === tab.id
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {activeTab === tab.id
                ? (
                    <m.span
                      layoutId={`pr-detail-tab-${owner}/${repo}#${number}`}
                      className="absolute inset-0 rounded-md bg-accent"
                      transition={{ type: 'spring', stiffness: 600, damping: 40 }}
                      style={{ zIndex: -1 }}
                    />
                  )
                : null}
              <span className="relative">{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onRefresh}
            aria-label={t('detail.refresh')}
          >
            <RefreshIcon className={cn('size-3.5', isFetching && 'animate-spin')} />
          </Button>
          {onOpenWork
            ? (
                <Button type="button" variant="outline" size="sm" onClick={onOpenWork}>
                  {t('detail.openWork')}
                </Button>
              )
            : null}
          <Button variant="outline" size="icon-xs" asChild aria-label={t('detail.openGithub')}>
            <a href={detail.pullRequest.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pb-20">
          <div className={activeTab === 'summary' ? undefined : 'hidden'}>
            <PullRequestSummaryView detail={detail} now={now} />
          </div>
          <div className={activeTab === 'timeline' ? undefined : 'hidden'}>
            <PullRequestTimelineView detail={detail} locale={locale} />
          </div>
          <div className={activeTab === 'code' ? undefined : 'hidden'}>
            <PullRequestCodeView files={detail.files} />
          </div>
        </div>
      </div>
    </div>
  )
}
