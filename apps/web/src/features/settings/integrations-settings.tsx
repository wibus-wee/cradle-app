import {
  AddLine as AddIcon,
  ArrowRightLine as ArrowRightIcon,
  CheckLine as CheckIcon,
  ChipLine as ChipIcon,
  CloseLine as CloseIcon,
  CommandLine as TerminalIcon,
  DeleteLine as TrashIcon,
  FlashLine as ZapIcon,
  HashtagLine as HashIcon,
  Key2Line as KeyIcon,
  Link3Line as LinkIcon,
  More2Line as MoreIcon,
  PencilLine as PencilIcon,
  PlayLine as PlayIcon,
  Refresh2Line as RefreshIcon,
  RobotLine as BotIcon,
  SendLine as SendIcon,
  ServerLine as ServerIcon,
  StopLine as StopIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deleteConversationBridgeConnectionsById,
  deleteConversationBridgeConnectionsByIdWorkspacesByExternalWorkspaceIdChannelsByExternalChannelIdBinding,
  getAgents,
  getChatRuntimes,
  getConversationBridgeAdapters,
  getConversationBridgeConnections,
  getConversationBridgeConnectionsByIdChannelBindings,
  getConversationBridgeConnectionsByIdThreads,
  getConversationBridgeDeliveryAttemptsRetryable,
  getProviderTargets,
  getSecrets,
  patchConversationBridgeConnectionsById,
  postConversationBridgeConnectionsByIdStart,
  postConversationBridgeConnectionsByIdStop,
  postConversationBridgeDeliveryAttemptsRetry,
  putConversationBridgeConnectionsByIdWorkspacesByExternalWorkspaceIdChannelsByExternalChannelIdBinding,
} from '~/api-gen/sdk.gen'
import type { GetAgentsResponse, GetChatRuntimesResponse, GetProviderTargetsResponse } from '~/api-gen/types.gen'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { toastManager } from '~/components/ui/toast'
import { isUiRuntimeKindEnabled } from '~/features/agent-runtime/ui-availability'
import { runtimeCatalogItemRequiresProviderTarget } from '~/features/agent-runtime/use-runtime-catalog'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'

import { CreateConnectionDialog } from './connection-create-dialog'
import type { Adapter, ChannelBinding, Connection, DeliveryAttempt, HealthStatus, Secret, ThreadBinding } from './integrations-primitives'
import { formatTimestamp, healthStatusLabel, PlatformGlyph, queryKeys, StatusDot, timeAgo } from './integrations-primitives'
import { SettingsGroup, SettingsMasterDetail, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'
import { useAppPreferences } from './use-app-preferences'

const EMPTY_ADAPTERS: Adapter[] = []
const EMPTY_CHANNEL_BINDINGS: ChannelBinding[] = []
const EMPTY_CONNECTIONS: Connection[] = []
const EMPTY_DELIVERY_ATTEMPTS: DeliveryAttempt[] = []
const EMPTY_SECRETS: Secret[] = []
const EMPTY_THREAD_BINDINGS: ThreadBinding[] = []
const EMPTY_AGENTS: GetAgentsResponse = []
const EMPTY_PROVIDER_TARGETS: GetProviderTargetsResponse = []
const EMPTY_RUNTIMES: GetChatRuntimesResponse['items'] = []

interface RuntimeTargetOption {
  value: string
  label: string
  description: string
  agentId: string | null
  providerTargetId: string | null
  runtimeKind: string | null
}

type RuntimeTargetTranslationKey
  = | 'integrations.channelBindings.runtimeTargetAgentPrefix'
    | 'integrations.channelBindings.runtimeTargetProviderPrefix'

interface RuntimeTargetOptionsInput {
  agents: GetAgentsResponse
  providerTargets: GetProviderTargetsResponse
  runtimes: GetChatRuntimesResponse['items']
  translate: (key: RuntimeTargetTranslationKey) => string
}

function buildRuntimeTargetOptions({
  agents,
  providerTargets,
  runtimes,
  translate,
}: RuntimeTargetOptionsInput): RuntimeTargetOption[] {
  const chatRuntimeByKind = new Map<string, GetChatRuntimesResponse['items'][number]>()
  const runtimesByProviderKind = new Map<string, GetChatRuntimesResponse['items']>()
  for (const runtime of runtimes) {
    if (!isUiRuntimeKindEnabled(runtime.runtimeKind)) {
      continue
    }
    let supportsChatSurface = !runtime.surfaces
    for (const surface of runtime.surfaces ?? []) {
      if (surface === 'chat') {
        supportsChatSurface = true
        break
      }
    }
    if (!runtimeCatalogItemRequiresProviderTarget(runtime) || !supportsChatSurface) {
      continue
    }
    chatRuntimeByKind.set(runtime.runtimeKind, runtime)
    for (const providerKind of runtime.providerKinds) {
      const providerRuntimes = runtimesByProviderKind.get(providerKind)
      if (providerRuntimes) {
        providerRuntimes.push(runtime)
      }
      else {
        runtimesByProviderKind.set(providerKind, [runtime])
      }
    }
  }

  const options: RuntimeTargetOption[] = []
  for (const agent of agents) {
    if (agent.enabled && agent.providerTargetId && chatRuntimeByKind.has(agent.runtimeKind)) {
      options.push({
        value: `agent:${agent.id}`,
        label: `${translate('integrations.channelBindings.runtimeTargetAgentPrefix')} ${agent.name}`,
        description: agent.modelId ?? agent.runtimeKind,
        agentId: agent.id,
        providerTargetId: null,
        runtimeKind: null,
      })
    }
  }

  for (const target of providerTargets) {
    if (!target.enabled) {
      continue
    }
    const providerRuntimes = runtimesByProviderKind.get(target.providerKind) ?? EMPTY_RUNTIMES
    for (const runtime of providerRuntimes) {
      options.push({
        value: `provider:${target.id}:${runtime.runtimeKind}`,
        label: `${translate('integrations.channelBindings.runtimeTargetProviderPrefix')} ${target.displayName}`,
        description: runtime.label,
        agentId: null,
        providerTargetId: target.id,
        runtimeKind: runtime.runtimeKind,
      })
    }
  }
  return options
}

// Connections view component
function ConnectionsView({
  onBack,
  selectedConnectionId,
  onSelectConnection,
  onCreateConnection,
  deletingConnectionId,
  setDeletingConnectionId,
}: {
  onBack: () => void
  selectedConnectionId: string | null
  onSelectConnection: (id: string | null) => void
  onCreateConnection: () => void
  deletingConnectionId: string | null
  setDeletingConnectionId: (v: string | null) => void
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  // Queries
  const {
    data: adapters = EMPTY_ADAPTERS,
    isLoading: adaptersLoading,
    refetch: refetchAdapters,
  } = useQuery({
    queryKey: queryKeys.adapters,
    queryFn: async () => {
      const { data, error } = await getConversationBridgeAdapters()
      if (error) { throw new Error(String(error)) }
      return data ?? []
    },
  })

  const {
    data: connections = EMPTY_CONNECTIONS,
    isLoading: connectionsLoading,
    refetch: refetchConnections,
  } = useQuery({
    queryKey: queryKeys.connections,
    queryFn: async () => {
      const { data, error } = await getConversationBridgeConnections()
      if (error) { throw new Error(String(error)) }
      return data ?? []
    },
  })

  const {
    data: secrets = EMPTY_SECRETS,
    isLoading: secretsLoading,
  } = useQuery({
    queryKey: queryKeys.secrets,
    queryFn: async () => {
      const { data, error } = await getSecrets()
      if (error) { throw new Error(String(error)) }
      return data ?? []
    },
  })

  // Mutations
  const startMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await postConversationBridgeConnectionsByIdStart({ path: { id } })
      if (error) { throw new Error(String(error)) }
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.started') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections })
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.startFailed') })
    },
  })

  const stopMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await postConversationBridgeConnectionsByIdStop({ path: { id } })
      if (error) { throw new Error(String(error)) }
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.stopped') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections })
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.stopFailed') })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await deleteConversationBridgeConnectionsById({ path: { id } })
      if (error) { throw new Error(String(error)) }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.deleted') })
      onSelectConnection(null)
      setDeletingConnectionId(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections })
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.deleteFailed') })
    },
  })

  const handleStart = (connection: Connection) => {
    void startMutation.mutate(connection.id)
  }

  const handleStop = (connection: Connection) => {
    void stopMutation.mutate(connection.id)
  }

  const handleDelete = (connection: Connection) => {
    setDeletingConnectionId(connection.id)
  }

  const confirmDelete = () => {
    if (deletingConnectionId) {
      void deleteMutation.mutate(deletingConnectionId)
    }
  }

  const selectedConnection = connections.find(c => c.id === selectedConnectionId) ?? null

  // Group connections by adapter
  const connectionsByAdapter = new Map<string, Connection[]>()
  for (const adapter of adapters) {
    connectionsByAdapter.set(adapter.id, connections.filter(c => c.adapterId === adapter.id && c.adapterOwner === adapter.owner))
  }

  const isLoading = adaptersLoading || connectionsLoading || secretsLoading

  return (
    <SettingsMasterDetail
      title={t('integrations.categories.connections.title')}
      description={t('integrations.categories.connections.description')}
      toolbar={(
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mb-2 w-fit text-xs"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><path d="m15 18-6-6 6-6" /></svg>
          Back
        </Button>
      )}
      list={(
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCreateConnection}
              className="h-7 gap-1.5 text-xs"
              disabled={adapters.length === 0}
            >
              <AddIcon className="size-3.5" aria-hidden="true" />
              {t('integrations.connection.create')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void refetchAdapters()
                void refetchConnections()
              }}
              className="h-7 gap-1.5 text-xs"
            >
              <RefreshIcon className={cn('size-3.5', isLoading && 'animate-spin')} aria-hidden="true" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading
? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
              </div>
            )
