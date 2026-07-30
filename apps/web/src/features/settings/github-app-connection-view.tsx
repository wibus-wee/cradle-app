import { useState } from 'react'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

import { SettingsGroup } from './settings-container'

export interface GithubAppConnection {
  state: 'unconfigured' | 'disconnected' | 'pending' | 'connected' | 'expired' | 'error'
  appName: string | null
  appSlug: string | null
  installationUrl: string | null
  viewer: { login: string, avatarUrl: string | null, profileUrl: string | null } | null
  expiresAt: number | null
  error: string | null
}

export interface GithubAppPendingLogin {
  loginId: string
  verificationUri: string
  userCode: string
  expiresAt: number
}

interface GithubAppConnectionViewProps {
  connection: GithubAppConnection | null
  pendingLogin: GithubAppPendingLogin | null
  loading?: boolean
  connecting?: boolean
  disconnecting?: boolean
  /** When true, render without SettingsGroup chrome for dialog/setup hosts. */
  embedded?: boolean
  labels: {
    title: string
    description: string
    appBadge: string
    installTitle: string
    installDescription: string
    install: string
    connectTitle: string
    connectDescription: string
    connect: string
    connecting: string
    continueInBrowser: string
    cancel: string
    disconnect: string
    disconnectTitle: string
    disconnectDescription: string
    confirmDisconnect: string
    connected: string
    expires: string
    expired: string
    unavailable: string
    pendingCode: string
  }
  onInstall: () => void
  onConnect: () => void
  onContinueInBrowser: () => void
  onCancel: () => void
  onDisconnect: () => void
}

export function GithubAppConnectionView({
  connection,
  pendingLogin,
  loading = false,
  connecting = false,
  disconnecting = false,
  embedded = false,
  labels,
  onInstall,
  onConnect,
  onContinueInBrowser,
  onCancel,
  onDisconnect,
}: GithubAppConnectionViewProps) {
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const state = connection?.state ?? 'unconfigured'
  const viewer = connection?.viewer ?? null
  const isPending = pendingLogin !== null
  const isConnected = state === 'connected' && viewer !== null
  const isRecoverable = state === 'expired' || state === 'error'

  const body = loading
    ? (
        <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {labels.connecting}
        </div>
      )
    : isPending
      ? (
          <div className="flex flex-col gap-4 px-4 py-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{labels.connectTitle}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{labels.connectDescription}</p>
            </div>
            <div className="rounded-lg bg-muted px-3 py-2.5 font-mono text-lg font-semibold tracking-[0.2em] tabular-nums text-foreground">
              {pendingLogin.userCode}
            </div>
            <p className="text-xs text-muted-foreground">{labels.pendingCode}</p>
            <p className="text-xs text-muted-foreground">
              {labels.expires.replace('{{date}}', new Date(pendingLogin.expiresAt * 1000).toLocaleDateString())}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onContinueInBrowser}>{labels.continueInBrowser}</Button>
              <Button variant="outline" size="sm" onClick={onCancel}>{labels.cancel}</Button>
            </div>
          </div>
        )
      : isConnected
        ? (
            <div className="flex items-center justify-between gap-4 px-4 py-4">
              <div className="flex min-w-0 items-center gap-3">
                {viewer.avatarUrl
                  ? <img className="size-9 rounded-full outline outline-1 outline-black/10 dark:outline-white/10" src={viewer.avatarUrl} alt="" />
                  : <div className="size-9 rounded-full bg-muted" aria-hidden="true" />}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{labels.connected.replace('{{login}}', viewer.login)}</p>
                  {connection?.expiresAt && <p className="mt-0.5 text-xs text-muted-foreground">{labels.expires.replace('{{date}}', new Date(connection.expiresAt * 1000).toLocaleDateString())}</p>}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setConfirmingDisconnect(true)} disabled={disconnecting}>{labels.disconnect}</Button>
            </div>
          )
        : (
            <div className="flex flex-col gap-4 px-4 py-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{state === 'unconfigured' ? labels.unavailable : labels.installTitle}</p>
                <p className={cn('text-sm leading-relaxed text-muted-foreground', isRecoverable && 'text-destructive')}>
                  {isRecoverable ? (connection?.error ?? labels.expired) : labels.installDescription}
                </p>
              </div>
              {state !== 'unconfigured' && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={onInstall} disabled={!connection?.installationUrl}>{labels.install}</Button>
                  <Button size="sm" onClick={onConnect} disabled={connecting}>
                    {connecting && <Spinner className="size-3.5" />}
                    {labels.connect}
                  </Button>
                </div>
              )}
            </div>
          )

  const dialog = (
    <AlertDialog open={confirmingDisconnect} onOpenChange={setConfirmingDisconnect}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.disconnectTitle}</AlertDialogTitle>
          <AlertDialogDescription>{labels.disconnectDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={onDisconnect}>{labels.confirmDisconnect}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  if (embedded) {
    return (
      <div className="overflow-hidden rounded-lg border border-border" data-testid="github-app-connection-embedded">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
          <p className="text-[12px] font-medium text-foreground">{labels.title}</p>
          <Badge variant="outline" className="font-medium">{connection?.appName ?? labels.appBadge}</Badge>
        </div>
        {body}
        {dialog}
      </div>
    )
  }

  return (
    <SettingsGroup
      label={labels.title}
      description={labels.description}
      action={<Badge variant="outline" className="font-medium">{connection?.appName ?? labels.appBadge}</Badge>}
      bare
      className="overflow-hidden"
    >
      {body}
      {dialog}
    </SettingsGroup>
  )
}
