import { TopLevelTabPage } from '@/components/common/top-level-tab-page'
import { PullRequestListContainer } from '@/features/pull-requests/PullRequestListContainer'

export default function PullRequestsRoute() {
  return (
    <TopLevelTabPage>
      <PullRequestListContainer />
    </TopLevelTabPage>
  )
}
