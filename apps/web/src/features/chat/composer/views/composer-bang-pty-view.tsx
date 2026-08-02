import { CloseLine as CloseIcon, SendLine as SendIcon } from '@mingcute/react'
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
        'flex min-h-0 flex-col overflow-hidden rounded-[inherit] bg-zinc-950 text-zinc-50',
        className,
      )}
      data-testid="composer-bang-pty"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
        <div className="min-w-0 font-mono text-[11px] text-zinc-400">
          Temporary shell · Esc to discard · Send to write back
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onDiscard}
            className="h-7 gap-1 px-2 text-zinc-300 hover:bg-white/10 hover:text-zinc-50"
            data-testid="composer-bang-pty-discard"
          >
            <CloseIcon className="size-3.5" aria-hidden="true" />
            Discard
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={onSubmit}
            className="h-7 gap-1 px-2.5"
            data-testid="composer-bang-pty-submit"
          >
            <SendIcon className="size-3.5" aria-hidden="true" />
            Write back
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{terminal}</div>
    </div>
  )
}
