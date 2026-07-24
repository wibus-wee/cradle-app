import { useTranslation } from 'react-i18next'

import type { PullRequestRecencyGroup } from './pull-request-list-presenter'
import { PullRequestRowView } from './pull-request-row-view'
import type { CradlePullRequest } from './use-pull-requests'

export interface PullRequestRecencyGroupViewProps {
  group: PullRequestRecencyGroup
  selectedRef?: string
  locale: string
  now: number
  onPrefetch: (item: CradlePullRequest) => void
  onSelect: (item: CradlePullRequest) => void
}

export function PullRequestRecencyGroupView({
  group,
  selectedRef,
  locale,
  now,
  onPrefetch,
  onSelect,
}: PullRequestRecencyGroupViewProps) {
  const { t } = useTranslation('pull-requests')

  return (
    <section className="mt-5 first:mt-0">
      <div className="flex h-7 items-center px-3">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t(`group.${group.id}`)}
        </span>
      </div>
      <ul role="list" className="flex flex-col gap-0.5">
        {group.items.map(item => (
          <li key={item.id}>
            <PullRequestRowView
              item={item}
              active={item.id === selectedRef}
              locale={locale}
              now={now}
              onPrefetch={() => onPrefetch(item)}
              onSelect={() => onSelect(item)}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
