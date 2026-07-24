import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { openWork } from '~/navigation/navigation-commands'

import { pullRequestQueryOptions } from './api/pull-requests'
import { PullRequestDetailPanelView } from './pull-request-detail-panel-view'

export interface PullRequestDetailPanelProps {
  owner: string
  repo: string
  number: number
  workId?: string
}

export function PullRequestDetailPanel({
  owner,
  repo,
  number,
  workId,
}: PullRequestDetailPanelProps) {
  const { i18n } = useTranslation('pull-requests')
  const detailQuery = useQuery({
    ...pullRequestQueryOptions.detail({
      path: { owner, repo, number: String(number) },
    }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  if (detailQuery.error) {
    throw detailQuery.error
  }

  return (
    <PullRequestDetailPanelView
      detail={detailQuery.data ?? null}
      owner={owner}
      repo={repo}
      number={number}
      locale={i18n.language}
      isFetching={detailQuery.isFetching}
      onRefresh={() => void detailQuery.refetch()}
      onOpenWork={workId ? () => openWork(workId) : undefined}
    />
  )
}
