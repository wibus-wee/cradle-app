import { useLocalSearchParams } from 'expo-router'

import { PullRequestDetailContainer } from '@/features/pull-requests/PullRequestDetailContainer'

export default function PullRequestDetailRoute() {
  const { owner, repo, number } = useLocalSearchParams<{
    owner: string
    repo: string
    number: string
  }>()
  return <PullRequestDetailContainer number={number} owner={owner} repo={repo} />
}
