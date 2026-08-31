import { TopLevelTabPage } from '@/components/common/top-level-tab-page'
import { ProjectsContainer } from '@/features/projects/ProjectsContainer'

export default function ProjectsRoute() {
  return (
    <TopLevelTabPage>
      <ProjectsContainer />
    </TopLevelTabPage>
  )
}
