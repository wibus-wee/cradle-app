import type { RuntimeWarningPartData } from '@cradle/chat-runtime-contracts'
import { RightSmallLine as ChevronRightIcon, WarningLine as WarningIcon } from '@mingcute/react'

export function RuntimeWarningBlock({ warning }: { warning: RuntimeWarningPartData }) {
  if (!warning.additionalDetails) {
    return (
      <div className="my-1 flex min-h-10 items-center gap-2 text-[12px] text-muted-foreground">
        <WarningIcon className="size-3.5 shrink-0 !text-amber-500" aria-hidden />
        <span className="text-pretty">{warning.message}</span>
      </div>
    )
  }

  return (
    <details className="group my-1 text-[12px] text-muted-foreground">
      <summary className="-mx-2 flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md px-2 transition-[background-color,color] duration-150 hover:bg-amber-500/5 hover:text-foreground">
        <WarningIcon className="size-3.5 shrink-0 !text-amber-500" aria-hidden />
        <span className="min-w-0 flex-1 text-pretty">{warning.message}</span>
        <ChevronRightIcon
          className="size-3.5 shrink-0 transition-transform duration-150 group-open:rotate-90"
          aria-hidden
        />
      </summary>
      <div className="ml-1.5 border-l border-amber-500/20 py-1.5 pl-4 text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word text-muted-foreground/80">
        {warning.additionalDetails}
      </div>
    </details>
  )
}
