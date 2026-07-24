import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

export interface PullRequestChecksValueViewProps {
  state: string
  count: number
}

export function PullRequestChecksValueView({
  state,
  count,
}: PullRequestChecksValueViewProps) {
  const { t } = useTranslation('pull-requests')

  if (count === 0) {
    return <span className="tabular-nums text-muted-foreground/60">0</span>
  }
  if (state === 'neutral') {
    return <span className="tabular-nums text-muted-foreground">{count}</span>
  }

  const failed = state === 'failure'
  const pending = state === 'pending'
  return (
    <span
      className={cn(
        'flex items-center gap-1 tabular-nums',
        pending ? 'text-warning' : failed ? 'text-destructive' : 'text-success',
      )}
    >
      {count}
      <span className="font-normal text-muted-foreground/60">
        {pending ? t('check.pending') : failed ? t('check.failed') : t('check.passed')}
      </span>
    </span>
  )
}
