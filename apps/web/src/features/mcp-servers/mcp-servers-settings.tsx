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
import { toastManager } from '~/components/ui/toast'

import { McpServerDialog } from './mcp-server-dialog'
import type { McpServerDraft, McpServerSaveBody } from './mcp-server-form'
import type { McpServersSettingsMode } from './mcp-servers-settings-view'
import { McpServersSettingsView } from './mcp-servers-settings-view'
import type { RegistryCandidate } from './registry-browser'
import { RegistryBrowser } from './registry-browser-container'

type McpServer = GetMcpServersResponse[number]
const QUERY_KEY = ['mcp-servers'] as const
const EMPTY_SERVERS: McpServer[] = []

const NAME_MAX_LENGTH = 64

function slugifyServerName(candidate: RegistryCandidate): string {
  const source = (candidate.title ?? candidate.name).toLowerCase()
  const slug = source
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+/, '')
    .replace(/-+/g, '-')
    .slice(0, NAME_MAX_LENGTH)
  return slug || 'mcp-server'
}

function draftFromCandidate(candidate: RegistryCandidate): McpServerDraft | null {
  if (!candidate.installHint) { return null }
  const name = slugifyServerName(candidate)
  const secretKeys = [...candidate.env]
    .sort((a, b) => Number(b.required) - Number(a.required))
    .map(entry => entry.name)
  if (candidate.installHint.transport === 'stdio') {
    return {
      transport: 'stdio',
      name,
      command: candidate.installHint.command,
      args: candidate.installHint.args,
      secretKeys,
    }
  }
  return {
    transport: 'streamable-http',
    name,
    url: candidate.installHint.url,
    secretKeys,
  }
}

export function McpServersSettings() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<McpServer | null>(null)
  const [draft, setDraft] = useState<McpServerDraft | null>(null)
  const [deleting, setDeleting] = useState<McpServer | null>(null)
  const [mode, setMode] = useState<McpServersSettingsMode>('installed')

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
      setDraft(null)
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
    setDraft(null)
    setDialogOpen(true)
  }
  const openEdit = (server: McpServer) => {
    setEditing(server)
    setDraft(null)
    setDialogOpen(true)
  }
  const installCandidate = (candidate: RegistryCandidate) => {
    const candidateDraft = draftFromCandidate(candidate)
    if (!candidateDraft) { return }
    setEditing(null)
    setDraft(candidateDraft)
    setDialogOpen(true)
  }

  return (
    <>
      <McpServersSettingsView
        mode={mode}
        servers={servers}
        isLoading={serversQuery.isLoading}
        isError={serversQuery.isError}
        toggling={enabledMutation.isPending}
        discover={mode === 'discover' ? <RegistryBrowser onInstall={installCandidate} /> : null}
        onModeChange={setMode}
        onRetry={() => void serversQuery.refetch()}
        onAdd={openCreate}
        onToggle={(server, enabled) => enabledMutation.mutate({ server, enabled })}
        onEdit={openEdit}
        onDelete={setDeleting}
      />

      {dialogOpen && (
        <McpServerDialog
          key={editing?.id ?? (draft ? `draft-${draft.name}` : 'new')}
          open={dialogOpen}
          server={editing}
          draft={draft ?? undefined}
          saving={saveMutation.isPending}
          onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) {
              setEditing(null)
              setDraft(null)
            }
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
    </>
  )
}
