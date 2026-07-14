import {
  AlertLine as CircleAlertIcon,
  CheckLine as CheckIcon,
  CloseLine as XIcon,
  CopyLine as CopyIcon,
  DeleteLine as Trash2Icon,
  EnterDoorLine as LogInIcon,
} from '@mingcute/react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, m } from 'motion/react'
import type { MutableRefObject, ReactNode } from 'react'
import { useCallback, useEffect, useEffectEvent, useReducer, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import {
  getProvidersTargetsByProviderTargetIdModelsCacheOptions,
  getProviderTargetsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import {
  patchProfilesByIdIcon,
  postProvidersModels,
  postSecrets,
  postSecretsByIdReveal,
  putProfilesById,
} from '~/api-gen/sdk.gen'
import { ProviderIcon } from '~/components/common/provider-icons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { IconPicker } from '~/components/ui/icon-picker'
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
import { Switch } from '~/components/ui/switch'
import { toastManager } from '~/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import type { ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import {
  DEFAULT_CLAUDE_AGENT_ALIASES,
  readClaudeAgentModelAliases,
  writeClaudeAgentModelAliases,
} from '~/features/agent-runtime/claude-agent-config'
import { ProfileConfigJsonSchema } from '~/features/agent-runtime/profile-config-schema'
import type { AgentProfile, ApiProviderKind, ModelDescriptor, ProviderTarget } from '~/features/agent-runtime/types'
import { AGENT_MODELS_QUERY_KEY } from '~/features/agent-runtime/use-agent-models'
import { apiErrorMessage } from '~/lib/api-error'
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
import { ClaudeModelMatrixEditor } from './claude-model-matrix-editor'
import { CodexAccountDiagnosticsPanel } from './codex-account-diagnostics-panel'
import {
  CODEX_AUTH_MODE_API_KEY,
  CODEX_AUTH_MODE_BEDROCK_API_KEY,
  CODEX_AUTH_MODE_CHATGPT,
  CODEX_AUTH_MODE_OPTIONS,
  codexAuthModeFromCredentialKind,
  codexCredentialPlaceholder,
  codexSecretKindForAuthMode,
  normalizeCodexAuthMode,
} from './codex-auth-modes'
import { CustomModelsEditor } from './custom-models-editor'
import { ModelsPanel } from './models-panel'
import {
  ALL_DISABLED_SENTINEL,
  presetForProviderKind,
  PROVIDER_KIND_LABELS,
} from './provider-settings-utils'
import type { EditableCustomModel } from './provider-target-model-settings'
import {
  CustomModelsJsonSchema,
  enabledModelsFromConfig,
  loadProviderTargetModelSettings,
  updateProviderTargetCustomModels,
  updateProviderTargetModelVisibility,
} from './provider-target-model-settings'
import type { ChatgptCredentialLoginStart } from './use-chatgpt-credential-login'
import {
  openChatgptCredentialLoginUrl,
  reserveChatgptCredentialLoginWindow,
  useChatgptCredentialLoginActions,
  useChatgptCredentialLoginStatus,
} from './use-chatgpt-credential-login'
import type { CredentialMetadata } from './use-credential-metadata'
import { isChatgptCredentialMetadata, useCredentialMetadata } from './use-credential-metadata'

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
type ProfileTextField = 'name' | 'apiKey' | 'baseUrl' | 'openaiBaseUrl' | 'anthropicBaseUrl' | 'api' | 'authMode' | 'bedrockRegion'

interface BuildProfileConfigOptions {
  codexAuthMode?: string | null
}

interface CustomModelsState {
  customModelsJson: string
  models: EditableCustomModel[]
}

interface ProfileDetailFormValues {
  name: string
  apiKey: string
  providerKind: ApiProviderKind
  baseUrl: string
  openaiBaseUrl: string
  anthropicBaseUrl: string
  model: string
  api: string
  authMode: string
  bedrockRegion: string
  claudeAgentAliases: ClaudeAgentModelAliases
  enabledModels: string[]
}

interface ProfileDetailUiState {
  availableModels: ModelDescriptor[]
  modelsLoading: boolean
  modelsCachedAt: number | null
  saveState: SaveState
  confirmRemove: boolean
}

interface ChatgptLoginState {
  loginId: string | null
  activeLogin: ChatgptCredentialLoginStart | null
}

const SecretCreateResponseSchema = z.object({
  id: z.string().min(1),
})

type ProfileDetailUiAction
  = | { type: 'reset' }
    | { type: 'models/loading' }
    | { type: 'models/loaded', models: ModelDescriptor[], cachedAt?: number | null }
    | { type: 'models/failed' }
    | { type: 'models/update-one', model: ModelDescriptor }
    | { type: 'save/set', state: SaveState }
    | { type: 'remove/set', open: boolean }

type ChatgptLoginAction
  = | { type: 'start', login: ChatgptCredentialLoginStart }
    | { type: 'clear' }

const INITIAL_UI_STATE: ProfileDetailUiState = {
  availableModels: [],
  modelsLoading: false,
  modelsCachedAt: null,
  saveState: 'idle',
  confirmRemove: false,
}

const INITIAL_CHATGPT_LOGIN_STATE: ChatgptLoginState = {
  loginId: null,
  activeLogin: null,
}

const EMPTY_ENABLED_MODELS: string[] = []

const ModelDescriptorSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerKind: z.enum(['openai-compatible', 'anthropic', 'universal']),
  capabilities: z
    .object({
      contextWindow: z.number().optional(),
    })
    .passthrough()
    .default({}),
})

const ModelDescriptorListSchema = z.array(ModelDescriptorSchema).default([])

const ProviderModelsCacheSchema = z
  .object({
    models: ModelDescriptorListSchema,
    cached: z.boolean(),
    stale: z.boolean(),
  })
  .nullable()

function profileDetailUiReducer(
  state: ProfileDetailUiState,
  action: ProfileDetailUiAction,
): ProfileDetailUiState {
  switch (action.type) {
    case 'reset':
      return INITIAL_UI_STATE
    case 'models/loading':
      return { ...state, modelsLoading: true }
    case 'models/loaded':
      return {
        ...state,
        availableModels: action.models,
        modelsLoading: false,
        modelsCachedAt: 'cachedAt' in action ? (action.cachedAt ?? null) : Date.now(),
      }
    case 'models/failed':
      return { ...state, availableModels: [], modelsLoading: false }
    case 'models/update-one':
      return {
        ...state,
        availableModels: state.availableModels.map(model =>
          model.id === action.model.id ? action.model : model),
      }
    case 'save/set':
      return { ...state, saveState: action.state }
    case 'remove/set':
      return { ...state, confirmRemove: action.open }
    default:
      return state
  }
}

