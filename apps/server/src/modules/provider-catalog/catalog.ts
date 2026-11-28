import { z } from 'zod'

import { isLoopbackBindHost } from '../../config/server-config'
import { AppError } from '../../errors/app-error'
import { guardedFetch } from '../../lib/ssrf-guard'
import {
  CodexChatgptAuthReauthRequiredError,
  readCodexChatgptAuthCredential,
} from '../chat-runtime-providers/codex/app-server/chatgpt-auth'
import { listCodexChatgptModels } from '../chat-runtime-providers/codex/app-server/model-list'
import {
  buildCodexExternalModelProviderConfig,
} from '../chat-runtime-providers/codex/config/runtime-config'
import { parseCodexNativeConfig } from '../provider-contracts/codex-native-config'
import {
  AnthropicConfigJsonSchema,
  normalizeBaseUrl,
  OpenAICompatibleConfigJsonSchema,
  UniversalProviderConfigJsonSchema,
} from '../provider-contracts/provider-base'
import type {
  ModelCapabilities,
  ModelDescriptor,
  ModelServiceTier,
  ProviderKind,
  ProviderRequest,
} from '../provider-contracts/types'
import { readProviderDefaultModelCapabilities } from './model-capabilities'
import { resolveAnthropicWireAuth } from './provider-endpoint-registry'

export interface ProviderMetadataProvider {
  readonly providerKind: ProviderKind
  listModels: (
    input: ProviderRequest,
    deps: ProviderCatalogDeps,
  ) => Promise<ModelDescriptor[]>
}

interface ProviderCatalogDeps {
  readSecret: (secretRef: string) => string
  updateSecretValue?: (secretRef: string, secret: string) => void
}

const TRAILING_SLASH_RE = /\/$/
const VERSIONED_API_PATH_RE = /\/v\d+\/?$/i
const ANTHROPIC_VERSION = '2023-06-01'
const PRIVATE_PROVIDER_HOSTS_ENV = 'CRADLE_ALLOW_PRIVATE_PROVIDER_HOSTS'
const DESKTOP_PROCESS_ENV = 'CRADLE_DESKTOP_PID'
const DESKTOP_LOCAL_PROVIDER_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const
/**
 * OpenAI's own `/v1/models` only defines `id`, but gateways that also act as a
 * model catalog (magpie, LiteLLM, vLLM, OpenRouter) return served-model facts
 * next to it. Those facts are inventory, not enrichment: they describe what the
 * endpoint in front of Cradle accepts. Reading them keeps a model usable when
 * models.dev has no record for a gateway-specific id.
 */
const OpenAICompatibleModelSchema = z.object({
  id: z.string(),
  display_name: z.string().optional(),
  context_window: z.number().positive().optional(),
  context_length: z.number().positive().optional(),
  max_input_tokens: z.number().positive().optional(),
  max_output_tokens: z.number().positive().optional(),
  modalities: z.object({
    input: z.array(z.string()).optional(),
    output: z.array(z.string()).optional(),
  }).optional(),
  reasoning: z.boolean().optional(),
  reasoning_levels: z.array(z.string()).optional(),
  supported_reasoning_levels: z.array(z.object({ effort: z.string().optional() })).optional(),
  service_tiers: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
  })).optional(),
  tool_call: z.boolean().optional(),
})

const OpenAICompatibleModelsResponseSchema = z.object({
  data: z.array(OpenAICompatibleModelSchema).min(1),
})

const OPENAI_COMPATIBLE_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const

type OpenAICompatibleReasoningEffort = (typeof OPENAI_COMPATIBLE_REASONING_EFFORTS)[number]

type OpenAICompatibleModel = z.infer<typeof OpenAICompatibleModelSchema>

const AnthropicModelsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        display_name: z.string().optional(),
      }),
    )
    .min(1),
})
interface ModelsRequestOption {
  url: string
  headers?: HeadersInit
}

export class ProviderCatalog {
  private readonly providers = new Map<ProviderKind, ProviderMetadataProvider>()

  constructor() {
    this.register(new OpenAICompatibleMetadataProvider())
    this.register(new AnthropicMetadataProvider())
    this.register(new UniversalMetadataProvider())
  }

  register(provider: ProviderMetadataProvider): void {
    this.providers.set(provider.providerKind, provider)
  }

  get(providerKind: ProviderKind): ProviderMetadataProvider | undefined {
    return this.providers.get(providerKind)
  }
}

class OpenAICompatibleMetadataProvider implements ProviderMetadataProvider {
  readonly providerKind = 'openai-compatible' as const

