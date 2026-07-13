import {
  AlertLine as CircleAlertIcon,
  ArrowLeftLine as ArrowLeftIcon,
  CheckCircleLine as CircleCheckIcon,
  CheckLine as CheckIcon,
  CloseLine as XIcon,
  CopyLine as CopyIcon,
  EnterDoorLine as LogInIcon,
  RightSmallLine as ChevronRightIcon,
} from '@mingcute/react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, m } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import { postSecrets } from '~/api-gen/sdk.gen'
import { PROVIDER_ICONS } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { AGENT_MODELS_QUERY_KEY } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { cn } from '~/lib/cn'

import { SettingsDivider, SettingsRow } from '../settings/settings-row'
import { ChatgptCredentialSummary } from './chatgpt-credential-summary'
import {
  CLAUDE_AUTH_MODE_API_KEY,
  CLAUDE_AUTH_MODE_CLAUDE_AI,
  CLAUDE_AUTH_MODE_OPTIONS,
  claudeCredentialPlaceholder,
  normalizeClaudeAuthMode,
} from './claude-auth-modes'
import {
  CODEX_AUTH_MODE_API_KEY,
  CODEX_AUTH_MODE_BEDROCK_API_KEY,
  CODEX_AUTH_MODE_CHATGPT,
  CODEX_AUTH_MODE_OPTIONS,
  codexCredentialPlaceholder,
  codexSecretKindForAuthMode,
  normalizeCodexAuthMode,
} from './codex-auth-modes'
import { warmManualProviderModelCache } from './provider-model-cache'
import type { DraftProvider } from './provider-settings-utils'
import { buildProfileId } from './provider-settings-utils'
import type { ProviderPreset } from './provider-templates'
import { PROVIDER_PRESETS } from './provider-templates'
import type { ChatgptCredentialLoginStart } from './use-chatgpt-credential-login'
import {
  openChatgptCredentialLoginUrl,
  reserveChatgptCredentialLoginWindow,
  useChatgptCredentialLoginActions,
  useChatgptCredentialLoginStatus,
} from './use-chatgpt-credential-login'
import { useCredentialMetadata } from './use-credential-metadata'

interface PresetSetupFormValues {
  name: string
  values: Record<string, string>
}

const SecretCreateResponseSchema = z.object({
  id: z.string().min(1),
})

