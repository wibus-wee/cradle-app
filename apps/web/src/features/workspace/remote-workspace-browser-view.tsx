import {
  LoadingLine,
  NewFolderLine as FolderPlusIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import type { GetRemoteHostsResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'

import type { WorkspaceFileEntry } from './api/files'
import { RemoteWorkspaceCardView } from './remote-workspace-card-view'
import { RemoteWorkspaceFileRowView } from './remote-workspace-file-row-view'
import type { Workspace } from './types'

type RemoteHost = GetRemoteHostsResponse[number]

export interface RemoteWorkspaceBrowserViewProps {
  host: RemoteHost
  workspaces: readonly Workspace[]
  selectedWorkspaceId: string | null
  files: readonly WorkspaceFileEntry[]
  workspacesLoading: boolean
  workspacesError: string | null
  filesLoading: boolean
  filesError: string | null
  creating: boolean
  importingPath: boolean
  onSelectWorkspace: (workspaceId: string) => void
  onBrowseAndImport: () => Promise<void>
  onMountExisting: () => Promise<void>
}

export function RemoteWorkspaceBrowserView({
  host,
  workspaces,
  selectedWorkspaceId,
  files,
  workspacesLoading,
  workspacesError,
  filesLoading,
  filesError,
  creating,
  importingPath,
  onSelectWorkspace,
  onBrowseAndImport,
  onMountExisting,
}: RemoteWorkspaceBrowserViewProps) {
  const { t } = useTranslation(['workspace', 'settings'])
  const selectedWorkspace = workspaces.find(
    workspace => workspace.id === selectedWorkspaceId,
  ) ?? workspaces[0] ?? null
  const busy = creating || importingPath

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col items-stretch gap-2 rounded-lg border border-border/70 bg-card/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[12px] font-medium text-foreground/90">
            {t('workspace.dialog.remoteBrowseTitle')}
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('workspace.dialog.remoteBrowseHint', {
              hostName: host.displayName,
            })}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          disabled={busy || host.connectionState !== 'connected'}
          onClick={() => void onBrowseAndImport()}
        >
          {importingPath
            ? <LoadingLine className="animate-spin" />
            : <FolderPlusIcon className="size-3.5" />}
          {t('workspace.dialog.remoteBrowseAction')}
        </Button>
      </div>

      {workspacesLoading
        ? (
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
              <LoadingLine className="size-3 animate-spin" />
              {t('settings:remoteHosts.loading')}
            </div>
          )
        : workspacesError
          ? (
              <p className="break-words rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                {workspacesError}
              </p>
            )
          : workspaces.length === 0
            ? (
                <p className="rounded-md border border-dashed border-border/70 px-2.5 py-3 text-center text-[11px] text-muted-foreground">
                  {t('workspace.dialog.remoteNoExistingWorkspaces')}
                </p>
              )
            : (
                <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <div className="min-h-0 overflow-y-auto rounded-md border border-border/60">
                    <p className="sticky top-0 z-10 border-b border-border/50 bg-muted px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                      {t('workspace.dialog.remoteExistingLabel')}
                    </p>
                    {workspaces.map(workspace => (
                      <RemoteWorkspaceCardView
                        key={workspace.id}
                        workspace={workspace}
                        selected={selectedWorkspace?.id === workspace.id}
                        onSelect={() => onSelectWorkspace(workspace.id)}
                      />
                    ))}
                  </div>

                  <div className="min-w-0 space-y-3">
                    {selectedWorkspace
                      ? (
                          <div className="space-y-2 rounded-lg border border-border/70 bg-card/60 p-3">
                            <div className="min-w-0">
                              <p className="text-[11px] font-medium uppercase text-muted-foreground/70">
                                {t('workspace.dialog.selectedWorkspace')}
                              </p>
                              <p
                                className="truncate font-mono text-[11.5px] text-foreground/80"
                                title={selectedWorkspace.locator.path}
                              >
                                {selectedWorkspace.locator.path}
                              </p>
                            </div>
                            {selectedWorkspace.gitIdentity.originUrl
                              ? (
                                  <p className="break-all font-mono text-[11px] text-muted-foreground/80">
                                    {selectedWorkspace.gitIdentity.originUrl}
                                  </p>
                                )
                              : null}
                            <Button
                              type="button"
                              size="sm"
                              disabled={busy}
                              onClick={() => void onMountExisting()}
                            >
                              {creating && !importingPath
                                ? <LoadingLine className="animate-spin" />
                                : null}
                              {t('workspace.dialog.remoteMountExisting')}
                            </Button>
                          </div>
                        )
                      : null}

                    {filesLoading
                      ? (
                          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
                            <LoadingLine className="size-3 animate-spin" />
                            {t('workspace.dialog.loadingFiles')}
                          </div>
                        )
                      : filesError
                        ? (
                            <p className="break-words rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                              {filesError}
                            </p>
                          )
                        : files.length > 0
                          ? (
                              <div className="max-h-56 overflow-y-auto rounded-md border border-border/60">
                                {files.map(entry => (
                                  <RemoteWorkspaceFileRowView
                                    key={entry.path}
                                    entry={entry}
                                  />
                                ))}
                              </div>
                            )
                          : selectedWorkspace
                            ? (
                                <p className="rounded-md border border-dashed border-border/70 px-2.5 py-3 text-center text-[11px] text-muted-foreground">
                                  {t('settings:remoteHosts.files.empty')}
                                </p>
                              )
                            : null}
                  </div>
                </div>
              )}
    </div>
  )
}
