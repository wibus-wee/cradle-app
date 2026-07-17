import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import {
  AlertLine as AlertIcon,
  CheckCircleLine as HealthyIcon,
  PlayCircleLine as StartIcon,
  Refresh1Line as RefreshIcon,
  ServerLine as ServerIcon,
  StopCircleLine as StopIcon,
} from '@mingcute/react'
import { useCallback, useEffect, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Skeleton } from '~/components/ui/skeleton'

interface SidecarStatus {
  installed: boolean
  version: string | null
  running: boolean
  healthy: boolean
  endpoint: string
  port: number
  models: string[]
  accountFileCount: number
  authenticatingProviders: string[]
  error: string | null
}

type AuthProvider = 'codex' | 'claude' | 'gemini'
type PanelAction = 'start' | 'stop' | 'save' | `auth-${AuthProvider}`

const AUTH_PROVIDERS: Array<{ id: AuthProvider, label: string }> = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' },
]

interface StatusResponse {
  ok: boolean
  status?: SidecarStatus
  error?: string
}

function CliProxyApiPanel({ routes, isActive }: { routes: WebPluginContext['routes'], isActive: boolean }) {
  const [status, setStatus] = useState<SidecarStatus | null>(null)
  const [port, setPort] = useState('8317')
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState<PanelAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await routes.fetch('/status')
      const body = await response.json() as StatusResponse
      if (!response.ok || !body.ok || !body.status) {
        throw new Error(body.error ?? `HTTP ${response.status}`)
      }
      setStatus(body.status)
      setPort(String(body.status.port))
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
    finally {
      setLoading(false)
    }
  }, [routes])

  const authenticate = useCallback(async (provider: AuthProvider) => {
    setAction(`auth-${provider}`)
    setError(null)
    try {
      const response = await routes.fetch(`/auth/${provider}`, { method: 'POST' })
      const body = await response.json() as StatusResponse
      if (!response.ok || !body.ok || !body.status) {
        throw new Error(body.error ?? `HTTP ${response.status}`)
      }
      setStatus(body.status)
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
    finally {
      setAction(null)
    }
  }, [routes])

  useEffect(() => {
    if (isActive) { void refresh() }
  }, [isActive, refresh])

  const runAction = useCallback(async (nextAction: 'start' | 'stop') => {
    setAction(nextAction)
    setError(null)
    try {
      const response = await routes.fetch(`/${nextAction}`, { method: 'POST' })
      const body = await response.json() as StatusResponse
      if (!response.ok || !body.ok || !body.status) {
        throw new Error(body.error ?? `HTTP ${response.status}`)
      }
      setStatus(body.status)
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
    finally {
      setAction(null)
    }
  }, [routes])

  const savePort = useCallback(async () => {
    setAction('save')
    setError(null)
    try {
      const response = await routes.fetch('/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ port: Number(port) }),
      })
      const body = await response.json() as { ok: boolean, error?: string }
      if (!response.ok || !body.ok) { throw new Error(body.error ?? `HTTP ${response.status}`) }
      await refresh()
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
    finally {
      setAction(null)
    }
  }, [port, refresh, routes])

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-3">
        <Card size="sm">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  <ServerIcon className="size-4" aria-hidden="true" />
                  CLIProxyAPI
                </CardTitle>
                <CardDescription>Managed multi-account model router on this device.</CardDescription>
              </div>
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => void refresh()} disabled={loading}>
                <RefreshIcon className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Refresh status</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && !status
              ? <Skeleton className="h-16 w-full rounded-lg" />
              : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={status?.installed ? 'secondary' : 'outline'}>
                      {status?.installed ? `Runtime ${status.version ?? ''}` : 'Runtime not installed'}
                    </Badge>
                    <Badge variant={status?.healthy ? 'default' : 'outline'}>
                      {status?.healthy && <HealthyIcon aria-hidden="true" />}
                      {status?.healthy ? 'Healthy' : status?.running ? 'Starting' : 'Stopped'}
                    </Badge>
                    {status?.models.length
                      ? (
                          <Badge variant="outline">
                            {status.models.length}
                            {' '}
                            models
                          </Badge>
                        )
                      : null}
                  </div>
                )}
            {!status?.installed && (
              <Alert>
                <AlertIcon aria-hidden="true" />
                <AlertTitle>Runtime required</AlertTitle>
                <AlertDescription>Install “CLIProxyAPI runtime” from the Resources page, then return here to start it.</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertIcon aria-hidden="true" />
                <AlertTitle>CLIProxyAPI action failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void runAction('start')}
                disabled={!status?.installed || status.running || action !== null}
              >
                <StartIcon aria-hidden="true" />
                Start
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void runAction('stop')}
                disabled={!status?.running || action !== null}
              >
                <StopIcon aria-hidden="true" />
                Stop
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>Start an upstream OAuth flow. CLIProxyAPI opens the provider login in your browser and stores the resulting account file in plugin-owned storage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {status?.accountFileCount ?? 0}
                {' '}
                account files
              </Badge>
              {status?.authenticatingProviders.length
                ? <Badge variant="secondary">Authentication in progress</Badge>
                : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {AUTH_PROVIDERS.map(provider => (
                <Button
                  key={provider.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void authenticate(provider.id)}
                  disabled={!status?.installed || action !== null || status.authenticatingProviders.includes(provider.id)}
                >
                  Add
                  {' '}
                  {provider.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Local endpoint</CardTitle>
            <CardDescription>The sidecar is always restricted to 127.0.0.1.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cli-proxy-api-port">Port</Label>
              <div className="flex gap-2">
                <Input
                  id="cli-proxy-api-port"
                  type="number"
                  min={1024}
                  max={65535}
                  value={port}
                  onChange={event => setPort(event.target.value)}
                  disabled={status?.running || action !== null}
                />
                <Button type="button" variant="outline" onClick={() => void savePort()} disabled={status?.running || action !== null}>
                  Save
                </Button>
              </div>
            </div>
            <p className="break-all font-mono text-xs text-muted-foreground">
              {status?.endpoint ?? `http://127.0.0.1:${port}/v1`}
            </p>
          </CardContent>
        </Card>

        {status?.models.length
          ? (
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Available models</CardTitle>
                  <CardDescription>Discovered from the running sidecar.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1.5">
                  {status.models.map(model => <Badge key={model} variant="outline">{model}</Badge>)}
                </CardContent>
              </Card>
            )
          : null}
      </div>
    </ScrollArea>
  )
}

export function activate(ctx: WebPluginContext): void {
  ctx.panels.register({
    id: 'cli-proxy-api',
    title: 'CLIProxyAPI',
    component: props => <CliProxyApiPanel {...props} routes={ctx.routes} />,
    location: 'sidebar',
  })
}