function universalEndpointDefaults(baseUrl: string): { openaiBaseUrl: string, anthropicBaseUrl: string } {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  const anthropicBaseUrl = trimmed.replace(/\/v1$/i, '')
  return {
    openaiBaseUrl: /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`,
    anthropicBaseUrl,
  }
}

export function DraftSetupPanel({
  draft,
  onSelectPreset,
  onComplete,
  onCancel,
}: {
  draft: DraftProvider
  onSelectPreset: (presetId: string) => void
  onComplete: (newProfileId?: string) => void
  onCancel: () => void
}) {
  const preset = PROVIDER_PRESETS.find(p => p.id === draft.presetId) ?? null

  if (!preset) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-heading text-[14px] font-medium text-foreground">
              Choose a provider
            </h4>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Cradle works with the major coding agents and any OpenAI-compatible endpoint.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <XIcon />
            Cancel
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {PROVIDER_PRESETS.map((p, idx) => {
            const Icon = PROVIDER_ICONS[p.id] ?? PROVIDER_ICONS.custom!
            return (
              <m.button
                key={p.id}
                type="button"
                onClick={() => onSelectPreset(p.id)}
                data-testid={`provider-preset-${p.id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: idx * 0.03, ease: 'easeOut' }}
                whileHover={{ y: -1 }}
                className={cn(
                  'group/preset relative flex flex-col gap-2 rounded-xl bg-card p-3.5 text-left',
                  'ring-1 ring-foreground/[0.07] transition-[box-shadow,ring-color] duration-150',
                  'hover:ring-foreground/15 hover:shadow-sm',
                  'active:scale-[0.97]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="size-5 shrink-0 text-foreground/70" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-foreground">{p.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{p.tagline}</div>
                  </div>
                  <ChevronRightIcon className="size-3.5 shrink-0 !text-muted-foreground/30 transition-[transform,color] duration-150 group-hover/preset:translate-x-0.5 group-hover/preset:!text-muted-foreground" />
                </div>
                <p className="text-pretty text-[11.5px] leading-relaxed text-muted-foreground/80">
                  {p.tagline}
                </p>
              </m.button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <PresetSetupForm
      key={preset.id}
      preset={preset}
      onComplete={onComplete}
      onBack={() => onSelectPreset('')}
    />
  )
}

function PresetSetupForm({
  preset,
  onComplete,
  onBack,
}: {
  preset: ProviderPreset
  onComplete: (newProfileId?: string) => void
  onBack: () => void
}) {
  const Icon = PROVIDER_ICONS[preset.id] ?? PROVIDER_ICONS.custom!
  const { createProfile } = useAgentProfiles()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean, text: string } | null>(null)
  const [chatgptLoginId, setChatgptLoginId] = useState<string | null>(null)
  const [activeChatgptLogin, setActiveChatgptLogin] = useState<ChatgptCredentialLoginStart | null>(null)
  const [chatgptCredentialRef, setChatgptCredentialRef] = useState<string | null>(null)
  const { startLogin, cancelLogin } = useChatgptCredentialLoginActions()
  const chatgptLoginStatus = useChatgptCredentialLoginStatus(chatgptLoginId)
  const chatgptCredentialMetadata = useCredentialMetadata(chatgptCredentialRef)

  const form = useForm<PresetSetupFormValues>({
    defaultValues: {
      name: preset.name,
      values: preset.providerKind === 'openai-compatible'
        ? { codexAuthMode: CODEX_AUTH_MODE_API_KEY }
        : preset.providerKind === 'anthropic'
          ? { claudeAuthMode: CLAUDE_AUTH_MODE_API_KEY }
          : {},
    },
  })
  const watchedValues = useWatch({ control: form.control }) as PresetSetupFormValues
  const name = watchedValues.name ?? ''
  const values = watchedValues.values ?? {}
  const isCodexProvider = preset.providerKind === 'openai-compatible'
  const isClaudeProvider = preset.providerKind === 'anthropic'
  const codexAuthMode = isCodexProvider
    ? normalizeCodexAuthMode(values.codexAuthMode)
    : CODEX_AUTH_MODE_API_KEY
  const claudeAuthMode = isClaudeProvider
    ? normalizeClaudeAuthMode(values.claudeAuthMode)
    : CLAUDE_AUTH_MODE_API_KEY
  const claudeAiLogin = isClaudeProvider && claudeAuthMode === CLAUDE_AUTH_MODE_CLAUDE_AI
  const profileId = buildProfileId(name, preset.id)
  const canSubmit = name.trim().length > 0

  // ── Auth method + credential field visibility ───────────────────────────
  // Mirrors ProfileDetailPanel: a Select for the auth mode, then only the
  // inputs the selected mode actually needs. Universal presets have no auth
  // mode choice and just take an endpoint + key.
  const hasAuthMethodChoice = isCodexProvider || isClaudeProvider
  const isChatgptMode = isCodexProvider && codexAuthMode === CODEX_AUTH_MODE_CHATGPT
  const isBedrockMode = isCodexProvider && codexAuthMode === CODEX_AUTH_MODE_BEDROCK_API_KEY
  const isUniversalPreset = !isCodexProvider && !isClaudeProvider
  // Endpoint is only meaningful when the method actually uses a custom base URL.
  const showEndpoint = isUniversalPreset
    || (isClaudeProvider && claudeAuthMode === CLAUDE_AUTH_MODE_API_KEY)
    || (isCodexProvider && codexAuthMode === CODEX_AUTH_MODE_API_KEY)
  const showKeyInput = !claudeAiLogin && !isChatgptMode
  const authModeOptions = isClaudeProvider ? CLAUDE_AUTH_MODE_OPTIONS : CODEX_AUTH_MODE_OPTIONS
  const selectedAuthMode = isClaudeProvider ? claudeAuthMode : codexAuthMode
  const keyPlaceholder = isCodexProvider
    ? codexCredentialPlaceholder(codexAuthMode, false)
    : isClaudeProvider
      ? claudeCredentialPlaceholder(false, claudeAuthMode)
      : (preset.fields.find(f => f.key === 'apiKey')?.placeholder ?? 'sk-...')
  const endpointPlaceholder = preset.fields.find(f => f.key === 'baseUrl')?.placeholder ?? 'https://api.example.com/v1'

  const handleAuthModeChange = (next: string) => {
    if (isClaudeProvider) {
      form.setValue('values.claudeAuthMode', next, { shouldDirty: true })
      if (next === CLAUDE_AUTH_MODE_CLAUDE_AI) {
        form.setValue('values.apiKey', '', { shouldDirty: true })
        form.setValue('values.baseUrl', '', { shouldDirty: true })
      }
      return
    }
    if (isCodexProvider) {
      form.setValue('values.codexAuthMode', next, { shouldDirty: true })
      if (next !== CODEX_AUTH_MODE_CHATGPT) {
        setChatgptCredentialRef(null)
        setChatgptLoginId(null)
        setActiveChatgptLogin(null)
      }
      if (next === CODEX_AUTH_MODE_CHATGPT) {
        form.setValue('values.apiKey', '', { shouldDirty: true })
        form.setValue('values.baseUrl', '', { shouldDirty: true })
      }
    }
  }

  useEffect(() => {
    const login = chatgptLoginStatus.data
    if (!login) {
      return
    }
    if (login.state === 'completed' && login.credentialRef) {
      setChatgptCredentialRef(login.credentialRef)
      form.setValue('values.codexAuthMode', CODEX_AUTH_MODE_CHATGPT, { shouldDirty: true })
      form.setValue('values.apiKey', '', { shouldDirty: true })
      form.setValue('values.baseUrl', '', { shouldDirty: true })
      setChatgptLoginId(null)
      setActiveChatgptLogin(null)
      setStatus({ ok: true, text: 'ChatGPT credential connected' })
    }
    if (login.state === 'failed') {
      setActiveChatgptLogin(null)
      setStatus({ ok: false, text: login.error ?? 'ChatGPT login failed' })
    }
  }, [chatgptLoginStatus.data, form])

  const handleChatgptLogin = async () => {
    const reservedWindow = reserveChatgptCredentialLoginWindow()
    try {
      const login = await startLogin.mutateAsync(`${name.trim() || preset.name} ChatGPT`)
      setChatgptLoginId(login.loginId)
      setActiveChatgptLogin(login)
      await navigator.clipboard?.writeText(login.userCode).catch(() => undefined)
      await openChatgptCredentialLoginUrl(login.verificationUrl, reservedWindow)
      setStatus({ ok: true, text: 'ChatGPT login opened. Device code copied.' })
    }
    catch (error) {
      reservedWindow?.close()
      setStatus({ ok: false, text: error instanceof Error ? error.message : 'ChatGPT login failed' })
    }
  }

  const handleCancelChatgptLogin = async () => {
    if (!chatgptLoginId) {
      return
    }
    await cancelLogin.mutateAsync(chatgptLoginId).catch(() => undefined)
    setChatgptLoginId(null)
    setActiveChatgptLogin(null)
  }

  const handleConnect = async () => {
    const currentValues = form.getValues()
    setStatus(null)

    const requiresApiKey = preset.fields.some(f => f.key === 'apiKey')
    const credentialValue = currentValues.values.apiKey?.trim() ?? ''
    const bedrockRegion = currentValues.values.bedrockRegion?.trim() ?? ''
    const selectedCodexAuthMode = isCodexProvider
      ? normalizeCodexAuthMode(currentValues.values.codexAuthMode)
      : CODEX_AUTH_MODE_API_KEY
    const selectedClaudeAuthMode = isClaudeProvider
      ? normalizeClaudeAuthMode(currentValues.values.claudeAuthMode)
      : CLAUDE_AUTH_MODE_API_KEY
    if (isUniversalPreset) {
      const openaiBaseUrl = currentValues.values.openaiBaseUrl?.trim() ?? ''
      const anthropicBaseUrl = currentValues.values.anthropicBaseUrl?.trim() ?? ''
      if (!openaiBaseUrl || !anthropicBaseUrl) {
        setStatus({ ok: false, text: 'Both OpenAI and Anthropic endpoints are required' })
        return
      }
    }
    if (requiresApiKey) {
      if (isCodexProvider) {
        if (selectedCodexAuthMode === CODEX_AUTH_MODE_CHATGPT && !chatgptCredentialRef) {
          setStatus({ ok: false, text: 'Credential is required' })
          return
        }
        if (selectedCodexAuthMode !== CODEX_AUTH_MODE_CHATGPT && !credentialValue) {
          setStatus({ ok: false, text: 'Credential is required' })
          return
        }
        if (selectedCodexAuthMode === CODEX_AUTH_MODE_BEDROCK_API_KEY && !bedrockRegion) {
          setStatus({ ok: false, text: 'Bedrock region is required' })
          return
        }
      }
      else if (isClaudeProvider && selectedClaudeAuthMode === CLAUDE_AUTH_MODE_CLAUDE_AI) {
        // Claude.ai subscription login needs no API key.
      }
      else if (!credentialValue) {
        setStatus({ ok: false, text: 'Credential is required' })
        return
      }
    }

    setBusy(true)
    try {
      let credentialRef: string | null = selectedCodexAuthMode === CODEX_AUTH_MODE_CHATGPT
        ? chatgptCredentialRef
        : null
      if (credentialValue && selectedCodexAuthMode !== CODEX_AUTH_MODE_CHATGPT) {
        const { data: meta } = await postSecrets({
          body: {
            kind: isCodexProvider
              ? codexSecretKindForAuthMode(selectedCodexAuthMode, preset.providerKind)
              : preset.providerKind,
            label: currentValues.name,
            secret: credentialValue,
          },
        })
        credentialRef = SecretCreateResponseSchema.parse(meta).id
      }

      const config: Record<string, unknown> = { ...preset.defaults }
      if (isCodexProvider) {
        config.authMode = selectedCodexAuthMode
        if (selectedCodexAuthMode === CODEX_AUTH_MODE_API_KEY) {
          config.baseUrl = currentValues.values.baseUrl ?? ''
        }
        else {
          config.baseUrl = ''
        }
        if (selectedCodexAuthMode === CODEX_AUTH_MODE_BEDROCK_API_KEY) {
          config.bedrock = { region: bedrockRegion }
        }
      }
      else if (isClaudeProvider) {
        config.authMode = selectedClaudeAuthMode
        config.baseUrl = selectedClaudeAuthMode === CLAUDE_AUTH_MODE_CLAUDE_AI
          ? ''
          : (currentValues.values.baseUrl ?? '')
      }
      else {
        const baseUrl = currentValues.values.baseUrl ?? ''
        const defaults = universalEndpointDefaults(baseUrl)
        config.openaiBaseUrl = currentValues.values.openaiBaseUrl?.trim() || defaults.openaiBaseUrl
        config.anthropicBaseUrl = currentValues.values.anthropicBaseUrl?.trim() || defaults.anthropicBaseUrl
      }
      if (currentValues.values.model) {
        config.model = currentValues.values.model
      }

      await createProfile.mutateAsync({
        path: { id: profileId },
        body: {
          name: currentValues.name,
          providerKind: preset.providerKind,
          enabled: true,
          config,
          credentialRef,
        },
      })

      void warmManualProviderModelCache({
        id: profileId,
        name: currentValues.name,
        providerKind: preset.providerKind,
        config,
        credentialRef,
      })
        .then(() => queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY }))
        .catch(error => console.error('[ProviderSetup] model cache warm failed', error))
      setStatus({ ok: true, text: 'Saved' })
      setTimeout(onComplete, 500, profileId)
    }
    catch (err) {
      setStatus({ ok: false, text: 'Failed to save provider' })
      console.error('[ProviderSetup]', err)
    }
    finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          aria-label="Back to templates"
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <Icon className="size-6 shrink-0 text-foreground/80" />
        <div className="min-w-0 flex-1">
          <h4 className="font-heading text-[15px] font-medium text-foreground">{preset.name}</h4>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{preset.tagline}</p>
        </div>
      </div>

      <Separator className="bg-foreground/6" />

      {/* Form */}
      <div className="flex flex-col">
        <SettingsRow
          label="Display name"
          description="This is how the provider shows up in chat and agent settings."
        >
          <Input
            data-testid="provider-name"
            {...form.register('name')}
            placeholder={preset.name}
            className="h-9 w-56 text-[13px]"
          />
        </SettingsRow>

        {isUniversalPreset
          ? (
              <>
                <SettingsDivider />
                <SettingsRow label="Endpoints" description="OpenAI normally uses /v1; Anthropic normally does not." vertical>
                  <div className="flex w-full max-w-[28rem] flex-col gap-2">
                    <Input
                      data-testid="provider-openai-baseurl"
                      value={values.openaiBaseUrl ?? ''}
                      onChange={(event) => {
                        const nextOpenaiBaseUrl = event.target.value
                        form.setValue('values.openaiBaseUrl', nextOpenaiBaseUrl, { shouldDirty: true })
                        if (!values.anthropicBaseUrl) {
                          form.setValue('values.anthropicBaseUrl', universalEndpointDefaults(nextOpenaiBaseUrl).anthropicBaseUrl, { shouldDirty: true })
                        }
                      }}
                      placeholder="OpenAI endpoint, e.g. https://api.example.com/v1"
                      className="h-9 text-[12.5px] font-mono"
                    />
                    <Input
                      data-testid="provider-anthropic-baseurl"
                      value={values.anthropicBaseUrl ?? ''}
                      onChange={event => form.setValue('values.anthropicBaseUrl', event.target.value, { shouldDirty: true })}
                      placeholder="Anthropic endpoint, e.g. https://api.example.com"
                      className="h-9 text-[12.5px] font-mono"
                    />
                  </div>
                </SettingsRow>
              </>
            )
          : showEndpoint && (
          <>
            <SettingsDivider />
            <SettingsRow label="Endpoint" description="Base URL for the API">
              <Input
                data-testid="provider-baseurl"
                value={values.baseUrl ?? ''}
                onChange={e =>
                  form.setValue('values.baseUrl', e.target.value, { shouldDirty: true })}
                placeholder={endpointPlaceholder}
                className="h-9 w-56 text-[12.5px] font-mono"
              />
            </SettingsRow>
          </>
        )}

        <SettingsDivider />
        <SettingsRow
          label={hasAuthMethodChoice ? 'Authentication' : 'Credentials'}
          description={
            hasAuthMethodChoice
              ? (isClaudeProvider
                  ? 'How this provider authenticates to Claude.'
                  : 'How this provider signs in to Codex.')
              : 'Stored locally and encrypted.'
          }
          vertical
        >
          <div className="flex w-full max-w-[28rem] flex-col gap-2">
            {hasAuthMethodChoice && (
              <Select
                value={selectedAuthMode}
                onValueChange={handleAuthModeChange}
              >
                <SelectTrigger className="h-9 w-56 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {authModeOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {claudeAiLogin && (
              <InfoCallout>
                Uses your Claude.ai subscription login. No API key needed — the Claude Agent SDK manages login state in its own config directory.
              </InfoCallout>
            )}

            {isChatgptMode && chatgptCredentialMetadata.data && (
              <ChatgptCredentialSummary credential={chatgptCredentialMetadata.data} />
            )}

            {showKeyInput && (
              <Input
                data-testid="provider-apikey"
                type="password"
                value={values.apiKey ?? ''}
                onChange={(e) => {
                  setChatgptCredentialRef(null)
                  form.setValue('values.apiKey', e.target.value, { shouldDirty: true })
                }}
                placeholder={keyPlaceholder}
                className="h-9 text-[12.5px] font-mono"
              />
            )}

            {isBedrockMode && (
              <Input
                data-testid="provider-bedrock-region"
                value={values.bedrockRegion ?? ''}
                onChange={e =>
                  form.setValue('values.bedrockRegion', e.target.value, { shouldDirty: true })}
                placeholder="us-east-1"
                className="h-9 w-56 text-[12.5px] font-mono"
              />
            )}

            {isChatgptMode && (
              <div className="flex flex-wrap items-center gap-2">
                {chatgptLoginId
                  ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => void handleCancelChatgptLogin()}
                      >
                        <XIcon className="size-3" />
                        Cancel ChatGPT login
                      </Button>
                    )
                  : (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => void handleChatgptLogin()}
                        disabled={startLogin.isPending}
                      >
                        {startLogin.isPending ? <Spinner className="size-3" /> : <LogInIcon className="size-3" />}
                        Sign in with ChatGPT
                      </Button>
                    )}
              </div>
            )}
            {isChatgptMode && activeChatgptLogin && (
              <ChatgptDeviceCodeNotice login={activeChatgptLogin} />
            )}

            {preset.fields.length === 0 && (
              <InfoCallout>
                No credentials needed: this provider runs on your machine.
              </InfoCallout>
            )}
          </div>
        </SettingsRow>
      </div>

      {/* Status */}
      <AnimatePresence>
        {status && (
          <m.div
            data-testid="provider-status"
            data-status-ok={status.ok ? 'true' : 'false'}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium ring-1',
              status.ok
                ? 'bg-emerald-500/8 text-emerald-600 ring-emerald-500/15 dark:text-emerald-400'
                : 'bg-destructive/8 text-destructive ring-destructive/15',
            )}
          >
            {status.ok
              ? <CircleCheckIcon className="size-3.5" />
              : <CircleAlertIcon className="size-3.5" />}
            {status.text}
          </m.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          data-testid="provider-submit"
          size="sm"
          onClick={() => void handleConnect()}
          disabled={busy || !canSubmit}
        >
          {busy ? <Spinner className="size-3" /> : <CheckIcon />}
          {busy ? 'Saving...' : 'Save provider'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  )
}

function InfoCallout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground ring-1 ring-foreground/4">
      {children}
    </div>
  )
}

function ChatgptDeviceCodeNotice({ login }: { login: ChatgptCredentialLoginStart }) {
  const copyCode = () => {
    void navigator.clipboard?.writeText(login.userCode).catch(() => undefined)
  }

  return (
    <div className="rounded-md border border-foreground/8 bg-muted/35 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">Device code</span>
        <Button type="button" size="xs" variant="ghost" className="h-6 px-1.5" onClick={copyCode}>
          <CopyIcon className="size-3" />
          Copy
        </Button>
      </div>
      <div className="mt-1 font-mono text-[18px] font-semibold tracking-normal text-foreground">
        {login.userCode}
      </div>
      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Enter this code on the OpenAI Codex authorization page.
      </div>
    </div>
  )
}
