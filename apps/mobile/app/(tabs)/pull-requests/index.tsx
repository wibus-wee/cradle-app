import { SearchableTopLevelTabPage } from '@/components/common/searchable-top-level-tab-page'
import { PullRequestListContainer } from '@/features/pull-requests/PullRequestListContainer'

export default function PullRequestsRoute() {
  return (
    <SearchableTopLevelTabPage placeholder="Search pull requests">
      {search => <PullRequestListContainer {...search} />}
    </SearchableTopLevelTabPage>
  )
}
