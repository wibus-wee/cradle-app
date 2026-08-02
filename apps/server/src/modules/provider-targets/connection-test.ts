import { kvCache } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { isLoopbackBindHost } from '../../config/server-config'
import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { guardedFetch } from '../../lib/ssrf-guard'
import { getProviderCatalog } from '../provider-catalog/catalog'
import { resolveAnthropicWireAuth } from '../provider-catalog/provider-endpoint-registry'
import {
  AnthropicConfigJsonSchema,
  normalizeBaseUrl,
  OpenAICompatibleConfigJsonSchema,
  UniversalProviderConfigJsonSchema,
} from '../provider-contracts/provider-base'
import type { ProviderKind, ProviderRequest } from '../provider-contracts/types'
import * as Secrets from '../secrets/service'
import { resolveProviderTarget } from './service'

export type ProviderConnectionStatus
  = | 'ok'
    | 'auth_failed'
    | 'network_error'
    | 'endpoint_error'
    | 'model_unavailable'

export interface ProviderConnectionTestResult {
  status: ProviderConnectionStatus
  latencyMs: number
  checkedAt: string
  modelsCount?: number
  detail?: string
  deep?: boolean
  model?: string
}

const PROBE_TIMEOUT_MS = 10_000
const CACHE_TTL_SECONDS = 60 * 60 * 24 // 24 hours
const ANTHROPIC_VERSION = '2023-06-01'
const HTTP_STATUS_MESSAGE_RE = /with status (\d{3})/
const UNKNOWN_MODEL_BODY_RE = /unknown model|model.*(not found|does not exist|is not supported)|no such model|invalid model/i
const DETAIL_MAX_LENGTH = 200

class ProbeTimeoutError extends Error {
  constructor() {
    super(`Provider connection probe timed out after ${PROBE_TIMEOUT_MS}ms`)
    this.name = 'ProbeTimeoutError'
  }
}

const ConnectionTestResultJsonSchema = z
  .string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    status: z.enum(['ok', 'auth_failed', 'network_error', 'endpoint_error', 'model_unavailable']),
    latencyMs: z.number(),
    checkedAt: z.string(),
    modelsCount: z.number().optional(),
    detail: z.string().optional(),
    deep: z.boolean().optional(),
    model: z.string().optional(),
  }))

const DefaultModelConfigJsonSchema = z
  .string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    model: z.string().trim().min(1).nullable().default(null),
  }).passthrough())

function connectionTestCacheKey(providerTargetId: string): string {
  return `provider-test-result:${providerTargetId}`
}

function withTimeout<T>(run: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    run(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProbeTimeoutError()), timeoutMs)
      timer.unref?.()
    }),
  ]).finally(() => clearTimeout(timer))
}

function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > DETAIL_MAX_LENGTH ? message.slice(0, DETAIL_MAX_LENGTH) : message
}

function classifyHttpStatus(httpStatus: number): ProviderConnectionStatus {
  if (httpStatus === 401 || httpStatus === 403) {
    return 'auth_failed'
  }
  return 'endpoint_error'
}

function classifyProbeError(error: unknown): ProviderConnectionStatus {
  if (error instanceof ProbeTimeoutError) {
    return 'network_error'
  }
  if (error instanceof AppError) {
    if (error.status === 401 || error.status === 403) {
      return 'auth_failed'
    }
    if (error.code === 'secret_not_found' || error.code === 'secret_not_configured') {
      return 'auth_failed'
    }
    if (error.code === 'provider_base_url_unresolved_host') {
      return 'network_error'
    }
    const statusMatch = HTTP_STATUS_MESSAGE_RE.exec(error.message)
    if (statusMatch) {
      return classifyHttpStatus(Number(statusMatch[1]))
    }
    if (error.code.startsWith('provider_base_url_') || error.code === 'invalid_provider_request') {
      return 'endpoint_error'
    }
  }
  // Raw transport failures (ECONNREFUSED, ENOTFOUND, TLS, abort) surface here.
  return 'network_error'
}

