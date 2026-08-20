import {
  AlertLine as AlertIcon,
  ArrowRightUpLine as ExternalLinkIcon,
  BrainLine as BrainIcon,
  CheckCircleLine as CheckCircleIcon,
  Key2Line as KeyIcon,
  ServerLine as ServerIcon,
} from '@mingcute/react'
import { useEffect, useMemo, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Skeleton } from '~/components/ui/skeleton'
import { Switch } from '~/components/ui/switch'
import { SettingsDivider, SettingsRow, SettingsSectionHeader } from '~/features/settings/settings-row'

import type { ConfigFormState, NowledgeConfigUpdate, NowledgePluginConfig } from '../types'

interface ConfigTabViewProps {
  config: NowledgePluginConfig | null
  loading: boolean
  error: string | null
  onRefresh: () => Promise<void>
  onSave: (update: NowledgeConfigUpdate) => Promise<NowledgePluginConfig>
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const EMPTY_FORM: ConfigFormState = {
  mcpUrl: '',
  enabled: true,
  apiKey: '',
  removeApiKey: false,
}

const DOCS_URL = 'https://mem.nowledge.co/docs/remote-access'

export function ConfigTabView({
  config,
  loading,
  error,
  onRefresh,
  onSave,
}: ConfigTabViewProps) {
  const [form, setForm] = useState<ConfigFormState>(EMPTY_FORM)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  useEffect(() => {
    if (!config) {
      return
    }
    setForm({
      mcpUrl: config.mcpUrl,
      enabled: config.enabled,
      apiKey: '',
      removeApiKey: false,
    })
    setSaveState('idle')
  }, [config])

  const dirty = useMemo(() => {
    if (!config) {
      return false
    }
    return form.mcpUrl.trim() !== config.mcpUrl
      || form.enabled !== config.enabled
      || form.apiKey.trim().length > 0
      || form.removeApiKey
  }, [config, form])

  async function handleSave() {
    if (!config || !form.mcpUrl.trim()) {
      return
    }
    setSaveState('saving')
    try {
      const next = await onSave({
        mcpUrl: form.mcpUrl.trim(),
        enabled: form.enabled,
        ...(form.apiKey.trim()
          ? { apiKey: form.apiKey.trim() }
          : form.removeApiKey
            ? { apiKey: null }
            : {}),
      })
      setForm({
        mcpUrl: next.mcpUrl,
        enabled: next.enabled,
        apiKey: '',
        removeApiKey: false,
      })
      setSaveState('saved')
    }
    catch {
      setSaveState('error')
    }
  }

  function handleReset() {
    if (config) {
      setForm({
        mcpUrl: config.mcpUrl,
        enabled: config.enabled,
        apiKey: '',
        removeApiKey: false,
      })
    }
    setSaveState('idle')
    void onRefresh()
  }

  const credentialLabel = form.removeApiKey
    ? 'Will be removed'
    : config?.apiKeySource === 'plugin'
      ? 'Stored by Cradle'
      : config?.apiKeySource === 'environment'
        ? 'Provided by environment'
        : 'Not configured'

  function updateForm(update: (current: ConfigFormState) => ConfigFormState) {
    setForm(update)
    setSaveState('idle')
  }

  return (
    <ScrollArea className="h-full" viewportClassName="max-h-full">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 p-6">
        <header className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BrainIcon className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-balance">Nowledge Mem</h2>
              {config && (
                <Badge variant={config.enabled ? 'secondary' : 'outline'}>
                  {config.enabled ? 'MCP enabled' : 'Disabled'}
                </Badge>
              )}
            </div>
            <p className="text-[12px] text-muted-foreground text-pretty">
              Streamable HTTP MCP connection for Cradle agent runtimes.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href={DOCS_URL} target="_blank" rel="noreferrer">
              Docs
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            </a>
          </Button>
        </header>

        {!config && loading && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
          </div>
        )}

        {!config && error && (
          <Alert variant="destructive">
            <AlertIcon aria-hidden="true" />
            <AlertTitle>Could not load settings</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {config && (
          <>
            <section>
              <SettingsSectionHeader
                title="MCP registration"
                description="Cradle exposes this server to agent runtimes when the plugin is enabled."
              />
              <Alert>
                {config.enabled
                  ? <CheckCircleIcon aria-hidden="true" />
                  : <AlertIcon aria-hidden="true" />}
                <AlertTitle>{config.enabled ? 'Registered for agent runtimes' : 'Registration disabled'}</AlertTitle>
                <AlertDescription>
                  {config.enabled
                    ? 'Connectivity is established when a runtime invokes a Nowledge Mem tool.'
                    : 'Enable the plugin below to make Nowledge Mem tools available.'}
                </AlertDescription>
              </Alert>
            </section>

            <section>
              <SettingsSectionHeader
                title="Connection"
                description="The endpoint is stored in plugin-local configuration. Credentials use encrypted plugin secrets."
              />
              <SettingsRow
                label="MCP endpoint"
                description="Exact streamable HTTP endpoint exposed by Nowledge Mem."
              >
                <div className="flex items-center gap-2">
                  <ServerIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <Input
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    value={form.mcpUrl}
                    placeholder="http://127.0.0.1:14242/mcp/"
                    disabled={saveState === 'saving'}
                    onChange={event => updateForm(current => ({ ...current, mcpUrl: event.target.value }))}
                  />
                </div>
              </SettingsRow>
              <SettingsDivider />
              <SettingsRow
                label="API key"
                description="Optional for local Mem. Remote endpoints usually require a key."
              >
                <div className="flex min-w-0 flex-col items-end gap-2">
                  <div className="flex w-full items-center gap-2">
                    <KeyIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <Input
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={form.apiKey}
                      placeholder={config.hasApiKey ? 'Enter a replacement key' : 'nmem_...'}
                      disabled={saveState === 'saving' || form.removeApiKey}
                      onChange={event => updateForm(current => ({
                        ...current,
                        apiKey: event.target.value,
                        removeApiKey: false,
                      }))}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Badge variant="outline">{credentialLabel}</Badge>
                    {config.apiKeySource === 'plugin' && !form.removeApiKey && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={saveState === 'saving'}
                        onClick={() => updateForm(current => ({
                          ...current,
                          apiKey: '',
                          removeApiKey: true,
                        }))}
                      >
                        Remove stored key
                      </Button>
                    )}
                    {form.removeApiKey && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={saveState === 'saving'}
                        onClick={() => updateForm(current => ({ ...current, removeApiKey: false }))}
                      >
                        Keep key
                      </Button>
                    )}
                  </div>
                </div>
              </SettingsRow>
              <SettingsDivider />
              <SettingsRow
                label="Enabled"
                description="Controls whether Cradle registers the MCP server for agent runtimes."
              >
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.enabled}
                    disabled={saveState === 'saving'}
                    onCheckedChange={enabled => updateForm(current => ({ ...current, enabled }))}
                  />
                  <span className="text-[12px] text-muted-foreground">
                    {form.enabled ? 'On' : 'Off'}
                  </span>
                </div>
              </SettingsRow>
            </section>

            {error && (
              <Alert variant="destructive">
                <AlertIcon aria-hidden="true" />
                <AlertTitle>Could not save settings</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <footer className="flex min-h-10 items-center justify-between gap-3 pb-2">
              <span className="text-[12px] text-muted-foreground" aria-live="polite">
                {saveState === 'saving' && 'Saving...'}
                {saveState === 'saved' && 'Saved'}
                {saveState === 'error' && 'Save failed'}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!dirty || saveState === 'saving'}
                  onClick={handleReset}
                >
                  Reset
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!dirty || !form.mcpUrl.trim() || saveState === 'saving'}
                  onClick={() => void handleSave()}
                >
                  {saveState === 'saving' ? 'Saving...' : 'Save changes'}
                </Button>
              </div>
            </footer>
          </>
        )}
      </div>
    </ScrollArea>
  )
}
