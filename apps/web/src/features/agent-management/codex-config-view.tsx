import {
  CheckLine as CheckIcon,
  RefreshAnticlockwise1Line as ResetIcon,
  SaveLine as SaveIcon,
  WarningLine as WarningIcon,
} from '@mingcute/react'
import { lazy, Suspense, useMemo, useState } from 'react'

import type { GetProviderTargetsCodexConfigSchemaResponse } from '~/api-gen/types.gen'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { cn } from '~/lib/cn'

import {
  countOverrides,
  parseCodexConfig,
  parseCodexSchema,
  setConfigFlag,
  setPathValue,
} from './codex-config-schema'
import { CodexConfigSettingsView } from './codex-config-settings-view'

const CodexConfigEditorView = lazy(() =>
  import('./codex-config-editor-view').then(module => ({ default: module.CodexConfigEditorView })))

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
  const [mode, setMode] = useState<'settings' | 'json'>('settings')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const model = useMemo(() => parseCodexSchema(schema), [schema])
  const parsed = parseCodexConfig(value)
  const parseError = 'error' in parsed ? parsed.error : null
  const config = 'config' in parsed ? parsed.config : {}

  const commit = (next: Record<string, unknown>) => {
    setValue(JSON.stringify(next, null, 2))
    setSaved(false)
  }
  const busy = disabled || saving
  const dirty = value !== savedValue
  const overrides = countOverrides(config)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(value)
      setSavedValue(value)
      setSaved(true)
    }
    catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save Codex configuration')
    }
    finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="Codex configuration" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 px-0.5">
          <h3 className="text-sm font-medium text-foreground">Codex configuration</h3>
          <p className="mt-0.5 text-xs text-muted-foreground [text-wrap:pretty]">
            {`Native settings for this provider's Codex runtime · Codex ${model.version}`}
          </p>
        </div>
        <Tabs
          value={mode}
          onValueChange={next => setMode(next as 'settings' | 'json')}
        >
          <TabsList>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {mode === 'settings'
        ? (
            <CodexConfigSettingsView
              schema={schema}
              model={model}
              config={config}
              theme={theme}
              readOnly={busy || Boolean(parseError)}
              search={search}
              onSearchChange={setSearch}
              onSetPath={(path, next) => commit(setPathValue(config, path, next))}
              onSetFlag={(key, next) => commit(setConfigFlag(config, key, next))}
            />
          )
        : (
            <div className="flex min-w-0 flex-col gap-2">
              <Suspense
                fallback={(
                  <div className="flex h-96 items-center justify-center">
                    <Spinner />
                  </div>
                )}
              >
                <CodexConfigEditorView
                  value={value}
                  schemaJson={schema.schemaJson}
                  theme={theme}
                  disabled={busy}
                  onChange={(next) => {
                    setValue(next)
                    setSaved(false)
                  }}
                />
              </Suspense>
              <p className="text-xs text-muted-foreground">
                {`Validated against the Codex ${model.version} configuration schema.`}
              </p>
            </div>
          )}

      {parseError && mode !== 'json' && (
        <Alert variant="warning">
          <WarningIcon />
          <AlertTitle>Configuration JSON is invalid</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {parseError}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setMode('json')}
            >
              Fix in JSON
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>Could not save Codex configuration</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/4 pt-4">
        <span
          aria-live="polite"
          className={cn(
            'flex min-w-0 items-center gap-1.5 text-xs',
            saved ? 'text-success' : 'text-muted-foreground',
          )}
        >
          {saved && <CheckIcon className="size-3 shrink-0" />}
          {saving
            ? 'Saving…'
            : saved
              ? 'Saved. Applies to the next runtime connection.'
              : dirty
                ? 'Unsaved changes'
                : 'Applies to the next runtime connection.'}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {overrides > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={busy}
              onClick={() => {
                commit({})
                setError(null)
                setSearch('')
              }}
            >
              <ResetIcon />
              Reset overrides
            </Button>
          )}
          {dirty && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={busy}
              onClick={() => {
                setValue(savedValue)
                setError(null)
                setSaved(false)
              }}
            >
              Discard
            </Button>
          )}
          <Button
            size="sm"
            className="gap-1.5"
            disabled={busy || Boolean(parseError) || !dirty}
            onClick={() => void save()}
          >
            {saving ? <Spinner /> : <SaveIcon />}
            Save
          </Button>
        </div>
      </footer>
    </section>
  )
}