function writeCachedConnectionTest(
  providerTargetId: string,
  result: ProviderConnectionTestResult,
): void {
  try {
    const key = connectionTestCacheKey(providerTargetId)
    const value = JSON.stringify(result)
    const expiresAt = Math.floor(Date.now() / 1000) + CACHE_TTL_SECONDS
    db()
      .insert(kvCache)
      .values({ key, value, expiresAt })
      .onConflictDoUpdate({ target: kvCache.key, set: { value, expiresAt } })
      .run()
  }
  catch {
    // non-critical diagnostics cache, ignore write failures
  }
}

export async function readCachedConnectionTest(
  providerTargetId: string,
): Promise<ProviderConnectionTestResult | null> {
  const row = db()
    .select()
    .from(kvCache)
    .where(eq(kvCache.key, connectionTestCacheKey(providerTargetId)))
    .get()
  if (!row || row.expiresAt * 1000 <= Date.now()) {
    return null
  }
  try {
    return ConnectionTestResultJsonSchema.parse(row.value)
  }
  catch {
    return null
  }
}

interface DeepProbeRequest {
  url: string
  headers: Record<string, string>
  body: string
}

function buildDeepProbeRequest(
  providerKind: ProviderKind,
  configJson: string,
  secret: string | null,
  model: string,
): DeepProbeRequest {
  const pingBody = JSON.stringify({
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  })

  if (providerKind === 'anthropic') {
    const config = AnthropicConfigJsonSchema.parse(configJson)
    const baseUrl = normalizeBaseUrl(config.baseUrl ?? 'https://api.anthropic.com/v1')
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
    }
    if (secret) {
      if (resolveAnthropicWireAuth(config.baseUrl) === 'bearer-token') {
        headers.Authorization = `Bearer ${secret}`
      }
      else {
        headers['x-api-key'] = secret
      }
    }
    return { url: `${baseUrl}/messages`, headers, body: pingBody }
  }

  const baseUrl = providerKind === 'universal'
    ? (() => {
        const config = UniversalProviderConfigJsonSchema.parse(configJson)
        return config.openaiBaseUrl || config.baseUrl
      })()
    : OpenAICompatibleConfigJsonSchema.parse(configJson).baseUrl

  if (!baseUrl) {
    throw new AppError({
      code: 'invalid_provider_request',
      status: 400,
      message: 'Base URL is required for a deep connection test',
    })
  }

  return {
    url: `${normalizeBaseUrl(baseUrl)}/chat/completions`,
    headers: {
      'content-type': 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: pingBody,
  }
}

function deepTestSkipReason(providerKind: ProviderKind, configJson: string, model: string | null): string | null {
  if (!model) {
    return 'Deep test skipped: no model configured'
  }
  if (providerKind === 'openai-compatible') {
    // ChatGPT login is an account identity, not an OpenAI-compatible gateway;
    // POSTing chat/completions with the token JSON would produce a bogus verdict.
    const authMode = OpenAICompatibleConfigJsonSchema.parse(configJson).authMode
    if (authMode === 'chatgptAuthTokens') {
      return 'Deep test skipped: ChatGPT account credentials are not an OpenAI-compatible gateway'
    }
  }
  return null
}

async function runDeepProbe(
  providerKind: ProviderKind,
  configJson: string,
  credentialRef: string | null,
  model: string,
): Promise<{ status: ProviderConnectionStatus, detail?: string }> {
  try {
    const secret = credentialRef ? Secrets.readSecret(credentialRef) : null
    const request = buildDeepProbeRequest(providerKind, configJson, secret, model)
    const response = await guardedFetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    }, {
      allowPrivateHosts: readPrivateProviderHostAllowlist(),
      blockedHostCode: 'provider_base_url_blocked_host',
      invalidSchemeCode: 'provider_base_url_invalid_scheme',
      invalidUrlCode: 'provider_base_url_invalid_url',
      message: 'Provider chat endpoint is not allowed',
      unresolvedHostCode: 'provider_base_url_unresolved_host',
    })

    if (response.ok) {
      return { status: 'ok' }
    }

    const bodyText = (await response.text().catch(() => '')).slice(0, DETAIL_MAX_LENGTH)
    if (response.status === 404 || UNKNOWN_MODEL_BODY_RE.test(bodyText)) {
      return {
        status: 'model_unavailable',
        detail: `Model "${model}" is not available (HTTP ${response.status})`,
      }
    }
    const status = classifyHttpStatus(response.status)
    return {
      status,
      detail: `Deep test request failed with HTTP ${response.status}${bodyText ? `: ${bodyText}` : ''}`,
    }
  }
  catch (error) {
    return { status: classifyProbeError(error), detail: errorSummary(error) }
  }
}

