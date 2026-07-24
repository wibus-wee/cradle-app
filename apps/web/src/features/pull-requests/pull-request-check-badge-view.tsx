import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

import { isPullRequestCheckFailure } from './pull-request-detail-presenter'

export interface PullRequestCheckBadgeViewProps {
  status: string
  conclusion: string | null
}

export function PullRequestCheckBadgeView({
  status,
  conclusion,
}: PullRequestCheckBadgeViewProps) {
  const { t } = useTranslation('pull-requests')
  const failed = isPullRequestCheckFailure(conclusion)
  const pending = status !== 'completed' || conclusion === null

  return (
    <span
      className={cn(
        'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
        pending
          ? 'bg-warning/10 text-warning'
          : failed
            ? 'bg-destructive/10 text-destructive'
            : 'bg-success/10 text-success',
      )}
    >
      {pending ? t('check.pending') : failed ? t('check.failed') : t('check.passed')}
    </span>
  )
}
