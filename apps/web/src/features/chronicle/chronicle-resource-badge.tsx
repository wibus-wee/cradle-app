import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'

import {
  getChronicleResourceStateLabel,
  getChronicleResourceTone,
} from './chronicle-resource-presenter'
import type { ChronicleModelResource } from './use-chronicle'

export interface ChronicleResourceBadgeProps {
  resource: ChronicleModelResource
}

export function ChronicleResourceBadge({
  resource,
}: ChronicleResourceBadgeProps) {
  const { t } = useTranslation('chronicle')
  const tone = getChronicleResourceTone(resource)

  return (
    <Badge
      variant="outline"
      className={cn(
        'ml-auto text-[11px]',
        {
          'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300':
            tone === 'ready',
          'border-foreground/10 bg-muted text-muted-foreground': tone === 'optional',
          'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300':
            tone === 'warning' || tone === 'loading',
          'border-destructive/20 bg-destructive/10 text-destructive': tone === 'error',
        },
      )}
    >
      {getChronicleResourceStateLabel(t, resource)}
    </Badge>
  )
}