export async function testProviderConnection(
  providerTargetId: string,
  options: { deep?: boolean, model?: string } = {},
): Promise<ProviderConnectionTestResult> {
  const resolved = resolveProviderTarget(providerTargetId)
  const startedAt = Date.now()
  const checkedAt = new Date().toISOString()

  const provider = getProviderCatalog().get(resolved.providerKind)
  if (!provider) {
    throw new AppError({
      code: 'provider_not_available',
      status: 501,
      message: `Provider is not available: ${resolved.providerKind}`,
      details: { providerKind: resolved.providerKind },
    })
  }

  const request: ProviderRequest = {
    providerKind: resolved.providerKind,
    label: resolved.label,
    configJson: resolved.configJson,
    secretRef: resolved.credentialRef,
    profileId: resolved.id,
    providerTargetKind: resolved.target.kind,
    providerTargetId: resolved.target.id,
    sourceApp: resolved.sourceMetadata?.app ?? null,
  }

  let result: ProviderConnectionTestResult
  try {
    const models = await withTimeout(
      () => provider.listModels(request, {
        readSecret: secretRef => Secrets.readSecret(secretRef),
      }),
      PROBE_TIMEOUT_MS,
    )
    result = {
      status: 'ok',
      latencyMs: Date.now() - startedAt,
      checkedAt,
      modelsCount: models.length,
    }
  }
  catch (error) {
    result = {
      status: classifyProbeError(error),
      latencyMs: Date.now() - startedAt,
      checkedAt,
      detail: errorSummary(error),
    }
  }

  if (result.status === 'ok' && options.deep) {
    const model = options.model ?? readConfiguredDefaultModel(resolved.configJson)
    result.deep = true
    const skipReason = deepTestSkipReason(resolved.providerKind, resolved.configJson, model)
    if (skipReason) {
      result.detail = skipReason
    }
    else if (model) {
      result.model = model
      const deepOutcome = await runDeepProbe(
        resolved.providerKind,
        resolved.configJson,
        resolved.credentialRef,
        model,
      )
      result.latencyMs = Date.now() - startedAt
      if (deepOutcome.status !== 'ok') {
        result.status = deepOutcome.status
      }
      if (deepOutcome.detail) {
        result.detail = deepOutcome.detail
      }
    }
  }

  writeCachedConnectionTest(providerTargetId, result)
  return result
}

function readConfiguredDefaultModel(configJson: string): string | null {
  try {
    return DefaultModelConfigJsonSchema.parse(configJson).model
  }
  catch {
    return null
  }
}

// Mirrors the catalog's private-host allowlist (catalog.ts readPrivateProviderHostAllowlist);
// kept as a local copy because the catalog does not export it.
function readPrivateProviderHostAllowlist(): Set<string> {
  const allowlist = new Set(
    (process.env.CRADLE_ALLOW_PRIVATE_PROVIDER_HOSTS ?? '')
      .split(/[,\s]+/)
      .map(host => host.trim().toLowerCase().replace(/^\[|\]$/g, ''))
      .filter(Boolean),
  )

  if (process.env.CRADLE_DESKTOP_PID?.trim()
    && isLoopbackBindHost(process.env.CRADLE_HOST ?? '127.0.0.1')) {
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      allowlist.add(host)
    }
  }

  return allowlist
}
