import {
  CheckLine as CheckIcon,
  ComputerLine as ComputerIcon,
  CopyLine as CopyIcon,
  Link3Line as LinkIcon,
  Refresh1Line as RefreshIcon,
  Settings3Line as SettingsIcon,
} from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { SettingsGroup, SettingsPage } from '~/features/settings/settings-container'
import { SettingsRow } from '~/features/settings/settings-row'
import { cn } from '~/lib/cn'

import type { FabricMembership, FabricNode } from './types'

export interface NodesSettingsViewProps {
  membership: FabricMembership | null
  managedRelay: { relayUrl: string, accessMode: 'local' | 'network' } | null
  nodes: FabricNode[]
  networkCode: string | null
  canManageAccess: boolean
  reconnectingNodeId: string | null
  onLinkDevice: () => void
  onReconnect: (nodeId: string) => void
  onManageAccess: (nodeId: string) => void
}

export function NodesSettingsView({
  membership,
  managedRelay,
  nodes,
  networkCode,
  canManageAccess,
  reconnectingNodeId,
  onLinkDevice,
  onReconnect,
  onManageAccess,
}: NodesSettingsViewProps) {
  const { t } = useTranslation('nodes')

  return (
    <SettingsPage
      title={t('settings.page.title')}
      description={t('settings.page.description')}
      maxWidth="4xl"
      data-testid="nodes-settings"
    >
      {!membership && (
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
            <Button type="button" onClick={onLinkDevice}>
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
              <Button type="button" size="sm" onClick={onLinkDevice}>
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
          </SettingsGroup>

          <SettingsGroup
            label={t('settings.devices.title')}
            description={t('settings.devices.description')}
          >
            {nodes.length === 0
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
                  />
                ))}
          </SettingsGroup>
        </>
      )}
    </SettingsPage>
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
}: {
  node: FabricNode
  isThisDevice: boolean
  reconnecting: boolean
  canManageAccess: boolean
  onReconnect: (nodeId: string) => void
  onManageAccess: (nodeId: string) => void
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
      <div className="flex shrink-0 items-center gap-2">
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
      </div>
    </div>
  )
}
