import { AppError } from '../../../../errors/app-error'
import { outboundFetch } from '../../../../lib/outbound-network'
import * as Preferences from '../../../preferences/service'
import { readTrustedCodexConfig } from '../../../provider-contracts/provider-base'
import * as ProviderTargets from '../../../provider-targets/service'
import * as Secrets from '../../../secrets/service'
import type { ConsumeAccountRateLimitResetCreditParams } from '../app-server-protocol/v2/ConsumeAccountRateLimitResetCreditParams'
import type { ConsumeAccountRateLimitResetCreditResponse } from '../app-server-protocol/v2/ConsumeAccountRateLimitResetCreditResponse'
import type { GetAccountRateLimitsResponse } from '../app-server-protocol/v2/GetAccountRateLimitsResponse'
import type { GetAccountResponse } from '../app-server-protocol/v2/GetAccountResponse'
import type { GetAccountTokenUsageResponse } from '../app-server-protocol/v2/GetAccountTokenUsageResponse'
import type { RateLimitSnapshot } from '../app-server-protocol/v2/RateLimitSnapshot'
import type { RateLimitWindow } from '../app-server-protocol/v2/RateLimitWindow'
import { buildCodexConfig } from '../config/runtime-config'
import { resolveCodexRuntimeContext } from '../config/runtime-context'
import { CODEX_RUNTIME_KIND } from '../metadata'
import type { CodexAppServerClientLike } from '../types'
import { buildDefaultCodexAppServerRequestResult } from './bridge'
import type { CodexAppServerAuthResolution } from './chatgpt-auth'
import {
  ensureCodexChatgptAuthAccessToken,
  readCodexApiKeyAuth,
  readCodexChatgptAuth,
  resolveCodexAppServerAuth,
} from './chatgpt-auth'
import type { CodexAppServerClientOptions } from './client'
import { buildCodexAppServerEnv } from './env'
import { acquireCodexAppServerHostLease, codexProviderTargetDiagnosticsAppServerScopeId } from './host-lease'

