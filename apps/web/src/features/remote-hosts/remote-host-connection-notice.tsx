import { ServerLine as ServerIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'

import type { RemoteHostConnectionGate } from './use-remote-host-connection'
import { useConnectRemoteHost } from './use-remote-host-connection'

interface RemoteHostConnectionNoticeProps {
  gate: RemoteHostConnectionGate
  className?: string
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) {
      return message
    }
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Inline Connect CTA shown when a remote workspace/session needs an active
 * Cradle Server tunnel before create/send.
 */
export function RemoteHostConnectionNotice({
  gate,
  className,
}: RemoteHostConnectionNoticeProps) {
  const { t } = useTranslation('chat')
  const { t: tSettings } = useTranslation('settings')
  const hostId = gate.kind === 'disconnected' || gate.kind === 'unknown-host'
    ? gate.hostId
    : null
  const connect = useConnectRemoteHost(hostId)

  if (gate.kind === 'local' || gate.kind === 'connected') {
    return null
  }

  const hostName = gate.kind === 'disconnected'
    ? gate.host.displayName || gate.hostId
    : gate.hostId

  const handleConnect = () => {
    connect.mutate(undefined, {
      onSuccess: () => {
        toastManager.add({
          type: 'success',
          title: tSettings('remoteHosts.toast.connected'),
        })
      },
      onError: (error) => {
        toastManager.add({
          type: 'error',
          title: tSettings('remoteHosts.toast.connectFailed'),
          description: describeError(error),
        })
      },
    })
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground',
        className,
      )}
      data-testid="remote-host-connection-notice"
    >
      <ServerIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {gate.kind === 'unknown-host'
          ? t('execution.disconnected.unknownHost', { hostName })
          : t('execution.disconnected.message', { hostName })}
      </span>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={!hostId || connect.isPending}
        onClick={handleConnect}
        data-testid="remote-host-connection-connect"
      >
        {connect.isPending
          ? tSettings('remoteHosts.state.connecting')
          : tSettings('remoteHosts.action.connect')}
      </Button>
    </div>
  )
}
