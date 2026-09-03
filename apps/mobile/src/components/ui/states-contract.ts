import type { LucideIcon } from 'lucide-react-native'

export interface StateProps {
  actionLabel?: string
  title: string
  description?: string
  icon?: LucideIcon
  isActionPending?: boolean
  onAction?: () => void
}
