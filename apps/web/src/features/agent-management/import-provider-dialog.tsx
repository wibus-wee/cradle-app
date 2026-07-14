import {
  AlertLine as CircleAlertIcon,
  DownloadLine as DownloadIcon,
  GlobeLine as GlobeIcon,
  Key2Line as KeyIcon,
  SparklesLine as SparklesIcon,
} from '@mingcute/react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import { z } from 'zod'

import { patchProfilesByIdCustomModels, postSecrets } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import type { ApiProviderKind } from '~/features/agent-runtime/types'
import { AGENT_MODELS_QUERY_KEY } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { cn } from '~/lib/cn'

import type { ParsedProvider, ParseResult } from './import-provider-parser'
import { parseProviderConfig } from './import-provider-parser'
import { matchProviderEndpoint } from './provider-endpoint-registry'
import { warmManualProviderModelCache } from './provider-model-cache'
import { buildProfileId } from './provider-settings-utils'

const SecretCreateResponseSchema = z.object({ id: z.string().min(1) })

const KIND_OPTIONS: { value: ApiProviderKind, label: string }[] = [
  { value: 'openai-compatible', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'universal', label: 'Universal' },
]

const FLAT_IMPORT_FIELD_CLASS = [
  'h-7 rounded-sm border-0 border-b border-transparent bg-transparent px-1 shadow-none',
  'text-[11px] font-mono placeholder:text-muted-foreground/45',
  'transition-[background-color,border-color] duration-150 hover:bg-muted/50',
  'focus-visible:border-ring focus-visible:bg-muted/50 focus-visible:ring-0 focus-visible:ring-offset-0',
].join(' ')

const IMPORT_FIELD_LABEL_CLASS = 'text-[9px] font-medium uppercase tracking-wide text-muted-foreground/55'

function hostnameFromUrl(url: string): string {
  try { return new URL(url).hostname }
 catch { return url }
}

function baseUrlIncludesV1(baseUrl: string): boolean {
  try {
    const path = new URL(baseUrl).pathname
    return path.split('/').some(segment => segment.toLowerCase() === 'v1')
  }
 catch {
    return /(^|\/)v1(\/|$)/i.test(baseUrl)
  }
}

function shouldShowV1Reminder(baseUrl: string): boolean {
  const trimmed = baseUrl.trim()
  return trimmed.length > 0 && !baseUrlIncludesV1(trimmed)
}

