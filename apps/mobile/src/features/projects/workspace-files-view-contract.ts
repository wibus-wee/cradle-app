import type {
  GetWorkspacesByWorkspaceIdFilesChildrenResponse,
  GetWorkspacesByWorkspaceIdFilesInfoResponse,
} from '@/api-gen'

export interface WorkspaceFilesViewProps {
  currentPath: string
  entries: GetWorkspacesByWorkspaceIdFilesChildrenResponse
  file?: {
    content: string | null
    info: GetWorkspacesByWorkspaceIdFilesInfoResponse
    previewable: boolean
  }
  isRefreshing?: boolean
  onBack: () => void
  onOpenDirectory: (path: string) => void
  onOpenFile: (path: string) => void
  onRefresh?: () => Promise<void> | void
  onSearchChange: (query: string) => void
  search: string
  showsInlineSearch?: boolean
}
