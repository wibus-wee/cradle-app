import { useTranslation } from 'react-i18next'

import { AutomationStatusDot } from './automation-status-dot'
import type { AutomationRun } from './types'

export interface AutomationTriageRowViewProps {
  run: AutomationRun
  definitionTitle: string
  onSelect: (definitionId: string) => void
}

export function AutomationTriageRowView({
  run,
  definitionTitle,
  onSelect,
}: AutomationTriageRowViewProps) {
  const { t } = useTranslation('automation')

  return (
    <button
      type="button"
      onClick={() => onSelect(run.automationDefinitionId)}
      className="flex min-w-0 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
    >
      <AutomationStatusDot status={run.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-foreground">
          {definitionTitle}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {run.resultSummary
            ?? run.errorText
            ?? t('triage.needsReview', { defaultValue: 'Needs review' })}
        </span>
      </span>
    </button>
  )
}