: adapters.length === 0
? (
              <div className="border-y border-border/60 bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground/70">
                {t('integrations.adapter.empty')}
              </div>
            )
: (
              <div className="flex flex-col gap-1.5 p-2">
                {adapters.map(adapter => (
                  <AdapterSection
                    key={`${adapter.owner}-${adapter.id}`}
                    adapter={adapter}
                    connections={connectionsByAdapter.get(adapter.id) ?? []}
                    selectedConnectionId={selectedConnectionId}
                    onSelectConnection={onSelectConnection}
                    onStart={handleStart}
                    onStop={handleStop}
                    onDelete={handleDelete}
                    startingId={startMutation.variables}
                    stoppingId={stopMutation.variables}
                  />
                ))}
                {connections.length === 0 && (
                  <div className="mt-4 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-4 py-8 text-center">
                    <LinkIcon className="mx-auto size-6 text-muted-foreground/40" aria-hidden="true" />
                    <p className="mt-3 text-xs text-muted-foreground">{t('integrations.connection.empty')}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      detail={
        selectedConnection
? (
          <ConnectionDetail
            connection={selectedConnection}
            secrets={secrets}
            onUpdated={() => queryClient.invalidateQueries({ queryKey: queryKeys.connections })}
            onDelete={() => setDeletingConnectionId(selectedConnection.id)}
          />
        )
: (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-muted-foreground">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/30">
              <LinkIcon className="size-5 text-muted-foreground/50" aria-hidden="true" />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">{t('integrations.connection.selectConnection')}</p>
              <p className="mt-1 text-[11px]">{t('integrations.connection.selectConnectionHint')}</p>
            </div>
          </div>
        )
      }
    >
      <AlertDialog
        open={!!deletingConnectionId}
        onOpenChange={open => !open && setDeletingConnectionId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('integrations.connection.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('integrations.connection.deleteConfirmDescription', {
                displayName: connections.find(c => c.id === deletingConnectionId)?.displayName ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('integrations.connection.deleteConfirmCancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Spinner className="size-3.5 mr-1" />}
              {t('integrations.connection.deleteConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsMasterDetail>
  )
}

// Adapter section component
function AdapterSection({
  adapter,
  connections,
  selectedConnectionId,
  onSelectConnection,
  onStart,
  onStop,
  onDelete,
  startingId,
  stoppingId,
}: {
  adapter: Adapter
  connections: Connection[]
  selectedConnectionId: string | null
  onSelectConnection: (id: string) => void
  onStart: (connection: Connection) => void
  onStop: (connection: Connection) => void
  onDelete: (connection: Connection) => void
  startingId: string | undefined
  stoppingId: string | undefined
}) {
  const { t } = useTranslation('settings')
  const isAvailable = true

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <PlatformGlyph platform={adapter.platform} label={adapter.label} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('truncate text-xs font-medium', isAvailable ? 'text-foreground' : 'text-muted-foreground')}>
              {adapter.label}
            </span>
            {!isAvailable && <Badge variant="outline" className="text-[10px]">{t('integrations.adapter.unavailable')}</Badge>}
          </div>
          {adapter.description && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{adapter.description}</p>
          )}
        </div>
        {connections.length > 0 && (
          <span className="inline-flex items-center rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
            {connections.length}
          </span>
        )}
      </div>

      {isAvailable && connections.length > 0 && (
        <div className="border-t border-border/60">
          {connections.map(connection => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              selected={selectedConnectionId === connection.id}
              onSelect={() => onSelectConnection(connection.id)}
              onStart={() => onStart(connection)}
              onStop={() => onStop(connection)}
              onDelete={() => onDelete(connection)}
              starting={startingId === connection.id}
              stopping={stoppingId === connection.id}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// Connection row component with better visuals
function ConnectionRow({
  connection,
  selected,
  onSelect,
  onStart,
  onStop,
  onDelete,
  starting,
  stopping,
}: {
  connection: Connection
  selected: boolean
  onSelect: () => void
  onStart: () => void
  onStop: () => void
  onDelete: () => void
  starting: boolean
  stopping: boolean
}) {
  const { t } = useTranslation('settings')

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
        selected ? 'bg-accent/60' : 'hover:bg-accent/30',
      )}
    >
      <StatusDot
        status={connection.healthStatus as HealthStatus}
        pulse={connection.healthStatus === 'running'}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <span className="truncate text-xs font-medium text-foreground">{connection.displayName}</span>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
          <span>{healthStatusLabel(connection.healthStatus as HealthStatus, t)}</span>
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={e => e.stopPropagation()}
            className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <MoreIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {connection.healthStatus !== 'running' && (
            <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); onStart() }}
              disabled={starting}
            >
              <PlayIcon className="mr-2 size-3.5" aria-hidden="true" />
              {starting ? t('integrations.connection.starting') : t('integrations.connection.start')}
            </DropdownMenuItem>
          )}
          {connection.healthStatus === 'running' && (
            <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); onStop() }}
              disabled={stopping}
            >
              <StopIcon className="mr-2 size-3.5" aria-hidden="true" />
              {stopping ? t('integrations.connection.stopping') : t('integrations.connection.stop')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
          >
            <TrashIcon className="mr-2 size-3.5" aria-hidden="true" />
            {t('integrations.connection.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </button>
  )
}

// ── Connection detail (drill-in) ─────────────────────────────────────────────
// The Slack inner page. Redesigned to actually show the connection's data
// instead of a "managed via secrets" dead end: live health + direct enable
// toggle + inline name edit in a Configuration group; real Slack credentials
// (masked, looked up via secretRefs → secrets) + log level in a Credentials
// group; and a Lifecycle group for timestamps. The three list tabs
// (bindings / threads / deliveries) use the same flat card language as the
// rest of Settings.

// Label/value row for read-mostly metadata inside a detail group.
function MetaRow({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] text-foreground">{children}</span>
    </div>
  )
}

// Small inline chip for an optional routing default on a channel binding.
function RoutingChip({ icon: Icon, value }: { icon: React.ComponentType<{ className?: string }>, value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      <Icon className="size-3" />
      <span className="max-w-[12rem] truncate">{value}</span>
    </span>
  )
}

function ConnectionDetail({
  connection,
  secrets,
  onUpdated,
  onDelete,
}: {
  connection: Connection
  secrets: Secret[]
  onUpdated: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const [displayName, setDisplayName] = useState(connection.displayName)
  const [isEditingName, setIsEditingName] = useState(false)
  const [enabled, setEnabled] = useState(connection.enabled)

  const {
    data: channelBindings = EMPTY_CHANNEL_BINDINGS,
    isLoading: channelBindingsLoading,
  } = useQuery({
    queryKey: queryKeys.channelBindings(connection.id),
    queryFn: async () => {
      const { data, error } = await getConversationBridgeConnectionsByIdChannelBindings({ path: { id: connection.id } })
      if (error) { throw new Error(String(error)) }
      return data ?? []
    },
  })

  const {
    data: threads = EMPTY_THREAD_BINDINGS,
    isLoading: threadsLoading,
  } = useQuery({
    queryKey: queryKeys.threads(connection.id),
    queryFn: async () => {
      const { data, error } = await getConversationBridgeConnectionsByIdThreads({ path: { id: connection.id } })
      if (error) { throw new Error(String(error)) }
      return data ?? []
    },
  })

  const {
    data: retryableDeliveries = EMPTY_DELIVERY_ATTEMPTS,
    isLoading: retryableDeliveriesLoading,
  } = useQuery({
    queryKey: queryKeys.retryableDeliveries,
    queryFn: async () => {
      const { data, error } = await getConversationBridgeDeliveryAttemptsRetryable()
      if (error) { throw new Error(String(error)) }
      return (data ?? []).filter(d => d.connectionId === connection.id)
    },
  })

  // Single patch mutation shared by the name save and the enable toggle —
  // both write { displayName, enabled }, so one code path keeps them honest.
  const updateMutation = useMutation({
    mutationFn: async (patch: { displayName?: string, enabled?: boolean }) => {
      const { data, error } = await patchConversationBridgeConnectionsById({
        path: { id: connection.id },
        body: {
          displayName: patch.displayName ?? connection.displayName,
          enabled: patch.enabled ?? connection.enabled,
        },
      })
      if (error) { throw new Error(String(error)) }
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.updated') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections })
      void onUpdated()
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.updateFailed') })
      // Roll back the optimistic enable toggle on failure.
      setEnabled(connection.enabled)
    },
  })

  const startMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await postConversationBridgeConnectionsByIdStart({ path: { id: connection.id } })
      if (error) { throw new Error(String(error)) }
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.started') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections })
      void onUpdated()
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.startFailed') })
    },
  })

  const stopMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await postConversationBridgeConnectionsByIdStop({ path: { id: connection.id } })
      if (error) { throw new Error(String(error)) }
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.stopped') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections })
      void onUpdated()
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.stopFailed') })
    },
  })

  const invalidateBindings = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.channelBindings(connection.id) })
  }

  const isSlack = connection.platform === 'slack'
  const status = connection.healthStatus as HealthStatus
  const isRunning = connection.healthStatus === 'running'
  const savingName = isEditingName && updateMutation.isPending

  const handleSaveName = () => {
    void updateMutation.mutate({ displayName })
    setIsEditingName(false)
  }

  const handleCancelName = () => {
    setDisplayName(connection.displayName)
    setIsEditingName(false)
  }

  const handleToggleEnabled = (next: boolean) => {
    setEnabled(next)
    void updateMutation.mutate({ enabled: next })
  }

  // Resolve a Slack secret ref (by id stored in secretRefs) to its stored
  // secret so we can show a masked value + label instead of a dead-end note.
  const secretRefs = (connection.secretRefs ?? {}) as Record<string, string>
  const resolveSecret = (refKey: string): Secret | undefined =>
    secretRefs[refKey] ? secrets.find(s => s.id === secretRefs[refKey]) : undefined
  const slackCredentials = isSlack
    ? [
      { refKey: 'botToken', labelKey: 'integrations.slack.botToken' as const },
      { refKey: 'appToken', labelKey: 'integrations.slack.appToken' as const },
      { refKey: 'signingSecret', labelKey: 'integrations.slack.signingSecret' as const },
    ]
    : []
  const logLevel = isSlack ? (connection.config as { logLevel?: string } | null)?.logLevel : undefined

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Tabs defaultValue="config" className="flex-1">
        {/* Sticky identity + action bar */}
        <div className="sticky top-0 z-10 border-b border-border/60 bg-background px-5 pt-4 pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <PlatformGlyph platform={connection.platform} label={connection.displayName} size="sm" />
              <div className="flex min-w-0 items-center gap-2">
                <StatusDot status={status} pulse={isRunning} />
                <h2 className="truncate text-[15px] font-medium text-foreground">{connection.displayName}</h2>
              </div>
              <Badge variant="outline" className="shrink-0 text-[10px] capitalize">{connection.platform}</Badge>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {isRunning
                ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void stopMutation.mutate()}
                    disabled={stopMutation.isPending}
                    className="h-7 gap-1.5 text-xs"
                  >
                    {stopMutation.isPending
                      ? <Spinner className="size-3.5" />
                      : <StopIcon className="size-3.5" aria-hidden="true" />}
                    {t('integrations.connection.stop')}
                  </Button>
                )
                : (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => void startMutation.mutate()}
                    disabled={startMutation.isPending}
                    className="h-7 gap-1.5 text-xs"
                  >
                    {startMutation.isPending
                      ? <Spinner className="size-3.5" />
                      : <PlayIcon className="size-3.5" aria-hidden="true" />}
                    {t('integrations.connection.start')}
                  </Button>
                )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t('integrations.connection.edit')}>
                    <MoreIcon className="size-3.5" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => setIsEditingName(true)}>
                    <PencilIcon className="mr-2 size-3.5" aria-hidden="true" />
                    {t('integrations.connection.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    <TrashIcon className="mr-2 size-3.5" aria-hidden="true" />
                    {t('integrations.connection.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <TabsList className="mt-3 h-8 gap-1 px-0">
            <TabsTrigger value="config" className="h-7 px-2.5 text-[12px]">{t('integrations.connection.configTitle')}</TabsTrigger>
            <TabsTrigger value="bindings" className="h-7 px-2.5 text-[12px]">{t('integrations.channelBindings.title')}</TabsTrigger>
            <TabsTrigger value="threads" className="h-7 px-2.5 text-[12px]">{t('integrations.threads.title')}</TabsTrigger>
            <TabsTrigger value="deliveries" className="h-7 px-2.5 text-[12px]">
              {t('integrations.delivery.title')}
              {retryableDeliveries.length > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-medium text-white">
                  {retryableDeliveries.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Configuration */}
        <TabsContent value="config" className="flex-1 space-y-6 px-5 py-5">
          <SettingsGroup label={t('integrations.connection.configTitle')}>
            {/* Display name — inline edit */}
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <Label className="text-[13px] font-medium text-foreground">{t('integrations.connection.displayName')}</Label>
              </div>
              {isEditingName
                ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={displayName}
                      autoFocus
                      onChange={e => setDisplayName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { handleSaveName() }
                        if (e.key === 'Escape') { handleCancelName() }
                      }}
                      placeholder={t('integrations.connection.displayNamePlaceholder')}
                      className="h-7 w-48 text-xs"
                    />
                    <Button variant="ghost" size="icon-xs" onClick={handleCancelName} disabled={savingName}>
                      <CloseIcon className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button size="icon-xs" onClick={handleSaveName} disabled={savingName || !displayName.trim()}>
                      {savingName ? <Spinner className="size-3.5" /> : <CheckIcon className="size-3.5" aria-hidden="true" />}
                    </Button>
                  </div>
                )
                : (
                  <button
                    type="button"
                    onClick={() => setIsEditingName(true)}
                    className="group flex items-center gap-1.5 text-[13px] text-foreground"
                  >
                    <span className="truncate">{connection.displayName}</span>
                    <PencilIcon className="size-3 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" aria-hidden="true" />
                  </button>
                )}
            </div>

            {/* Enabled — direct toggle */}
            <div className="flex items-center justify-between gap-4 border-t border-border/60 px-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <Label className="text-[13px] font-medium text-foreground">{t('integrations.connection.enabled')}</Label>
                <p className="text-[12px] text-muted-foreground">{t('integrations.connection.enabledDescription')}</p>
              </div>
              <Switch size="sm" checked={enabled} disabled={updateMutation.isPending} onCheckedChange={handleToggleEnabled} />
            </div>

            {/* Health */}
            <div className="border-t border-border/60 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <Label className="text-[13px] font-medium text-foreground">{t('integrations.connection.healthStatus')}</Label>
                <div className="flex items-center gap-1.5">
                  <StatusDot status={status} pulse={isRunning} size="sm" />
                  <span className="text-[13px] text-foreground">{healthStatusLabel(status, t)}</span>
                </div>
              </div>
              {connection.healthMessage && (
                <p className="mt-1.5 text-[12px] text-muted-foreground">{connection.healthMessage}</p>
              )}
            </div>
          </SettingsGroup>

          {/* Slack credentials — real masked values, not a dead end */}
          {isSlack && (
            <SettingsGroup label={t('integrations.slack.title')} description={t('integrations.slack.description')}>
              {slackCredentials.map(({ refKey, labelKey }) => {
                const secret = resolveSecret(refKey)
                return (
                  <div key={refKey} className="flex items-center justify-between gap-4 px-4 py-2.5 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border/60">
                    <div className="flex min-w-0 items-center gap-2">
                      <KeyIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="text-[13px] font-medium text-foreground">{t(labelKey)}</span>
                    </div>
                    {secret
                      ? (
                        <div className="flex min-w-0 flex-col items-end gap-0.5">
                          <span className="truncate font-mono text-[12px] text-foreground">{secret.maskedSecret}</span>
                          <span className="truncate text-[11px] text-muted-foreground">{secret.label}</span>
                        </div>
                      )
                      : (
                        <span className="text-[12px] italic text-muted-foreground/70">—</span>
                      )}
                  </div>
                )
              })}
              {logLevel && (
                <div className="flex items-center justify-between gap-4 border-t border-border/60 px-4 py-2.5">
                  <span className="text-[13px] font-medium text-foreground">{t('integrations.slack.logLevel')}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">{logLevel}</Badge>
                </div>
              )}
            </SettingsGroup>
          )}

          {/* Lifecycle — timestamps */}
          <SettingsGroup label={t('integrations.connection.metadataTitle')}>
            <div className="px-4 py-1">
              <MetaRow label={t('integrations.connection.createdAt')}>
                {formatTimestamp(connection.createdAt)}
              </MetaRow>
              <MetaRow label={t('integrations.connection.updatedAt')}>
                {formatTimestamp(connection.updatedAt)}
              </MetaRow>
              {connection.lastStartedAt && (
                <MetaRow label={t('integrations.connection.lastStartedAt')}>
                  {formatTimestamp(connection.lastStartedAt)}
                </MetaRow>
              )}
              {connection.lastStoppedAt && (
                <MetaRow label={t('integrations.connection.lastStoppedAt')}>
                  {formatTimestamp(connection.lastStoppedAt)}
                </MetaRow>
              )}
              {connection.lastErrorAt && (
                <MetaRow label={t('integrations.connection.lastErrorAt')}>
                  <span className="text-destructive">{formatTimestamp(connection.lastErrorAt)}</span>
                </MetaRow>
              )}
            </div>
          </SettingsGroup>
        </TabsContent>

        <TabsContent value="bindings" className="flex-1 px-5 py-5">
          <ChannelBindingsSection
            connectionId={connection.id}
            bindings={channelBindings}
            loading={channelBindingsLoading}
            onUpdated={invalidateBindings}
          />
        </TabsContent>

        <TabsContent value="threads" className="flex-1 px-5 py-5">
          <ThreadsSection
            threads={threads}
            loading={threadsLoading}
          />
        </TabsContent>

        <TabsContent value="deliveries" className="flex-1 px-5 py-5">
          <FailedDeliveriesSection
            deliveries={retryableDeliveries}
            loading={retryableDeliveriesLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Channel bindings tab ─────────────────────────────────────────────────────

function ChannelBindingsSection({
  connectionId,
  bindings,
  loading,
  onUpdated,
}: {
  connectionId: string
  bindings: ChannelBinding[]
  loading: boolean
  onUpdated: () => void
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const { workspaces } = useWorkspaces()

  const [showAddDialog, setShowAddDialog] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: async (binding: ChannelBinding) => {
      const { error } = await deleteConversationBridgeConnectionsByIdWorkspacesByExternalWorkspaceIdChannelsByExternalChannelIdBinding({
        path: {
          id: connectionId,
          externalWorkspaceId: binding.externalWorkspaceId,
          externalChannelId: binding.externalChannelId,
        },
      })
      if (error) { throw new Error(String(error)) }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.channelBindings.toast.removed') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.channelBindings(connectionId) })
      void onUpdated()
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.channelBindings.toast.removeFailed') })
    },
  })

  const cradleWorkspaceName = (id: string) => workspaces.find(w => w.id === id)?.name ?? id

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t('integrations.channelBindings.title')}
        description={t('integrations.channelBindings.description')}
        action={(
          <Button variant="ghost" size="sm" onClick={() => setShowAddDialog(true)} className="h-7 gap-1.5 text-xs">
            <AddIcon className="size-3.5" aria-hidden="true" />
            {t('integrations.channelBindings.add')}
          </Button>
        )}
      />

      {loading
        ? (
          <LoadingRow />
        )
        : bindings.length === 0
          ? (
            <EmptyState icon={<HashIcon className="size-6" />} text={t('integrations.channelBindings.empty')} />
          )
          : (
            <div className="space-y-2">
              {bindings.map((binding) => {
                const routing = [
                  binding.sessionAgentId && { icon: BotIcon, value: binding.sessionAgentId },
                  binding.sessionProviderTargetId && { icon: ServerIcon, value: binding.sessionProviderTargetId },
                  binding.sessionRuntimeKind && { icon: ChipIcon, value: binding.sessionRuntimeKind },
                  binding.sessionModelId && { icon: ZapIcon, value: binding.sessionModelId },
                ].filter(Boolean) as Array<{ icon: React.ComponentType<{ className?: string }>, value: string }>

                return (
                  <div key={binding.id} className="group rounded-xl border border-border/60 bg-card px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <HashIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="truncate font-mono text-[13px] font-medium text-foreground">{binding.externalChannelId}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => void deleteMutation.mutate(binding)}
                        disabled={deleteMutation.isPending}
                        className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <TrashIcon className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-6 text-[11px] text-muted-foreground">
                      <span>in</span>
                      <span className="font-mono text-foreground">{binding.externalWorkspaceId}</span>
                      <ArrowRightIcon className="size-3 text-muted-foreground/50" aria-hidden="true" />
                      <span className="text-foreground">{cradleWorkspaceName(binding.cradleWorkspaceId)}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>{timeAgo(binding.createdAt)}</span>
                    </div>
                    {routing.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                        {routing.map(({ icon: Icon, value }) => (
                          <RoutingChip key={value} icon={Icon} value={value} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

      <AddChannelBindingDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        connectionId={connectionId}
        onAdded={() => { setShowAddDialog(false); void onUpdated() }}
      />
    </div>
  )
}

// ── Threads tab ──────────────────────────────────────────────────────────────

function ThreadsSection({
  threads,
  loading,
}: {
  threads: ThreadBinding[]
  loading: boolean
}) {
  const { t } = useTranslation('settings')
  const { workspaces } = useWorkspaces()

  return (
    <div className="space-y-4">
      <SectionHeader title={t('integrations.threads.title')} description={t('integrations.threads.description')} />

      {loading
        ? <LoadingRow />
        : threads.length === 0
          ? <EmptyState icon={<HashIcon className="size-6" />} text={t('integrations.threads.empty')} />
          : (
            <div className="space-y-2">
              {threads.map(thread => (
                <div key={thread.id} className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <HashIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate font-mono text-[13px] font-medium text-foreground">{thread.externalThreadId}</span>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(thread.createdAt)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-6 text-[11px] text-muted-foreground">
                    <span>in</span>
                    <span className="font-mono text-foreground">{thread.externalChannelId}</span>
                    <ArrowRightIcon className="size-3 text-muted-foreground/50" aria-hidden="true" />
                    <span className="text-foreground">{workspaces.find(w => w.id === thread.cradleWorkspaceId)?.name ?? thread.cradleWorkspaceId ?? '—'}</span>
                  </div>
                  <div className="mt-1 pl-6 text-[11px] text-muted-foreground">
                    <span className="text-muted-foreground/60">session</span>
                    {' '}
                    <span className="font-mono text-foreground/80">{thread.sessionId}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
    </div>
  )
}

// ── Failed deliveries tab ────────────────────────────────────────────────────

function FailedDeliveriesSection({
  deliveries,
  loading,
}: {
  deliveries: DeliveryAttempt[]
  loading: boolean
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const retryMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await postConversationBridgeDeliveryAttemptsRetry()
      if (error) { throw new Error(String(error)) }
      return data
    },
    onSuccess: (result) => {
      toastManager.add({
        type: 'success',
        title: t('integrations.delivery.toast.retried', {
          attempted: result?.attempted ?? 0,
          delivered: result?.delivered ?? 0,
          failed: result?.failed ?? 0,
        }),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.retryableDeliveries })
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.delivery.toast.retryFailed') })
    },
  })

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t('integrations.delivery.title')}
        description={t('integrations.delivery.description')}
        action={deliveries.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void retryMutation.mutate()}
            disabled={retryMutation.isPending}
            className="h-7 gap-1.5 text-xs"
          >
            {retryMutation.isPending
              ? <Spinner className="size-3.5" />
              : <RefreshIcon className="size-3.5" aria-hidden="true" />}
            {t('integrations.delivery.retryAll')}
          </Button>
        )}
      />

      {loading
        ? <LoadingRow />
        : deliveries.length === 0
          ? <EmptyState icon={<SendIcon className="size-6" />} text={t('integrations.delivery.empty')} />
          : (
            <div className="space-y-2">
              {deliveries.map(delivery => (
                <div key={delivery.id} className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className="shrink-0 text-[10px] capitalize">{delivery.status}</Badge>
                      <span className="truncate font-mono text-[12px] font-medium text-foreground">{delivery.externalThreadId}</span>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(delivery.createdAt)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-[11px] text-muted-foreground">
                    <span>
                      {t('integrations.delivery.attemptCount')}
                      :
                      {' '}
                      <span className="text-foreground">{delivery.attemptCount}</span>
                    </span>
                    {delivery.errorText && (
                      <span className="text-destructive">
                        {t('integrations.delivery.errorText')}
                        :
                        {' '}
                        {delivery.errorText}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
    </div>
  )
}

// ── Shared detail-tab helpers ────────────────────────────────────────────────

function SectionHeader({ title, description, action }: { title: string, description?: string, action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="mt-1 text-[12px] text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
      <Spinner className="size-3.5" />
    </div>
  )
}

function EmptyState({ icon, text }: { icon: React.ReactNode, text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-4 py-10 text-center">
      <span className="text-muted-foreground/40">{icon}</span>
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  )
}

// Add channel binding dialog
function AddChannelBindingDialog({
  open,
  onOpenChange,
  connectionId,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  onAdded: () => void
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const { workspaces } = useWorkspaces()

  const [externalWorkspaceId, setExternalWorkspaceId] = useState('')
  const [externalChannelId, setExternalChannelId] = useState('')
  const [cradleWorkspaceId, setCradleWorkspaceId] = useState('')
  const [runtimeTargetValue, setRuntimeTargetValue] = useState('')

  const {
    data: runtimeTargets,
    isError: runtimeTargetsError,
    isLoading: runtimeTargetsLoading,
  } = useQuery({
    queryKey: queryKeys.runtimeTargets,
    enabled: open,
    queryFn: async () => {
      const [agentsResult, providerTargetsResult, runtimesResult] = await Promise.all([
        getAgents(),
        getProviderTargets(),
        getChatRuntimes(),
      ])
      if (agentsResult.error) { throw new Error(String(agentsResult.error)) }
      if (providerTargetsResult.error) { throw new Error(String(providerTargetsResult.error)) }
      if (runtimesResult.error) { throw new Error(String(runtimesResult.error)) }
      return {
        agents: agentsResult.data ?? [],
        providerTargets: providerTargetsResult.data ?? [],
        runtimes: runtimesResult.data?.items ?? [],
      }
    },
  })

  const runtimeTargetOptions = buildRuntimeTargetOptions({
    agents: runtimeTargets?.agents ?? EMPTY_AGENTS,
    providerTargets: runtimeTargets?.providerTargets ?? EMPTY_PROVIDER_TARGETS,
    runtimes: runtimeTargets?.runtimes ?? EMPTY_RUNTIMES,
    translate: key => t(key),
  })

  const addMutation = useMutation({
    mutationFn: async () => {
      const selectedTarget = runtimeTargetOptions.find(option => option.value === runtimeTargetValue)
      const { data, error } = await putConversationBridgeConnectionsByIdWorkspacesByExternalWorkspaceIdChannelsByExternalChannelIdBinding({
        path: { id: connectionId, externalWorkspaceId, externalChannelId },
        body: {
          cradleWorkspaceId,
          sessionAgentId: selectedTarget?.agentId ?? null,
          sessionProviderTargetId: selectedTarget?.providerTargetId ?? null,
          sessionRuntimeKind: selectedTarget?.runtimeKind ?? null,
        },
      })
      if (error) { throw new Error(String(error)) }
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.channelBindings.toast.added') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.channelBindings(connectionId) })
      onAdded()
      setExternalWorkspaceId('')
      setExternalChannelId('')
      setCradleWorkspaceId('')
      setRuntimeTargetValue('')
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.channelBindings.toast.addFailed') })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('integrations.channelBindings.add')}</DialogTitle>
          <DialogDescription>{t('integrations.channelBindings.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="externalWorkspaceId" className="text-xs">{t('integrations.channelBindings.externalWorkspaceId')}</Label>
            <Input
              id="externalWorkspaceId"
              value={externalWorkspaceId}
              onChange={e => setExternalWorkspaceId(e.target.value)}
              placeholder={t('integrations.channelBindings.externalWorkspaceIdPlaceholder')}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="externalChannelId" className="text-xs">{t('integrations.channelBindings.externalChannelId')}</Label>
            <Input
              id="externalChannelId"
              value={externalChannelId}
              onChange={e => setExternalChannelId(e.target.value)}
              placeholder={t('integrations.channelBindings.externalChannelIdPlaceholder')}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cradleWorkspaceId" className="text-xs">{t('integrations.channelBindings.cradleWorkspaceId')}</Label>
            <Select value={cradleWorkspaceId} onValueChange={setCradleWorkspaceId}>
              <SelectTrigger id="cradleWorkspaceId" className="h-8 text-xs">
                <SelectValue placeholder={t('integrations.channelBindings.cradleWorkspacePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map(workspace => (
                  <SelectItem key={workspace.id} value={workspace.id} className="text-xs">{workspace.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="runtimeTarget" className="text-xs">{t('integrations.channelBindings.runtimeTarget')}</Label>
            <Select
              value={runtimeTargetValue}
              onValueChange={setRuntimeTargetValue}
              disabled={runtimeTargetsLoading || runtimeTargetOptions.length === 0}
            >
              <SelectTrigger id="runtimeTarget" className="h-8 text-xs">
                <SelectValue placeholder={runtimeTargetsLoading ? t('integrations.channelBindings.runtimeTargetLoading') : t('integrations.channelBindings.runtimeTargetPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {runtimeTargetOptions.map(option => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {option.label}
                    {' · '}
                    {option.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {runtimeTargetsError && (
              <p className="text-[11px] text-destructive">{t('integrations.channelBindings.runtimeTargetError')}</p>
            )}
            {!runtimeTargetsLoading && runtimeTargetOptions.length === 0 && (
              <p className="text-[11px] text-muted-foreground">{t('integrations.channelBindings.runtimeTargetEmpty')}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">{t('registry.action.cancel')}</Button>
          <Button
            size="sm"
            onClick={() => void addMutation.mutate()}
            disabled={!externalWorkspaceId || !externalChannelId || !cradleWorkspaceId || !runtimeTargetValue || addMutation.isPending}
            className="h-7 text-xs"
          >
            {addMutation.isPending && <Spinner className="size-3.5 mr-1" />}
            {t('integrations.channelBindings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Landing ──────────────────────────────────────────────────────────────────
// Flat, platform-as-the-axis board. One SettingsGroup per adapter (platform),
// its connections listed as hairline-divided rows underneath. No fake
// "category" cards, no big-number stat dashboard — those broke Cradle's flat
// surface-texture language. Live health lives in the header as a compact
// status pill; Provider Skills is demoted to one quiet toggle at the bottom.

function StatusPill({ adapters, connections }: { adapters: Adapter[], connections: Connection[] }) {
  const { t } = useTranslation('settings')
  const running = connections.filter(c => c.healthStatus === 'running').length
  const failed = connections.filter(c => c.healthStatus === 'error').length

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
      <span className="flex items-center gap-1.5">
        {t('integrations.console.statusStrip.adapters')}
        <span className="font-medium text-foreground">{adapters.length}</span>
      </span>
      <span className="text-border">·</span>
      <span className="flex items-center gap-1.5">
        <StatusDot status="running" size="sm" />
        {t('integrations.console.statusStrip.running')}
        <span className="font-medium text-success">{running}</span>
      </span>
      {failed > 0 && (
        <>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1.5">
            <StatusDot status="error" size="sm" />
            {t('integrations.console.statusStrip.failed')}
            <span className="font-medium text-destructive">{failed}</span>
          </span>
        </>
      )}
    </div>
  )
}

function LandingConnectionRow({
  connection,
  adapterLabel,
  selected,
  onSelect,
}: {
  connection: Connection
  adapterLabel: string
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation('settings')
  const status = connection.healthStatus as HealthStatus

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
        selected ? 'bg-accent/60' : 'hover:bg-accent/40',
      )}
    >
      <StatusDot status={status} pulse={status === 'running'} size="sm" />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">{connection.displayName}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {adapterLabel}
{' '}
·
{healthStatusLabel(status, t)}
        </span>
      </div>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  )
}

// Native skill roots this feature symlinks into. Keep this as the single
// source of truth: adding a provider means one entry here plus its
// `integrations.console.providerSkills.path*` string in the default locale.
// The provider label is derived from the path (the `~/.<provider>/` segment)
// so we never carry a redundant, separately-localised name alongside the path
// that already names it.
function providerLabelFromPath(path: string): string {
  const segment = path.split('/')[1] ?? ''
  const name = segment.replace(/^\./, '')
  if (!name) { return path }
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function ProviderSkillsGroup() {
  const { t } = useTranslation('settings')
  const { prefs, isLoading: prefsLoading, isSaving, savePrefs } = useAppPreferences()

  const saveFeatureFlags = (featureFlags: Partial<NonNullable<typeof prefs>['featureFlags']>) => {
    if (!prefs) { return }
    void savePrefs({ featureFlags: { ...prefs.featureFlags, ...featureFlags } })
  }

  const enabled = prefs?.featureFlags.nativeProviderSkillProjection ?? false

  const skillRoots = [
    t('integrations.console.providerSkills.pathCodex'),
    t('integrations.console.providerSkills.pathClaude'),
  ]

  return (
    <SettingsGroup label={t('integrations.categories.provider.title')}>
      <SettingsRow
        label={t('features.nativeProviderSkillProjection.label')}
        description={t('integrations.console.providerSkills.hint')}
      >
        <Switch
          size="sm"
          checked={enabled}
          disabled={prefsLoading || isSaving}
          onCheckedChange={checked => saveFeatureFlags({ nativeProviderSkillProjection: checked })}
        />
      </SettingsRow>
      {/* Responsive grid: tiles 2-up at width so the list stays compact as
          more providers are added, never collapsing into a tall single column. */}
      <div className="grid grid-cols-1 gap-1.5 py-2 sm:grid-cols-2">
        {skillRoots.map(path => (
          <div
            key={path}
            className="inline-flex items-center gap-2 rounded-md bg-muted px-2 py-1.5"
          >
            <span className="shrink-0 text-[11px] font-medium text-foreground">
              {providerLabelFromPath(path)}
            </span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {path}
            </span>
          </div>
        ))}
      </div>
    </SettingsGroup>
  )
}

function SlackGuideStep({
  icon: Icon,
  title,
  description,
  items,
  tone = 'default',
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  items?: string[]
  tone?: 'default' | 'accent'
}) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 gap-y-1 py-1">
      <Icon className={cn('mt-0.5 size-4', tone === 'accent' ? 'text-foreground' : 'text-muted-foreground')} aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-foreground">{title}</div>
        <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground text-pretty">{description}</p>
        {items && items.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {items.map(item => (
              <span key={item} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-4 text-muted-foreground">
                {item}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SlackSetupGuide() {
  const { t } = useTranslation('settings')

  const slackAppSteps = [
    {
      icon: LinkIcon,
      title: t('integrations.slackGuide.step.createApp.title'),
      description: t('integrations.slackGuide.step.createApp.description'),
    },
    {
      icon: ZapIcon,
      title: t('integrations.slackGuide.step.socketMode.title'),
      description: t('integrations.slackGuide.step.socketMode.description'),
      items: ['connections:write'],
    },
    {
      icon: KeyIcon,
      title: t('integrations.slackGuide.step.botScopes.title'),
      description: t('integrations.slackGuide.step.botScopes.description'),
      items: ['chat:write', 'app_mentions:read', 'channels:history', 'groups:history', 'commands'],
    },
    {
      icon: SendIcon,
      title: t('integrations.slackGuide.step.events.title'),
      description: t('integrations.slackGuide.step.events.description'),
      items: ['app_mention', 'message.channels', 'message.groups'],
    },
    {
      icon: TerminalIcon,
      title: t('integrations.slackGuide.step.slashCommand.title'),
      description: t('integrations.slackGuide.step.slashCommand.description'),
      items: ['/cradle'],
      tone: 'accent' as const,
    },
  ]

  const cradleSteps = [
    {
      icon: KeyIcon,
      title: t('integrations.slackGuide.step.credentials.title'),
      description: t('integrations.slackGuide.step.credentials.description'),
      items: ['xoxb-...', 'xapp-...', 'signing secret'],
    },
    {
      icon: HashIcon,
      title: t('integrations.slackGuide.step.binding.title'),
      description: t('integrations.slackGuide.step.binding.description'),
      items: ['T...', 'C... / G...', 'Cradle workspace', 'default runtime target'],
    },
    {
      icon: BotIcon,
      title: t('integrations.slackGuide.step.invite.title'),
      description: t('integrations.slackGuide.step.invite.description'),
    },
  ]

  return (
    <div className="max-w-2xl space-y-5 pb-10">
      <SettingsGroup
        label={t('integrations.slackGuide.slackApp.title')}
        description={t('integrations.slackGuide.slackApp.description')}
        bare
        className="p-4"
      >
        <div className="flex flex-col gap-2">
          {slackAppSteps.map(step => (
            <SlackGuideStep
              key={step.title}
              icon={step.icon}
              title={step.title}
              description={step.description}
              items={step.items}
              tone={step.tone}
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        label={t('integrations.slackGuide.cradle.title')}
        description={t('integrations.slackGuide.cradle.description')}
        bare
        className="p-4"
      >
        <div className="flex flex-col gap-2">
          {cradleSteps.map(step => (
            <SlackGuideStep
              key={step.title}
              icon={step.icon}
              title={step.title}
              description={step.description}
              items={step.items}
            />
          ))}
        </div>
      </SettingsGroup>
    </div>
  )
}

// Main component — landing board with drill-in to connection detail.
export function IntegrationsSettings() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const {
    data: adapters = EMPTY_ADAPTERS,
    isFetching: adaptersFetching,
    isLoading: adaptersLoading,
    refetch: refetchAdapters,
  } = useQuery({
    queryKey: queryKeys.adapters,
    queryFn: async () => {
      const { data, error } = await getConversationBridgeAdapters()
      if (error) { throw new Error(String(error)) }
      return data ?? []
    },
  })

  const {
    data: connections = EMPTY_CONNECTIONS,
    isFetching: connectionsFetching,
    isLoading: connectionsLoading,
    refetch: refetchConnections,
  } = useQuery({
    queryKey: queryKeys.connections,
    queryFn: async () => {
      const { data, error } = await getConversationBridgeConnections()
      if (error) { throw new Error(String(error)) }
      return data ?? []
    },
  })

  const [activeView, setActiveView] = useState<'landing' | 'connections'>('landing')
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [deletingConnectionId, setDeletingConnectionId] = useState<string | null>(null)

  const refreshing = adaptersFetching || connectionsFetching
  const isLoading = adaptersLoading || connectionsLoading

  const connectionsByAdapterMap = new Map<string, Connection[]>()
  for (const adapter of adapters) {
    connectionsByAdapterMap.set(adapter.id, connections.filter(c => c.adapterId === adapter.id && c.adapterOwner === adapter.owner))
  }
  const connectionsByAdapter = adapters.map(adapter => ({
    adapter,
    connections: connectionsByAdapterMap.get(adapter.id) ?? EMPTY_CONNECTIONS,
  }))

  const goToLanding = () => {
    setActiveView('landing')
    setSelectedConnectionId(null)
  }

  const openConnection = (id: string) => {
    setSelectedConnectionId(id)
    setActiveView('connections')
  }

  const handleCreated = () => {
    setShowCreateDialog(false)
    void queryClient.invalidateQueries({ queryKey: queryKeys.connections })
  }

  if (activeView === 'connections') {
    return (
      <>
        <ConnectionsView
          onBack={goToLanding}
          selectedConnectionId={selectedConnectionId}
          onSelectConnection={setSelectedConnectionId}
          onCreateConnection={() => setShowCreateDialog(true)}
          deletingConnectionId={deletingConnectionId}
          setDeletingConnectionId={setDeletingConnectionId}
        />
        <CreateConnectionDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          adapters={adapters}
          onCreated={handleCreated}
        />
      </>
    )
  }

  // Landing — platform-grouped board
  return (
    <SettingsPage
      title={t('integrations.page.title')}
      description={t('integrations.page.description')}
      maxWidth="4xl"
      className="h-full min-h-0 pb-0"
      action={(
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCreateDialog(true)}
              disabled={adapters.length === 0}
              className="h-7 gap-1.5 text-xs"
            >
              <AddIcon className="size-3.5" />
              {t('integrations.console.bridge.new')}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                void refetchAdapters()
                void refetchConnections()
              }}
              aria-label={t('integrations.console.bridge.refresh')}
            >
              <RefreshIcon className={cn('size-3.5', refreshing && 'animate-spin')} />
            </Button>
          </div>
          <StatusPill adapters={adapters} connections={connections} />
        </div>
      )}
    >
      <Tabs defaultValue="connections" className="min-h-0 flex-1 gap-5">
        <TabsList className="h-8 shrink-0 gap-1 px-0">
          <TabsTrigger value="connections" className="h-7 px-2.5 text-[12px]">{t('integrations.tabs.connections')}</TabsTrigger>
          <TabsTrigger value="slack-setup" className="h-7 px-2.5 text-[12px]">{t('integrations.tabs.slackSetup')}</TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="mt-0 min-h-0 overflow-y-auto pr-1 pb-10">
          {isLoading
? (
            <SettingsGroup>
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
              </div>
            </SettingsGroup>
          )
: adapters.length === 0
? (
            <SettingsGroup>
              <div className="px-4 py-10 text-center text-xs text-muted-foreground/70">
                {t('integrations.adapter.empty')}
              </div>
            </SettingsGroup>
          )
: (
            <div className="flex flex-col gap-7">
              {connectionsByAdapter.map(({ adapter, connections: list }) => (
                <SettingsGroup
                  key={`${adapter.owner}-${adapter.id}`}
                  label={adapter.label}
                  action={(
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal tabular-nums">
                      {list.length}
                    </Badge>
                  )}
                  bare
                  className="overflow-hidden p-0"
                >
                  {list.length > 0
? (
                    <div className="flex flex-col [&>*+*]:border-t [&>*+*]:border-border/60">
                      {list.map(connection => (
                        <LandingConnectionRow
                          key={connection.id}
                          connection={connection}
                          adapterLabel={adapter.label}
                          selected={selectedConnectionId === connection.id}
                          onSelect={() => openConnection(connection.id)}
                        />
                      ))}
                    </div>
                  )
: (
                    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="text-[11px] text-muted-foreground/70">
                        {t('integrations.adapter.noConnections')}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowCreateDialog(true)}
                        className="h-6 gap-1 text-[11px]"
                      >
                        <AddIcon className="size-3" />
                        {t('integrations.connection.create')}
                      </Button>
                    </div>
                  )}
                </SettingsGroup>
              ))}

              <ProviderSkillsGroup />
            </div>
          )}
        </TabsContent>

        <TabsContent value="slack-setup" className="mt-0 min-h-0 overflow-y-auto pr-1">
          <SlackSetupGuide />
        </TabsContent>
      </Tabs>

      <CreateConnectionDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        adapters={adapters}
        onCreated={handleCreated}
      />
    </SettingsPage>
  )
}
