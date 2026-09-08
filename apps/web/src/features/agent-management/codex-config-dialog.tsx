import { RightLine as ChevronRightIcon } from '@mingcute/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '~/components/ui/dialog'

import { CodexConfigContainer } from './codex-config-container'

/**
 * Dialog frame for the Codex settings explorer. The built-in close button sits
 * in the top-right corner, so the scroll body reserves space for it with `pt-11`.
 */
export function CodexConfigDialogFrame({ children }: { children: ReactNode }) {
  return (
    <DialogContent
      className="gap-0 overflow-hidden p-0 sm:max-w-2xl"
      aria-describedby={undefined}
    >
      <DialogTitle className="sr-only">Codex configuration</DialogTitle>
      <div className="max-h-[85vh] overflow-y-auto p-5 pt-11">
        {children}
      </div>
    </DialogContent>
  )
}

/**
 * Entry point for the provider-scoped Codex runtime configuration. The panel
 * shows a single row; the full settings explorer lives in a dialog so the
 * provider form stays focused on identity and credentials.
 */
export function CodexConfigDialog({
  providerTargetId,
  onSaved,
  onSavingChange,
  disabled,
}: {
  providerTargetId: string
  onSaved: (configJson: string) => void
  onSavingChange: (saving: boolean) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <section className="flex flex-col gap-4">
      <h3 className="px-0.5 text-sm font-medium text-foreground">Runtime</h3>
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Codex configuration</p>
          <p className="mt-0.5 text-xs text-muted-foreground [text-wrap:pretty]">
            Native Codex settings, feature flags, and TUI behavior for this provider.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1"
            disabled={disabled}
            onClick={() => setOpen(true)}
          >
            Configure
            <ChevronRightIcon />
          </Button>
          <CodexConfigDialogFrame>
            {open && (
              <CodexConfigContainer
                providerTargetId={providerTargetId}
                onSaved={onSaved}
                onSavingChange={onSavingChange}
                disabled={disabled}
              />
            )}
          </CodexConfigDialogFrame>
        </Dialog>
      </div>
    </section>
  )
}
