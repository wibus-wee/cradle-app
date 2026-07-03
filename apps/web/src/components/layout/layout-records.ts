import type { RuntimeKind } from '~/features/agent-runtime/types'

export interface SessionLayoutRecord {
  sessionId: string
  sessionTitle: string | null
  workspaceId: string | null
  workspacePath: string | null
  runtimeKind: RuntimeKind | null
}

export interface WorkspaceLayoutRecord {
  workspaceId: string
  workspaceName: string | null
  workspacePath: string | null
}
