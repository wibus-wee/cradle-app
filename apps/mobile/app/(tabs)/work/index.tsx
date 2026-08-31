import { SearchableTopLevelTabPage } from '@/components/common/searchable-top-level-tab-page'
import { WorkListContainer } from '@/features/work/WorkListContainer'

export default function WorkRoute() {
  return (
    <SearchableTopLevelTabPage placeholder="Search Work">
      {search => <WorkListContainer {...search} />}
    </SearchableTopLevelTabPage>
  )
}