  async listModels(
    input: ProviderRequest,
    deps: ProviderCatalogDeps,
  ): Promise<ModelDescriptor[]> {
    const config = OpenAICompatibleConfigJsonSchema.parse(input.configJson)
    const secret = input.secretRef ? deps.readSecret(input.secretRef) : null
    const chatgptAuth = readCodexChatgptAuthCredential(input.secretRef, secret)

    // ChatGPT login is an account identity, not an OpenAI-compatible gateway.
    // Official models come from Codex app-server `model/list`, including when
    // baseUrl is empty (native ChatGPT) or set (external Responses endpoint).
    if (chatgptAuth) {
      try {
        const baseUrl = config.baseUrl?.trim() || null
        const codexConfig = parseCodexNativeConfig(config.codex ?? {})
        if (baseUrl) {
          Object.assign(codexConfig, buildCodexExternalModelProviderConfig(normalizeBaseUrl(baseUrl), 'chatgptAuthTokens'))
        }
        return await listCodexChatgptModels({
          credential: chatgptAuth,
          readSecret: deps.readSecret,
          config: baseUrl || config.codex ? codexConfig : undefined,
          updateSecretValue: deps.updateSecretValue,
        })
      }
      catch (error) {
        throw wrapProviderModelsError(this.providerKind, error)
      }
    }

    if (!config.baseUrl) {
      throw invalidProviderRequest('Base URL is required')
    }

    const baseUrl = normalizeBaseUrl(config.baseUrl)

    try {
      const payload = OpenAICompatibleModelsResponseSchema.parse(
        await fetchModelsPayload(
          this.providerKind,
          modelRequestOptions(
            baseUrl,
            secret ? { Authorization: `Bearer ${secret}` } : undefined,
          ),
        ),
      )

      return payload.data.map(item => ({
        id: item.id,
        label: item.display_name?.trim() || item.id,
        providerKind: 'openai-compatible' as const,
        capabilities: readOpenAiCompatibleModelCapabilities(item),
      }))
    }
    catch (error) {
      throw wrapProviderModelsError(this.providerKind, error)
    }
  }
}

class AnthropicMetadataProvider implements ProviderMetadataProvider {
  readonly providerKind = 'anthropic' as const

  async listModels(
    input: ProviderRequest,
    deps: ProviderCatalogDeps,
  ): Promise<ModelDescriptor[]> {
    const config = AnthropicConfigJsonSchema.parse(input.configJson)

    const apiKey = input.secretRef ? deps.readSecret(input.secretRef) : null
    const baseUrl = normalizeBaseUrl(config.baseUrl ?? 'https://api.anthropic.com/v1').replace(TRAILING_SLASH_RE, '')

    try {
      const payload = AnthropicModelsResponseSchema.parse(
        await fetchModelsPayload(
          this.providerKind,
          modelRequestOptions(baseUrl, {
            'anthropic-version': ANTHROPIC_VERSION,
            ...projectAnthropicAuthHeaders(config.baseUrl, apiKey),
          }),
        ),
      )

      return payload.data.map(item => ({
        id: item.id,
        label: item.display_name ?? item.id,
        providerKind: 'anthropic' as const,
        capabilities: readProviderDefaultModelCapabilities('anthropic'),
      }))
    }
    catch (error) {
      throw wrapProviderModelsError(this.providerKind, error)
    }
  }
}

function projectAnthropicAuthHeaders(
  baseUrl: string | null,
  credential: string | null,
): Record<string, string> {
  if (!credential) {
    return {}
  }
  if (resolveAnthropicWireAuth(baseUrl) === 'bearer-token') {
    return { Authorization: `Bearer ${credential}` }
  }
  return { 'x-api-key': credential }
}

class UniversalMetadataProvider implements ProviderMetadataProvider {
  readonly providerKind = 'universal' as const

