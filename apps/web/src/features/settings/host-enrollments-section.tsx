import {
  ArrowDownLine as ChevronIcon,
  CheckLine as CheckIcon,
  CopyLine as CopyIcon,
  DeleteLine as TrashIcon,
  LinkLine as LinkIcon,
  PlusLine as PlusIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getRelayServersOptions,
  getRelayTransportHostEnrollmentsByEnrollmentIdPairingStringOptions,
  getRelayTransportHostEnrollmentsOptions,
  getRelayTransportHostEnrollmentsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import {
  deleteRelayTransportHostEnrollmentsByEnrollmentId,
  postRelayTransportHostEnrollments,
} from '~/api-gen/sdk.gen'
import type {
  GetRelayServersResponse,
  GetRelayTransportHostEnrollmentsResponse,
  PostRelayTransportHostEnrollmentsData,
} from '~/api-gen/types.gen'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import { SettingsGroup } from './settings-container'

type Enrollment = GetRelayTransportHostEnrollmentsResponse[number]
type RelayServer = GetRelayServersResponse[number]
type SettingsKey = keyof typeof import('~/locales/default').default.settings
type EnrollmentSaveBody = PostRelayTransportHostEnrollmentsData['body']

const MANAGED_LOCAL_RELAY_SERVER_ID = 'system:local-relayd'
const CUSTOM_RELAY_SERVER_VALUE = '__custom_relay_url__'

type EnrollmentDisplayState = 'connected' | 'disconnected' | 'offline' | 'pending'

const DISPLAY_BADGE: Record<EnrollmentDisplayState, string> = {
  connected: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
  disconnected: 'border-muted-foreground/30 text-muted-foreground',
  offline: 'border-destructive/40 text-destructive',
  pending: 'border-muted-foreground/30 text-muted-foreground',
}

/**
 * The DB `status` field is coarse (pending/paired/offline). The host-connector's
 * in-memory `live.connected` is the real-time signal. Prefer it when available:
 * a `paired` enrollment with `live.connected === true` is "Connected" right now,
 * while `live.connected === false` means the controller was paired but isn't
 * currently attached (show "Disconnected" + last-seen).
 */
function enrollmentDisplayState(enrollment: Enrollment): EnrollmentDisplayState {
  if (enrollment.live?.connected) {
    return 'connected'
  }
  if (enrollment.status === 'pending') {
    return 'pending'
  }
  if (enrollment.status === 'offline') {
    return 'offline'
  }
  return 'disconnected'
}

function formatLastSeen(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000)
  if (seconds < 60) {
    return `${seconds}s ago`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  return new Date(ms).toLocaleDateString()
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) {
      return message
    }
  }
  if (typeof error === 'string') {
    return error
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Compute the controller fingerprint client-side, matching the server's
 * `relayPublicKeyFingerprint` (HMAC-SHA512, key "cradle-relay-fp", hex, 16 chars).
 * Avoids a server change / API regen just to surface a friendly identifier.
 */
async function controllerFingerprint(pubkeyBase64: string): Promise<string> {
  const raw = Uint8Array.from(atob(pubkeyBase64), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('cradle-relay-fp'),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, raw))
  return Array.from(sig, b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

function useControllerFingerprint(pubkey: string | null): string | null {
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  useEffect(() => {
    if (!pubkey) {
      setFingerprint(null)
      return
    }
    let cancelled = false
    void controllerFingerprint(pubkey)
      .then((fp) => {
        if (!cancelled) {
          setFingerprint(fp)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFingerprint(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [pubkey])
  return fingerprint
}

function relayServerDisplayName(server: RelayServer, managedLocalName: string): string {
  return server.id === MANAGED_LOCAL_RELAY_SERVER_ID ? managedLocalName : server.displayName
}

function PairingStringDialog({
  enrollmentId,
  initialPairingString,
  open,
  onOpenChange,
}: {
  enrollmentId: string
  initialPairingString?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('settings')
  const [copied, setCopied] = useState(false)
  const query = useQuery({
    ...getRelayTransportHostEnrollmentsByEnrollmentIdPairingStringOptions({
      path: { enrollmentId },
    }),
    enabled: open && !initialPairingString && enrollmentId.length > 0,
    retry: false,
  })

  const pairingString = initialPairingString ?? query.data?.pairingString ?? ''

  const copy = async () => {
    if (!pairingString) {
      return
    }
    try {
      await navigator.clipboard.writeText(pairingString)
      setCopied(true)
      toastManager.add({ type: 'success', title: t('hostEnrollments.pairing.copied' as SettingsKey) })
      setTimeout(setCopied, 1500, false)
    }
    catch {
      toastManager.add({ type: 'error', title: t('hostEnrollments.pairing.copyFailed' as SettingsKey) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('hostEnrollments.pairing.title' as SettingsKey)}</DialogTitle>
          <DialogDescription>{t('hostEnrollments.pairing.hint' as SettingsKey)}</DialogDescription>
        </DialogHeader>

        <div className="py-1">
          {query.isLoading
            ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" />
                  {t('hostEnrollments.loading' as SettingsKey)}
                </div>
              )
            : query.isError
              ? (
                  <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                    {describeError(query.error)}
                  </p>
                )
              : (
                <div className="group relative overflow-hidden rounded-lg border border-border bg-muted/40">
                  <pre className="break-all whitespace-pre-wrap px-3 py-2 pr-10 font-mono text-[11.5px] leading-relaxed text-foreground/85">
                    <code>{pairingString}</code>
                  </pre>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={copy}
                    aria-label={t('hostEnrollments.action.copy' as SettingsKey)}
                    className="absolute right-1.5 top-1.5"
                  >
                    {copied
                      ? <CheckIcon className="size-3.5 text-emerald-500" aria-hidden="true" />
                      : <CopyIcon className="size-3.5" aria-hidden="true" />}
                  </Button>
                </div>
              )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
            {t('hostEnrollments.action.cancel' as SettingsKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HostEnrollmentFormDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (pairingString: string) => void
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState('')
  const [relayServerId, setRelayServerId] = useState('')
  const [relayUrl, setRelayUrl] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const { data: relayServers = [] } = useQuery(getRelayServersOptions())
  const managedLocalRelayName = t('remoteHosts.relayServers.managedLocalName')
  const enabledRelayServers: RelayServer[] = relayServers.filter(server => server.enabled)
  const defaultRelayServer = enabledRelayServers.find(server => server.isDefault) ?? enabledRelayServers[0]

  useEffect(() => {
    if (open) {
      setDisplayName('')
      setRelayUrl('')
      // Default to the built-in / default relay so the simple form just works.
      // When no default is available, open Advanced so the user can supply a URL.
      setRelayServerId(defaultRelayServer?.id ?? '')
      setAdvancedOpen(!defaultRelayServer)
    }
  }, [open, defaultRelayServer])

  const resolvedRelayUrl = relayServerId
    ? enabledRelayServers.find(server => server.id === relayServerId)?.relayUrl ?? ''
    : relayUrl.trim()
  const valid = displayName.trim().length > 0 && resolvedRelayUrl.length > 0

  const create = useMutation({
    mutationFn: async () => {
      const body: EnrollmentSaveBody = {
        displayName: displayName.trim(),
        relayUrl: resolvedRelayUrl,
      }
      const { data, error } = await postRelayTransportHostEnrollments({ body })
      if (error) {
        throw error
      }
      return data
    },
    onSuccess: (data) => {
      toastManager.add({ type: 'success', title: t('hostEnrollments.toast.created' as SettingsKey) })
      void queryClient.invalidateQueries({ queryKey: getRelayTransportHostEnrollmentsQueryKey() })
      onOpenChange(false)
      if (data?.pairingString) {
        onCreated?.(data.pairingString)
      }
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('hostEnrollments.toast.saveFailed' as SettingsKey),
      description: describeError(error),
    }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('hostEnrollments.form.addTitle' as SettingsKey)}</DialogTitle>
          <DialogDescription>{t('hostEnrollments.form.description' as SettingsKey)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="he-display-name" className="text-xs">{t('hostEnrollments.form.displayName' as SettingsKey)}</Label>
            <Input
              id="he-display-name"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder={t('hostEnrollments.form.displayNamePlaceholder' as SettingsKey)}
              className="h-8 text-xs"
              autoFocus
            />
            {defaultRelayServer && (
              <p className="text-[11px] text-muted-foreground">
                {t('hostEnrollments.form.relayHint' as SettingsKey)}
              </p>
            )}
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronIcon className={cn('size-3.5 transition-transform', advancedOpen ? 'rotate-0' : '-rotate-90')} aria-hidden="true" />
                {t('hostEnrollments.form.advanced' as SettingsKey)}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-3">
              <div className="space-y-2">
                <Label className="text-xs">{t('hostEnrollments.form.relayServer' as SettingsKey)}</Label>
                <Select
                  value={relayServerId || CUSTOM_RELAY_SERVER_VALUE}
                  onValueChange={(next) => {
                    if (next === CUSTOM_RELAY_SERVER_VALUE) {
                      setRelayServerId('')
                      return
                    }
                    setRelayServerId(next)
                  }}
                >
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledRelayServers.map(server => (
                      <SelectItem key={server.id} value={server.id}>
                        {relayServerDisplayName(server, managedLocalRelayName)}
                        {server.isDefault ? ` · ${t('remoteHosts.relayServers.badge.default')}` : ''}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_RELAY_SERVER_VALUE}>{t('hostEnrollments.form.relayUrl' as SettingsKey)}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {!relayServerId && (
                <div className="space-y-2">
                  <Label htmlFor="he-relay-url" className="text-xs">{t('hostEnrollments.form.relayUrl' as SettingsKey)}</Label>
                  <Input
                    id="he-relay-url"
                    value={relayUrl}
                    onChange={e => setRelayUrl(e.target.value)}
                    placeholder="https://relay.example.com"
                    className="h-8 font-mono text-xs"
                  />
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
            {t('hostEnrollments.action.cancel' as SettingsKey)}
          </Button>
          <Button size="sm" disabled={!valid || create.isPending} onClick={() => create.mutate()} className="h-7 text-xs">
            {create.isPending && <Spinner className="size-3.5" />}
            {t('hostEnrollments.action.add' as SettingsKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EnrollmentRow({ enrollment, onShowPairing }: { enrollment: Enrollment, onShowPairing: (enrollmentId: string) => void }) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const controllerFp = useControllerFingerprint(enrollment.pinnedControllerPubkey)

  const deleteEnrollment = useMutation({
    mutationFn: async () => {
      const { error } = await deleteRelayTransportHostEnrollmentsByEnrollmentId({
        path: { enrollmentId: enrollment.id },
      })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('hostEnrollments.toast.deleted' as SettingsKey) })
      void queryClient.invalidateQueries({ queryKey: getRelayTransportHostEnrollmentsQueryKey() })
      setConfirmingDelete(false)
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('hostEnrollments.toast.deleteFailed' as SettingsKey),
      description: describeError(error),
    }),
  })

  const busy = deleteEnrollment.isPending
  const displayState = enrollmentDisplayState(enrollment)
  const controllerLabel = enrollment.live?.controllerName ?? controllerFp
  const lastSeenText = !enrollment.live?.connected && enrollment.live?.lastReadyAt
    ? `${t('hostEnrollments.row.lastSeen' as SettingsKey)} ${formatLastSeen(enrollment.live.lastReadyAt)}`
    : null

  return (
    <div className="flex items-start gap-3 px-3.5 py-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        <LinkIcon className="size-3.5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[12.5px] font-medium text-foreground">{enrollment.displayName}</span>
          <Badge variant="outline" className={cn('h-4 px-1.5 text-[9px] font-normal', DISPLAY_BADGE[displayState])}>
            {t(`hostEnrollments.status.${displayState}` as SettingsKey)}
          </Badge>
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground/70">{enrollment.relayUrl}</div>
        {controllerLabel && (
          <div className="font-mono text-[11px] text-muted-foreground/70">
            {`${t('hostEnrollments.row.controller' as SettingsKey)}: ${controllerLabel}`}
          </div>
        )}
        {lastSeenText && (
          <div className="text-[11px] text-muted-foreground/60">
            {lastSeenText}
          </div>
        )}
        {enrollment.lastError && (
          <p className="text-[11px] text-destructive">{enrollment.lastError}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {enrollment.pairable && (
          <Button
            size="xs"
            variant="ghost"
            className="h-7 px-2.5 text-[11px]"
            disabled={busy}
            onClick={() => onShowPairing(enrollment.id)}
          >
            {t('hostEnrollments.action.showPairingString' as SettingsKey)}
          </Button>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
              aria-label={t('hostEnrollments.action.delete' as SettingsKey)}
            >
              {deleteEnrollment.isPending ? <Spinner className="size-3.5" /> : <TrashIcon className="size-3.5" aria-hidden="true" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('hostEnrollments.action.delete' as SettingsKey)}</TooltipContent>
        </Tooltip>
      </div>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('hostEnrollments.delete.title' as SettingsKey)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('hostEnrollments.delete.description', { name: enrollment.displayName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('hostEnrollments.action.cancel' as SettingsKey)}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteEnrollment.mutate()}>
              {t('hostEnrollments.action.delete' as SettingsKey)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function HostEnrollmentsSection() {
  const { t } = useTranslation('settings')
  const [creating, setCreating] = useState(false)
  const [pairingDisplay, setPairingDisplay] = useState<{ enrollmentId: string, initial?: string } | null>(null)
  const { data: enrollments = [], isLoading } = useQuery({
    ...getRelayTransportHostEnrollmentsOptions(),
    // Poll so the live connection state + controller name stay fresh while the
    // section is visible. The host-connector updates this state on every
    // connect/disconnect event; 5s is cheap and keeps the dot responsive.
    refetchInterval: 5000,
  })

  return (
    <SettingsGroup
      label={t('hostEnrollments.title' as SettingsKey)}
      description={t('hostEnrollments.description' as SettingsKey)}
      action={(
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <PlusIcon className="size-3.5" aria-hidden="true" />
          {t('hostEnrollments.action.add' as SettingsKey)}
        </Button>
      )}
      bare
      className="[&>*+*]:border-t [&>*+*]:border-border/60"
    >
      {isLoading
        ? (
            <div className="flex items-center justify-center gap-2 px-3.5 py-6 text-[12px] text-muted-foreground">
              <Spinner className="size-3.5" />
              {t('hostEnrollments.loading' as SettingsKey)}
            </div>
          )
        : enrollments.length === 0
          ? (
              <div className="px-3.5 py-5 text-[12px] text-muted-foreground">
                {t('hostEnrollments.empty' as SettingsKey)}
              </div>
            )
          : enrollments.map(enrollment => (
              <EnrollmentRow
                key={enrollment.id}
                enrollment={enrollment}
                onShowPairing={enrollmentId => setPairingDisplay({ enrollmentId })}
              />
            ))}

      {creating && (
        <HostEnrollmentFormDialog
          open
          onOpenChange={open => !open && setCreating(false)}
          onCreated={pairingString => setPairingDisplay({ enrollmentId: '', initial: pairingString })}
        />
      )}
      {pairingDisplay && (
        <PairingStringDialog
          enrollmentId={pairingDisplay.enrollmentId}
          initialPairingString={pairingDisplay.initial}
          open
          onOpenChange={open => !open && setPairingDisplay(null)}
        />
      )}
    </SettingsGroup>
  )
}
