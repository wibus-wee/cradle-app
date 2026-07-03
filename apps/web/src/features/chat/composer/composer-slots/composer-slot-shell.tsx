/**
 * Shared shell primitives for compact composer-adjacent runtime slots.
 */
import type { ReactNode } from 'react'

import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

interface ComposerSlotShellProps {
  stateName: string
  testId?: string
  className?: string
  children: ReactNode
}

export function ComposerSlotShell({ stateName, testId, className, children }: ComposerSlotShellProps) {
  return (
    <div
      className={cn(
        'pointer-events-auto relative z-0 mx-1.5 -mb-px max-w-full overflow-hidden rounded-t-lg rounded-b-none bg-transparent px-3.5 py-1.5 pb-2 text-xs text-muted-foreground',
        'border border-border border-b-0 shadow-sm',
        className,
      )}
      data-chat-runtime-slot-state={stateName}
      data-testid={testId}
    >
      <div className="pointer-events-none absolute inset-px rounded-[inherit] bg-background/80 [-webkit-backdrop-filter:blur(64px)] [backdrop-filter:blur(64px)]" />
      <div className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
      <div className="relative z-10 opacity-(--composer-slot-content-opacity) [filter:blur(var(--composer-slot-content-blur,0px))]">
        {children}
      </div>
    </div>
  )
}

export function ComposerSlotIconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="size-5 rounded-sm text-muted-foreground/75 hover:bg-muted hover:text-foreground active:scale-[0.96] disabled:opacity-40"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