export interface CodexRateLimitWindowDiagnostics {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export interface CodexSpendControlLimitDiagnostics {
  limit: string
  used: string
  remainingPercent: number
  resetsAt: number
}

export interface CodexRateLimitSnapshotDiagnostics {
  limitId: string | null
  limitName: string | null
  primary: CodexRateLimitWindowDiagnostics | null
  secondary: CodexRateLimitWindowDiagnostics | null
  credits: {
    hasCredits: boolean
    unlimited: boolean
    balance: string | null
  } | null
  individualLimit: CodexSpendControlLimitDiagnostics | null
  planType: string | null
  rateLimitReachedType: string | null
}

export interface CodexAccountDiagnostics {
  providerTargetId: string
  supported: boolean
  unavailableReason: string | null
  refreshedAt: number | null
  account: {
    authMode: 'chatgptAuthTokens'
    accountType: NonNullable<GetAccountResponse['account']>['type'] | null
    email: string | null
    planType: string | null
    requiresOpenaiAuth: boolean | null
  } | null
  rateLimits: CodexRateLimitSnapshotDiagnostics | null
  rateLimitsByLimitId: Record<string, CodexRateLimitSnapshotDiagnostics> | null
  rateLimitResetCredits: {
    availableCount: string
  } | null
  tokenUsage: {
    summary: {
      lifetimeTokens: string | null
      peakDailyTokens: string | null
      longestRunningTurnSec: string | null
      currentStreakDays: string | null
      longestStreakDays: string | null
    }
    dailyUsageBuckets: Array<{
      startDate: string
      tokens: string
    }>
  } | null
}

export interface CodexRateLimitResetCreditConsumption {
  providerTargetId: string
  outcome: ConsumeAccountRateLimitResetCreditResponse['outcome']
  consumedAt: number
}

export type CodexWhamEndpointKey = 'usage' | 'rateLimitResetCredits' | 'referralEligibilityRules'

export type CodexWhamJsonValue
  = | string
    | number
    | boolean
    | null
    | CodexWhamJsonValue[]
    | { [key: string]: CodexWhamJsonValue }

export interface CodexWhamEndpointResult {
  key: CodexWhamEndpointKey
  url: string
  ok: boolean
  status: number | null
  reason: string | null
  body: CodexWhamJsonValue
}

export interface CodexWhamDiagnostics {
  providerTargetId: string
  supported: boolean
  unavailableReason: string | null
  refreshedAt: number | null
  account: {
    authMode: 'chatgptAuthTokens'
    chatgptAccountId: string
    planType: string | null
  } | null
  endpoints: Record<CodexWhamEndpointKey, CodexWhamEndpointResult | null>
}

interface CodexWhamAuth {
  accessToken: string
  chatgptAccountId: string
}

interface CodexAccountDiagnosticsDeps {
  resolveProviderTarget: typeof ProviderTargets.resolveProviderTarget
  readSecret: typeof Secrets.readSecret
  readSecretValueWithMetadata: typeof Secrets.readSecretValueWithMetadata
  updateSecretValue: typeof Secrets.updateSecretValue
  readCodexPreferences: typeof Preferences.getCodexPreferencesSync
  createAppServerClient?: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
  fetchWhamEndpoint?: (key: CodexWhamEndpointKey, url: string, auth: CodexWhamAuth) => Promise<CodexWhamEndpointResult>
}

interface SupportedCodexAccountDiagnosticsTarget {
  supported: true
  target: ReturnType<typeof ProviderTargets.resolveProviderTarget>
  config: ReturnType<typeof readTrustedCodexConfig>
  auth: Extract<CodexAppServerAuthResolution, { kind: 'chatgptAuthTokens' }>
}

interface UnsupportedCodexAccountDiagnosticsTarget {
  supported: false
  providerTargetId: string
  unavailableReason: string
}

type CodexAccountDiagnosticsTarget
  = | SupportedCodexAccountDiagnosticsTarget
    | UnsupportedCodexAccountDiagnosticsTarget

const DEFAULT_CODEX_ACCOUNT_DIAGNOSTICS_DEPS: CodexAccountDiagnosticsDeps = {
  resolveProviderTarget: ProviderTargets.resolveProviderTarget,
  readSecret: Secrets.readSecret,
  readSecretValueWithMetadata: Secrets.readSecretValueWithMetadata,
  updateSecretValue: Secrets.updateSecretValue,
  readCodexPreferences: Preferences.getCodexPreferencesSync,
}

const CODEX_WHAM_ENDPOINTS: ReadonlyArray<{ key: CodexWhamEndpointKey, url: string }> = [
  { key: 'usage', url: 'https://chatgpt.com/backend-api/wham/usage' },
  { key: 'rateLimitResetCredits', url: 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits' },
  {
    key: 'referralEligibilityRules',
    url: 'https://chatgpt.com/backend-api/wham/referrals/eligibility_rules?referral_key=codex_referral_persistent_invite',
  },
]

export async function readCodexAccountDiagnostics(
  input: { providerTargetId: string },
  deps: CodexAccountDiagnosticsDeps = DEFAULT_CODEX_ACCOUNT_DIAGNOSTICS_DEPS,
): Promise<CodexAccountDiagnostics> {
  const resolved = resolveSupportedCodexAccountDiagnosticsTarget(input.providerTargetId, deps)
  if (!resolved.supported) {
    return {
      providerTargetId: resolved.providerTargetId,
      supported: false,
      unavailableReason: resolved.unavailableReason,
      refreshedAt: null,
      account: null,
      rateLimits: null,
      rateLimitsByLimitId: null,
      rateLimitResetCredits: null,
      tokenUsage: null,
    }
  }

  const { target, config, auth } = resolved
  const chatgptAuth = readCodexChatgptAuth(auth)!
  const hostLease = await acquireDiagnosticsHostLease({
    providerTargetId: target.id,
    config,
    auth,
    deps,
  })
  const client = hostLease.resource.client

  try {
    const [accountResponse, rateLimitsResponse, usageResponse] = await Promise.all([
      client.request('account/read', { refreshToken: false }) as Promise<GetAccountResponse>,
      client.request('account/rateLimits/read', {}) as Promise<GetAccountRateLimitsResponse>,
      client.request('account/usage/read', {}) as Promise<GetAccountTokenUsageResponse>,
    ])

    return {
      providerTargetId: target.id,
      supported: true,
      unavailableReason: null,
      refreshedAt: Date.now(),
      account: projectAccountDiagnostics(accountResponse, chatgptAuth, rateLimitsResponse.rateLimits),
      rateLimits: projectRateLimitSnapshot(rateLimitsResponse.rateLimits),
      rateLimitsByLimitId: projectRateLimitsByLimitId(rateLimitsResponse.rateLimitsByLimitId),
      rateLimitResetCredits: rateLimitsResponse.rateLimitResetCredits
        ? { availableCount: formatCounter(rateLimitsResponse.rateLimitResetCredits.availableCount) }
        : null,
      tokenUsage: projectTokenUsage(usageResponse),
    }
  }
  finally {
    hostLease.release()
  }
}

export async function consumeCodexRateLimitResetCredit(
  input: { providerTargetId: string, idempotencyKey: string },
  deps: CodexAccountDiagnosticsDeps = DEFAULT_CODEX_ACCOUNT_DIAGNOSTICS_DEPS,
): Promise<CodexRateLimitResetCreditConsumption> {
  const resolved = resolveSupportedCodexAccountDiagnosticsTarget(input.providerTargetId, deps)
  if (!resolved.supported) {
    throw new AppError({
      code: 'codex_account_diagnostics_unsupported',
      status: 400,
      message: resolved.unavailableReason,
      details: { providerTargetId: resolved.providerTargetId },
    })
  }

  const hostLease = await acquireDiagnosticsHostLease({
    providerTargetId: resolved.target.id,
    config: resolved.config,
    auth: resolved.auth,
    deps,
  })
  const client = hostLease.resource.client

  try {
    const params: ConsumeAccountRateLimitResetCreditParams = {
      idempotencyKey: input.idempotencyKey,
    }
    const response = await client.request('account/rateLimitResetCredit/consume', params) as ConsumeAccountRateLimitResetCreditResponse
    return {
      providerTargetId: resolved.target.id,
      outcome: response.outcome,
      consumedAt: Date.now(),
    }
  }
  finally {
    hostLease.release()
  }
}

export async function readCodexWhamDiagnostics(
  input: { providerTargetId: string },
  deps: CodexAccountDiagnosticsDeps = DEFAULT_CODEX_ACCOUNT_DIAGNOSTICS_DEPS,
): Promise<CodexWhamDiagnostics> {
  const resolved = resolveSupportedCodexAccountDiagnosticsTarget(input.providerTargetId, deps)
  if (!resolved.supported) {
    return {
      providerTargetId: resolved.providerTargetId,
      supported: false,
      unavailableReason: resolved.unavailableReason,
      refreshedAt: null,
      account: null,
      endpoints: emptyWhamEndpoints(),
    }
  }

  const chatgptAuth = await ensureCodexChatgptAuthAccessToken(readCodexChatgptAuth(resolved.auth)!, {
    updateSecretValue: deps.updateSecretValue,
  })
  if (!chatgptAuth.accessToken) {
    throw new AppError({
      code: 'codex_chatgpt_auth_access_token_missing',
      status: 400,
      message: 'Codex ChatGPT auth requires an access token.',
      details: { providerTargetId: resolved.target.id },
    })
  }

  const auth: CodexWhamAuth = {
    accessToken: chatgptAuth.accessToken,
    chatgptAccountId: chatgptAuth.chatgptAccountId,
  }
  const fetchEndpoint = deps.fetchWhamEndpoint ?? fetchCodexWhamEndpoint
  const results = await Promise.all(
    CODEX_WHAM_ENDPOINTS.map(endpoint => fetchEndpoint(endpoint.key, endpoint.url, auth)),
  )

  return {
    providerTargetId: resolved.target.id,
    supported: true,
    unavailableReason: null,
    refreshedAt: Date.now(),
    account: {
      authMode: 'chatgptAuthTokens',
      chatgptAccountId: chatgptAuth.chatgptAccountId,
      planType: chatgptAuth.chatgptPlanType,
    },
    endpoints: Object.fromEntries(results.map(result => [result.key, result])) as CodexWhamDiagnostics['endpoints'],
  }
}

function resolveSupportedCodexAccountDiagnosticsTarget(
  providerTargetId: string,
  deps: CodexAccountDiagnosticsDeps,
): CodexAccountDiagnosticsTarget {
  const target = deps.resolveProviderTarget(providerTargetId)
  if (target.providerKind !== 'openai-compatible') {
    return {
      supported: false,
      providerTargetId: target.id,
      unavailableReason: 'Codex account diagnostics are only available for Codex provider targets.',
    }
  }

  const config = readTrustedCodexConfig(target.configJson)
  const auth = resolveCodexAppServerAuth({ credentialRef: target.credentialRef }, config, 'OPENAI_API_KEY', deps)
  if (auth.kind !== 'chatgptAuthTokens') {
    return {
      supported: false,
      providerTargetId: target.id,
      unavailableReason: 'Codex account diagnostics require ChatGPT account auth.',
    }
  }

  return {
    supported: true,
    target,
    config,
    auth,
  }
}

async function acquireDiagnosticsHostLease(input: {
  providerTargetId: string
  config: ReturnType<typeof readTrustedCodexConfig>
  auth: Extract<CodexAppServerAuthResolution, { kind: 'chatgptAuthTokens' }>
  deps: CodexAccountDiagnosticsDeps
}) {
  const workspacePath = process.cwd()
  const runtimeContext = resolveCodexRuntimeContext(workspacePath, null)
  const diagnosticsScopeId = codexProviderTargetDiagnosticsAppServerScopeId(input.providerTargetId)
  const chatgptAuth = readCodexChatgptAuth(input.auth)

  return await acquireCodexAppServerHostLease({
    runtimeKind: CODEX_RUNTIME_KIND,
    providerTargetId: input.providerTargetId,
    scopeId: diagnosticsScopeId,
    chatgptAuth,
    options: {
      apiKey: readCodexApiKeyAuth(input.auth) ?? undefined,
      config: buildCodexConfig(input.config, workspacePath, () => [], null, input.config.model, input.auth),
      env: buildCodexAppServerEnv({
        chatSessionId: diagnosticsScopeId,
        workspacePath,
        agentId: null,
        agentHome: runtimeContext.agentHome,
      }, input.auth),
      serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
        chatgptAuth,
        updateSecretValue: input.deps.updateSecretValue,
      }),
    },
    deps: {
      createAppServerClient: input.deps.createAppServerClient,
      readCodexPreferences: input.deps.readCodexPreferences,
      updateSecretValue: input.deps.updateSecretValue,
    },
  })
}

