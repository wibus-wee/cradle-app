import { GitPullRequestLine as PullRequestIcon } from '@mingcute/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { PullRequestDetail } from './api/pull-requests'
import { formatPullRequestTimestamp } from './pull-request-detail-presenter'
import { PullRequestTimelineEntryView } from './pull-request-timeline-entry-view'

type PullRequestTimelineItem = PullRequestDetail['timeline'][number]

interface PullRequestLifecycleEvent {
  id: string
  kind: 'lifecycle'
  label: string
  createdAt: string
}

type PullRequestTimelineEvent = PullRequestLifecycleEvent | PullRequestTimelineItem

export interface PullRequestTimelineViewProps {
  detail: PullRequestDetail
  locale: string
}

export function PullRequestTimelineView({
  detail,
  locale,
}: PullRequestTimelineViewProps) {
  const { t } = useTranslation('pull-requests')
  const events = useMemo<PullRequestTimelineEvent[]>(() => {
    const pullRequest = detail.pullRequest
    const lifecycle: PullRequestLifecycleEvent[] = [{
      id: 'created',
      kind: 'lifecycle',
      label: t('timeline.created'),
      createdAt: pullRequest.createdAtIso,
    }]

    if (pullRequest.mergedAtIso) {
      lifecycle.push({
        id: 'merged',
        kind: 'lifecycle',
        label: t('timeline.merged'),
        createdAt: pullRequest.mergedAtIso,
      })
    }
    else if (pullRequest.closedAtIso) {
      lifecycle.push({
        id: 'closed',
        kind: 'lifecycle',
        label: t('timeline.closed'),
        createdAt: pullRequest.closedAtIso,
      })
    }

    return [...lifecycle, ...detail.timeline].toSorted(
      (left, right) => left.createdAt.localeCompare(right.createdAt),
    )
  }, [detail, t])

  return (
    <div className="pt-6">
      {events.length > 0
        ? (
            <ol className="ml-2.5 border-l border-border/70">
              {events.map(event => event.kind === 'lifecycle'
                ? (
                    <li key={event.id} className="relative pb-5 pl-5 last:pb-0">
                      <span className="absolute -left-[11px] top-0 grid size-[22px] place-items-center rounded-full bg-background text-muted-foreground shadow-[var(--shadow-inset-ring)]">
                        <PullRequestIcon className="size-2.5" aria-hidden="true" />
                      </span>
                      <p className="text-[12.5px] font-medium text-foreground/85">
                        {event.label}
                      </p>
                      <time className="mt-0.5 block font-mono text-[10px] tabular-nums text-muted-foreground">
                        {formatPullRequestTimestamp(event.createdAt, locale)}
                      </time>
                    </li>
                  )
                : (
                    <PullRequestTimelineEntryView
                      key={event.id}
                      item={event}
                      locale={locale}
                    />
                  ))}
            </ol>
          )
        : <p className="text-[13px] text-muted-foreground/70">{t('timeline.empty')}</p>}
    </div>
  )
}
