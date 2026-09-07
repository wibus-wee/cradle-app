import type { RuntimeWarningPartData } from '@cradle/chat-runtime-contracts'
import {
  AlertLine as ErrorIcon,
  InformationLine as InfoIcon,
  RightSmallLine as ChevronRightIcon,
  WarningLine as WarningIcon,
} from '@mingcute/react'

import { cn } from '~/lib/cn'

const severityPresentation = {
  error: {
    icon: ErrorIcon,
    iconClassName: '!text-destructive',
    detailBorderClassName: 'border-destructive/20',
  },
  info: {
    icon: InfoIcon,
    iconClassName: '!text-sky-500',
    detailBorderClassName: 'border-sky-500/20',
  },
  warning: {
    icon: WarningIcon,
    iconClassName: '!text-amber-500',
    detailBorderClassName: 'border-amber-500/20',
  },
} as const

export function RuntimeWarningBlock({ warning }: { warning: RuntimeWarningPartData }) {
  const presentation = severityPresentation[warning.severity ?? 'warning']
  const Icon = presentation.icon

  if (!warning.additionalDetails) {
    return (
      <div className="my-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Icon className={cn('size-3.5 shrink-0', presentation.iconClassName)} aria-hidden />
        <span className="text-pretty">{warning.message}</span>
      </div>
    )
  }

  return (
    <details className="group my-0.5 text-[12px] text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-0.5 transition-[color] duration-150 hover:text-foreground">
        <Icon className={cn('size-3.5 shrink-0', presentation.iconClassName)} aria-hidden />
        <span className="min-w-0 flex-1 text-pretty">{warning.message}</span>
        <ChevronRightIcon
          className="size-3 shrink-0 transition-transform duration-150 group-open:rotate-90"
          aria-hidden
        />
      </summary>
      <div className={cn(
        'ml-1.5 mt-0.5 border-l py-1 pl-3 text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word text-muted-foreground/80',
        presentation.detailBorderClassName,
      )}
      >
        {warning.additionalDetails}
      </div>
    </details>
  )
}
