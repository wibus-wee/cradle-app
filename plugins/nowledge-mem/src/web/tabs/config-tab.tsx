/* Settings panel for Nowledge Mem — onboarding-first, with live connection status. */

import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import {
  AlertLine as AlertCircleIcon,
  ArrowRightUpLine as ExternalLinkIcon,
  Book2Line as BookIcon,
  BrainLine as BrainIcon,
  CheckCircleLine as CheckCircleIcon,
  CloseCircleLine as CloseCircleIcon,
  Key2Line as KeyIcon,
  PowerLine as PowerIcon,
  Refresh2Line as RefreshIcon,
  ServerLine as ServerIcon,
  SparklesLine as SparklesIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Skeleton } from '~/components/ui/skeleton'
import { Switch } from '~/components/ui/switch'
import { TooltipProvider } from '~/components/ui/tooltip'
import { SettingsDivider, SettingsRow, SettingsSectionHeader } from '~/features/settings/settings-row'
import { cn } from '~/lib/cn'

import { deriveMcpUrl } from '../format'
import type { SaveState } from '../hooks'
import { useNowledgeConfig, useNowledgeStatus } from '../hooks'
import type { ConfigFormState, ConnState } from '../types'

interface ConfigTabProps {
  ctx: WebPluginContext
}

const PRODUCT_URL = 'https://mem.nowledge.co/'
const DOCS_URL = 'https://mem.nowledge.co/docs/start-here'

const EMPTY_FORM: ConfigFormState = {
  apiUrl: '',
  mcpUrl: '',
  spaceId: '',
  enabled: true,
}

const FEATURE_CHIPS = ['Local-first', 'Graph-powered', 'Cross-tool', 'Searchable']

