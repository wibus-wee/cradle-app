import { GlobalSearchDialogContent } from './global-search-dialog-content'
import { usePaletteLandingData } from './palette/use-palette-data'

export interface GlobalSearchDialogProps {
  open: boolean
  initialQuery?: string
  onOpenChange: (open: boolean) => void
}

export function GlobalSearchDialog({
  open,
  initialQuery = '>',
  onOpenChange,
}: GlobalSearchDialogProps) {
  usePaletteLandingData(!open)

  if (!open) {
    return null
  }

  return (
    <GlobalSearchDialogContent
      key={initialQuery}
      initialQuery={initialQuery}
      onOpenChange={onOpenChange}
    />
  )
}
