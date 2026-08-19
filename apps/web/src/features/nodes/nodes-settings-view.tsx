import {
  CheckLine as CheckIcon,
  CloseCircleLine as CancelIcon,
  CloseLine as RejectIcon,
  ComputerLine as ComputerIcon,
  CopyLine as CopyIcon,
  Delete2Line as RemoveIcon,
  Link3Line as LinkIcon,
  Refresh1Line as RefreshIcon,
  SafeShieldLine as ApprovalIcon,
  Settings3Line as SettingsIcon,
  TimeLine as PendingIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { SettingsGroup, SettingsPage } from '~/features/settings/settings-container'
import { SettingsRow } from '~/features/settings/settings-row'
import { cn } from '~/lib/cn'

import { CancelPendingEnrollmentDialog } from './cancel-pending-enrollment-dialog'
import { LeaveFabricDialog } from './leave-fabric-dialog'
import { RemoveDeviceDialog } from './remove-device-dialog'
import type { FabricMembership, FabricNode, PendingFabricEnrollment, PendingFabricNodeRequest } from './types'

export interface NodesSettingsViewProps {
  membership: FabricMembership | null
  pendingEnrollment: PendingFabricEnrollment | null
  pendingInviteCode: string | null
  membershipLoading: boolean
  membershipError: boolean
  managedRelay: { relayUrl: string, accessMode: 'local' | 'network' | 'external' } | null
  nodes: FabricNode[]
  nodesLoading: boolean
  nodesError: boolean
  pendingRequests: PendingFabricNodeRequest[]
  pendingRequestsLoading: boolean
  pendingRequestsError: boolean
  pendingRequestAction: { requestId: string, kind: 'approve' | 'reject' } | null
  networkCode: string | null
  canManageAccess: boolean
  reconnectingNodeId: string | null
  removingNodeId: string | null
  cancellingEnrollment: boolean
  leavingFabric: boolean
  onLinkDevice: () => void
  onReconnect: (nodeId: string) => void
  onManageAccess: (nodeId: string) => void
  onRemoveNode: (nodeId: string) => void
  onRefreshMembership: () => void
  onRefreshNodes: () => void
  onRefreshPendingRequests: () => void
  onApprovePendingRequest: (requestId: string) => void
  onRejectPendingRequest: (requestId: string) => void
  onCancelPendingEnrollment: () => void
  onLeaveFabric: () => void
  fabricSettings: ReactNode
}

export function NodesSettingsView({
  membership,
  pendingEnrollment,
  pendingInviteCode,
  membershipLoading,
  membershipError,
  managedRelay,
  nodes,
  nodesLoading,
  nodesError,
  pendingRequests,
  pendingRequestsLoading,
  pendingRequestsError,
  pendingRequestAction,
  networkCode,
  canManageAccess,
  reconnectingNodeId,
  removingNodeId,
  cancellingEnrollment,
  leavingFabric,
  onLinkDevice,
  onReconnect,
  onManageAccess,
  onRemoveNode,
  onRefreshMembership,
  onRefreshNodes,
  onRefreshPendingRequests,
  onApprovePendingRequest,
  onRejectPendingRequest,
  onCancelPendingEnrollment,
  onLeaveFabric,
  fabricSettings,
}: NodesSettingsViewProps) {
  const { t } = useTranslation('nodes')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [removeNode, setRemoveNode] = useState<FabricNode | null>(null)

  useEffect(() => {
    if (removeNode && !nodes.some(node => node.nodeId === removeNode.nodeId)) {
      setRemoveNode(null)
    }
  }, [nodes, removeNode])

  return (
    <SettingsPage
      title={t('settings.page.title')}
      description={t('settings.page.description')}
      maxWidth="4xl"
      data-testid="nodes-settings"
    >
      {membershipLoading && (
        <SettingsGroup label={t('settings.setup.title')} description={t('settings.setup.description')}>
          <div className="flex items-center gap-2 py-3 text-[12px] text-muted-foreground">
            <Spinner className="size-3.5" />
            {t('settings.loading')}
          </div>
        </SettingsGroup>
      )}

      {membershipError && !membershipLoading && (
        <SettingsGroup label={t('settings.setup.title')} description={t('settings.setup.description')}>
          <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] text-muted-foreground">{t('settings.error')}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRefreshMembership}>
              <RefreshIcon className="size-3.5" aria-hidden />
              {t('action.retry')}
            </Button>
          </div>
        </SettingsGroup>
      )}

      {!membershipLoading && !membershipError && !membership && pendingEnrollment && (
        <SettingsGroup
          label={t('settings.pending.title')}
          description={t('settings.pending.description')}
        >
          <div className="flex min-w-0 flex-col gap-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <PendingIcon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{t('settings.pending.status')}</span>
                  <Badge variant="secondary">{t('settings.status.pending')}</Badge>
                </div>
                <p className="mt-1 max-w-prose text-pretty text-[12px] leading-relaxed text-muted-foreground">
                  {pendingInviteCode ? t('settings.pending.hint') : t('settings.pending.legacyHint')}
                </p>
                <code className="mt-2 block max-w-full truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground" title={pendingEnrollment.relayUrl}>
                  {pendingEnrollment.relayUrl}
                </code>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
              <Button type="button" variant="outline" size="sm" onClick={onLinkDevice} data-testid="nodes-link-device">
                <LinkIcon className="size-3.5" aria-hidden />
                {t('action.viewRequest')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={cancellingEnrollment}
                onClick={() => setCancelOpen(true)}
              >
                <CancelIcon className="size-3.5" aria-hidden />
                {t('action.cancelJoin')}
              </Button>
            </div>
          </div>
        </SettingsGroup>
      )}

      {!membershipLoading && !membershipError && !membership && !pendingEnrollment && (
        <SettingsGroup label={t('settings.setup.title')} description={t('settings.setup.description')}>
          <div className="flex flex-col gap-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground">
                <ComputerIcon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{t('settings.setup.status')}</span>
                  <Badge variant="secondary">{t('settings.status.notConnected')}</Badge>
                </div>
                <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-muted-foreground">
                  {t('settings.setup.hint')}
                </p>
                {managedRelay && (
                  <code className="mt-2 block max-w-full truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground" title={managedRelay.relayUrl}>
                    {managedRelay.relayUrl}
                  </code>
                )}
              </div>
            </div>
            <Button type="button" onClick={onLinkDevice} data-testid="nodes-link-device">
              <LinkIcon className="size-4" aria-hidden />
              {t('action.linkDevice')}
            </Button>
          </div>
        </SettingsGroup>
      )}

      {membership && (
        <>
          <SettingsGroup
            label={t('settings.network.title')}
            description={t('settings.network.description')}
            action={(
              <Button type="button" size="sm" onClick={onLinkDevice} data-testid="nodes-link-device">
                <LinkIcon className="size-3.5" aria-hidden />
                {t('action.linkDevice')}
              </Button>
            )}
          >
            <SettingsRow
              label={t('settings.network.statusLabel')}
              description={t('settings.network.statusDescription')}
            >
              <Badge variant="secondary">{t('settings.status.connected')}</Badge>
            </SettingsRow>
            <SettingsRow
              label={t('settings.network.relayLabel')}
              description={t('settings.network.relayDescription')}
            >
              <code className="max-w-[50%] truncate rounded-md bg-muted px-2 py-1 font-mono text-[12px]" title={membership.relayUrl}>
                {membership.relayUrl}
              </code>
            </SettingsRow>
            <SettingsRow
              label={t('settings.network.fabricIdLabel')}
              description={t('settings.network.fabricIdDescription')}
            >
              <code className="max-w-[50%] truncate rounded-md bg-muted px-2 py-1 font-mono text-[12px]" title={membership.fabricId}>
                {membership.fabricId}
              </code>
            </SettingsRow>
            <SettingsRow
              label={t('settings.network.codeLabel')}
              description={t('settings.network.codeDescription')}
              vertical
            >
              {networkCode && <NetworkCode code={networkCode} />}
            </SettingsRow>
            {membership.role !== 'owner' && (
              <SettingsRow
                label={t('settings.network.leaveLabel')}
                description={t('settings.network.leaveDescription')}
              >
                <Button type="button" variant="destructive" className="h-10" onClick={() => setLeaveOpen(true)}>
                  <CancelIcon className="size-3.5" aria-hidden />
                  {t('action.leaveFabric')}
                </Button>
              </SettingsRow>
            )}
          </SettingsGroup>

          {canManageAccess && (
            <SettingsGroup
              label={t('settings.approvals.title')}
              description={t('settings.approvals.description')}
            >
              {pendingRequestsLoading && (
                <div className="flex items-center gap-2 py-3 text-[12px] text-muted-foreground">
                  <Spinner className="size-3.5" />
                  {t('settings.approvals.loading')}
                </div>
              )}
              {pendingRequestsError && !pendingRequestsLoading && (
                <QueryErrorState label={t('settings.approvals.error')} onRetry={onRefreshPendingRequests} />
              )}
              {!pendingRequestsLoading && !pendingRequestsError && pendingRequests.length === 0 && (
                <div className="py-3 text-pretty text-[12px] text-muted-foreground">
                  {t('settings.approvals.empty')}
                </div>
              )}
              {!pendingRequestsLoading && !pendingRequestsError && pendingRequests.map(request => (
                <PendingRequestRow
                  key={request.requestId}
                  request={request}
                  action={pendingRequestAction?.requestId === request.requestId ? pendingRequestAction.kind : null}
                  actionsDisabled={pendingRequestAction !== null}
                  onApprove={onApprovePendingRequest}
                  onReject={onRejectPendingRequest}
                />
              ))}
            </SettingsGroup>
          )}

          <SettingsGroup
            label={t('settings.devices.title')}
            description={t('settings.devices.description')}
          >
            {nodesLoading && (
              <div className="flex items-center gap-2 py-3 text-[12px] text-muted-foreground">
                <Spinner className="size-3.5" />
                {t('settings.devices.loading')}
              </div>
            )}
            {nodesError && !nodesLoading && (
              <QueryErrorState label={t('settings.devices.error')} onRetry={onRefreshNodes} />
            )}
            {!nodesLoading && !nodesError && (nodes.length === 0
              ? (
                  <div className="py-3 text-[12px] text-muted-foreground">{t('settings.devices.empty')}</div>
                )
              : nodes.map(node => (
                  <DeviceSettingsRow
                    key={node.nodeId}
                    node={node}
                    isThisDevice={node.nodeId === membership.localNodeId}
                    reconnecting={reconnectingNodeId === node.nodeId}
                    canManageAccess={canManageAccess}
                    onReconnect={onReconnect}
                    onManageAccess={onManageAccess}
                    onRemove={setRemoveNode}
                  />
                )))}
          </SettingsGroup>
        </>
      )}

      {fabricSettings}

      <CancelPendingEnrollmentDialog
        open={cancelOpen}
        busy={cancellingEnrollment}
        onOpenChange={setCancelOpen}
        onConfirm={onCancelPendingEnrollment}
      />
      <LeaveFabricDialog
        open={leaveOpen}
        busy={leavingFabric}
        onOpenChange={setLeaveOpen}
        onConfirm={() => {
          onLeaveFabric()
          setLeaveOpen(false)
        }}
      />
      <RemoveDeviceDialog
        node={removeNode}
        busy={removeNode !== null && removingNodeId === removeNode.nodeId}
        onOpenChange={(open) => {
          if (!open && removingNodeId === null) {
            setRemoveNode(null)
          }
        }}
        onConfirm={onRemoveNode}
      />
    </SettingsPage>
  )
}

function QueryErrorState({ label, onRetry }: { label: string, onRetry: () => void }) {
  const { t } = useTranslation('nodes')
  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-pretty text-[12px] text-destructive">{label}</p>
      <Button type="button" variant="outline" className="h-10" onClick={onRetry}>
        <RefreshIcon className="size-3.5" aria-hidden />
        {t('action.retry')}
      </Button>
    </div>
  )
}

