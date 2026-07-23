import type { WorkspaceSessionMenuAnchor } from './workspace-session-item-view'

export interface WorkspaceSessionActionsMenuState {
  open: boolean
  sessionId: string | null
  workId: string | null
  anchor: WorkspaceSessionMenuAnchor | null
}

export const CLOSED_WORKSPACE_SESSION_ACTIONS_MENU_STATE:
WorkspaceSessionActionsMenuState = {
  open: false,
  sessionId: null,
  workId: null,
  anchor: null,
}
