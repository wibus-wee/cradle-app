import {
  CheckLine as CheckIcon,
  Copy2Line as CopyIcon,
  ExternalLinkLine as ExternalLinkIcon,
  Refresh1Line as RefreshIcon,
} from '@mingcute/react'
import { m } from 'motion/react'
import type { KeyboardEvent } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

import type { PullRequestDetail } from './api/pull-requests'
import { PullRequestCodeView } from './pull-request-code-view'
import { PullRequestDetailSkeletonView } from './pull-request-detail-skeleton-view'
import type { PullRequestErrorKind } from './pull-request-error'
import { PullRequestErrorStateView } from './pull-request-error-state-view'
import type { PullRequestActionsViewProps } from './pull-request-summary-view'
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
  errorKind?: PullRequestErrorKind | null
  initialTab?: PullRequestDetailTab
  now?: number
  onRefresh: () => void
  onCopyLink: (url: string) => Promise<void>
  onOpenWork?: () => void
  actions?: PullRequestActionsViewProps
}

export function PullRequestDetailPanelView({
  detail,
  owner,
  repo,
  number,
  locale,
  isFetching,
  errorKind = null,
  initialTab = 'summary',
  now = Date.now(),
  onRefresh,
  onCopyLink,
  onOpenWork,
  actions,
}: PullRequestDetailPanelViewProps) {
  const { t } = useTranslation('pull-requests')
  const [activeTab, setActiveTab] = useState<PullRequestDetailTab>(initialTab)
  const [copied, setCopied] = useState(false)

  if (errorKind) {
    return (
      <div
        className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-background"
        data-testid="pull-request-detail-panel"
      >
        <PullRequestErrorStateView
          kind={errorKind}
          retrying={isFetching}
          onRetry={onRefresh}
        />
      </div>
    )
  }

  if (!detail) {
    return <PullRequestDetailSkeletonView />
  }

  const tabs: Array<{ id: PullRequestDetailTab, label: string }> = [
    { id: 'summary', label: t('detail.tab.summary') },
    { id: 'timeline', label: t('detail.tab.timeline') },
    { id: 'code', label: t('detail.tab.code') },
  ]

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % tabs.length
    }
    else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + tabs.length) % tabs.length
    }
    else if (event.key === 'Home') {
      nextIndex = 0
    }
    else if (event.key === 'End') {
      nextIndex = tabs.length - 1
    }

    if (nextIndex === null) {
      return
    }

    event.preventDefault()
    const nextTab = tabs[nextIndex]
    setActiveTab(nextTab.id)
    const tabButtons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    tabButtons?.[nextIndex]?.focus()
  }

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
              id={`pr-detail-tab-${tab.id}`}
              aria-controls={`pr-detail-panel-${tab.id}`}
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={event => handleTabKeyDown(event, tabs.indexOf(tab))}
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
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              void onCopyLink(detail.pullRequest.url).then(() => setCopied(true))
            }}
            aria-label={copied ? t('detail.copiedLink') : t('detail.copyLink')}
            title={copied ? t('detail.copiedLink') : t('detail.copyLink')}
          >
            {copied
              ? <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
              : <CopyIcon className="size-3.5" aria-hidden />}
          </Button>
          <Button variant="outline" size="icon-xs" asChild aria-label={t('detail.openGithub')}>
            <a href={detail.pullRequest.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pb-6">
          <div
            id="pr-detail-panel-summary"
            role="tabpanel"
            aria-labelledby="pr-detail-tab-summary"
            className={activeTab === 'summary' ? undefined : 'hidden'}
          >
            <PullRequestSummaryView detail={detail} now={now} locale={locale} actions={actions} />
          </div>
          <div
            id="pr-detail-panel-timeline"
            role="tabpanel"
            aria-labelledby="pr-detail-tab-timeline"
            className={activeTab === 'timeline' ? undefined : 'hidden'}
          >
            <PullRequestTimelineView detail={detail} locale={locale} />
          </div>
          <div
            id="pr-detail-panel-code"
            role="tabpanel"
            aria-labelledby="pr-detail-tab-code"
            className={activeTab === 'code' ? undefined : 'hidden'}
          >
            <PullRequestCodeView files={detail.files} />
          </div>
        </div>
      </div>

    </div>
  )
}
