import type { GetWorkspacesResponse } from '@/api-gen'

export interface WorkspacePickerSheetProps {
  onClose: () => void
  onDismissed?: () => void
  onSelect: (workspaceId: string) => void
  selectedWorkspaceId: string
  visible: boolean
  workspaces: GetWorkspacesResponse
}
