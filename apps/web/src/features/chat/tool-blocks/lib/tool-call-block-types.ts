import type { ReactNode } from 'react'

import type { RuntimeToolApprovalOption } from '../../rendering/chat-tool-entities'
import type { ToolState } from '../../rendering/tool-ui-classifier'

export interface ToolCallBlockProps {
  toolName: string
  toolCallId: string
  state: ToolState
  animated?: boolean
  approval?: {
    id: string
    approved?: boolean
    reason?: string
    options?: RuntimeToolApprovalOption[]
  }
  argumentsText?: string
  input?: unknown
  output?: unknown
  errorText?: string
  sessionId?: string | null
  autoOpenArtifact?: boolean
  workspaceDiffTarget?: { workspaceId: string, ownerId?: string | null }
  onApprovalResponse?: (approval: { id: string, approved: boolean, selectedOptionId?: string }) => void
  children?: ReactNode
}
