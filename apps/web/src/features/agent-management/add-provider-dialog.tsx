import { useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '~/components/ui/dialog'

import { ProviderSetupFlow } from './provider-setup-flow'

/**
 * "Add provider" as a modal two-step flow (preset gallery → credential form)
 * instead of morphing the settings detail pane. The dialog keeps a fixed
 * height so neither the step transition nor auth-mode changes shift the page
 * behind it.
 */
export function AddProviderDialog({
  open,
  onOpenChange,
  onComplete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: (newProfileId?: string) => void
}) {
  const [presetId, setPresetId] = useState<string | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPresetId(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">Add provider</DialogTitle>
        <ProviderSetupFlow
          className="h-[min(620px,85vh)]"
          presetId={presetId}
          onSelectPreset={nextPresetId => setPresetId(nextPresetId || null)}
          onComplete={onComplete}
        />
      </DialogContent>
    </Dialog>
  )
}
