import {
  FolderLine as FolderIcon,
  Message1Line as MessageSquareIcon,
  NewFolderLine as FolderPlusIcon,
} from '@mingcute/react'

import { RepoOwnerAvatar } from '~/components/common/repo-owner-avatar'
import { Button } from '~/components/ui/button'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '~/components/ui/menu'

export interface NewChatWorkspaceOption {
  /** Workspace id, or `repo:<key>` for a merged repository entry. */
  id: string
  name: string
  /** Git origin display; merged repo entries show the owner avatar. */
  repo?: { owner: string, avatarUrl: string | null } | null
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
        {selectedWorkspace?.repo
          ? (
              <RepoOwnerAvatar
                owner={selectedWorkspace.repo.owner}
                avatarUrl={selectedWorkspace.repo.avatarUrl}
                className="size-3.5"
              />
            )
          : <FolderIcon className="size-3.5 shrink-0" aria-hidden="true" />}
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
            <MessageSquareIcon className="size-3.5" aria-hidden="true" />
            <span className="flex-1">{adhocLabel}</span>
          </MenuItem>
          {workspaces.map(workspace => (
            <MenuItem
              key={workspace.id}
              onClick={() => onSelectWorkspace(workspace.id)}
              data-testid={`new-chat-workspace-option-${workspace.id}`}
            >
              {workspace.repo
                ? (
                    <RepoOwnerAvatar
                      owner={workspace.repo.owner}
                      avatarUrl={workspace.repo.avatarUrl}
                      className="size-3.5"
                    />
                  )
                : <FolderIcon className="size-3.5" aria-hidden="true" />}
              <span className="flex-1">{workspace.name}</span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            onClick={onAddProject}
            disabled={addingProject}
            data-testid="new-chat-workspace-add-project"
          >
            <FolderPlusIcon className="size-3.5" aria-hidden="true" />
            <span className="flex-1">{addingProject ? addingProjectLabel : addProjectLabel}</span>
          </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  )
}
