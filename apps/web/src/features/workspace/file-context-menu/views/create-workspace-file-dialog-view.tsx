import type { TFunction } from 'i18next'
import { useEffect, useState } from 'react'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'

import { DEFAULT_NEW_FILE_NAME, DEFAULT_NEW_FOLDER_NAME } from '../lib/workspace-file-menu'

type WorkspaceTranslation = TFunction<'workspace'>

export interface CreateWorkspaceFileDialogViewProps {
  request: { kind: 'file' | 'folder', parentPath: string } | null
  onOpenChange: (open: boolean) => void
  onCommit: (name: string) => Promise<void>
  t: WorkspaceTranslation
}

export function CreateWorkspaceFileDialogView({
  request,
  onOpenChange,
  onCommit,
  t,
}: CreateWorkspaceFileDialogViewProps) {
  const [name, setName] = useState('')

  useEffect(() => {
    setName(request?.kind === 'folder' ? DEFAULT_NEW_FOLDER_NAME : DEFAULT_NEW_FILE_NAME)
  }, [request])

  const title = request?.kind === 'folder'
    ? t('fileTree.dialog.newFolderTitle')
    : t('fileTree.dialog.newFileTitle')

  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void onCommit(name)
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={event => setName(event.currentTarget.value)}
            onFocus={event => event.currentTarget.select()}
            aria-label={t('fileTree.dialog.nameLabel')}
          />
          <DialogFooter variant="bare">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('fileTree.dialog.cancel')}
            </Button>
            <Button type="submit">
              {t('fileTree.dialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
