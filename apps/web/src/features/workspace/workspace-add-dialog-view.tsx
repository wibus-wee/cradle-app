import {
  FolderOpenLine as FolderOpenIcon,
  LoadingLine,
  NewFolderLine as FolderPlusIcon,
  TransferVerticalLine as RemoteHostIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { GetRemoteHostsResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { cn } from '~/lib/cn'

type RemoteHost = GetRemoteHostsResponse[number]

export interface WorkspaceAddDialogViewProps {
  open: boolean
  creating: boolean
  remoteHosts: readonly RemoteHost[]
  remoteHostsLoading: boolean
  remoteHostsError: string | null
  selectedHostId: string
  remoteContent: ReactNode
  onOpenChange: (open: boolean) => void
  onSelectHost: (hostId: string) => void
  onAddLocal: () => void
}

export function WorkspaceAddDialogView({
  open,
  creating,
  remoteHosts,
  remoteHostsLoading,
  remoteHostsError,
  selectedHostId,
  remoteContent,
  onOpenChange,
  onSelectHost,
  onAddLocal,
}: WorkspaceAddDialogViewProps) {
  const { t } = useTranslation(['workspace', 'settings'])
  const selectedRemoteHost = remoteHosts.find(
    host => host.id === selectedHostId,
  ) ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,46rem)] overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>
            {t('workspace.dialog.addWorkspaceTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(18rem,1fr)] overflow-y-auto border-t border-border/60 sm:min-h-96 sm:grid-cols-[12rem_minmax(0,1fr)] sm:grid-rows-1 sm:overflow-hidden">
          <div className="min-w-0 border-b border-border/60 bg-muted/20 p-2 sm:overflow-y-auto sm:border-b-0 sm:border-r">
            <button
              type="button"
              onClick={() => onSelectHost('local')}
              className={cn(
                'flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors',
                selectedHostId === 'local'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <FolderOpenIcon className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {t('workspace.dialog.addWorkspaceLocalHost')}
              </span>
            </button>
            <div className="mt-2 border-t border-border/60 pt-2">
              <p className="px-2.5 pb-1 text-[10px] font-medium uppercase text-muted-foreground/60">
                {t('settings:remoteHosts.page.title')}
              </p>
              {remoteHostsLoading
                ? (
                    <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-muted-foreground">
                      <LoadingLine className="size-3 animate-spin" />
                      {t('settings:remoteHosts.loading')}
                    </div>
                  )
                : remoteHostsError
                  ? (
                      <p className="break-words px-2.5 py-2 text-[11px] text-destructive">
                        {remoteHostsError}
                      </p>
                    )
                  : remoteHosts.length === 0
                    ? (
                        <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
                          {t('workspace.dialog.addWorkspaceNoRemoteHosts')}
                        </p>
                      )
                    : null}
              {!remoteHostsLoading && !remoteHostsError
                ? (
                    <div className="grid grid-flow-col auto-cols-[minmax(8rem,1fr)] gap-1 overflow-x-auto sm:block sm:space-y-1 sm:overflow-visible">
                      {remoteHosts.map((host) => {
                        const connected
                          = host.connectionState === 'connected'
                        return (
                          <button
                            key={host.id}
                            type="button"
                            disabled={!connected}
                            onClick={() => onSelectHost(host.id)}
                            className={cn(
                              'flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                              selectedHostId === host.id
                                ? 'bg-accent text-foreground'
                                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                            )}
                          >
                            <RemoteHostIcon className="size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">
                              {host.displayName}
                            </span>
                            <span
                              className={cn(
                                'size-1.5 shrink-0 rounded-full',
                                connected
                                  ? 'bg-emerald-500'
                                  : 'bg-muted-foreground/40',
                              )}
                            />
                          </button>
                        )
                      })}
                    </div>
                  )
                : null}
            </div>
          </div>

          <div className="min-h-0 min-w-0 overflow-y-auto p-4">
            {selectedHostId === 'local'
              ? (
                  <div className="flex h-full min-h-64 flex-col items-center justify-center gap-4 px-2 text-center sm:px-6">
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
                )
              : selectedRemoteHost
                ? remoteContent
                : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
