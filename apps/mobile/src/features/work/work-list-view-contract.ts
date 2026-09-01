import type { GetWorkspacesResponse, GetWorksResponse, PostWorksData } from '@/api-gen'

export type WorkListItem = GetWorksResponse['items'][number]
export type WorkListWorkspace = GetWorkspacesResponse[number]

export interface WorkListViewProps {
  works: WorkListItem[]
  archivedWorks: WorkListItem[]
  workspaces: WorkListWorkspace[]
  isCreating?: boolean
  isRefreshing?: boolean
  onCreate: (input: PostWorksData['body']) => void
  onOpen: (sessionId: string) => void
  onOpenInfo: (workId: string) => void
  onOpenUsage: () => void
  onRefresh?: () => Promise<void> | void
  onSearchQueryChange: (query: string) => void
  searchQuery: string
  showsInlineSearch?: boolean
}