function chatgptLoginReducer(
  state: ChatgptLoginState,
  action: ChatgptLoginAction,
): ChatgptLoginState {
  switch (action.type) {
    case 'start':
      return {
        loginId: action.login.loginId,
        activeLogin: action.login,
      }
    case 'clear':
      return INITIAL_CHATGPT_LOGIN_STATE
    default:
      return state
  }
}

function getInitialEnabledModels(enabledModels: string[]): string[] {
  return enabledModels
}

function getProfileFormValues(
  profile: AgentProfile,
): ProfileDetailFormValues {
  const config = ProfileConfigJsonSchema.parse(profile.configJson)
  return {
    name: profile.name,
    apiKey: '',
    providerKind: profile.providerKind,
    baseUrl: config.baseUrl,
    openaiBaseUrl: config.openaiBaseUrl || config.baseUrl,
    anthropicBaseUrl: config.anthropicBaseUrl || config.baseUrl,
    model: config.model,
    api: config.api,
    authMode: profile.providerKind === 'anthropic'
      ? normalizeClaudeAuthMode(config.authMode)
      : normalizeCodexAuthMode(config.authMode),
    bedrockRegion: config.bedrock?.region ?? '',
    claudeAgentAliases: readClaudeAgentModelAliases(config),
    enabledModels: getInitialEnabledModels(config.enabledModels),
  }
}

function supportsClaudeAgentModelAliases(providerKind: ApiProviderKind): boolean {
  return providerKind === 'anthropic' || providerKind === 'universal'
}

function applyClaudeAgentAliasesToProfileConfig(
  config: Record<string, unknown>,
  values: ProfileDetailFormValues,
): Record<string, unknown> {
  return writeClaudeAgentModelAliases(
    config,
    supportsClaudeAgentModelAliases(values.providerKind)
      ? values.claudeAgentAliases
      : DEFAULT_CLAUDE_AGENT_ALIASES,
  )
}

function buildProviderRequestBody(profile: AgentProfile) {
  return {
    providerKind: profile.providerKind,
    label: profile.name,
    config: ProfileConfigJsonSchema.parse(profile.configJson),
    secretRef: profile.credentialRef ?? null,
    profileId: profile.id,
    providerTargetKind: 'manual' as const,
    providerTargetId: profile.id,
  }
}

function buildProfileConfig(
  values: ProfileDetailFormValues,
  currentConfig: Record<string, unknown>,
  options: BuildProfileConfigOptions = {},
): Record<string, unknown> {
  const {
    enabledModels: _,
    authMode: _authMode,
    bedrock: _bedrock,
    baseUrl: _baseUrl,
    openaiBaseUrl: _openaiBaseUrl,
    anthropicBaseUrl: _anthropicBaseUrl,
    api: _api,
    accessMode: _accessMode,
    interactionMode: _interactionMode,
    permissionMode: _permissionMode,
    ...rest
  } = currentConfig
  if (values.providerKind === 'universal') {
    return applyClaudeAgentAliasesToProfileConfig({
      ...rest,
      openaiBaseUrl: values.openaiBaseUrl,
      anthropicBaseUrl: values.anthropicBaseUrl,
      model: values.model || undefined,
    }, values)
  }
  if (values.providerKind === 'openai-compatible' && options.codexAuthMode) {
    const codexAuthMode = normalizeCodexAuthMode(options.codexAuthMode)
    return applyClaudeAgentAliasesToProfileConfig({
      ...rest,
      authMode: codexAuthMode,
      baseUrl: codexAuthMode === CODEX_AUTH_MODE_API_KEY ? values.baseUrl : '',
      model: values.model || undefined,
      api: values.api || undefined,
      ...(codexAuthMode === CODEX_AUTH_MODE_BEDROCK_API_KEY
        ? { bedrock: { region: values.bedrockRegion.trim() } }
        : {}),
    }, values)
  }
  if (values.providerKind === 'anthropic') {
    const claudeAuthMode = normalizeClaudeAuthMode(values.authMode)
    return applyClaudeAgentAliasesToProfileConfig({
      ...rest,
      authMode: claudeAuthMode,
      baseUrl: claudeAuthMode === CLAUDE_AUTH_MODE_CLAUDE_AI ? '' : values.baseUrl,
      model: values.model || undefined,
      api: values.api || undefined,
    }, values)
  }
  return applyClaudeAgentAliasesToProfileConfig({
    ...rest,
    baseUrl: values.baseUrl,
    model: values.model || undefined,
    api: values.api || undefined,
  }, values)
}

function createProfileSignature(values: ProfileDetailFormValues): string {
  return JSON.stringify({
    name: values.name,
    apiKey: values.apiKey,
    providerKind: values.providerKind,
    baseUrl: values.baseUrl,
    openaiBaseUrl: values.openaiBaseUrl,
    anthropicBaseUrl: values.anthropicBaseUrl,
    model: values.model,
    api: values.api,
    authMode: values.authMode,
    bedrockRegion: values.bedrockRegion,
    claudeAgentAliases: values.claudeAgentAliases,
    enabledModels: values.enabledModels,
  })
}

function readCustomModelsState(customModelsJson: string): CustomModelsState {
  return {
    customModelsJson,
    models: CustomModelsJsonSchema.parse(customModelsJson),
  }
}

function clearTimer(timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  if (!timerRef.current) {
    return
  }

  clearTimeout(timerRef.current)
  timerRef.current = null
}

