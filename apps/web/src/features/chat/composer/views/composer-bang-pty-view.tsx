import { CloseLine as CloseIcon, SendPlaneLine as SendIcon } from '@mingcute/react'
import type { ReactNode } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

export interface ComposerBangPtyViewProps {
  /** Live PTY surface (ShellView) mounted by the container. */
  terminal: ReactNode
  busy?: boolean
  onSubmit: () => void
  onDiscard: () => void
  className?: string
}

/** Props-only chrome for the Composer bang PTY surface. */
export function ComposerBangPtyView({
  terminal,
  busy = false,
  onSubmit,
  onDiscard,
  className,
}: ComposerBangPtyViewProps) {
  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden rounded-3xl bg-zinc-950 text-zinc-50',
        className,
      )}
      data-testid="composer-bang-pty"
    >
      <div className="pointer-events-none absolute top-2 right-2 z-10 flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={busy}
          onClick={onDiscard}
          aria-label="Discard shell session"
          title="Discard"
          className="pointer-events-auto size-6 rounded-full bg-zinc-950/70 text-zinc-300 hover:bg-white/10 hover:text-zinc-50"
          data-testid="composer-bang-pty-discard"
        >
          <CloseIcon className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          disabled={busy}
          onClick={onSubmit}
          aria-label="Write shell transcript back to chat"
          title="Write back"
          className="pointer-events-auto size-6 rounded-full"
          data-testid="composer-bang-pty-submit"
        >
          <SendIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-[inherit]">{terminal}</div>
    </div>
  )
}