function universalEndpointDefaults(baseUrl: string): { openaiBaseUrl: string, anthropicBaseUrl: string } {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  const anthropicBaseUrl = trimmed.replace(/\/v1$/i, '')
  return {
    openaiBaseUrl: /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`,
    anthropicBaseUrl,
  }
}

function fingerprintProvider(provider: ParsedProvider): string {
  let hash = 0
  for (const ch of provider.apiKey) {
    hash = Math.imul(31, hash) + ch.charCodeAt(0) | 0
  }
  return `${provider.providerKind}:${provider.baseUrl}:${hash.toString(36)}`
}

function parsedConfigFingerprint(parseResult: ParseResult): string {
  return [
    parseResult.token ?? '',
    ...parseResult.providers.map(fingerprintProvider),
  ].join('\n')
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function ImportProviderDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { createProfile, profiles } = useAgentProfiles()
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [enabledSet, setEnabledSet] = useState<Set<number>>(() => new Set())
  const [kinds, setKinds] = useState<ApiProviderKind[]>([])
  const [apiKeys, setApiKeys] = useState<string[]>([])
  const [baseUrls, setBaseUrls] = useState<string[]>([])
  const [openaiBaseUrls, setOpenaiBaseUrls] = useState<string[]>([])
  const [anthropicBaseUrls, setAnthropicBaseUrls] = useState<string[]>([])
  const [manualUrl, setManualUrl] = useState('')
  const [manualKind, setManualKind] = useState<ApiProviderKind>('openai-compatible')
  const prevParsedConfigKeyRef = useRef<string | null>(null)

  const parseResult = useMemo(() => {
    if (!text.trim()) { return null }
    return parseProviderConfig(text)
  }, [text])

  // Deduplicate provider names: append " (2)", " (3)" etc for same-name entries
  const computeResolvedNames = useCallback((parsed: ParsedProvider[]) => {
    const counts = new Map<string, number>()
    const allExisting = new Set(profiles.map(p => p.name.toLowerCase()))
    return parsed.map((p) => {
      const base = p.name
      let candidate = base
      let n = 1
      while (allExisting.has(candidate.toLowerCase()) || counts.has(candidate.toLowerCase())) {
        n++
        candidate = `${base} (${n})`
      }
      allExisting.add(candidate.toLowerCase())
      counts.set(candidate.toLowerCase(), n)
      return candidate
    })
  }, [profiles])

  const [resolvedNames, setResolvedNames] = useState<string[]>([])

  const handleTextChange = (value: string) => {
    setText(value)

    const nextParseResult = value.trim() ? parseProviderConfig(value) : null
    const nextConfigKey = nextParseResult ? parsedConfigFingerprint(nextParseResult) : null
    if (nextConfigKey === prevParsedConfigKeyRef.current) { return }

    prevParsedConfigKeyRef.current = nextConfigKey

    if (!nextParseResult) {
      setResolvedNames(prev => (prev.length === 0 ? prev : []))
      setKinds(prev => (prev.length === 0 ? prev : []))
      setApiKeys(prev => (prev.length === 0 ? prev : []))
      setBaseUrls(prev => (prev.length === 0 ? prev : []))
      setOpenaiBaseUrls(prev => (prev.length === 0 ? prev : []))
      setAnthropicBaseUrls(prev => (prev.length === 0 ? prev : []))
      setEnabledSet(prev => (prev.size === 0 ? prev : new Set()))
      setManualUrl('')
      return
    }

    const nextNames = computeResolvedNames(nextParseResult.providers)
    setResolvedNames(prev => (stringArraysEqual(prev, nextNames) ? prev : nextNames))
    setKinds(nextParseResult.providers.map(p => p.providerKind))
    setApiKeys(nextParseResult.providers.map(p => p.apiKey))
    setBaseUrls(nextParseResult.providers.map(p => p.baseUrl))
    setOpenaiBaseUrls(nextParseResult.providers.map(p => universalEndpointDefaults(p.baseUrl).openaiBaseUrl))
    setAnthropicBaseUrls(nextParseResult.providers.map(p => universalEndpointDefaults(p.baseUrl).anthropicBaseUrl))
    setManualUrl('')
    setEnabledSet(new Set(nextParseResult.providers.map((_, i) => i)))
  }

  const resetImportDraft = () => {
    prevParsedConfigKeyRef.current = null
    setText('')
    setManualUrl('')
    setResolvedNames([])
    setKinds([])
    setApiKeys([])
    setBaseUrls([])
    setOpenaiBaseUrls([])
    setAnthropicBaseUrls([])
    setEnabledSet(new Set())
  }

  const token = parseResult?.token ?? null
  const hasProviders = parseResult && parseResult.providers.length > 0
  const showManualEntry = parseResult && !hasProviders && parseResult.urls.length === 0

  const handleImport = async () => {
    if (importing) { return }
    const providers: ParsedProvider[] = [...(parseResult?.providers ?? [])]
    const finalKinds = [...kinds]

    // Manual entry fallback
    if (providers.length === 0 && token && manualUrl.trim()) {
      providers.push({
        providerKind: manualKind,
        name: hostnameFromUrl(manualUrl.trim()),
        apiKey: token,
        baseUrl: manualUrl.trim(),
      })
      finalKinds.push(manualKind)
    }

    if (providers.length === 0) { return }
    const selectedProviders: { provider: ParsedProvider, index: number }[] = []
    for (let index = 0; index < providers.length; index++) {
      if (enabledSet.has(index) || providers.length === 1) {
        selectedProviders.push({ provider: providers[index], index })
      }
    }
    if (selectedProviders.length === 0) { return }
    setImporting(true)

    try {
      const importBatchId = Date.now()
      const credentialRefs = new Map<string, string>()

      for (const { provider: p, index } of selectedProviders) {
        const kind = finalKinds[index] ?? p.providerKind
        const apiKey = apiKeys[index]?.trim() ?? p.apiKey
        const baseUrl = baseUrls[index]?.trim() ?? p.baseUrl
        const openaiBaseUrl = openaiBaseUrls[index]?.trim() ?? universalEndpointDefaults(baseUrl).openaiBaseUrl
        const anthropicBaseUrl = anthropicBaseUrls[index]?.trim() ?? universalEndpointDefaults(baseUrl).anthropicBaseUrl
        if (!apiKey || (kind === 'universal' ? !openaiBaseUrl || !anthropicBaseUrl : !baseUrl)) {
          continue
        }
        const secretKey = `${kind}\0${apiKey}`
        let credentialRef = credentialRefs.get(secretKey)

        if (!credentialRef) {
          const { data: meta } = await postSecrets({
            body: { kind, label: resolvedNames[index] ?? p.name, secret: apiKey },
          })
          credentialRef = SecretCreateResponseSchema.parse(meta).id
          credentialRefs.set(secretKey, credentialRef)
        }

        const name = resolvedNames[index] ?? p.name
        const profileId = buildProfileId(name, `imported-${importBatchId}-${index}`)
        const config = kind === 'universal'
          ? { openaiBaseUrl, anthropicBaseUrl }
          : { baseUrl }
        await createProfile.mutateAsync({
          path: { id: profileId },
          body: {
            name,
            providerKind: kind,
            enabled: true,
            config,
            credentialRef,
          },
        })

        // Auto-populate custom models from endpoint template
        const template = matchProviderEndpoint(kind === 'universal' ? openaiBaseUrl : baseUrl)
        if (template && template.models.length > 0) {
          void patchProfilesByIdCustomModels({
            path: { id: profileId },
            body: { models: template.models },
            throwOnError: true,
          }).catch(error => console.error('[ImportProvider] custom models auto-config failed', error))
        }

        void warmManualProviderModelCache({
          id: profileId,
          name,
          providerKind: kind,
          config,
          credentialRef,
        })
          .then(() => queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY }))
          .catch(error => console.error('[ImportProvider] model cache warm failed', error))
      }
      onOpenChange(false)
      resetImportDraft()
      setImporting(false)
    }
    catch (err) {
      console.error('[ImportProvider]', err)
      setImporting(false)
    }
  }

  const handleClose = () => {
    if (importing) { return }
    resetImportDraft()
    onOpenChange(false)
  }

  const providerCount = hasProviders
    ? parseResult!.providers.filter((_, i) => {
      const kind = kinds[i] ?? 'openai-compatible'
      const hasEndpoint = kind === 'universal'
        ? !!openaiBaseUrls[i]?.trim() && !!anthropicBaseUrls[i]?.trim()
        : !!baseUrls[i]?.trim()
      return enabledSet.has(i) && !!apiKeys[i]?.trim() && hasEndpoint
    }).length
    : (token && manualUrl.trim() ? 1 : 0)
  const canImport = providerCount > 0
  const showManualV1Reminder = showManualEntry && shouldShowV1Reminder(manualUrl)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { handleClose() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Provider</DialogTitle>
          <DialogDescription>
            Paste a configuration snippet, keys and URLs are detected automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <textarea
            aria-label="Provider configuration snippet"
            value={text}
            onChange={e => handleTextChange(e.target.value)}
            placeholder={`token: sk-xxxxxxxx\nhttps://api.example.com/v1\nhttps://api.example.com/anthropic`}
            className={cn(
              'w-full rounded-lg border bg-muted/40 px-3 py-2.5 font-mono text-[12px] leading-relaxed',
              'placeholder:text-muted-foreground/50',
              'focus:outline-none focus:ring-2 focus:ring-ring/30',
              'min-h-[80px] resize-y',
            )}
          />

          {parseResult && (
            <>
              {/* Key indicator */}
              <div
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]',
                  token
                    ? 'bg-emerald-500/8 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/8 text-amber-600 dark:text-amber-400',
                )}
              >
                <KeyIcon className="size-3.5 shrink-0" />
                {token
? (
                  <>
                    <span className="flex-1 truncate font-mono text-[11px]">
                      {token.length > 48 ? `${token.slice(0, 24)}...${token.slice(-12)}` : token}
                    </span>
                  </>
                )
: (
                  <span>No API key detected.</span>
                )}
              </div>

              {/* Auto-detected providers */}
              {hasProviders && (
                <ScrollArea className="max-h-[260px]">
                  <div className="flex flex-col gap-2">
                    {parseResult.providers.map((p, i) => (
                      <ProviderCard
                        key={fingerprintProvider(p)}
                        resolvedName={resolvedNames[i] ?? p.name}
                        kind={kinds[i] ?? p.providerKind}
                        apiKey={apiKeys[i] ?? p.apiKey}
                        baseUrl={baseUrls[i] ?? p.baseUrl}
                        openaiBaseUrl={openaiBaseUrls[i] ?? universalEndpointDefaults(p.baseUrl).openaiBaseUrl}
                        anthropicBaseUrl={anthropicBaseUrls[i] ?? universalEndpointDefaults(p.baseUrl).anthropicBaseUrl}
                        enabled={enabledSet.has(i)}
                        onToggle={() => {
                          setEnabledSet((prev) => {
                            const next = new Set(prev)
                            if (next.has(i)) { next.delete(i) }
                            else { next.add(i) }
                            return next
                          })
                        }}
                        onKindChange={(k) => {
                          setKinds((prev) => {
                            const next = [...prev]
                            next[i] = k
                            return next
                          })
                          if (k === 'universal') {
                            const defaults = universalEndpointDefaults(baseUrls[i] ?? p.baseUrl)
                            setOpenaiBaseUrls(prev => prev.map((value, index) => index === i ? (value || defaults.openaiBaseUrl) : value))
                            setAnthropicBaseUrls(prev => prev.map((value, index) => index === i ? (value || defaults.anthropicBaseUrl) : value))
                          }
                        }}
                        onNameChange={(name) => {
                          setResolvedNames((prev) => {
                            const next = [...prev]
                            next[i] = name
                            return next
                          })
                        }}
                        onApiKeyChange={value => setApiKeys(prev => prev.map((entry, index) => index === i ? value : entry))}
                        onBaseUrlChange={value => setBaseUrls(prev => prev.map((entry, index) => index === i ? value : entry))}
                        onOpenaiBaseUrlChange={value => setOpenaiBaseUrls(prev => prev.map((entry, index) => index === i ? value : entry))}
                        onAnthropicBaseUrlChange={value => setAnthropicBaseUrls(prev => prev.map((entry, index) => index === i ? value : entry))}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}

              {/* Manual endpoint entry */}
              {showManualEntry && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Select value={manualKind} onValueChange={v => setManualKind(v as ApiProviderKind)}>
                      <SelectTrigger
                        className={cn(
                          'h-7 w-auto gap-1 rounded border-0 px-1.5 text-[10px] font-medium shrink-0',
                          {
                            'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400': manualKind === 'openai-compatible',
                            'bg-orange-500/10 text-orange-600 dark:text-orange-400': manualKind === 'anthropic',
                            'bg-violet-500/10 text-violet-600 dark:text-violet-400': manualKind === 'universal',
                          },
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KIND_OPTIONS.map(o => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex-1 flex items-center gap-1.5">
                      <GlobeIcon className="size-3.5 shrink-0 !text-muted-foreground" />
                      <Input
                        value={manualUrl}
                        onChange={e => setManualUrl(e.target.value)}
                        placeholder="https://api.example.com/v1"
                        className="h-8 flex-1 font-mono text-[12px]"
                      />
                    </div>
                  </div>
                  {showManualV1Reminder && <BaseUrlV1Reminder />}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={handleClose} disabled={importing}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleImport()}
            disabled={!canImport || importing}
          >
            {importing ? <Spinner className="size-3" /> : <DownloadIcon className="size-3" />}
            {importing ? 'Importing...' : `Import ${providerCount}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProviderCard({
  resolvedName,
  kind,
  apiKey,
  baseUrl,
  openaiBaseUrl,
  anthropicBaseUrl,
  enabled,
  onToggle,
  onKindChange,
  onNameChange,
  onApiKeyChange,
  onBaseUrlChange,
  onOpenaiBaseUrlChange,
  onAnthropicBaseUrlChange,
}: {
  resolvedName: string
  kind: ApiProviderKind
  apiKey: string
  baseUrl: string
  openaiBaseUrl: string
  anthropicBaseUrl: string
  enabled: boolean
  onToggle: () => void
  onKindChange: (k: ApiProviderKind) => void
  onNameChange: (name: string) => void
  onApiKeyChange: (value: string) => void
  onBaseUrlChange: (value: string) => void
  onOpenaiBaseUrlChange: (value: string) => void
  onAnthropicBaseUrlChange: (value: string) => void
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 transition-colors cursor-pointer',
        enabled
          ? 'border-foreground/10 bg-card'
          : 'border-foreground/5 bg-muted/20 opacity-60',
      )}
    >
      <Checkbox checked={enabled} onCheckedChange={onToggle} className="mt-0.5" />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Select value={kind} onValueChange={v => onKindChange(v as ApiProviderKind)}>
            <SelectTrigger
              className={cn(
                'h-6 w-auto gap-1 rounded border-0 px-1.5 text-[10px] font-medium shrink-0',
                {
                  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400': kind === 'openai-compatible',
                  'bg-orange-500/10 text-orange-600 dark:text-orange-400': kind === 'anthropic',
                  'bg-violet-500/10 text-violet-600 dark:text-violet-400': kind === 'universal',
                },
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={resolvedName}
            onChange={e => onNameChange(e.target.value)}
            className="h-6 flex-1 border-0 bg-transparent px-0 text-[13px] font-medium text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          {kind === 'universal'
            ? (
                <div className="flex flex-col gap-1.5">
                  <label className="flex flex-col gap-0.5">
                    <span className={IMPORT_FIELD_LABEL_CLASS}>OpenAI endpoint</span>
                    <Input value={openaiBaseUrl} onChange={event => onOpenaiBaseUrlChange(event.target.value)} placeholder="Usually ends in /v1" className={FLAT_IMPORT_FIELD_CLASS} />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className={IMPORT_FIELD_LABEL_CLASS}>Anthropic endpoint</span>
                    <Input value={anthropicBaseUrl} onChange={event => onAnthropicBaseUrlChange(event.target.value)} placeholder="Usually has no /v1" className={FLAT_IMPORT_FIELD_CLASS} />
                  </label>
                </div>
              )
            : (
                <label className="flex flex-col gap-0.5">
                  <span className={IMPORT_FIELD_LABEL_CLASS}>Endpoint</span>
                  <Input value={baseUrl} onChange={event => onBaseUrlChange(event.target.value)} placeholder="https://api.example.com/v1" className={FLAT_IMPORT_FIELD_CLASS} />
                </label>
              )}
          <label className="flex flex-col gap-0.5">
            <span className={IMPORT_FIELD_LABEL_CLASS}>API key</span>
            <Input type="password" value={apiKey} onChange={event => onApiKeyChange(event.target.value)} placeholder="Enter API key" className={FLAT_IMPORT_FIELD_CLASS} />
          </label>
          {kind !== 'universal' && shouldShowV1Reminder(baseUrl) && <BaseUrlV1Reminder />}
          {(() => {
            const template = matchProviderEndpoint(kind === 'universal' ? openaiBaseUrl : baseUrl)
            return template
              ? (
                  <div className="flex items-center gap-1.5 rounded-md bg-emerald-500/8 px-2 py-1 text-[11px] leading-snug text-emerald-700 dark:text-emerald-300">
                    <SparklesIcon className="size-3 shrink-0" />
                    <span>
{template.name}
{' '}
—
{' '}
{template.models.length}
{' '}
models will be auto-configured
                    </span>
                  </div>
                )
              : null
          })()}
        </div>
      </div>
    </div>
  )
}

function BaseUrlV1Reminder() {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-amber-500/8 px-2 py-1 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
      <CircleAlertIcon className="size-3 shrink-0" />
      <span>This Base URL does not include /v1. Did you forget to add it?</span>
    </div>
  )
}