function PendingRequestRow({
  request,
  action,
  actionsDisabled,
  onApprove,
  onReject,
}: {
  request: PendingFabricNodeRequest
  action: 'approve' | 'reject' | null
  actionsDisabled: boolean
  onApprove: (requestId: string) => void
  onReject: (requestId: string) => void
}) {
  const { t } = useTranslation('nodes')
  const requestedAt = new Date(request.requestedAt).toLocaleString()

  return (
    <div
      className="flex flex-col gap-3 border-b border-border/60 py-3 last:border-b-0 sm:flex-row sm:items-center"
      data-testid={`node-pending-request-${request.requestId}`}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300">
        <ApprovalIcon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-medium">{request.displayName}</span>
          <Badge variant="secondary">{t('settings.status.pending')}</Badge>
        </div>
        <p className="mt-1 text-pretty text-[12px] leading-relaxed text-muted-foreground">
          {request.platform}
          {' · '}
          {t('popover.version', { version: request.version })}
          {' · '}
          <time dateTime={request.requestedAt}>{t('settings.approvals.requestedAt', { time: requestedAt })}</time>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-10"
          disabled={actionsDisabled}
          onClick={() => onReject(request.requestId)}
        >
          {action === 'reject' ? <Spinner className="size-3.5" /> : <RejectIcon className="size-3.5" aria-hidden />}
          {t('action.reject')}
        </Button>
        <Button
          type="button"
          className="h-10"
          disabled={actionsDisabled}
          onClick={() => onApprove(request.requestId)}
          data-testid={`node-pending-approve-${request.requestId}`}
        >
          {action === 'approve' ? <Spinner className="size-3.5" /> : <CheckIcon className="size-3.5" aria-hidden />}
          {t('action.approve')}
        </Button>
      </div>
    </div>
  )
}

