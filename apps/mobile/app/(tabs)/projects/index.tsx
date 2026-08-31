import { SearchableTopLevelTabPage } from '@/components/common/searchable-top-level-tab-page'
import { ProjectsContainer } from '@/features/projects/ProjectsContainer'

export default function ProjectsRoute() {
  return (
    <SearchableTopLevelTabPage placeholder="Search workspaces">
      {search => <ProjectsContainer {...search} />}
    </SearchableTopLevelTabPage>
  )
}
