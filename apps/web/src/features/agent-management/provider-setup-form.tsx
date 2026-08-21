import {
  AlertLine as CircleAlertIcon,
  CheckCircleLine as CircleCheckIcon,
  CheckLine as CheckIcon,
  CloseLine as XIcon,
  CopyLine as CopyIcon,
  EnterDoorLine as LogInIcon,
} from '@mingcute/react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, m } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { getProviderTargetsByProviderTargetIdTestQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { postProviderTargetsByProviderTargetIdTest, postSecrets } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { AGENT_MODELS_QUERY_KEY } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { cn } from '~/lib/cn'

import { ChatgptCredentialSummary } from './chatgpt-credential-summary'
import {
  CLAUDE_AUTH_MODE_API_KEY,
  CLAUDE_AUTH_MODE_CLAUDE_AI,
  claudeCredentialPlaceholder,
  normalizeClaudeAuthMode,
} from './claude-auth-modes'
import {
  CODEX_AUTH_MODE_API_KEY,
  CODEX_AUTH_MODE_BEDROCK_API_KEY,
  CODEX_AUTH_MODE_CHATGPT,
  codexCredentialPlaceholder,
  codexSecretKindForAuthMode,
  normalizeCodexAuthMode,
} from './codex-auth-modes'
import { warmManualProviderModelCache } from './provider-model-cache'
import { buildProfileId } from './provider-settings-utils'
import type { ProviderPreset } from './provider-templates'
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

/**
 * Stacked form field — label and supporting copy sit above a full-width
 * control, replacing the cramped label-left/control-right settings row.
 * Shared by the setup form and the profile detail panel.
 */
