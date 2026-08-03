import { LoadingLine } from '@mingcute/react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuSeparator,
} from '~/components/ui/menu'
import { cn } from '~/lib/cn'

import { multiFolderEntryName } from './multi-folder-entry-name'
import type { Workspace } from './types'

export interface WorkspaceMultiFolderMenuViewProps {
  candidates: readonly Workspace[]
  creating: boolean
  onCommit: (input: {
    name: string
    folders: Array<{ name: string, path: string }>
  }) => Promise<void>
}

function suggestName(workspaces: readonly Workspace[]): string {
  return workspaces
    .map(workspace => multiFolderEntryName(workspace))
    .join('-')
    .slice(0, 64)
}

export function WorkspaceMultiFolderMenuView({
  candidates,
  creating,
  onCommit,
}: WorkspaceMultiFolderMenuViewProps) {
  const { t } = useTranslation('workspace')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedWorkspaces = useMemo(
    () => candidates.filter(workspace => selectedIds.includes(workspace.id)),
    [candidates, selectedIds],
  )

  useEffect(() => {
    if (!nameTouched) {
      setName(selectedWorkspaces.length > 0 ? suggestName(selectedWorkspaces) : '')
    }
  }, [nameTouched, selectedWorkspaces])

  const toggleWorkspace = (workspaceId: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(workspaceId) ? current : [...current, workspaceId]
      }
      return current.filter(id => id !== workspaceId)
    })
    setError(null)
  }

  const canCreate = selectedWorkspaces.length >= 2 && name.trim().length > 0 && !creating

  return (
    <div
      className="flex w-72 flex-col gap-0"
      // Keep typing/clicks inside the submenu from dismissing the parent menu.
      onKeyDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div className="grid gap-1.5 px-2 pb-2 pt-1.5">
        <label
          htmlFor="multi-folder-menu-name"
          className="text-[11px] font-medium text-muted-foreground"
        >
          {t('workspace.menu.multiFolderNameLabel')}
        </label>
        <Input
          id="multi-folder-menu-name"
          value={name}
          disabled={creating}
          placeholder={t('workspace.menu.multiFolderNamePlaceholder')}
          className="h-8"
          onChange={(event) => {
            setNameTouched(true)
            setName(event.currentTarget.value)
            setError(null)
          }}
        />
      </div>

      <MenuSeparator />

      <MenuGroup>
        <MenuGroupLabel>
          {t('workspace.menu.multiFolderMembersLabel')}
        </MenuGroupLabel>
        {candidates.length === 0
          ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {t('workspace.menu.multiFolderNeedProjects')}
              </p>
            )
          : candidates.map(workspace => (
              <MenuCheckboxItem
                key={workspace.id}
                checked={selectedIds.includes(workspace.id)}
                disabled={creating}
                onCheckedChange={checked =>
                  toggleWorkspace(workspace.id, checked === true)}
              >
                <span className="min-w-0 truncate">{workspace.name}</span>
              </MenuCheckboxItem>
            ))}
      </MenuGroup>

      <MenuSeparator />

      <div className="grid gap-2 px-2 pb-2 pt-1.5">
        {error
          ? <p className="text-xs text-destructive">{error}</p>
          : (
              <p className="text-[11px] text-muted-foreground">
                {candidates.length < 2
                  ? t('workspace.menu.multiFolderNeedProjects')
                  : t('workspace.menu.multiFolderHint')}
              </p>
            )}
        <Button
          type="button"
          size="sm"
          className={cn('w-full')}
          disabled={!canCreate}
          onClick={() => {
            const workspaceName = name.trim()
            if (!workspaceName || selectedWorkspaces.length < 2) {
              setError(t('workspace.toast.multiFolderInvalidEntry'))
              return
            }
            const folders = selectedWorkspaces.map(workspace => ({
              name: multiFolderEntryName(workspace),
              path: workspace.locator.path,
            }))
            const folderNames = new Set(folders.map(folder => folder.name))
            if (folderNames.size !== folders.length) {
              setError(t('workspace.toast.multiFolderDuplicateName'))
              return
            }
            void onCommit({ name: workspaceName, folders })
          }}
        >
          {creating ? <LoadingLine className="animate-spin" /> : null}
          {t('workspace.menu.multiFolderCreate')}
        </Button>
      </div>
    </div>
  )
}