export function ConfigTab({ ctx }: ConfigTabProps) {
  const { config, loading, error, refresh, save } = useNowledgeConfig(ctx.routes, true)
  const { data: statusData, loading: statusLoading, error: statusError, refresh: statusRefresh } = useNowledgeStatus(ctx.routes, true)
  const [form, setForm] = useState<ConfigFormState>(EMPTY_FORM)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRequestRef = useRef(0)
  const savedSignatureRef = useRef<string>('')

  // Sync local form when config first loads or changes externally
  useEffect(() => {
    if (config) {
      setForm({
        apiUrl: config.apiUrl,
        mcpUrl: config.mcpUrl ?? deriveMcpUrl(config.apiUrl),
        spaceId: config.spaceId ?? '',
        enabled: config.enabled,
      })
      savedSignatureRef.current = signatureOf({
        apiUrl: config.apiUrl,
        spaceId: config.spaceId ?? '',
        enabled: config.enabled,
      })
      setSaveState('idle')
    }
  }, [config])

  const signature = useMemo(
    () => signatureOf({ apiUrl: form.apiUrl, spaceId: form.spaceId, enabled: form.enabled }),
    [form.apiUrl, form.spaceId, form.enabled],
  )

  const dirty = signature !== savedSignatureRef.current

  const performSave = useCallback(async (formToSave: ConfigFormState) => {
    const requestId = ++saveRequestRef.current
    setSaveState('saving')
    try {
      await save(formToSave)
      if (saveRequestRef.current !== requestId) { return }
      setSaveState('saved')
      ctx.notifications.show({ title: 'Config saved', type: 'success' })
      savedSignatureRef.current = signatureOf({
        apiUrl: formToSave.apiUrl,
        spaceId: formToSave.spaceId,
        enabled: formToSave.enabled,
      })
      if (clearTimerRef.current) { clearTimeout(clearTimerRef.current) }
      clearTimerRef.current = setTimeout(setSaveState, 1600, 'idle')
      // Re-check live connection after a save (e.g. enabling the plugin).
      void statusRefresh()
    }
    catch (err) {
      if (saveRequestRef.current !== requestId) { return }
      const message = err instanceof Error ? err.message : String(err)
      setSaveState('error')
      ctx.notifications.show({ title: 'Save failed', description: message, type: 'error' })
    }
  }, [ctx.notifications, save, statusRefresh])

  // Debounced auto-save when form changes
  useEffect(() => {
    if (!dirty || !config) { return }
    if (saveState === 'saving') { return }
    setSaveState('pending')
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current) }
    saveTimerRef.current = setTimeout(() => { void performSave(form) }, 1200)
    return () => {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current) }
    }
  }, [dirty, config, form, performSave, saveState])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current) }
      if (clearTimerRef.current) { clearTimeout(clearTimerRef.current) }
    }
  }, [])

  const setField = useCallback(<K extends keyof ConfigFormState>(key: K, value: ConfigFormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleReset = useCallback(() => {
    void refresh()
  }, [refresh])

  const connState = useMemo<ConnState>(() => {
    if (statusLoading && !statusData) { return 'loading' }
    if (statusError && !statusData) { return 'unreachable' }
    if (statusData?.health?.skipped) { return 'disabled' }
    if (statusData) { return 'connected' }
    return 'loading'
  }, [statusData, statusError, statusLoading])

  const allReady = connState === 'connected' && !!config?.hasApiKey && !!config?.enabled

  return (
    <ScrollArea className="h-full" viewportClassName="max-h-full">
      <TooltipProvider>
        <div className="mx-auto flex max-w-2xl flex-col gap-2 p-6">
          <Hero />

          {/* Live connection status */}
          <div className="mt-4">
            <SettingsSectionHeader
              title="Connection status"
              description="Live check against your Nowledge Mem instance."
              action={(
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  onClick={() => void statusRefresh()}
                  disabled={statusLoading}
                  aria-label="Refresh status"
                >
                  <RefreshIcon className={cn('size-4', statusLoading && 'animate-spin')} aria-hidden="true" />
                </Button>
              )}
            />
          </div>

          {allReady && (
            <Alert className="mb-1">
              <CheckCircleIcon aria-hidden="true" />
              <AlertTitle>You're all set</AlertTitle>
              <AlertDescription>
                Nowledge Mem is reachable and the plugin is enabled — memory is shared across your AI tools.
              </AlertDescription>
            </Alert>
          )}

          <StatusCheck
            icon={<ServerIcon className="size-4" aria-hidden="true" />}
            state={connState === 'connected' ? 'pass' : connState === 'loading' ? 'pending' : connState === 'disabled' ? 'pending' : 'fail'}
            title="Nowledge Mem server"
            hint={
              connState === 'connected'
                ? `Reachable at ${form.apiUrl || 'http://127.0.0.1:14242'}.`
                : connState === 'disabled'
                  ? 'Plugin is disabled — enable it below to test the connection.'
                  : connState === 'loading'
                    ? 'Checking reachability…'
                    : statusError
                      ? `Can't reach the API${form.apiUrl ? ` at ${form.apiUrl}` : ''}. Make sure the Nowledge Mem app is running, or adjust the API URL below.`
                      : undefined
            }
            action={
              connState !== 'connected' && connState !== 'loading' && (
                <Button variant="outline" size="xs" asChild>
                  <a href={PRODUCT_URL} target="_blank" rel="noreferrer">
                    <ExternalLinkIcon className="size-3" aria-hidden="true" />
                    Download
                  </a>
                </Button>
              )
            }
          />
          <SettingsDivider />
          <StatusCheck
            icon={<KeyIcon className="size-4" aria-hidden="true" />}
            state={!config ? 'pending' : config.hasApiKey ? 'pass' : 'fail'}
            title="API key"
            hint={
              config?.hasApiKey
                ? 'NMEM_API_KEY is set.'
                : 'Set NMEM_API_KEY in the environment or shared plugin config. The key is never persisted or returned.'
            }
          />
          <SettingsDivider />
          <StatusCheck
            icon={<PowerIcon className="size-4" aria-hidden="true" />}
            state={!config ? 'pending' : config.enabled ? 'pass' : 'fail'}
            title="Plugin enabled"
            hint={
              config?.enabled
                ? 'MCP server registers on next sync.'
                : 'Turn on Enabled below to register the MCP server and start sharing memory.'
            }
          />

          {/* Connection settings */}
          <div className="mt-4">
            <SettingsSectionHeader
              title="Connection"
              description="Non-secret settings stored in plugin-local storage."
            />
          </div>

          {!config && loading && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          )}

          {!config && error && (
            <Alert variant="destructive">
              <AlertCircleIcon aria-hidden="true" />
              <AlertTitle>Couldn't load config</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {config && (
            <>
              <SettingsRow
                label="API URL"
                description="Base URL of the Nowledge Mem API. Defaults to http://127.0.0.1:14242."
                info="Trailing slashes are stripped on save."
              >
                <Input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.apiUrl}
                  placeholder="http://127.0.0.1:14242"
                  disabled={saveState === 'saving'}
                  onChange={e => setField('apiUrl', e.target.value)}
                />
              </SettingsRow>
              <SettingsDivider />
              <SettingsRow
                label="Space ID"
                description="Optional default Nowledge space. Individual routes can override with space_id."
              >
                <Input
                  autoComplete="off"
                  spellCheck={false}
                  value={form.spaceId}
                  placeholder="default"
                  disabled={saveState === 'saving'}
                  onChange={e => setField('spaceId', e.target.value)}
                />
              </SettingsRow>
              <SettingsDivider />
              <SettingsRow
                label="Enabled"
                description="When off, upstream work and MCP registration are skipped on next activation."
              >
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.enabled}
                    disabled={saveState === 'saving'}
                    onCheckedChange={checked => setField('enabled', checked)}
                  />
                  <span className="text-[12px] text-muted-foreground tabular-nums">
                    {form.enabled ? 'On' : 'Off'}
                  </span>
                </div>
              </SettingsRow>
            </>
          )}

          {/* Advanced: transport internals */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="mt-4">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                {advancedOpen ? 'Hide' : 'Show'}
{' '}
advanced
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 flex flex-col gap-2">
              <SettingsRow
                label="MCP URL"
                description="Streamable HTTP MCP endpoint, derived from the API URL. Registered server-side when enabled."
              >
                <Input
                  type="url"
                  value={deriveMcpUrl(form.apiUrl)}
                  placeholder="http://127.0.0.1:14242/mcp"
                  readOnly
                  disabled
                  className="font-mono text-[12px]"
                />
              </SettingsRow>
              <SettingsDivider />
              <SettingsRow
                label="API key"
                description="Read from NMEM_API_KEY in env or shared plugin config. Never persisted or returned."
              >
                <Badge variant={config?.hasApiKey ? 'secondary' : 'outline'} className="gap-1">
                  {config?.hasApiKey ? 'Set' : 'Missing'}
                </Badge>
              </SettingsRow>
              <SettingsDivider />
              <SettingsRow
                label="Plugin"
                description={config?.enabled ? 'Enabled — MCP registration runs on next sync.' : 'Disabled — server routes stay configured, but upstream work is skipped.'}
              >
                <Badge variant={config?.enabled ? 'secondary' : 'outline'} className="gap-1">
                  {config?.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </SettingsRow>
            </CollapsibleContent>
          </Collapsible>

          {error && (
            <Alert variant="destructive" className="mt-2">
              <AlertCircleIcon aria-hidden="true" />
              <AlertTitle>Save failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Footer: SaveState + actions */}
          <div className="mt-2 flex items-center justify-between gap-2 pb-4">
            <SaveIndicator state={saveState} />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={!dirty || saveState === 'saving'}
              >
                Reset
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void performSave(form)}
                disabled={!dirty || saveState === 'saving'}
              >
                {saveState === 'saving' ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </div>
        </div>
      </TooltipProvider>
    </ScrollArea>
  )
}

function Hero() {
  return (
    <Card className="gap-0">
      <div className="flex items-center gap-3 border-b px-4 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <BrainIcon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold leading-tight">Nowledge Mem</h2>
            <Badge variant="secondary" className="gap-1 font-normal">
              <SparklesIcon className="size-3" aria-hidden="true" />
              Cradle plugin
            </Badge>
          </div>
          <p className="text-[12px] text-muted-foreground">One memory layer across your AI tools.</p>
        </div>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" asChild>
          <a href={PRODUCT_URL} target="_blank" rel="noreferrer" aria-label="Open Nowledge Mem site">
            <ExternalLinkIcon className="size-4" aria-hidden="true" />
          </a>
        </Button>
      </div>
      <CardContent className="px-4 py-3">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Local-first, graph-powered memory for your AI tools. Your chats, notes, files, and decisions stay on your
          own machine and become searchable memory you can revisit and build on — instead of resetting every time your
          stack changes.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {FEATURE_CHIPS.map(f => (
            <Badge key={f} variant="outline" className="font-normal text-muted-foreground">{f}</Badge>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" asChild>
            <a href={PRODUCT_URL} target="_blank" rel="noreferrer">
              Learn more
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={DOCS_URL} target="_blank" rel="noreferrer">
              <BookIcon className="size-3.5" aria-hidden="true" />
              Docs
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

type CheckState = 'pass' | 'fail' | 'pending'

function StatusCheck({
  icon,
  state,
  title,
  hint,
  action,
}: {
  icon: ReactNode
  state: CheckState
  title: string
  hint?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md',
          state === 'pass' && 'bg-success/10 text-success',
          state === 'fail' && 'bg-warning/10 text-warning',
          state === 'pending' && 'bg-muted text-muted-foreground',
        )}
      >
        {state === 'pending'
          ? <Skeleton className="size-2.5 rounded-full" />
          : state === 'pass'
            ? <CheckCircleIcon className="size-4" aria-hidden="true" />
            : <CloseCircleIcon className="size-4" aria-hidden="true" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/80">{icon}</span>
          <span className="text-[13px] font-medium leading-tight">{title}</span>
        </div>
        {hint && <p className="text-[12px] leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}

function signatureOf(form: { apiUrl: string, spaceId: string, enabled: boolean }): string {
  return JSON.stringify({
    apiUrl: form.apiUrl.trim(),
    spaceId: form.spaceId.trim(),
    enabled: form.enabled,
  })
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') { return null }
  return (
    <span
      className={cn(
        'flex items-center gap-1 text-[11px] font-medium transition-opacity duration-200',
        (state === 'saving' || state === 'pending') && 'text-muted-foreground',
        state === 'saved' && 'text-success',
        state === 'error' && 'text-destructive',
      )}
    >
      {(state === 'saving' || state === 'pending') && <Skeleton className="size-2.5 rounded-full" />}
      {state === 'saved' && <CheckCircleIcon className="size-3" aria-hidden="true" />}
      {state === 'error' && <AlertCircleIcon className="size-3" aria-hidden="true" />}
      <span>
        {state === 'pending' && 'Pending'}
        {state === 'saving' && 'Saving'}
        {state === 'saved' && 'Saved'}
        {state === 'error' && 'Save failed'}
      </span>
    </span>
  )
}