export function SetupField({ label, hint, children }: { label: string, hint?: string, children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12.5px] font-medium text-foreground">{label}</span>
        {hint && <p className="text-[11.5px] leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

/**
 * Vercel-style segmented picker. The active segment pill slides between
 * options via a shared layout animation. Used for auth-mode and provider-kind
 * choices across the setup form and the profile detail panel.
 */
export function AuthModeSegmented({
  options,
  value,
  onChange,
  disabled = false,
  testIdPrefix = 'provider-auth-mode',
}: {
  options: readonly { value: string, label: string }[]
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  testIdPrefix?: string
}) {
  const pillId = useId()
  return (
    <div
      role="radiogroup"
      aria-label="Authentication method"
      className="inline-flex items-center gap-0.5 self-start rounded-lg bg-muted/70 p-0.5 ring-1 ring-foreground/[0.06] ring-inset"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            data-testid={`${testIdPrefix}-${option.value}`}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative rounded-md px-3 py-1.5 text-[12px] font-medium outline-none transition-colors duration-150',
              'focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/85',
            )}
          >
            {active && (
              <m.span
                layoutId={`auth-mode-pill-${pillId}`}
                transition={{ type: 'spring', bounce: 0.18, duration: 0.45 }}
                className="absolute inset-0 rounded-md bg-background shadow-sm ring-1 ring-foreground/[0.08]"
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Credential/setup form for a chosen preset. Owns its scroll region and a
 * pinned footer so status messages and actions never shift the layout; in an
 * auto-height host (onboarding) everything simply flows in natural order.
 */
export function ProviderSetupForm({
  preset,
  onComplete,
}: {
  preset: ProviderPreset
  onComplete: (newProfileId?: string) => void
}) {
  const { t } = useTranslation('agentManagement')
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
      values: {
        authMethodId: preset.authMethods[0]?.id ?? 'apiKey',
        ...(typeof preset.defaults.baseUrl === 'string' && preset.defaults.baseUrl
          ? { baseUrl: preset.defaults.baseUrl }
          : {}),
        ...(typeof preset.defaults.openaiBaseUrl === 'string'
          ? { openaiBaseUrl: preset.defaults.openaiBaseUrl }
          : {}),
        ...(typeof preset.defaults.anthropicBaseUrl === 'string'
          ? { anthropicBaseUrl: preset.defaults.anthropicBaseUrl }
          : {}),
      },
    },
  })
  const watchedValues = useWatch({ control: form.control }) as PresetSetupFormValues
  const name = watchedValues.name ?? ''
  const values = watchedValues.values ?? {}
  const providerId = preset.providerId ?? preset.id
  const authMethods = preset.authMethods.length > 0
    ? preset.authMethods
    : [{ id: 'apiKey', label: 'API Key' }]
  const selectedAuthMethodId = values.authMethodId ?? authMethods[0]!.id
  const isOpenAiProvider = providerId === 'openai'
  const isClaudeProvider = providerId === 'anthropic'
  const isDualEndpoint = (preset.endpointProfiles?.length ?? 0) >= 2
    || preset.providerKind === 'universal'
  const codexAuthMode = isOpenAiProvider
    ? normalizeCodexAuthMode(selectedAuthMethodId)
    : CODEX_AUTH_MODE_API_KEY
  const claudeAuthMode = isClaudeProvider
    ? normalizeClaudeAuthMode(selectedAuthMethodId)
    : CLAUDE_AUTH_MODE_API_KEY
  const claudeAiLogin = isClaudeProvider && claudeAuthMode === CLAUDE_AUTH_MODE_CLAUDE_AI
  const profileId = buildProfileId(name, preset.id)
  const canSubmit = name.trim().length > 0

  // ── Auth method + credential field visibility ───────────────────────────
  const hasAuthMethodChoice = authMethods.length > 1
  const isChatgptMode = isOpenAiProvider && codexAuthMode === CODEX_AUTH_MODE_CHATGPT
  const isBedrockMode = isOpenAiProvider && codexAuthMode === CODEX_AUTH_MODE_BEDROCK_API_KEY
  const showDualEndpoints = isDualEndpoint && !isChatgptMode && !claudeAiLogin
  const showEndpoint = !showDualEndpoints
    && (
      (isClaudeProvider && claudeAuthMode === CLAUDE_AUTH_MODE_API_KEY)
      || (isOpenAiProvider && codexAuthMode === CODEX_AUTH_MODE_API_KEY)
      || (!isOpenAiProvider && !isClaudeProvider && !isDualEndpoint)
    )
  const showKeyInput = !claudeAiLogin && !isChatgptMode && preset.fields.some(f => f.key === 'apiKey')
  const authModeOptions = authMethods.map(m => ({ value: m.id, label: m.label }))
  const selectedAuthMode = selectedAuthMethodId
  const keyPlaceholder = isOpenAiProvider
    ? codexCredentialPlaceholder(codexAuthMode, false)
    : isClaudeProvider
      ? claudeCredentialPlaceholder(false, claudeAuthMode)
      : (preset.fields.find(f => f.key === 'apiKey')?.placeholder ?? 'sk-...')
  const endpointPlaceholder = preset.fields.find(f => f.key === 'baseUrl')?.placeholder ?? 'https://api.example.com/v1'
  const authHint = !hasAuthMethodChoice
    ? 'Stored locally and encrypted.'
    : isClaudeProvider
      ? 'How this provider authenticates to Claude.'
      : isOpenAiProvider
        ? 'How this provider signs in to Codex.'
        : 'How you authenticate with this provider.'

  const handleAuthModeChange = (next: string) => {
    form.setValue('values.authMethodId', next, { shouldDirty: true })
    if (isClaudeProvider) {
      if (next === CLAUDE_AUTH_MODE_CLAUDE_AI) {
        form.setValue('values.apiKey', '', { shouldDirty: true })
        form.setValue('values.baseUrl', '', { shouldDirty: true })
      }
      return
    }
    if (isOpenAiProvider) {
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
      form.setValue('values.authMethodId', CODEX_AUTH_MODE_CHATGPT, { shouldDirty: true })
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
    const selectedAuthId = currentValues.values.authMethodId ?? authMethods[0]!.id
    const selectedCodexAuthMode = isOpenAiProvider
      ? normalizeCodexAuthMode(selectedAuthId)
      : CODEX_AUTH_MODE_API_KEY
    const selectedClaudeAuthMode = isClaudeProvider
      ? normalizeClaudeAuthMode(selectedAuthId)
      : CLAUDE_AUTH_MODE_API_KEY
    if (isDualEndpoint) {
      const openaiBaseUrl = currentValues.values.openaiBaseUrl?.trim() ?? ''
      const anthropicBaseUrl = currentValues.values.anthropicBaseUrl?.trim() ?? ''
      if (!openaiBaseUrl || !anthropicBaseUrl) {
        setStatus({ ok: false, text: 'Both OpenAI and Anthropic endpoints are required' })
        return
      }
    }
    if (requiresApiKey) {
      if (isOpenAiProvider) {
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
            kind: isOpenAiProvider
              ? codexSecretKindForAuthMode(selectedCodexAuthMode, preset.providerKind)
              : preset.providerKind,
            label: currentValues.name,
            secret: credentialValue,
          },
        })
        credentialRef = SecretCreateResponseSchema.parse(meta).id
      }

      const config: Record<string, unknown> = { ...preset.defaults }
      if (isOpenAiProvider) {
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
      else if (isDualEndpoint) {
        const openaiBaseUrl = currentValues.values.openaiBaseUrl?.trim() ?? ''
        const anthropicBaseUrl = currentValues.values.anthropicBaseUrl?.trim() ?? ''
        config.openaiBaseUrl = openaiBaseUrl
        config.anthropicBaseUrl = anthropicBaseUrl
        config.baseUrl = openaiBaseUrl || anthropicBaseUrl
      }
      else {
        config.baseUrl = currentValues.values.baseUrl ?? ''
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
          providerId,
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

      // Close the add-and-verify loop: run the connection test right away so
      // the user sees a working provider (or a precise failure) before leaving.
      try {
        const { data: testResult } = await postProviderTargetsByProviderTargetIdTest({
          path: { providerTargetId: profileId },
          body: {},
        })
        if (testResult) {
          queryClient.setQueryData(
            getProviderTargetsByProviderTargetIdTestQueryKey({ path: { providerTargetId: profileId } }),
            testResult,
          )
          setStatus(testResult.status === 'ok'
            ? { ok: true, text: `Saved — connected in ${testResult.latencyMs}ms` }
            : { ok: false, text: `Saved, but the connection test failed: ${testResult.detail ?? testResult.status}` })
        }
      }
      catch {
        setStatus({ ok: true, text: 'Saved' })
      }
      setTimeout(onComplete, 900, profileId)
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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Fields */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
        <SetupField
          label="Display name"
          hint="This is how the provider shows up in chat and agent settings."
        >
          <Input
            data-testid="provider-name"
            {...form.register('name')}
            placeholder={preset.name}
            className="h-9 w-full text-[13px]"
          />
        </SetupField>

        {showDualEndpoints
          ? (
              <SetupField label="Endpoints" hint="OpenAI-compatible and Anthropic-compatible base URLs.">
                <div className="flex flex-col gap-2">
                  <Input
                    data-testid="provider-openai-baseurl"
                    value={values.openaiBaseUrl ?? ''}
                    onChange={(event) => {
                      const nextOpenaiBaseUrl = event.target.value
                      form.setValue('values.openaiBaseUrl', nextOpenaiBaseUrl, { shouldDirty: true })
                      if (!values.anthropicBaseUrl && providerId === 'universal') {
                        form.setValue('values.anthropicBaseUrl', universalEndpointDefaults(nextOpenaiBaseUrl).anthropicBaseUrl, { shouldDirty: true })
                      }
                    }}
                    placeholder="OpenAI endpoint, e.g. https://api.example.com/v1"
                    className="h-9 w-full text-[12.5px] font-mono"
                  />
                  <Input
                    data-testid="provider-anthropic-baseurl"
                    value={values.anthropicBaseUrl ?? ''}
                    onChange={event => form.setValue('values.anthropicBaseUrl', event.target.value, { shouldDirty: true })}
                    placeholder="Anthropic endpoint, e.g. https://api.example.com/anthropic"
                    className="h-9 w-full text-[12.5px] font-mono"
                  />
                </div>
              </SetupField>
            )
          : showEndpoint && (
            <SetupField label="Endpoint" hint="Base URL for the API.">
              <Input
                data-testid="provider-baseurl"
                value={values.baseUrl ?? ''}
                onChange={e =>
                  form.setValue('values.baseUrl', e.target.value, { shouldDirty: true })}
                placeholder={endpointPlaceholder}
                className="h-9 w-full text-[12.5px] font-mono"
              />
            </SetupField>
          )}

        <SetupField
          label={hasAuthMethodChoice ? 'Authentication' : 'Credentials'}
          hint={authHint}
        >
          <div className="flex flex-col gap-3">
            {hasAuthMethodChoice && (
              <AuthModeSegmented
                options={authModeOptions}
                value={selectedAuthMode}
                onChange={handleAuthModeChange}
              />
            )}

            {/* Mode-specific fields swap with a quick crossfade so the form
                never jumps when the auth method changes. */}
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={selectedAuthMode}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                className="flex flex-col gap-3"
              >
                {claudeAiLogin && (
                  <InfoCallout>
                    {t('detail.claudeAgent.subscriptionLoginNotice')}
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
                    className="h-9 w-full text-[12.5px] font-mono"
                  />
                )}

                {isBedrockMode && (
                  <Input
                    data-testid="provider-bedrock-region"
                    value={values.bedrockRegion ?? ''}
                    onChange={e =>
                      form.setValue('values.bedrockRegion', e.target.value, { shouldDirty: true })}
                    placeholder="us-east-1"
                    className="h-9 w-full text-[12.5px] font-mono"
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
              </m.div>
            </AnimatePresence>
          </div>
        </SetupField>
      </div>

      {/* Pinned footer: status has a reserved slot, actions never move. */}
      <div className="flex shrink-0 items-center gap-3 border-t border-border/60 bg-muted/30 px-5 py-3">
        <div className="min-w-0 flex-1">
          <AnimatePresence>
            {status && (
              <m.p
                data-testid="provider-status"
                data-status-ok={status.ok ? 'true' : 'false'}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className={cn(
                  'flex items-center gap-1.5 truncate text-[12px] font-medium',
                  status.ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-destructive',
                )}
              >
                {status.ok
                  ? <CircleCheckIcon className="size-3.5 shrink-0" />
                  : <CircleAlertIcon className="size-3.5 shrink-0" />}
                <span className="truncate">{status.text}</span>
              </m.p>
            )}
          </AnimatePresence>
        </div>
        <Button
          data-testid="provider-submit"
          size="sm"
          onClick={() => void handleConnect()}
          disabled={busy || !canSubmit}
        >
          {busy ? <Spinner className="size-3" /> : <CheckIcon />}
          {busy ? 'Saving...' : 'Save provider'}
        </Button>
      </div>
    </div>
  )
}

export function InfoCallout({ children }: { children: ReactNode }) {
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
