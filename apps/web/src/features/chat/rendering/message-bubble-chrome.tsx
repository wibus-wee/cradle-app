import { TargetLine as TargetIcon } from '@mingcute/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

export function SteerMessageLabel() {
  const { t } = useTranslation('chat')
  return (
    <div className="mb-1 flex justify-end pr-1">
      <span className="text-[11px] font-medium text-muted-foreground">
        {t('continuation.steer.label')}
      </span>
    </div>
  )
}

export function ThinkingPlaceholder() {
  const { t } = useTranslation('chat')

  return (
    <div
      data-testid="message-bubble-thinking-placeholder"
      className="mt-3 flex h-6 w-full items-center overflow-hidden text-xs text-muted-foreground/70"
      aria-live="polite"
    >
      <span
        className={cn(
          'inline-flex items-center font-medium',
          '[mask-image:linear-gradient(90deg,rgba(0,0,0,0.4)_0%,black_36%,black_64%,rgba(0,0,0,0.4)_100%)] [mask-size:220%_100%]',
          '[-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0.4)_0%,black_36%,black_64%,rgba(0,0,0,0.4)_100%)] [-webkit-mask-size:220%_100%]',
          'animate-[shimmer_2.8s_linear_infinite]',
        )}
      >
        {t('status.thinking')}
      </span>
    </div>
  )
}

export function GoalMessageLabel() {
  return (
    <div className="mb-1 flex justify-end pr-1">
      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase text-muted-foreground/60">
        <TargetIcon className="size-3" aria-hidden="true" />
        Goal
      </span>
    </div>
  )
}

export function ExecutionPhaseFold({
  children,
  defaultOpen = false,
}: {
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultOpen)

  return (
    <div className="my-1">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setExpanded(v => !v)}
        className="h-6 px-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
      >
        {expanded ? 'Hide execution details' : 'Show execution details'}
      </Button>
      {expanded && (
        <div className="overflow-hidden -mx-3 px-3">
          <div className="mt-1 space-y-1">{children}</div>
        </div>
      )}
    </div>
  )
}
