import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'

import {
  formatScheduleSummary,
  parseRruleToSchedule,
} from './automation-draft'
import { getAutomationTrigger } from './automation-presentation'
import { AutomationStatusDot } from './automation-status-dot'
import type { AutomationDefinition, AutomationRun } from './types'

export interface AutomationDefinitionRowViewProps {
  definition: AutomationDefinition
  active: boolean
  latestRun: AutomationRun | null
  onSelect: (definitionId: string) => void
}

export function AutomationDefinitionRowView({
  definition,
  active,
  latestRun,
  onSelect,
}: AutomationDefinitionRowViewProps) {
  const { t } = useTranslation('automation')
  const trigger = getAutomationTrigger(definition)
  const summary = trigger
    ? formatScheduleSummary(parseRruleToSchedule(trigger.rrule), t)
    : null

  return (
    <button
      type="button"
      onClick={() => onSelect(definition.id)}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'hover:bg-accent/50',
      )}
    >
      <AutomationStatusDot status={latestRun?.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">
          {definition.title}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {summary ?? trigger?.rrule ?? t('trigger.noTrigger')}
        </span>
      </span>
      {definition.enabled === false && (
        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
          {t('state.disabled')}
        </Badge>
      )}
    </button>
  )
}
