import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

import type { PullRequestFilter } from './pull-request-list-presenter'
import {
  matchesPullRequestFilter,
  PULL_REQUEST_FILTERS,
} from './pull-request-list-presenter'
import type { CradlePullRequest } from './use-pull-requests'

export interface PullRequestFilterTabsViewProps {
  filter: PullRequestFilter
  pullRequests: CradlePullRequest[]
  onChange: (filter: PullRequestFilter) => void
}

export function PullRequestFilterTabsView({
  filter,
  pullRequests,
  onChange,
}: PullRequestFilterTabsViewProps) {
  const { t } = useTranslation('pull-requests')

  return (
    <div className="flex items-end gap-4" role="group" aria-label={t('filter.label')}>
      {PULL_REQUEST_FILTERS.map((value) => {
        const active = filter === value
        const count = pullRequests.filter(item => matchesPullRequestFilter(item, value)).length
        return (
          <Button
            key={value}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(value)}
            aria-pressed={active}
            className={cn(
              'relative h-9 gap-1.5 rounded-none px-0 text-[13px] hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/40',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`filter.${value}`)}
            <span className="tabular-nums text-muted-foreground/70">{count}</span>
            {active
              ? <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-[1.5px] bg-foreground" />
              : null}
          </Button>
        )
      })}
    </div>
  )
}
