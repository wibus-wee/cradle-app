import type { ReactNode } from 'react'

import type { ToolState } from '../tool-ui-classifier'

export interface ToolCallBlockProps {
  toolName: string
  toolCallId: string
  state: ToolState
  animated?: boolean
  approval?: {
    id: string
    approved?: boolean
    reason?: string
  }
  argumentsText?: string
  input?: unknown
  output?: unknown
  errorText?: string
  sessionId?: string | null
  workspaceDiffTarget?: { workspaceId: string, ownerId?: string | null }
  onApprovalResponse?: (approval: { id: string, approved: boolean }) => void
  children?: ReactNode
}
