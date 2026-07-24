import { useTranslation } from 'react-i18next'

import type { PostWorkspacesMultiFolderData } from '~/api-gen/types.gen'
import { useDirectoryPicker } from '~/features/filesystem/directory-picker-provider'

import { WorkspaceMultiFolderDialogView } from './workspace-multi-folder-dialog-view'

type MultiFolderWorkspaceBody = PostWorkspacesMultiFolderData['body']

export interface WorkspaceMultiFolderDialogProps {
  open: boolean
  creating: boolean
  onOpenChange: (open: boolean) => void
  onCommit: (input: MultiFolderWorkspaceBody) => Promise<void>
}

export function WorkspaceMultiFolderDialog({
  open,
  creating,
  onOpenChange,
  onCommit,
}: WorkspaceMultiFolderDialogProps) {
  const { t } = useTranslation('workspace')
  const { selectDirectory } = useDirectoryPicker()

  return (
    <WorkspaceMultiFolderDialogView
      open={open}
      creating={creating}
      onOpenChange={onOpenChange}
      onBrowseFolder={() => selectDirectory({
        title: t('workspace.dialog.multiFolderBrowseTitle'),
        description: t('workspace.dialog.multiFolderBrowseDescription'),
      })}
      onCommit={onCommit}
    />
  )
}