function projectAccountDiagnostics(
  response: GetAccountResponse,
  chatgptAuth: NonNullable<ReturnType<typeof readCodexChatgptAuth>>,
  rateLimits: RateLimitSnapshot,
): NonNullable<CodexAccountDiagnostics['account']> {
  const account = response.account
  const chatgptAccount = account?.type === 'chatgpt' ? account : null

  return {
    authMode: 'chatgptAuthTokens',
    accountType: account?.type ?? null,
    email: chatgptAccount?.email ?? null,
    planType: chatgptAccount?.planType ?? chatgptAuth.chatgptPlanType ?? rateLimits.planType,
    requiresOpenaiAuth: response.requiresOpenaiAuth,
  }
}

function projectRateLimitSnapshot(
  snapshot: RateLimitSnapshot | null,
): CodexRateLimitSnapshotDiagnostics | null {
  if (!snapshot) {
    return null
  }
  return {
    limitId: snapshot.limitId,
    limitName: snapshot.limitName,
    primary: projectRateLimitWindow(snapshot.primary),
    secondary: projectRateLimitWindow(snapshot.secondary),
    credits: snapshot.credits
      ? {
          hasCredits: snapshot.credits.hasCredits,
          unlimited: snapshot.credits.unlimited,
          balance: snapshot.credits.balance,
        }
      : null,
    individualLimit: snapshot.individualLimit
      ? {
          limit: snapshot.individualLimit.limit,
          used: snapshot.individualLimit.used,
          remainingPercent: snapshot.individualLimit.remainingPercent,
          resetsAt: snapshot.individualLimit.resetsAt,
        }
      : null,
    planType: snapshot.planType,
    rateLimitReachedType: snapshot.rateLimitReachedType,
  }
}

