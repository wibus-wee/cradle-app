import {
  FolderLine as FolderIcon,
  Message1Line as MessageSquareIcon,
  NewFolderLine as FolderPlusIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '~/components/ui/menu'

export interface NewChatWorkspaceOption {
  id: string
  name: string
}

export interface NewChatWorkspaceSelectorViewProps {
  selectedWorkspace: NewChatWorkspaceOption | null
  workspaces: NewChatWorkspaceOption[]
  groupLabel: string
  adhocLabel: string
  addProjectLabel: string
  addingProjectLabel: string
  addingProject?: boolean
  onSelectWorkspace: (workspaceId: string | null) => void
  onAddProject: () => void
}

/** Props-only workspace picker used by the New Chat composer context bar. */
export function NewChatWorkspaceSelectorView({
  selectedWorkspace,
  workspaces,
  groupLabel,
  adhocLabel,
  addProjectLabel,
  addingProjectLabel,
  addingProject = false,
  onSelectWorkspace,
  onAddProject,
}: NewChatWorkspaceSelectorViewProps) {
  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="xs" className="text-foreground hover:text-foreground" />}
        data-testid="new-chat-workspace-selector"
      >
        <FolderIcon className="size-3 shrink-0" aria-hidden="true" />
        <span className="max-w-24 truncate">{selectedWorkspace?.name ?? adhocLabel}</span>
      </MenuTrigger>
      <MenuPopup>
        <MenuGroup>
          <MenuGroupLabel>{groupLabel}</MenuGroupLabel>
          <MenuSeparator />
          <MenuItem
            onClick={() => onSelectWorkspace(null)}
            data-testid="new-chat-workspace-option-adhoc"
          >
            <MessageSquareIcon className="size-3" aria-hidden="true" />
            <span className="flex-1">{adhocLabel}</span>
          </MenuItem>
          {workspaces.map(workspace => (
            <MenuItem
              key={workspace.id}
              onClick={() => onSelectWorkspace(workspace.id)}
              data-testid={`new-chat-workspace-option-${workspace.id}`}
            >
              <FolderIcon className="size-3" aria-hidden="true" />
              <span className="flex-1">{workspace.name}</span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            onClick={onAddProject}
            disabled={addingProject}
            data-testid="new-chat-workspace-add-project"
          >
            <FolderPlusIcon className="size-3" aria-hidden="true" />
            <span className="flex-1">{addingProject ? addingProjectLabel : addProjectLabel}</span>
          </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  )
}
