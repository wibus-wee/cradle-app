import { TopLevelTabPage } from '@/components/common/top-level-tab-page'
import { WorkListContainer } from '@/features/work/WorkListContainer'

export default function WorkRoute() {
  return (
    <TopLevelTabPage>
      <WorkListContainer />
    </TopLevelTabPage>
  )
}
