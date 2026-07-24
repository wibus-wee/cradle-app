import { Message1Line as CommentIcon } from '@mingcute/react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { AssetMarkdown } from '~/features/assets/asset-markdown'

import type { PullRequestDetail } from './api/pull-requests'
import { formatPullRequestTimestamp } from './pull-request-detail-presenter'

type PullRequestTimelineItem = PullRequestDetail['timeline'][number]

function getReviewLabel(
  state: string | null,
  t: TFunction<'pull-requests'>,
): string {
  if (state === 'APPROVED') {
    return t('timeline.review.approved')
  }
  if (state === 'CHANGES_REQUESTED') {
    return t('timeline.review.changesRequested')
  }
  if (state === 'DISMISSED') {
    return t('timeline.review.dismissed')
  }
  return t('timeline.review.commented')
}

export interface PullRequestTimelineEntryViewProps {
  item: PullRequestTimelineItem
  locale: string
}

export function PullRequestTimelineEntryView({
  item,
  locale,
}: PullRequestTimelineEntryViewProps) {
  const { t } = useTranslation('pull-requests')
  const label = item.kind === 'comment'
    ? t('timeline.commented')
    : getReviewLabel(item.state, t)

  return (
    <li className="relative pb-5 pl-5 last:pb-0">
      <span className="absolute -left-[11px] top-0 grid size-[22px] place-items-center overflow-hidden rounded-full bg-background shadow-[var(--shadow-inset-ring)]">
        {item.author?.avatarUrl
          ? (
              <img
                src={item.author.avatarUrl}
                alt=""
                className="size-[22px] rounded-full outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
              />
            )
          : <CommentIcon className="size-2.5 text-muted-foreground" aria-hidden="true" />}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="text-[12.5px] font-medium text-foreground/85">
          {item.author?.login ?? t('timeline.unknownAuthor')}
        </span>
        <span className="text-[11.5px] text-muted-foreground">{label}</span>
      </div>
      <time className="mt-0.5 block font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatPullRequestTimestamp(item.createdAt, locale)}
      </time>
      {item.body
        ? (
            <div className="mt-2 rounded-lg bg-muted/40 p-3">
              <AssetMarkdown
                content={item.body}
                className="text-pretty text-[12.5px] leading-5 text-foreground/80"
              />
            </div>
          )
        : null}
    </li>
  )
}
