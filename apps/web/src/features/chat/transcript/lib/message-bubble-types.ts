import type { ReactNode } from 'react'

import type { MessageTextTransform } from '../../rendering/message-bubble-selectors'
import type { MessageBubbleEditAction } from '../views/message-bubble-actions-view'

export interface MessageToolApprovalResponse {
  messageId: string
  approvalId: string
  approved: boolean
}

export type MessageToolApprovalHandler = (response: MessageToolApprovalResponse) => void

export interface MessageBubbleByIdProps {
  sessionId: string | null
  messageId: string
  onToolApprovalResponse?: MessageToolApprovalHandler
  editAction?: MessageBubbleEditAction
  textTransform?: MessageTextTransform
}

export interface MessageBubbleFrameSlots {
  content: ReactNode
  thinkingPlaceholder?: ReactNode
  debugCaption?: ReactNode
  actions?: ReactNode
}
