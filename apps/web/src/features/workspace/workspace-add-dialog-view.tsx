import {
  FolderOpenLine as FolderOpenIcon,
  NewFolderLine as FolderPlusIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Separator } from '~/components/ui/separator'

export interface WorkspaceAddDialogViewProps {
  open: boolean
  creating: boolean
  onOpenChange: (open: boolean) => void
  onAddLocal: () => void
  /** Node-dimension picker (merged cross-Node workspace view), when Nodes exist. */
  nodePicker?: ReactNode
}

export function WorkspaceAddDialogView({
  open,
  creating,
  onOpenChange,
  onAddLocal,
  nodePicker,
}: WorkspaceAddDialogViewProps) {
  const { t } = useTranslation('workspace')
  const { t: tNodes } = useTranslation('nodes')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('workspace.dialog.addWorkspaceTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center justify-center gap-4 px-2 py-6 text-center sm:px-6">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted/60">
            <FolderOpenIcon
              className="size-6 text-muted-foreground/70"
              aria-hidden="true"
            />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">
              {t('workspace.dialog.addWorkspaceLocalTitle')}
            </h3>
            <p className="mx-auto max-w-xs text-[12px] leading-relaxed text-muted-foreground">
              {t('workspace.dialog.addWorkspaceLocalDescription')}
            </p>
          </div>
          <Button
            type="button"
            disabled={creating}
            onClick={() => {
              onOpenChange(false)
              onAddLocal()
            }}
          >
            <FolderPlusIcon className="size-3.5" />
            {t('workspace.dialog.addWorkspaceChooseLocal')}
          </Button>
        </div>
        {nodePicker && (
          <>
            <Separator />
            <div className="flex min-w-0 flex-col gap-2 pt-1 text-left">
              <h3 className="px-1 text-[12px] font-medium text-muted-foreground">
                {tNodes('workspace.addFromDevice')}
              </h3>
              {nodePicker}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
