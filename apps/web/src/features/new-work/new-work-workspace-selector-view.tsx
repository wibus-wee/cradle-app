import {
  FolderLine as FolderIcon,
  NewFolderLine as FolderPlusIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '~/components/ui/menu'
import type { Workspace } from '~/features/workspace/types'

export interface NewWorkWorkspaceSelectorViewProps {
  workspaces: readonly Workspace[]
  selectedWorkspaceId: string | null
  adding: boolean
  defaultOpen?: boolean
  onSelectWorkspace: (workspaceId: string) => void
  onAddWorkspace: () => void
}

export function NewWorkWorkspaceSelectorView({
  workspaces,
  selectedWorkspaceId,
  adding,
  defaultOpen = false,
  onSelectWorkspace,
  onAddWorkspace,
}: NewWorkWorkspaceSelectorViewProps) {
  const { t } = useTranslation('work')
  const selectedWorkspace = workspaces.find(
    workspace => workspace.id === selectedWorkspaceId,
  )

  return (
    <Menu defaultOpen={defaultOpen}>
      <MenuTrigger
        render={(
          <Button
            variant="ghost"
            size="xs"
            className="text-foreground hover:text-foreground"
          />
        )}
        data-testid="new-work-workspace-selector"
      >
        <FolderIcon className="size-3 shrink-0" />
        <span className="max-w-32 truncate">
          {selectedWorkspace?.name ?? t('new.workspace')}
        </span>
      </MenuTrigger>
      <MenuPopup>
        <MenuGroup>
          <MenuGroupLabel>{t('new.workspace')}</MenuGroupLabel>
          <MenuSeparator />
          {workspaces.map(workspace => (
            <MenuItem
              key={workspace.id}
              onClick={() => onSelectWorkspace(workspace.id)}
            >
              <FolderIcon className="size-3" />
              <span className="flex-1">{workspace.name}</span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onClick={onAddWorkspace} disabled={adding}>
            <FolderPlusIcon className="size-3" />
            <span className="flex-1">
              {adding ? t('new.addingProject') : t('new.addProject')}
            </span>
          </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  )
}
