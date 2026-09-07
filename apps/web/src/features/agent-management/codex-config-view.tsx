import { Refresh1Line as ResetIcon, SaveLine as SaveIcon } from '@mingcute/react'
import type { json } from 'monaco-editor'
import { lazy, Suspense, useState } from 'react'
import { z } from 'zod'

import type { GetProviderTargetsCodexConfigSchemaResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { cn } from '~/lib/cn'

const CodexConfigEditorView = lazy(() =>
  import('./codex-config-editor-view').then(module => ({ default: module.CodexConfigEditorView })))
const Config = z.record(z.string(), z.json())

export interface CodexConfigViewProps {
  schema: GetProviderTargetsCodexConfigSchemaResponse
  initialValue: string
  theme?: 'vs' | 'vs-dark'
  disabled?: boolean
  onSave: (value: string) => Promise<void>
}

export function CodexConfigView({
  schema,
  initialValue,
  theme = 'vs',
  disabled = false,
  onSave,
}: CodexConfigViewProps) {
  const [value, setValue] = useState(initialValue)
  const [savedValue, setSavedValue] = useState(initialValue)
  const [mode, setMode] = useState('settings')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  let config: z.infer<typeof Config> = {}
  let parseError: string | null = null
  try {
    config = Config.parse(JSON.parse(value))
  }
  catch {
    parseError = 'Enter a JSON object with valid configuration values.'
  }

  const nativeSchema: json.JSONSchema = JSON.parse(schema.schemaJson)
  const featureSchema = nativeSchema.properties?.features
  const flags = Object.entries(
    typeof featureSchema === 'object' ? (featureSchema.properties ?? {}) : {},
  ).filter(
    ([name, field]) =>
      typeof field === 'object'
      && field.type === 'boolean'
      && name.toLowerCase().includes(search.toLowerCase()),
  )
  const features = Config.safeParse(config.features ?? {})
  const setField = (key: string, next: string) => {
    const updated = { ...config }
    if (next === 'inherit') {
      delete updated[key]
    }
    else {
      updated[key] = next
    }
    setValue(JSON.stringify(updated, null, 2))
    setSaved(false)
  }
  const setFlag = (key: string, next: string) => {
    const updated = { ...(features.success ? features.data : {}) }
    if (next === 'inherit') {
      delete updated[key]
    }
    else {
      updated[key] = next === 'true'
    }
    const nextConfig = { ...config }
    if (Object.keys(updated).length) {
      nextConfig.features = updated
    }
    else {
      delete nextConfig.features
    }
    setValue(JSON.stringify(nextConfig, null, 2))
    setSaved(false)
  }
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(value)
      setSavedValue(value)
      setSaved(true)
    }
    catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save Codex configuration')
    }
    finally {
      setSaving(false)
    }
  }
  const busy = disabled || saving
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="Codex configuration">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Codex configuration</h3>
          <p className="text-xs text-muted-foreground">{`Codex ${schema.version}`}</p>
        </div>
        <Tabs value={mode} onValueChange={setMode}>
          <TabsList>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {mode === 'settings'
        ? (
          <fieldset disabled={busy || Boolean(parseError)} className="flex min-w-0 flex-col gap-4">
            {[
              {
                key: 'web_search',
                label: 'Web search',
                definition: nativeSchema.definitions?.WebSearchMode,
              },
              {
                key: 'model_verbosity',
                label: 'Response verbosity',
                definition: nativeSchema.definitions?.Verbosity,
              },
            ]
              .filter(field => field.key in (nativeSchema.properties ?? {}))
              .map(field => (
                <div key={field.key} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-foreground">{field.label}</span>
                  <Select
                    value={
                      typeof config[field.key] === 'string'
                        ? (config[field.key] as string)
                        : 'inherit'
                    }
                    onValueChange={value => setField(field.key, value)}
                    disabled={busy || Boolean(parseError)}
                  >
                    <SelectTrigger className="w-36" aria-label={field.label}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">Inherit default</SelectItem>
                      {(typeof field.definition === 'object'
                        ? (field.definition.enum ?? [])
                        : []
                      ).map((option: string) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            <label className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground">
              Service tier
              <Input
                className="w-36"
                value={typeof config.service_tier === 'string' ? config.service_tier : ''}
                placeholder="Inherit default"
                onChange={event => setField('service_tier', event.target.value || 'inherit')}
              />
            </label>
            <Input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search feature flags"
              aria-label="Search feature flags"
            />
            <div className="max-h-64 overflow-y-auto">
              {flags.map(([key]) => (
                <div key={key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 break-all font-mono text-xs text-foreground">{key}</span>
                  <Select
                    value={
                      features.success && typeof features.data[key] === 'boolean'
                        ? String(features.data[key])
                        : 'inherit'
                    }
                    onValueChange={value => setFlag(key, value)}
                    disabled={busy || Boolean(parseError)}
                  >
                    <SelectTrigger className="w-36 shrink-0" aria-label={key}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">Inherit default</SelectItem>
                      <SelectItem value="true">Enabled</SelectItem>
                      <SelectItem value="false">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {!flags.length && (
                <p className="py-3 text-xs text-muted-foreground">No matching feature flags</p>
              )}
            </div>
          </fieldset>
        )
        : (
          <Suspense
            fallback={(
              <div className="flex h-80 items-center justify-center">
                <Spinner />
              </div>
            )}
          >
            <CodexConfigEditorView
              value={value}
              schemaJson={schema.schemaJson}
              theme={theme}
              disabled={busy}
              onChange={(value) => {
                setValue(value)
                setSaved(false)
              }}
            />
          </Suspense>
        )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Managed by Cradle</summary>
        <p className="mt-2 break-words font-mono">{schema.managedKeys.join(', ')}</p>
      </details>
      {(error || parseError) && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error || parseError}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={cn('text-xs', saved ? 'text-success' : 'text-muted-foreground')}>
          {saved
            ? 'Saved. Applies to the next runtime connection.'
            : value !== savedValue
              ? 'Unsaved changes'
              : 'Existing connections keep their current configuration.'}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || value === savedValue}
            onClick={() => {
              setValue(savedValue)
              setError(null)
              setSaved(false)
            }}
          >
            Discard
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || value === '{}'}
            onClick={() => {
              setValue('{}')
              setSaved(false)
            }}
          >
            <ResetIcon />
            Reset overrides
          </Button>
          <Button
            size="sm"
            disabled={busy || Boolean(parseError) || value === savedValue}
            onClick={() => void save()}
          >
            {saving ? <Spinner /> : <SaveIcon />}
            Save
          </Button>
        </div>
      </div>
    </section>
  )
}
