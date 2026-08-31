import type { GetSessionsResponse, GetWorkspacesResponse, PostWorksData } from '@/api-gen'

type Workspace = GetWorkspacesResponse[number]
type Session = GetSessionsResponse['items'][number]

export interface WorkspaceSummary {
  workspace: Workspace
  sessions: Session[]
}

export interface ProjectsViewProps {
  projects: WorkspaceSummary[]
  isCreating?: boolean
  isRefreshing?: boolean
  onCreate: (input: PostWorksData['body']) => void
  onOpenUsage: () => void
  onOpenProject: (workspaceId: string) => void
  onRefresh?: () => Promise<void> | void
  onSearchQueryChange: (query: string) => void
  searchQuery: string
  showsInlineSearch?: boolean
}
