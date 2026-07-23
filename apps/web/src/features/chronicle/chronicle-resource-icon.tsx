import {
  CheckCircleLine as ReadyIcon,
  ChipLine as ResourceIcon,
} from '@mingcute/react'

import { cn } from '~/lib/cn'

import type { ChronicleResourceTone } from './chronicle-resource-presenter'

export interface ChronicleResourceIconProps {
  tone: ChronicleResourceTone
}

export function ChronicleResourceIcon({
  tone,
}: ChronicleResourceIconProps) {
  return (
    <span
      className={cn(
        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md',
        {
          'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300': tone === 'ready',
          'bg-muted text-muted-foreground': tone === 'optional',
          'bg-amber-500/10 text-amber-700 dark:text-amber-300':
            tone === 'warning' || tone === 'loading',
          'bg-destructive/10 text-destructive': tone === 'error',
        },
      )}
    >
      {tone === 'ready'
        ? <ReadyIcon className="size-3.5" />
        : <ResourceIcon className="size-3.5" />}
    </span>
  )
}
