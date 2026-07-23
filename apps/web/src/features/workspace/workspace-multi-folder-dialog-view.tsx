import {
  AlertLine as CircleAlertIcon,
  DeleteLine as Trash2Icon,
  FolderOpenLine as FolderOpenIcon,
  LoadingLine,
  PlusLine as PlusIcon,
} from '@mingcute/react'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import type { PostWorkspacesMultiFolderData } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import {
  SettingsGroup,
  SettingsPage,
} from '~/features/settings/settings-container'
import { SettingsRow } from '~/features/settings/settings-row'

type MultiFolderWorkspaceBody = PostWorkspacesMultiFolderData['body']
type MultiFolderWorkspaceFolder = MultiFolderWorkspaceBody['folders'][number]
type MultiFolderWorkspaceFolderDraft
  = MultiFolderWorkspaceFolder & { id: string }

export interface WorkspaceMultiFolderDialogViewProps {
  open: boolean
  creating: boolean
  onOpenChange: (open: boolean) => void
  onBrowseFolder: () => Promise<string | null>
  onCommit: (input: MultiFolderWorkspaceBody) => Promise<void>
}

function createFolderDraft(): MultiFolderWorkspaceFolderDraft {
  return {
    id: `${Date.now()}-${Math.random()}`,
    name: '',
    path: '',
  }
}

function normalizeFolders(
  rows: MultiFolderWorkspaceFolderDraft[],
): MultiFolderWorkspaceFolder[] | null {
  const folders = rows.map(row => ({
    name: row.name.trim(),
    path: row.path.trim(),
  }))

  if (
    folders.length === 0
    || folders.some(folder => !folder.name || !folder.path.startsWith('/'))
  ) {
    return null
  }

  return folders
}

export function WorkspaceMultiFolderDialogView({
  open,
  creating,
  onOpenChange,
  onBrowseFolder,
  onCommit,
}: WorkspaceMultiFolderDialogViewProps) {
  const { t } = useTranslation('workspace')
  const [name, setName] = useState('')
  const [folderRows, setFolderRows]
    = useState<MultiFolderWorkspaceFolderDraft[]>(() => [createFolderDraft()])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setFolderRows([createFolderDraft()])
      setError(null)
    }
  }, [open])

  const updateFolderRow = useCallback((
    id: string,
    patch: Partial<MultiFolderWorkspaceFolder>,
  ) => {
    setFolderRows(rows =>
      rows.map(row => (row.id === id ? { ...row, ...patch } : row)))
    setError(null)
  }, [])

  const addFolderRow = useCallback(() => {
    setFolderRows(rows => [...rows, createFolderDraft()])
    setError(null)
  }, [])

  const removeFolderRow = useCallback((id: string) => {
    setFolderRows((rows) => {
      if (rows.length === 1) {
        return rows
      }
      return rows.filter(row => row.id !== id)
    })
    setError(null)
  }, [])

  const browseFolderPath = useCallback(async (id: string) => {
    const path = await onBrowseFolder()
    if (path) {
      updateFolderRow(id, { path })
    }
  }, [onBrowseFolder, updateFolderRow])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">
          {t('workspace.dialog.multiFolderTitle')}
        </DialogTitle>
        <form
          className="grid gap-0"
          onSubmit={(event) => {
            event.preventDefault()
            const workspaceName = name.trim()
            const folders = normalizeFolders(folderRows)
            if (!workspaceName || !folders) {
              setError(t('workspace.toast.multiFolderInvalidEntry'))
              return
            }
            const folderNames = new Set(
              folders.map(folder => folder.name),
            )
            if (folderNames.size !== folders.length) {
              setError(t('workspace.toast.multiFolderDuplicateName'))
              return
            }
            void onCommit({ name: workspaceName, folders })
          }}
        >
          <SettingsPage
            title={t('workspace.dialog.multiFolderTitle')}
            description={t('workspace.dialog.multiFolderDescription')}
            className="max-w-none gap-5 px-5 pb-4 pt-5"
          >
            <SettingsGroup>
              <SettingsRow
                label={t('workspace.dialog.nameLabel')}
                description={t(
                  'workspace.dialog.multiFolderNameDescription',
                )}
                vertical
              >
                <Input
                  id="multi-folder-workspace-name"
                  autoFocus
                  value={name}
                  onChange={(event) => {
                    setName(event.currentTarget.value)
                    setError(null)
                  }}
                  placeholder={t(
                    'workspace.dialog.multiFolderNamePlaceholder',
                  )}
                  className="h-8 w-full max-w-sm"
                />
              </SettingsRow>

              <SettingsRow
                label={t('workspace.dialog.multiFolderEntriesLabel')}
                description={t(
                  'workspace.dialog.multiFolderEntriesDescription',
                )}
                vertical
              >
                <div
                  id="multi-folder-workspace-folders"
                  className="grid gap-2"
                >
                  {folderRows.map((row, index) => (
                    <div
                      key={row.id}
                      className="grid min-w-0 grid-cols-[2rem_2rem_minmax(0,1fr)] gap-2 rounded-lg bg-muted/40 p-2 sm:grid-cols-[minmax(7rem,0.42fr)_minmax(0,1fr)_2rem_2rem]"
                    >
                      <Input
                        id={`multi-folder-name-${row.id}`}
                        aria-label={t(
                          'workspace.dialog.multiFolderFolderNameLabel',
                        )}
                        value={row.name}
                        onChange={event =>
                          updateFolderRow(row.id, {
                            name: event.currentTarget.value,
                          })}
                        placeholder={index === 0
                          ? t(
                              'workspace.dialog.multiFolderFolderNamePlaceholder',
                            )
                          : undefined}
                        className="col-span-3 h-8 min-w-0 bg-background sm:col-auto"
                      />
                      <Input
                        id={`multi-folder-path-${row.id}`}
                        aria-label={t(
                          'workspace.dialog.multiFolderFolderPathLabel',
                        )}
                        value={row.path}
                        onChange={event =>
                          updateFolderRow(row.id, {
                            path: event.currentTarget.value,
                          })}
                        placeholder={index === 0
                          ? t(
                              'workspace.dialog.multiFolderFolderPathPlaceholder',
                            )
                          : undefined}
                        className="col-span-3 h-8 min-w-0 bg-background font-mono text-xs sm:col-auto"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t(
                          'workspace.dialog.multiFolderBrowseFolder',
                        )}
                        onClick={() => void browseFolderPath(row.id)}
                      >
                        <FolderOpenIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t(
                          'workspace.dialog.multiFolderRemoveFolder',
                        )}
                        disabled={folderRows.length === 1}
                        onClick={() => removeFolderRow(row.id)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={addFolderRow}
                  >
                    <PlusIcon data-icon="inline-start" />
                    {t('workspace.dialog.multiFolderAddFolder')}
                  </Button>
                </div>
              </SettingsRow>
            </SettingsGroup>

            {error
              ? (
                  <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                    <p>{error}</p>
                  </div>
                )
              : null}
          </SettingsPage>

          <DialogFooter
            variant="bare"
            className="flex-col border-t px-5 py-3 sm:flex-row"
          >
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => onOpenChange(false)}
            >
              {t('workspace.dialog.cancel')}
            </Button>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={creating}
            >
              {creating ? <LoadingLine className="animate-spin" /> : null}
              {t('workspace.dialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
