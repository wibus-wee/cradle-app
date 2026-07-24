import { SparklesLine as SparklesIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

export interface AutomationDraftRowViewProps {
  onSelect: () => void
}

export function AutomationDraftRowView({
  onSelect,
}: AutomationDraftRowViewProps) {
  const { t } = useTranslation('automation')

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded-md border border-dashed border-primary/30 bg-primary/5 px-2 py-1.5 text-left text-xs transition-colors hover:border-primary/50 hover:bg-primary/10"
    >
      <span className="flex size-4 shrink-0 items-center justify-center rounded border border-dashed border-primary/30 text-primary">
        <SparklesIcon className="size-2.5" />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {t('create.title')}
      </span>
    </button>
  )
}