function projectRateLimitsByLimitId(
  snapshots: GetAccountRateLimitsResponse['rateLimitsByLimitId'],
): Record<string, CodexRateLimitSnapshotDiagnostics> | null {
  if (!snapshots) {
    return null
  }
  return Object.fromEntries(
    Object.entries(snapshots)
      .filter((entry): entry is [string, RateLimitSnapshot] => Boolean(entry[1]))
      .map(([limitId, snapshot]) => [limitId, projectRateLimitSnapshot(snapshot)!]),
  )
}

function projectRateLimitWindow(
  window: RateLimitWindow | null,
): CodexRateLimitWindowDiagnostics | null {
  if (!window) {
    return null
  }
  return {
    usedPercent: window.usedPercent,
    windowDurationMins: window.windowDurationMins,
    resetsAt: window.resetsAt,
  }
}

function projectTokenUsage(response: GetAccountTokenUsageResponse): CodexAccountDiagnostics['tokenUsage'] {
  return {
    summary: {
      lifetimeTokens: formatNullableCounter(response.summary.lifetimeTokens),
      peakDailyTokens: formatNullableCounter(response.summary.peakDailyTokens),
      longestRunningTurnSec: formatNullableCounter(response.summary.longestRunningTurnSec),
      currentStreakDays: formatNullableCounter(response.summary.currentStreakDays),
      longestStreakDays: formatNullableCounter(response.summary.longestStreakDays),
    },
    dailyUsageBuckets: (response.dailyUsageBuckets ?? []).map(bucket => ({
      startDate: bucket.startDate,
      tokens: formatCounter(bucket.tokens),
    })),
  }
}

