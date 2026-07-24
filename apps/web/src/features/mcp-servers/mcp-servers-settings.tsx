import {
  AddLine as AddIcon,
  DeleteLine as DeleteIcon,
  EditLine as EditIcon,
  Link3Line as HttpIcon,
  Refresh2Line as RefreshIcon,
  ServerLine as ServerIcon,
  TerminalBoxLine as TerminalIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deleteMcpServersById,
  getMcpServers,
  patchMcpServersByIdEnabled,
  postMcpServers,
  putMcpServersById,
} from '~/api-gen/sdk.gen'
import type { GetMcpServersResponse } from '~/api-gen/types.gen'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { toastManager } from '~/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { SettingsGroup, SettingsPage } from '~/features/settings/settings-container'
import { cn } from '~/lib/cn'

import { McpServerDialog } from './mcp-server-dialog'
import type { McpServerSaveBody } from './mcp-server-form'

type McpServer = GetMcpServersResponse[number]
const QUERY_KEY = ['mcp-servers'] as const
const EMPTY_SERVERS: McpServer[] = []

const statusDotClasses: Record<McpServer['status'], string> = {
  ready: 'bg-emerald-500',
  disabled: 'bg-muted-foreground/40',
  error: 'bg-destructive',
}

export function McpServersSettings() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<McpServer | null>(null)
  const [deleting, setDeleting] = useState<McpServer | null>(null)

  const serversQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await getMcpServers()
      if (error) { throw new Error(String(error)) }
      return data ?? EMPTY_SERVERS
    },
  })
  const servers = serversQuery.data ?? EMPTY_SERVERS

  const saveMutation = useMutation({
    mutationFn: async ({ server, body }: { server: McpServer | null, body: McpServerSaveBody }) => {
      const result = server
        ? await putMcpServersById({ path: { id: server.id }, body })
        : await postMcpServers({ body })
      if (result.error) { throw new Error(String(result.error)) }
      return result.data
    },
    onSuccess: () => {
      setDialogOpen(false)
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toastManager.add({ type: 'success', title: t('mcpServers.toast.saved') })
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: t('mcpServers.toast.saveFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })

  const enabledMutation = useMutation({
    mutationFn: async ({ server, enabled }: { server: McpServer, enabled: boolean }) => {
      const { error } = await patchMcpServersByIdEnabled({
        path: { id: server.id },
        body: { enabled },
      })
      if (error) { throw new Error(String(error)) }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: t('mcpServers.toast.toggleFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (server: McpServer) => {
      const { error } = await deleteMcpServersById({ path: { id: server.id } })
      if (error) { throw new Error(String(error)) }
    },
    onSuccess: () => {
      setDeleting(null)
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toastManager.add({ type: 'success', title: t('mcpServers.toast.deleted') })
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: t('mcpServers.toast.deleteFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (server: McpServer) => {
    setEditing(server)
    setDialogOpen(true)
  }

  return (
    <SettingsPage
      title={t('mcpServers.page.title')}
      description={t('mcpServers.page.description')}
      maxWidth="3xl"
      action={(
        <Button size="sm" onClick={openCreate}>
          <AddIcon />
          {t('mcpServers.action.add')}
        </Button>
      )}
    >
      <SettingsGroup bare>
        {serversQuery.isLoading
          ? (
              <div className="flex min-h-40 items-center justify-center">
                <Spinner />
              </div>
            )
          : serversQuery.isError
            ? (
                <Empty className="min-h-48 border-none">
                  <EmptyMedia variant="icon"><ServerIcon /></EmptyMedia>
                  <EmptyTitle>{t('mcpServers.error.title')}</EmptyTitle>
                  <EmptyDescription>{t('mcpServers.error.description')}</EmptyDescription>
                  <Button size="sm" variant="outline" onClick={() => void serversQuery.refetch()}>
                    <RefreshIcon />
                    {t('mcpServers.action.retry')}
                  </Button>
                </Empty>
              )
            : servers.length === 0
              ? (
                  <Empty className="min-h-48 border-none">
                    <EmptyMedia variant="icon"><ServerIcon /></EmptyMedia>
                    <EmptyTitle>{t('mcpServers.empty.title')}</EmptyTitle>
                    <EmptyDescription>{t('mcpServers.empty.description')}</EmptyDescription>
                    <Button size="sm" variant="outline" onClick={openCreate}>
                      <AddIcon />
                      {t('mcpServers.action.add')}
                    </Button>
                  </Empty>
                )
              : (
                  <div className="divide-y divide-border/60">
                    {servers.map(server => (
                      <div key={server.id} className="flex min-w-0 items-center gap-3 px-4 py-3.5">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground">
                          {server.transport === 'stdio' ? <TerminalIcon className="size-4" /> : <HttpIcon className="size-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{server.name}</span>
                            <Badge variant="outline">
                              {server.transport === 'stdio' ? t('mcpServers.transport.stdio') : t('mcpServers.transport.http')}
                            </Badge>
                            <span className={cn('size-1.5 shrink-0 rounded-full', statusDotClasses[server.status])} />
                          </div>
                          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                            {server.transport === 'stdio'
                              ? [server.command, ...(server.args ?? [])].join(' ')
                              : server.url}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {server.secretKeys.map(key => (
                              <Badge key={key} variant="secondary" className="font-mono text-[10px]">{key}</Badge>
                            ))}
                            {server.status === 'error' && server.error && (
                              <span className="truncate text-xs text-destructive">{server.error}</span>
                            )}
                            {server.transport === 'streamable-http' && (
                              <span className="text-[11px] text-muted-foreground">{t('mcpServers.runtime.httpNote')}</span>
                            )}
                          </div>
                        </div>
                        <Switch
                          checked={server.enabled}
                          onCheckedChange={enabled => enabledMutation.mutate({ server, enabled })}
                          disabled={enabledMutation.isPending}
                          aria-label={t('mcpServers.action.toggle', { name: server.name })}
                        />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon-sm" variant="ghost" onClick={() => openEdit(server)} aria-label={t('mcpServers.action.edit')}>
                              <EditIcon />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('mcpServers.action.edit')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon-sm" variant="ghost" onClick={() => setDeleting(server)} aria-label={t('mcpServers.action.delete')}>
                              <DeleteIcon />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('mcpServers.action.delete')}</TooltipContent>
                        </Tooltip>
                      </div>
                    ))}
                  </div>
                )}
      </SettingsGroup>

      {dialogOpen && (
        <McpServerDialog
          key={editing?.id ?? 'new'}
          open={dialogOpen}
          server={editing}
          saving={saveMutation.isPending}
          onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) { setEditing(null) }
          }}
          onSave={async (body) => {
            await saveMutation.mutateAsync({ server: editing, body })
          }}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mcpServers.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('mcpServers.delete.description', { name: deleting?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('mcpServers.action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleting && deleteMutation.mutate(deleting)}
            >
              {t('mcpServers.action.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  )
}
