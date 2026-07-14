import { ClipboardLine as ClipboardIcon, CloseLine as XIcon } from '@mingcute/react'
import { m } from 'motion/react'

import { Button } from '~/components/ui/button'

import type { ComposerPastedText } from './pasted-text'
import { pastedTextTitle } from './pasted-text'

export function PastedTextCard({
  pastedText,
  onRemove,
  onRestore,
}: {
  pastedText: ComposerPastedText
  onRemove: () => void
  onRestore: () => void
}) {
  const countLabel
    = pastedText.lineCount > 1
      ? `${pastedText.lineCount.toLocaleString()} lines`
      : `${pastedText.charCount.toLocaleString()} chars`

  return (
    <m.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 600, damping: 40 }}
      className="flex max-w-72 items-center gap-2 rounded-lg bg-[var(--color-surface-inset)] px-2.5 py-2 shadow-[var(--shadow-inset-ring)]"
      data-testid="composer-pasted-text-card"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent-global)]/10 text-[var(--color-accent-global)]">
        <ClipboardIcon className="size-3.5" aria-hidden="true" />
      </span>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onRestore}>
        <span className="block truncate text-xs font-medium text-[var(--text-primary)]">
          {pastedTextTitle(pastedText.text)}
        </span>
        <span className="block text-[11px] text-[var(--text-secondary)]">{countLabel}</span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-6 shrink-0 text-[var(--text-secondary)]"
        aria-label="Remove pasted text"
        onClick={onRemove}
      >
        <XIcon className="size-3" aria-hidden="true" />
      </Button>
    </m.div>
  )
}