  async listModels(
    input: ProviderRequest,
    deps: ProviderCatalogDeps,
  ): Promise<ModelDescriptor[]> {
    const config = UniversalProviderConfigJsonSchema.parse(input.configJson)
    const openaiBaseUrl = config.openaiBaseUrl || config.baseUrl
    const anthropicBaseUrl = config.anthropicBaseUrl || config.baseUrl
    const apiKey = input.secretRef ? deps.readSecret(input.secretRef) : null

    if (!openaiBaseUrl && anthropicBaseUrl) {
      try {
        const baseUrl = normalizeBaseUrl(anthropicBaseUrl).replace(TRAILING_SLASH_RE, '')
        const payload = AnthropicModelsResponseSchema.parse(
          await fetchModelsPayload(
            this.providerKind,
            modelRequestOptions(baseUrl, {
              'anthropic-version': ANTHROPIC_VERSION,
              ...projectAnthropicAuthHeaders(anthropicBaseUrl, apiKey),
            }),
          ),
        )
        return payload.data.map(item => ({
          id: item.id,
          label: item.display_name ?? item.id,
          providerKind: 'universal' as const,
          capabilities: readProviderDefaultModelCapabilities('anthropic'),
        }))
      }
      catch (error) {
        throw wrapProviderModelsError(this.providerKind, error)
      }
    }

    if (!openaiBaseUrl) {
      throw invalidProviderRequest('OpenAI or Anthropic Base URL is required')
    }

    try {
      const baseUrl = normalizeBaseUrl(openaiBaseUrl)
      const payload = OpenAICompatibleModelsResponseSchema.parse(
        await fetchModelsPayload(
          this.providerKind,
          modelRequestOptions(baseUrl, apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined),
        ),
      )
      return payload.data.map(item => ({
        id: item.id,
        label: item.display_name?.trim() || item.id,
        providerKind: 'universal' as const,
        capabilities: readOpenAiCompatibleModelCapabilities(item),
      }))
    }
    catch (error) {
      throw wrapProviderModelsError(this.providerKind, error)
    }
  }
}

/**
 * Project the served-model facts an OpenAI-compatible endpoint declares into the
 * capabilities Cradle already renders (context meter, image input, reasoning
 * selector, tool calling). Registry enrichment still runs afterwards and wins
 * wherever models.dev knows the model, so this only fills what the upstream
 * actually declares.
 *
 * Prices are deliberately not projected: cost is registry-owned, and inventory
 * strips it before caching, so a provider-declared price would disappear on the
 * first cache round-trip and leave the same model priced or unpriced depending
 * on when it was read.
 */
function readOpenAiCompatibleModelCapabilities(
  model: OpenAICompatibleModel,
): ModelCapabilities {
  const capabilities: ModelCapabilities = {}
  // The served window (`context_window`/`context_length`) is what the gateway
  // accepts per request. A larger `max_context_window` ceiling is intentionally
  // not projected: the context meter would promise room the gateway rejects.
  const contextWindow = model.context_window ?? model.context_length ?? model.max_input_tokens
  if (contextWindow !== undefined) {
    capabilities.contextWindow = Math.trunc(contextWindow)
  }
  if (model.max_output_tokens !== undefined) {
    capabilities.maxOutput = Math.trunc(model.max_output_tokens)
  }
  const inputModalities = readDeclaredModalities(model.modalities?.input)
  if (inputModalities) {
    capabilities.inputModalities = inputModalities
  }
  const outputModalities = readDeclaredModalities(model.modalities?.output)
  if (outputModalities) {
    capabilities.outputModalities = outputModalities
  }
  if (model.reasoning !== undefined) {
    capabilities.reasoning = model.reasoning
  }
  const reasoningEfforts = readDeclaredReasoningEfforts(model)
  if (reasoningEfforts.length > 0) {
    capabilities.reasoningEfforts = reasoningEfforts
  }
  const serviceTiers = readDeclaredServiceTiers(model)
  if (serviceTiers.length > 0) {
    capabilities.serviceTiers = serviceTiers
  }
  if (model.tool_call !== undefined) {
    capabilities.toolCall = model.tool_call
  }
  return capabilities
}

function readDeclaredModalities(values: string[] | undefined): string[] | undefined {
  const modalities = values?.map(value => value.trim().toLowerCase()).filter(Boolean)
  return modalities?.length ? [...new Set(modalities)] : undefined
}

function readDeclaredReasoningEfforts(
  model: OpenAICompatibleModel,
): OpenAICompatibleReasoningEffort[] {
  if (model.reasoning === false) {
    return []
  }
  // `supported_reasoning_levels` is the newer shape; `reasoning_levels` is the
  // flat equivalent some gateways still return.
  const declared = model.supported_reasoning_levels?.map(level => level.effort)
    ?? model.reasoning_levels
    ?? []
  const efforts: OpenAICompatibleReasoningEffort[] = []
  for (const value of declared) {
    const effort = value?.trim().toLowerCase()
    if (!isOpenAiCompatibleReasoningEffort(effort) || efforts.includes(effort)) {
      continue
    }
    efforts.push(effort)
  }
  return efforts
}

/**
 * Service tiers the OpenAI-compatible wire can actually request. The AI SDK's
 * `@ai-sdk/openai` provider option accepts exactly this set, so a gateway tier
 * outside it cannot be sent from Cradle; advertising it would put a control in
 * the picker that silently does nothing. Declared tiers are filtered to what a
 * run can request, and the rest stay visible only in the gateway.
 */