function formatNullableCounter(value: bigint | number | string | null): string | null {
  return value === null ? null : formatCounter(value)
}

function formatCounter(value: bigint | number | string): string {
  return String(value)
}

function emptyWhamEndpoints(): CodexWhamDiagnostics['endpoints'] {
  return {
    usage: null,
    rateLimitResetCredits: null,
    referralEligibilityRules: null,
  }
}

async function fetchCodexWhamEndpoint(
  key: CodexWhamEndpointKey,
  url: string,
  auth: CodexWhamAuth,
): Promise<CodexWhamEndpointResult> {
  try {
    const response = await outboundFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${auth.accessToken}`,
        'Accept': 'application/json',
        'User-Agent': 'cradle-codex-wham-diagnostics',
        'Origin': 'https://chatgpt.com',
        'Referer': 'https://chatgpt.com/codex',
        'ChatGPT-Account-ID': auth.chatgptAccountId,
      },
    })
    const body = await readWhamResponseBody(response)
    return {
      key,
      url,
      ok: response.ok,
      status: response.status,
      reason: response.ok ? null : response.statusText || null,
      body,
    }
  }
  catch (error) {
    return {
      key,
      url,
      ok: false,
      status: null,
      reason: error instanceof Error ? error.message : String(error),
      body: null,
    }
  }
}

async function readWhamResponseBody(response: Response): Promise<CodexWhamJsonValue> {
  const text = await response.text()
  if (!text.trim()) {
    return null
  }
  try {
    return JSON.parse(text) as CodexWhamJsonValue
  }
  catch {
    return text
  }
}