function NetworkCode({ code }: { code: string }) {
  const { t } = useTranslation('nodes')
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(setCopied, 1600, false)
    }
    catch {
      // Keep the code selectable when clipboard access is unavailable.
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 select-all truncate rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-[12px]">
        {code}
      </code>
      <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
        {copied ? <CheckIcon className="size-3.5 text-green-500" aria-hidden /> : <CopyIcon className="size-3.5" aria-hidden />}
        {copied ? t('action.copied') : t('action.copy')}
      </Button>
    </div>
  )
}

function DeviceSettingsRow({
  node,
  isThisDevice,
  reconnecting,
  canManageAccess,
  onReconnect,
  onManageAccess,
  onRemove,
}: {
  node: FabricNode
  isThisDevice: boolean
  reconnecting: boolean
  canManageAccess: boolean
  onReconnect: (nodeId: string) => void
  onManageAccess: (nodeId: string) => void
  onRemove: (node: FabricNode) => void
}) {
  const { t } = useTranslation('nodes')
  const online = node.status === 'online'
  const lastSeen = node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : null

  return (
    <div className="flex flex-col gap-3 border-b border-border/60 py-3 last:border-b-0 sm:flex-row sm:items-center">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <ComputerIcon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-medium">{node.displayName}</span>
          {isThisDevice && <Badge variant="outline">{t('thisDevice')}</Badge>}
          <Badge variant={online ? 'secondary' : 'outline'}>
            {online ? t('status.online') : t('status.offline')}
          </Badge>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {node.platform}
{' '}
·
{t('popover.version', { version: node.version })}
          {!online && lastSeen ? ` · ${t('popover.lastSeen', { time: lastSeen })}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {!online && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={reconnecting}
            onClick={() => onReconnect(node.nodeId)}
          >
            <RefreshIcon className={cn('size-3.5', reconnecting && 'animate-spin')} aria-hidden />
            {t('action.reconnect')}
          </Button>
        )}
        {canManageAccess && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onManageAccess(node.nodeId)}>
            <SettingsIcon className="size-3.5" aria-hidden />
            {t('action.manageAccess')}
          </Button>
        )}
        {canManageAccess && !isThisDevice && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => onRemove(node)}
            data-testid={`remove-device-${node.nodeId}`}
          >
            <RemoveIcon className="size-3.5" aria-hidden />
            {t('action.removeDevice')}
          </Button>
        )}
      </div>
    </div>
  )
}