export function ProfileDetailPanel({
  profile,
  onRemove,
  onToggle,
  onSaved,
}: {
  profile: AgentProfile
  onRemove: () => void
  onToggle: (enabled: boolean) => void
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const providerTarget: ProviderTarget = ({ kind: 'manual', id: profile.id })

  const supportsModels = true
  const form = useForm<ProfileDetailFormValues>({
    defaultValues: getProfileFormValues(profile),
  })
  const name = useWatch({ control: form.control, name: 'name' }) ?? ''
  const apiKey = useWatch({ control: form.control, name: 'apiKey' }) ?? ''
  const providerKind = useWatch({ control: form.control, name: 'providerKind' }) ?? profile.providerKind
  const baseUrl = useWatch({ control: form.control, name: 'baseUrl' }) ?? ''
  const openaiBaseUrl = useWatch({ control: form.control, name: 'openaiBaseUrl' }) ?? ''
  const anthropicBaseUrl = useWatch({ control: form.control, name: 'anthropicBaseUrl' }) ?? ''
  const model = useWatch({ control: form.control, name: 'model' }) ?? ''
  const api = useWatch({ control: form.control, name: 'api' }) ?? ''
  const authMode = useWatch({ control: form.control, name: 'authMode' }) ?? CODEX_AUTH_MODE_API_KEY
  const bedrockRegion = useWatch({ control: form.control, name: 'bedrockRegion' }) ?? ''
  const claudeAgentAliases
    = useWatch({ control: form.control, name: 'claudeAgentAliases' }) ?? DEFAULT_CLAUDE_AGENT_ALIASES
  const enabledModels
    = useWatch({ control: form.control, name: 'enabledModels' }) ?? EMPTY_ENABLED_MODELS

  const [uiState, dispatch] = useReducer(profileDetailUiReducer, INITIAL_UI_STATE)
  const { availableModels, modelsLoading, modelsCachedAt, saveState, confirmRemove } = uiState

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modelsRequestRef = useRef(0)
  const saveRequestRef = useRef(0)
  const savedSignatureRef = useRef(createProfileSignature(getProfileFormValues(profile)))
  const latestProfileRef = useRef(profile)
  const selectedProfileIdRef = useRef(profile.id)
  const [chatgptLogin, dispatchChatgptLogin] = useReducer(
    chatgptLoginReducer,
    INITIAL_CHATGPT_LOGIN_STATE,
  )
  const { startLogin, cancelLogin } = useChatgptCredentialLoginActions()
  const chatgptLoginStatus = useChatgptCredentialLoginStatus(chatgptLogin.loginId)
  const credentialMetadata = useCredentialMetadata(profile.credentialRef)
  const showCodexAccountDiagnostics = providerKind === 'openai-compatible'
    && normalizeCodexAuthMode(authMode) === CODEX_AUTH_MODE_CHATGPT
  const preset = presetForProviderKind(providerKind)

  useEffect(() => {
    latestProfileRef.current = profile
  }, [profile])

  useEffect(() => {
    const login = chatgptLoginStatus.data
    if (!login) {
      return
    }
    if (login.state === 'completed' && login.credentialRef) {
      const config = ProfileConfigJsonSchema.parse(profile.configJson)
      config.baseUrl = ''
      config.authMode = CODEX_AUTH_MODE_CHATGPT
      form.setValue('baseUrl', '', { shouldDirty: false })
      form.setValue('apiKey', '', { shouldDirty: false })
      form.setValue('authMode', CODEX_AUTH_MODE_CHATGPT, { shouldDirty: false })
      dispatchChatgptLogin({ type: 'clear' })
      void putProfilesById({
        path: { id: profile.id },
        body: {
          name: profile.name,
          providerKind: profile.providerKind,
          enabled: profile.enabled,
          config,
          credentialRef: login.credentialRef,
        },
      })
        .then(() => {
          dispatch({ type: 'save/set', state: 'saved' })
          onSaved()
          void queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() })
          void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
        })
        .catch((error) => {
          dispatch({ type: 'save/set', state: 'error' })
          console.error('[ProfileDetailPanel] ChatGPT credential save failed', error)
        })
    }
    if (login.state === 'failed') {
      dispatchChatgptLogin({ type: 'clear' })
      dispatch({ type: 'save/set', state: 'error' })
    }
  }, [chatgptLoginStatus.data, dispatchChatgptLogin, form, onSaved, profile, queryClient])

  const handleChatgptLogin = async () => {
    const reservedWindow = reserveChatgptCredentialLoginWindow()
    try {
      const login = await startLogin.mutateAsync(`${profile.name} ChatGPT`)
      dispatchChatgptLogin({ type: 'start', login })
      await navigator.clipboard?.writeText(login.userCode).catch(() => undefined)
      await openChatgptCredentialLoginUrl(login.verificationUrl, reservedWindow)
      dispatch({ type: 'save/set', state: 'pending' })
    }
    catch (error) {
      reservedWindow?.close()
      dispatch({ type: 'save/set', state: 'error' })
      console.error('[ProfileDetailPanel] ChatGPT login failed', error)
    }
  }

  const handleCancelChatgptLogin = async () => {
    if (!chatgptLogin.loginId) {
      return
    }
    await cancelLogin.mutateAsync(chatgptLogin.loginId).catch(() => undefined)
    dispatchChatgptLogin({ type: 'clear' })
    dispatch({ type: 'save/set', state: 'idle' })
  }

  const setTextField = (field: ProfileTextField, value: string) => {
      form.setValue(field, value, { shouldDirty: true })
    }

  const setProviderKind = (nextProviderKind: ApiProviderKind) => {
      const currentValues = form.getValues()
      if (nextProviderKind === 'openai-compatible') {
        form.setValue('baseUrl', currentValues.openaiBaseUrl || currentValues.baseUrl, { shouldDirty: true })
      }
      if (nextProviderKind === 'anthropic') {
        form.setValue('baseUrl', currentValues.anthropicBaseUrl || currentValues.baseUrl, { shouldDirty: true })
      }
      if (nextProviderKind === 'universal') {
        if (currentValues.providerKind === 'openai-compatible' && currentValues.baseUrl) {
          form.setValue('openaiBaseUrl', currentValues.baseUrl, { shouldDirty: true })
        }
        if (currentValues.providerKind === 'anthropic' && currentValues.baseUrl) {
          form.setValue('anthropicBaseUrl', currentValues.baseUrl, { shouldDirty: true })
        }
      }
      form.setValue('providerKind', nextProviderKind, { shouldDirty: true })
    }

  const handleEnabledModelsChange = (next: string[]) => {
      form.setValue('enabledModels', next, { shouldDirty: true })
    }

  const handleClaudeAgentAliasesChange = (next: ClaudeAgentModelAliases) => {
      form.setValue('claudeAgentAliases', next, { shouldDirty: true })
    }

  const handleModelRegistryMapped = (next: ModelDescriptor) => {
      dispatch({ type: 'models/update-one', model: next })
      void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
      onSaved()
    }

  const clearAutoSaveTimer = () => {
    clearTimer(autoSaveTimerRef)
  }

  const clearSavedClearTimer = () => {
    clearTimer(savedClearTimerRef)
  }

  useEffect(() => {
    return () => {
      clearTimer(autoSaveTimerRef)
      clearTimer(savedClearTimerRef)
    }
  }, [])

  const fetchModelsFromProvider = useCallback((requestId: number) => {
      postProvidersModels({ body: buildProviderRequestBody(latestProfileRef.current) })
        .then(({ data }) => {
          if (requestId !== modelsRequestRef.current) {
            return
          }
          dispatch({
            type: 'models/loaded',
            models: ModelDescriptorListSchema.parse(data),
            cachedAt: Date.now(),
          })
          void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
        })
        .catch(() => {
          if (requestId !== modelsRequestRef.current) {
            return
          }
          dispatch({ type: 'models/failed' })
        })
    }, [dispatch, queryClient])

  // Reset state when switching profile. Same-profile refetches happen after auto-save
  // and must not clear the already loaded model list.
  useEffect(() => {
    if (selectedProfileIdRef.current === profile.id) {
      return
    }
    selectedProfileIdRef.current = profile.id
    clearAutoSaveTimer()
    clearSavedClearTimer()
    modelsRequestRef.current += 1
    saveRequestRef.current += 1
    const initialValues = getProfileFormValues(profile)
    savedSignatureRef.current = createProfileSignature(initialValues)
    form.reset(initialValues)
    dispatch({ type: 'reset' })
  }, [form, profile])

  // Visibility lives in enabled_models_json (model-settings), not connectionConfigJson.
  useEffect(() => {
    let active = true
    void loadProviderTargetModelSettings({ kind: 'manual', id: profile.id })
      .then((settings) => {
        if (!active || selectedProfileIdRef.current !== profile.id) {
          return
        }
        const nextEnabled = enabledModelsFromConfig(settings.configJson)
        const current = form.getValues('enabledModels')
        if (JSON.stringify(current) === JSON.stringify(nextEnabled)) {
          return
        }
        form.setValue('enabledModels', nextEnabled, { shouldDirty: false })
        const nextValues = { ...form.getValues(), enabledModels: nextEnabled }
        savedSignatureRef.current = createProfileSignature(nextValues)
      })
      .catch(() => {
        // Keep form defaults if model-settings is unavailable.
      })
    return () => {
      active = false
    }
  }, [form, profile.id])

  useEffect(() => {
    if (profile.providerKind !== 'openai-compatible') {
      return
    }
    const config = ProfileConfigJsonSchema.parse(profile.configJson)
    if (config.authMode) {
      return
    }
    const credentialAuthMode = codexAuthModeFromCredentialKind(credentialMetadata.data?.kind)
    if (!credentialAuthMode) {
      return
    }
    const currentValues = form.getValues()
    const nextValues = { ...currentValues, authMode: credentialAuthMode }
    form.setValue('authMode', credentialAuthMode, { shouldDirty: false })
    savedSignatureRef.current = createProfileSignature(nextValues)
  }, [credentialMetadata.data?.kind, form, profile.configJson, profile.providerKind])

  useEffect(() => {
    if (!supportsModels) {
      dispatch({ type: 'models/loaded', models: [], cachedAt: null })
      return
    }

    const requestId = ++modelsRequestRef.current
    dispatch({ type: 'models/loading' })

    queryClient
      .fetchQuery(
        getProvidersTargetsByProviderTargetIdModelsCacheOptions({
          path: { providerTargetId: profile.id },
        }),
      )
      .then((rawCache) => {
        const cache = ProviderModelsCacheSchema.parse(rawCache)
        if (requestId !== modelsRequestRef.current) {
          return
        }

        if (cache?.cached) {
          dispatch({
            type: 'models/loaded',
            models: cache.models,
            cachedAt: cache.models.length > 0 ? null : Date.now(),
          })
          return
        }

        fetchModelsFromProvider(requestId)
      })
      .catch(() => {
        if (requestId !== modelsRequestRef.current) {
          return
        }
        dispatch({ type: 'models/failed' })
      })
  }, [fetchModelsFromProvider, supportsModels, profile.id, queryClient])

  const handleRefreshModels = () => {
    const requestId = ++modelsRequestRef.current
    dispatch({ type: 'models/loading' })
    fetchModelsFromProvider(requestId)
  }

  const saveProfile = useEffectEvent(async () => {
    const currentValues = form.getValues()
    const requestId = ++saveRequestRef.current
    dispatch({ type: 'save/set', state: 'saving' })

    try {
      // Update model visibility via dedicated endpoint (not through profile config)
      const cleanEnabledModels = currentValues.enabledModels.filter(id => id !== ALL_DISABLED_SENTINEL)
      const allDisabledNow = currentValues.enabledModels[0] === ALL_DISABLED_SENTINEL
      const effectiveEnabledModels = allDisabledNow ? [ALL_DISABLED_SENTINEL] : cleanEnabledModels
      const previousValues = JSON.parse(savedSignatureRef.current) as { enabledModels?: string[] }
      const previousEnabledModels = previousValues.enabledModels ?? []
      if (JSON.stringify(effectiveEnabledModels) !== JSON.stringify(previousEnabledModels)) {
        await updateProviderTargetModelVisibility(
          providerTarget,
          effectiveEnabledModels,
        )
      }

      let credentialRef = profile.credentialRef ?? null
      const credentialValue = currentValues.apiKey.trim()
      if (credentialValue && supportsModels) {
        const codexAuthMode = currentValues.providerKind === 'openai-compatible'
          ? normalizeCodexAuthMode(currentValues.authMode)
          : CODEX_AUTH_MODE_API_KEY
        const { data: meta } = await postSecrets({
          body: {
            kind: currentValues.providerKind === 'openai-compatible'
              ? codexSecretKindForAuthMode(codexAuthMode, currentValues.providerKind)
              : currentValues.providerKind,
            label: currentValues.name,
            secret: credentialValue,
          },
        })
        credentialRef = SecretCreateResponseSchema.parse(meta).id
      }
      const codexAuthMode = currentValues.providerKind === 'openai-compatible'
        ? normalizeCodexAuthMode(currentValues.authMode)
        : null

      await putProfilesById({
        path: { id: profile.id },
        body: {
          name: currentValues.name,
          providerKind: currentValues.providerKind,
          enabled: profile.enabled,
          config: supportsModels
            ? buildProfileConfig(currentValues, ProfileConfigJsonSchema.parse(profile.configJson), {
              codexAuthMode,
              })
            : ProfileConfigJsonSchema.parse(profile.configJson),
          credentialRef,
        },
      })

      if (requestId !== saveRequestRef.current) {
        return
      }

      dispatch({ type: 'save/set', state: 'saved' })
      const savedValues = {
        ...currentValues,
        apiKey: '',
      }
      savedSignatureRef.current = createProfileSignature(savedValues)
      form.reset(savedValues)
      void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
      clearSavedClearTimer()
      savedClearTimerRef.current = setTimeout(() => {
        if (requestId === saveRequestRef.current) {
          dispatch({ type: 'save/set', state: 'idle' })
        }
      }, 1600)
      onSaved()
    }
 catch (err) {
      if (requestId !== saveRequestRef.current) {
        return
      }

      dispatch({ type: 'save/set', state: 'error' })
      console.error('[ProfileDetailPanel] save failed', err)
    }
  })

  const watchedSignature = JSON.stringify({
        name,
        apiKey,
        providerKind,
        baseUrl,
        openaiBaseUrl,
        anthropicBaseUrl,
        model,
        api,
        authMode,
        bedrockRegion,
        claudeAgentAliases,
        enabledModels,
      })

  // Auto-save with debounce — but skip the very first run after switching profiles
  useEffect(() => {
    if (watchedSignature === savedSignatureRef.current || saveState === 'saving') {
      return
    }

    if (saveState !== 'pending') {
      dispatch({ type: 'save/set', state: 'pending' })
    }
    clearTimer(autoSaveTimerRef)
    const timeoutId = setTimeout(() => {
      void saveProfile()
    }, 1200)

    autoSaveTimerRef.current = timeoutId

    return () => {
      clearTimeout(timeoutId)
      if (autoSaveTimerRef.current === timeoutId) {
        autoSaveTimerRef.current = null
      }
    }
  }, [saveState, watchedSignature])

  // ── Icon change handler ──
  const handleIconChange = (slug: string | null) => {
      patchProfilesByIdIcon({
        path: { id: profile.id },
        body: { iconSlug: slug },
      })
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() })
          onSaved()
        })
        .catch(() => {})
    }

  const headerName = name.trim() || profile.name
  const kindLabel = PROVIDER_KIND_LABELS[providerKind]

  return (
    <div data-testid="provider-detail-panel" className="flex flex-col gap-2">
      <ProfileDetailHeader
        profile={profile}
        displayName={headerName}
        kindLabel={kindLabel}
        icon={(
          <IconPicker
            value={profile.iconSlug ?? null}
            onChange={handleIconChange}
            renderIcon={(entry, className) => (
              <ProviderIcon iconSlug={entry.slug} presetId={preset.id} className={className} />
            )}
          >
            <button
              type="button"
              className="mt-1 shrink-0 cursor-pointer rounded-md p-0.5 transition-colors hover:bg-fill"
            >
              <ProviderIcon iconSlug={profile.iconSlug} presetId={preset.id} className="size-6" />
            </button>
          </IconPicker>
        )}
        saveState={saveState}
        onToggle={onToggle}
        onOpenRemove={() => dispatch({ type: 'remove/set', open: true })}
      />

      {/* Configuration */}
      <div className="flex flex-col">
        <ProfileGeneralSettings
          profile={profile}
          credentialMetadata={credentialMetadata.data ?? null}
          values={{ name, apiKey, providerKind, baseUrl, openaiBaseUrl, anthropicBaseUrl, api, authMode, bedrockRegion }}
          onTextFieldChange={setTextField}
          onProviderKindChange={setProviderKind}
          supportsModels={supportsModels}
          readOnly={false}
          chatgptLoginPending={!!chatgptLogin.loginId}
          chatgptLoginBusy={startLogin.isPending}
          activeChatgptLogin={chatgptLogin.activeLogin}
          onChatgptLogin={handleChatgptLogin}
          onCancelChatgptLogin={handleCancelChatgptLogin}
        />

        {showCodexAccountDiagnostics && (
          <CodexAccountDiagnosticsPanel providerTargetId={profile.id} />
        )}

        {supportsModels && supportsClaudeAgentModelAliases(providerKind) && (
          <>
            <SettingsDivider />
            <ClaudeModelMatrixEditor
              aliases={claudeAgentAliases}
              models={availableModels}
              mainModelId={model || null}
              loading={modelsLoading}
              onChange={handleClaudeAgentAliasesChange}
            />
          </>
        )}

        {supportsModels && (
          <MemoizedProfileModelsSection
            loading={modelsLoading}
            models={availableModels}
            enabledModels={enabledModels}
            onChange={handleEnabledModelsChange}
            onModelRegistryMapped={handleModelRegistryMapped}
            onRefresh={handleRefreshModels}
            cachedAt={modelsCachedAt}
          />
        )}

        {supportsModels && (
          <MemoizedProfileCustomModelsSection
            providerTarget={providerTarget}
            customModelsJson={profile.customModels}
            onSaved={onSaved}
            onRefreshModels={handleRefreshModels}
          />
        )}
      </div>

      <RemoveProfileDialog
        open={confirmRemove}
        profileName={profile.name}
        onOpenChange={open => dispatch({ type: 'remove/set', open })}
        onConfirm={() => {
          dispatch({ type: 'remove/set', open: false })
          onRemove()
        }}
      />
    </div>
  )
}

