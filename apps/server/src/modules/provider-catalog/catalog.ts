import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { guardedFetch } from '../../lib/ssrf-guard'
import {
  CodexChatgptAuthReauthRequiredError,
  ensureCodexChatgptAuthAccessToken,
  readCodexChatgptAuthCredential,
} from '../chat-runtime-providers/codex/app-server/chatgpt-auth'
import {
  AnthropicConfigJsonSchema,
  normalizeBaseUrl,
  OpenAICompatibleConfigJsonSchema,
  UniversalProviderConfigJsonSchema,
} from '../provider-contracts/provider-base'
import type { ModelDescriptor, ProviderKind, ProviderRequest } from '../provider-contracts/types'
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
const OpenAICompatibleModelsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
      }),
    )
    .min(1),
})

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
            await projectOpenAICompatibleModelListAuthHeaders(input.secretRef, secret, deps),
          ),
        ),
      )

      return payload.data.map(item => ({
        id: item.id,
        label: item.id,
        providerKind: 'openai-compatible' as const,
        capabilities: {},
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

async function projectOpenAICompatibleModelListAuthHeaders(
  secretRef: string | null,
  secret: string | null,
  deps: ProviderCatalogDeps,
): Promise<Record<string, string> | undefined> {
  const chatgptAuth = readCodexChatgptAuthCredential(secretRef, secret)
  if (!chatgptAuth) {
    return secret ? { Authorization: `Bearer ${secret}` } : undefined
  }

  const credential = await ensureCodexChatgptAuthAccessToken(chatgptAuth, {
    updateSecretValue: deps.updateSecretValue,
  })
  if (!credential.accessToken) {
    throw new Error('ChatGPT auth requires an access token')
  }
  return {
    'Authorization': `Bearer ${credential.accessToken}`,
    'ChatGPT-Account-ID': credential.chatgptAccountId,
  }
}

class UniversalMetadataProvider implements ProviderMetadataProvider {
  readonly providerKind = 'universal' as const

  async listModels(
    input: ProviderRequest,
    deps: ProviderCatalogDeps,
  ): Promise<ModelDescriptor[]> {
    const config = UniversalProviderConfigJsonSchema.parse(input.configJson)
    const openaiBaseUrl = config.openaiBaseUrl || config.baseUrl
    if (!openaiBaseUrl) {
      throw invalidProviderRequest('OpenAI Base URL is required')
    }

    const apiKey = input.secretRef ? deps.readSecret(input.secretRef) : null

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
        label: item.id,
        providerKind: 'universal' as const,
        capabilities: {},
      }))
    }
    catch (error) {
      throw wrapProviderModelsError(this.providerKind, error)
    }
  }
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
  return new Set(
    (process.env[PRIVATE_PROVIDER_HOSTS_ENV] ?? '')
      .split(/[,\s]+/)
      .map(host => host.trim().toLowerCase().replace(/^\[|\]$/g, ''))
      .filter(Boolean),
  )
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
