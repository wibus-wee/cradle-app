import type { UIMessage } from 'ai'

export interface ChatActivitySheetProps {
  error?: string | null
  isLoading?: boolean
  message?: UIMessage
  onClose: () => void
  visible: boolean
}