const OPENAI_COMPATIBLE_WIRE_SERVICE_TIERS = new Set(['auto', 'flex', 'priority', 'default'])

/**
 * Service tiers are sent back to the gateway verbatim, so the declared id is the
 * wire value. A tier without a name still needs one for a picker: fall back to
 * the id instead of inventing a label.
 */
function readDeclaredServiceTiers(model: OpenAICompatibleModel): ModelServiceTier[] {
  const tiers: ModelServiceTier[] = []
  for (const tier of model.service_tiers ?? []) {
    const id = tier.id.trim()
    if (!id || !OPENAI_COMPATIBLE_WIRE_SERVICE_TIERS.has(id) || tiers.some(existing => existing.id === id)) {
      continue
    }
    const name = tier.name?.trim() || id
    const description = tier.description?.trim()
    tiers.push(description ? { id, name, description } : { id, name })
  }
  return tiers
}

function isOpenAiCompatibleReasoningEffort(
  value: string | undefined,
): value is OpenAICompatibleReasoningEffort {
  return value !== undefined
    && (OPENAI_COMPATIBLE_REASONING_EFFORTS as readonly string[]).includes(value)
}

function invalidProviderRequest(message: string): AppError {
  return new AppError({
    code: 'invalid_provider_request',
    status: 400,
    message,
  })
}

function providerModelsUnavailable(providerKind: ProviderKind, message: string): AppError {
  return new AppError({
    code: 'provider_models_unavailable',
    status: 502,
    message,
    details: { providerKind },
  })
}

function wrapProviderModelsError(providerKind: ProviderKind, error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }
  if (error instanceof CodexChatgptAuthReauthRequiredError) {
    return new AppError({
      code: error.code,
      status: 401,
      message: 'ChatGPT sign-in expired. Please sign in again.',
      details: { providerKind },
    })
  }
  const message = error instanceof Error ? error.message : String(error)
  return providerModelsUnavailable(providerKind, message)
}

function modelRequestOptions(baseUrl: string, headers?: HeadersInit): ModelsRequestOption[] {
  const normalized = normalizeBaseUrl(baseUrl).replace(TRAILING_SLASH_RE, '')
  const urls = VERSIONED_API_PATH_RE.test(normalized)
    ? [`${normalized}/models`]
    : [`${normalized}/v1/models`, `${normalized}/models`]

  return urls.map(url => ({ url, headers }))
}

function readPrivateProviderHostAllowlist(): Set<string> {
  const allowlist = new Set(
    (process.env[PRIVATE_PROVIDER_HOSTS_ENV] ?? '')
      .split(/[,\s]+/)
      .map(host => host.trim().toLowerCase().replace(/^\[|\]$/g, ''))
      .filter(Boolean),
  )

  // The Desktop app owns a local-only server by default and intentionally
  // manages local provider processes such as CLIProxyAPI. Permit only the
  // loopback hosts in that process; standalone/network-bound servers keep the
  // explicit opt-in requirement for private provider endpoints.
  if (process.env[DESKTOP_PROCESS_ENV]?.trim()
    && isLoopbackBindHost(process.env.CRADLE_HOST ?? '127.0.0.1')) {
    for (const host of DESKTOP_LOCAL_PROVIDER_HOSTS) {
      allowlist.add(host)
    }
  }

  return allowlist
}

async function fetchModelsPayload(
  providerKind: ProviderKind,
  options: ModelsRequestOption[],
): Promise<unknown> {
  let lastError: unknown = null
  const allowPrivateHosts = readPrivateProviderHostAllowlist()

  for (const option of options) {
    try {
      const response = await guardedFetch(option.url, {
        headers: option.headers,
      }, {
        allowPrivateHosts,
        blockedHostCode: 'provider_base_url_blocked_host',
        invalidSchemeCode: 'provider_base_url_invalid_scheme',
        invalidUrlCode: 'provider_base_url_invalid_url',
        message: 'Provider model endpoint is not allowed',
        unresolvedHostCode: 'provider_base_url_unresolved_host',
      })
      if (response.ok) {
        return response.json()
      }
      lastError = providerModelsUnavailable(
        providerKind,
        `Provider models request failed at ${option.url} with status ${response.status}`,
      )
    }
    catch (error) {
      lastError = error
    }
  }

  if (lastError instanceof Error) {
    throw lastError
  }

  throw providerModelsUnavailable(providerKind, 'Provider models request failed')
}

// ── singleton accessor ──

let _catalog: ProviderCatalog | null = null

export function getProviderCatalog(): ProviderCatalog {
  _catalog ??= new ProviderCatalog()
  return _catalog
}