function ProfileDetailHeader({
  profile,
  displayName,
  kindLabel,
  icon,
  saveState,
  onToggle,
  onOpenRemove,
}: {
  profile: AgentProfile
  displayName: string
  kindLabel: string
  icon: ReactNode
  saveState: SaveState
  onToggle: (enabled: boolean) => void
  onOpenRemove: () => void
}) {
  return (
    <header className="flex items-start gap-3">
      {icon}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-heading truncate text-[15px] font-medium text-foreground">
            {displayName}
          </h4>
          <Badge variant="secondary" className="font-normal text-muted-foreground">
            {kindLabel}
          </Badge>
        </div>
        <p className="mt-1 truncate text-[11.5px] text-muted-foreground/80">{profile.id}</p>
      </div>

      <div className="flex items-center gap-3 pt-0.5">
        <SaveIndicator state={saveState} />

        <div className="flex items-center gap-2 rounded-full bg-muted/40 px-2.5 py-1 ring-1 ring-foreground/4">
          <Switch size="sm" checked={profile.enabled} onCheckedChange={onToggle} />
          <span className="text-[11px] font-medium text-muted-foreground">
            {profile.enabled ? 'Active' : 'Off'}
          </span>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-testid={`agent-profile-remove-${profile.id}`}
              variant="ghost"
              size="icon-sm"
              onClick={onOpenRemove}
              className="text-muted-foreground/60 hover:bg-destructive/6 hover:text-destructive"
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Remove provider</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function ProfileGeneralSettings({
  profile,
  credentialMetadata,
  values,
  onTextFieldChange,
  onProviderKindChange,
  supportsModels,
  readOnly,
  chatgptLoginPending,
  chatgptLoginBusy,
  activeChatgptLogin,
  onChatgptLogin,
  onCancelChatgptLogin,
}: {
  profile: AgentProfile
  credentialMetadata: CredentialMetadata | null
  values: Pick<ProfileDetailFormValues, ProfileTextField | 'providerKind'>
  onTextFieldChange: (field: ProfileTextField, value: string) => void
  onProviderKindChange: (providerKind: ApiProviderKind) => void
  supportsModels: boolean
  readOnly: boolean
  chatgptLoginPending: boolean
  chatgptLoginBusy: boolean
  activeChatgptLogin: ChatgptCredentialLoginStart | null
  onChatgptLogin: () => void
  onCancelChatgptLogin: () => void
}) {
  const isUniversal = values.providerKind === 'universal'
  const isCodexProvider = values.providerKind === 'openai-compatible'
  const isClaudeProvider = values.providerKind === 'anthropic'
  const isChatgptCredential = isChatgptCredentialMetadata(credentialMetadata)
  const codexAuthMode = isCodexProvider
    ? normalizeCodexAuthMode(values.authMode)
    : CODEX_AUTH_MODE_API_KEY
  const claudeAuthMode = isClaudeProvider
    ? normalizeClaudeAuthMode(values.authMode)
    : CLAUDE_AUTH_MODE_API_KEY
  const endpointDisabled = readOnly
    || (isCodexProvider && codexAuthMode !== CODEX_AUTH_MODE_API_KEY)
    || (isClaudeProvider
      && claudeAuthMode !== CLAUDE_AUTH_MODE_API_KEY)
  const providerKindDisabled = readOnly || codexAuthMode === CODEX_AUTH_MODE_CHATGPT || isChatgptCredential

  return (
    <>
      <SettingsRow label="Display name" description="The name shown in the provider list">
        <Input
          data-testid="provider-edit-name"
          value={values.name}
          onChange={e => onTextFieldChange('name', e.target.value)}
          disabled={readOnly}
          className="h-9 w-56 text-[13px]"
        />
      </SettingsRow>

      {supportsModels && (
        <>
          <SettingsDivider />
          <SettingsRow label="Provider type" description="Runtime protocol family for this provider">
            <Select
              value={values.providerKind}
              onValueChange={value => onProviderKindChange(value as ApiProviderKind)}
              disabled={providerKindDisabled}
            >
              <SelectTrigger className="h-9 w-56 text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-compatible">{PROVIDER_KIND_LABELS['openai-compatible']}</SelectItem>
                <SelectItem value="anthropic">{PROVIDER_KIND_LABELS.anthropic}</SelectItem>
                <SelectItem value="universal">{PROVIDER_KIND_LABELS.universal}</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsDivider />
          {isUniversal
            ? (
                <SettingsRow label="Endpoints" description="Separate base URLs for each API family" vertical>
                  <div className="flex w-full max-w-[28rem] flex-col gap-1.5">
                    <label htmlFor="provider-edit-openai-baseurl" className="text-[11px] font-medium text-muted-foreground">
                      OpenAI
                    </label>
                    <Input
                      id="provider-edit-openai-baseurl"
                      data-testid="provider-edit-openai-baseurl"
                      value={values.openaiBaseUrl}
                      onChange={e => onTextFieldChange('openaiBaseUrl', e.target.value)}
                      disabled={readOnly}
                      className="h-9 text-[12.5px] font-mono"
                      placeholder="https://api.example.com/v1"
                    />
                    <label htmlFor="provider-edit-anthropic-baseurl" className="mt-1 text-[11px] font-medium text-muted-foreground">
                      Anthropic
                    </label>
                    <Input
                      id="provider-edit-anthropic-baseurl"
                      data-testid="provider-edit-anthropic-baseurl"
                      value={values.anthropicBaseUrl}
                      onChange={e => onTextFieldChange('anthropicBaseUrl', e.target.value)}
                      disabled={readOnly}
                      className="h-9 text-[12.5px] font-mono"
                      placeholder="https://api.example.com"
                    />
                  </div>
                </SettingsRow>
              )
            : (
                <SettingsRow label="Endpoint" description="Base URL for the API">
                  <Input
                    data-testid="provider-edit-baseurl"
                    value={values.baseUrl}
                    onChange={e => onTextFieldChange('baseUrl', e.target.value)}
                    disabled={endpointDisabled}
                    className="h-9 w-56 text-[12.5px] font-mono"
                    placeholder="https://api.example.com/v1"
                  />
                </SettingsRow>
              )}

          {!isUniversal && (
            <>
              <SettingsDivider />
              <SettingsRow label="API protocol" description="Communication protocol for this endpoint">
                <Select
                  value={values.api || 'auto'}
                  onValueChange={v => onTextFieldChange('api', v === 'auto' ? '' : v)}
                  disabled={endpointDisabled}
                >
                  <SelectTrigger className="h-9 w-56 text-[12.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="openai-completions">OpenAI Completions</SelectItem>
                    <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
                    <SelectItem value="anthropic-messages">Anthropic Messages</SelectItem>
                    <SelectItem value="google-generative-ai">Google Generative AI</SelectItem>
                    <SelectItem value="bedrock-converse-stream">AWS Bedrock</SelectItem>
                    <SelectItem value="mistral-conversations">Mistral</SelectItem>
                  </SelectContent>
                </Select>
              </SettingsRow>
            </>
          )}

          <SettingsDivider />
          <ProfileCredentialSettings
            profile={profile}
            credentialMetadata={credentialMetadata}
            values={values}
            onTextFieldChange={onTextFieldChange}
            readOnly={readOnly}
            providerKind={values.providerKind}
            lockChatgptAuth={isChatgptCredential}
            chatgptLoginPending={chatgptLoginPending}
            chatgptLoginBusy={chatgptLoginBusy}
            activeChatgptLogin={activeChatgptLogin}
            onChatgptLogin={onChatgptLogin}
            onCancelChatgptLogin={onCancelChatgptLogin}
          />

        </>
      )}
    </>
  )
}

function ProfileCredentialSettings({
  profile,
  credentialMetadata,
  values,
  onTextFieldChange,
  readOnly,
  providerKind,
  lockChatgptAuth,
  chatgptLoginPending,
  chatgptLoginBusy,
  activeChatgptLogin,
  onChatgptLogin,
  onCancelChatgptLogin,
}: {
  profile: AgentProfile
  credentialMetadata: CredentialMetadata | null
  values: Pick<ProfileDetailFormValues, ProfileTextField>
  onTextFieldChange: (field: ProfileTextField, value: string) => void
  readOnly: boolean
  providerKind: ApiProviderKind
  lockChatgptAuth: boolean
  chatgptLoginPending: boolean
  chatgptLoginBusy: boolean
  activeChatgptLogin: ChatgptCredentialLoginStart | null
  onChatgptLogin: () => void
  onCancelChatgptLogin: () => void
}) {
  const isCodexProvider = providerKind === 'openai-compatible'
  const isClaudeProvider = providerKind === 'anthropic'
  const isChatgptCredential = isChatgptCredentialMetadata(credentialMetadata)
  const codexAuthMode = isCodexProvider
    ? normalizeCodexAuthMode(values.authMode)
    : CODEX_AUTH_MODE_API_KEY
  const claudeAuthMode = isClaudeProvider
    ? normalizeClaudeAuthMode(values.authMode)
    : CLAUDE_AUTH_MODE_API_KEY
  const claudeAiLogin = isClaudeProvider && claudeAuthMode === CLAUDE_AUTH_MODE_CLAUDE_AI
  const showChatgptControls = isCodexProvider && codexAuthMode === CODEX_AUTH_MODE_CHATGPT
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [revealingSecret, setRevealingSecret] = useState(false)
  const [replacingSecret, setReplacingSecret] = useState(false)
  const description = isCodexProvider
    ? 'How this provider signs in to Codex.'
    : isClaudeProvider
      ? 'How this provider authenticates to Claude.'
      : profile.credentialRef
        ? 'Stored securely. Reveal it briefly or replace it with a new value.'
        : 'Stored locally and encrypted.'

  useEffect(() => {
    if (!revealedSecret) {
      return
    }
    const timeoutId = setTimeout(setRevealedSecret, 15_000, null)
    return () => clearTimeout(timeoutId)
  }, [revealedSecret])

  const revealSecret = async () => {
    if (!profile.credentialRef || revealingSecret) {
      return
    }
    setRevealingSecret(true)
    try {
      const { data } = await postSecretsByIdReveal({
        path: { id: profile.credentialRef },
        throwOnError: true,
      })
      setRevealedSecret(data.secret)
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: 'Could not reveal API key',
        description: apiErrorMessage(error),
      })
    }
    finally {
      setRevealingSecret(false)
    }
  }

  return (
    <SettingsRow
      label="Authentication"
      description={description}
      vertical
    >
      <div className="flex w-full max-w-[28rem] flex-col gap-2">
        {isCodexProvider && (
          <Select
            value={codexAuthMode}
            onValueChange={(nextAuthMode) => {
              onTextFieldChange('authMode', nextAuthMode)
              if (nextAuthMode === CODEX_AUTH_MODE_CHATGPT) {
                onTextFieldChange('apiKey', '')
                onTextFieldChange('baseUrl', '')
              }
            }}
            disabled={readOnly || lockChatgptAuth}
          >
            <SelectTrigger className="h-9 w-56 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CODEX_AUTH_MODE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {isClaudeProvider && (
          <Select
            value={claudeAuthMode}
            onValueChange={(nextAuthMode) => {
              onTextFieldChange('authMode', nextAuthMode)
              if (nextAuthMode === CLAUDE_AUTH_MODE_CLAUDE_AI) {
                onTextFieldChange('apiKey', '')
                onTextFieldChange('baseUrl', '')
              }
            }}
            disabled={readOnly}
          >
            <SelectTrigger className="h-9 w-56 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLAUDE_AUTH_MODE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {claudeAiLogin && (
          <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground ring-1 ring-foreground/4">
            Uses your Claude.ai subscription login. No API key needed — the Claude Agent SDK manages login state in its own config directory.
          </div>
        )}

        {showChatgptControls && credentialMetadata && isChatgptCredential && (
          <ChatgptCredentialSummary credential={credentialMetadata} />
        )}
        {!showChatgptControls && !claudeAiLogin && revealedSecret && (
          <div className="flex flex-col gap-1.5">
            <Input value={revealedSecret} readOnly type="text" className="h-9 font-mono text-[12.5px]" />
            <div className="flex items-center gap-2">
              <Button type="button" size="xs" variant="outline" onClick={() => setRevealedSecret(null)}>
                Hide API key
              </Button>
              <span className="text-[11px] text-muted-foreground">Hidden automatically after 15 seconds.</span>
            </div>
          </div>
        )}
        {!showChatgptControls && !claudeAiLogin && !revealedSecret && profile.credentialRef && !replacingSecret && (
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">{credentialMetadata?.maskedSecret ?? 'Stored API key'}</span>
            <Button type="button" size="xs" variant="outline" onClick={() => void revealSecret()} disabled={readOnly || revealingSecret}>
              {revealingSecret ? <Spinner className="size-3" /> : null}
              Reveal
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={() => setReplacingSecret(true)} disabled={readOnly}>
              Replace
            </Button>
          </div>
        )}
        {!showChatgptControls && !claudeAiLogin && !revealedSecret && (!profile.credentialRef || replacingSecret) && (
          <div className="flex flex-col gap-1.5">
          <Input
            data-testid="provider-edit-apikey"
            type="password"
            value={values.apiKey}
            onChange={e => onTextFieldChange('apiKey', e.target.value)}
            disabled={readOnly}
            placeholder={isCodexProvider
              ? codexCredentialPlaceholder(codexAuthMode, !!profile.credentialRef)
              : isClaudeProvider
                ? claudeCredentialPlaceholder(!!profile.credentialRef, claudeAuthMode)
                : codexCredentialPlaceholder(CODEX_AUTH_MODE_API_KEY, !!profile.credentialRef)}
            className="h-9 text-[12.5px] font-mono"
          />
            {profile.credentialRef && (
              <Button type="button" size="xs" variant="ghost" className="self-start" onClick={() => setReplacingSecret(false)}>
                Keep current API key
              </Button>
            )}
          </div>
        )}
        {isCodexProvider && codexAuthMode === CODEX_AUTH_MODE_BEDROCK_API_KEY && (
          <Input
            data-testid="provider-edit-bedrock-region"
            value={values.bedrockRegion}
            onChange={e => onTextFieldChange('bedrockRegion', e.target.value)}
            disabled={readOnly}
            placeholder="us-east-1"
            className="h-9 text-[12.5px] font-mono"
          />
        )}
        {showChatgptControls && (
          <div className="flex flex-wrap items-center gap-2">
            {chatgptLoginPending
              ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={onCancelChatgptLogin}
                    disabled={readOnly}
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
                    onClick={onChatgptLogin}
                    disabled={readOnly || chatgptLoginBusy}
                  >
                    {chatgptLoginBusy ? <Spinner className="size-3" /> : <LogInIcon className="size-3" />}
                    {isChatgptCredential ? 'Re-login with ChatGPT' : 'Sign in with ChatGPT'}
                  </Button>
                )}
          </div>
        )}
        {showChatgptControls && activeChatgptLogin && (
          <ChatgptDeviceCodeNotice login={activeChatgptLogin} />
        )}
      </div>
    </SettingsRow>
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

function ProfileModelsSection({
  loading,
  models,
  enabledModels,
  onChange,
  onModelRegistryMapped,
  onRefresh,
  cachedAt,
}: {
  loading: boolean
  models: ModelDescriptor[]
  enabledModels: string[]
  onChange: (next: string[]) => void
  onModelRegistryMapped: (next: ModelDescriptor) => void
  onRefresh?: () => void
  cachedAt?: number | null
}) {
  return (
    <>
      <Separator className="bg-foreground/6" />
      <section className="mt-4 flex flex-col gap-4">
        <ModelsPanel
          loading={loading}
          models={models}
          enabledModels={enabledModels}
          onChange={onChange}
          onModelRegistryMapped={onModelRegistryMapped}
          onRefresh={onRefresh}
          cachedAt={cachedAt}
        />
      </section>
    </>
  )
}

const MemoizedProfileModelsSection = ProfileModelsSection

function ProfileCustomModelsSection({
  providerTarget,
  customModelsJson,
  onSaved,
  onRefreshModels,
}: {
  providerTarget: ProviderTarget
  customModelsJson: string
  onSaved: () => void
  onRefreshModels: () => void
}) {
  const queryClient = useQueryClient()
  const [customModelsState, setCustomModelsState] = useState<CustomModelsState>(() =>
    readCustomModelsState(customModelsJson))

  let models = customModelsState.models
  if (customModelsState.customModelsJson !== customModelsJson) {
    const nextState = readCustomModelsState(customModelsJson)
    setCustomModelsState(nextState)
    models = nextState.models
  }

  const saveCustomModels = async (next: EditableCustomModel[]) => {
      setCustomModelsState({
        customModelsJson,
        models: next,
      })
      try {
        setCustomModelsState({
          customModelsJson,
          models: await updateProviderTargetCustomModels(providerTarget, next),
        })
        void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
        onRefreshModels()
        onSaved()
      }
 catch (error) {
        toastManager.add({
          type: 'error',
          title: 'Save failed',
          description: apiErrorMessage(error),
        })
      }
    }

  return (
    <>
      <Separator className="bg-foreground/6" />
      <section className="mt-4 flex flex-col gap-4">
        <CustomModelsEditor models={models} onChange={saveCustomModels} />
      </section>
    </>
  )
}

const MemoizedProfileCustomModelsSection = ProfileCustomModelsSection

function RemoveProfileDialog({
  open,
  profileName,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  profileName: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Remove provider?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong className="text-foreground">{profileName}</strong>
{' '}
will be disconnected from
            every agent that uses it. Stored credentials will be deleted from this machine. You can
            always add it back later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction size="sm" variant="destructive" onClick={onConfirm}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ─── Save indicator ───────────────────────────────────────────────────────────

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <AnimatePresence>
      {state !== 'idle' && (
        <m.span
          initial={{ opacity: 0, x: 4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -2 }}
          transition={{ duration: 0.18 }}
          className={cn(
            'flex items-center gap-1 text-[11px] font-medium',
            state === 'saving' || state === 'pending' ? 'text-muted-foreground' : '',
            state === 'saved' ? 'text-emerald-600 dark:text-emerald-400' : '',
            state === 'error' ? 'text-destructive' : '',
          )}
        >
          {(state === 'saving' || state === 'pending') && <Spinner className="size-2.5" />}
          {state === 'saved' && <CheckIcon className="size-3" />}
          {state === 'error' && <CircleAlertIcon className="size-3" />}
          {(state === 'saving' || state === 'pending') && 'Saving'}
          {state === 'saved' && 'Saved'}
          {state === 'error' && 'Save failed'}
        </m.span>
      )}
    </AnimatePresence>
  )
}
