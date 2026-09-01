import type {
  GetSessionsResponse,
  GetWorkspacesByWorkspaceIdFilesChildrenResponse,
  GetWorkspacesResponse,
  GetWorksResponse,
  PostWorksData,
} from '@/api-gen'

export type WorkspaceDetail = GetWorkspacesResponse[number]
export type WorkspaceSession = GetSessionsResponse['items'][number]
export type WorkspaceWork = GetWorksResponse['items'][number]
export type WorkspaceFile = GetWorkspacesByWorkspaceIdFilesChildrenResponse[number]

export interface WorkspaceViewProps {
  workspace: WorkspaceDetail
  workspaces: WorkspaceDetail[]
  sessions: WorkspaceSession[]
  works: WorkspaceWork[]
  files: WorkspaceFile[]
  isCreating?: boolean
  isRefreshing?: boolean
  onBrowseFiles: () => void
  onCreate: (input: PostWorksData['body']) => void
  onOpenFile: (entry: WorkspaceFile) => void
  onOpenSession: (sessionId: string) => void
  onOpenWork: (sessionId: string) => void
  onOpenWorkInfo: (workId: string) => void
  onRefresh?: () => Promise<void> | void
  onSetSessionPinned: (sessionId: string, pinned: boolean) => void
  updatingSessionPinId?: string
}
