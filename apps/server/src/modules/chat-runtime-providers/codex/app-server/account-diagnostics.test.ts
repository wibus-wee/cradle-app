import { afterEach, describe, expect, it, vi } from 'vitest'

import { providerRuntimeHostManager } from '../../../provider-runtime/host-manager'
import type { ResolvedProviderTarget } from '../../../provider-targets/service'
import type { CodexAppServerClientLike } from '../types'
import type { CodexWhamEndpointKey, CodexWhamEndpointResult } from './account-diagnostics'
import {
  consumeCodexRateLimitResetCredit,
  readCodexAccountDiagnostics,
  readCodexWhamDiagnostics,
} from './account-diagnostics'
import { CODEX_CHATGPT_AUTH_SECRET_KIND } from './chatgpt-auth'
import type { CodexAppServerClientOptions } from './client'
import { codexProviderTargetDiagnosticsAppServerScopeId } from './host-lease'

class FakeCodexAccountClient implements CodexAppServerClientLike {
  readonly requests: Array<{ method: string, params?: unknown }> = []
  readonly close = vi.fn()
  readonly initialize = vi.fn(async () => undefined)

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    switch (method) {
      case 'account/login/start':
        return {}
      case 'account/read':
        return {
          account: { type: 'chatgpt', email: 'user@example.com', planType: 'pro' },
          requiresOpenaiAuth: false,
        }
      case 'account/rateLimits/read':
        return {
          rateLimits: {
            limitId: 'codex',
            limitName: 'Codex',
            primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1_800_000_000 },
            secondary: null,
            credits: { hasCredits: true, unlimited: false, balance: '20.00' },
            individualLimit: { limit: '100.00', used: '12.34', remainingPercent: 87.66, resetsAt: 1_800_100_000 },
            planType: 'plus',
            rateLimitReachedType: null,
          },
          rateLimitsByLimitId: {
            codex: {
              limitId: 'codex',
              limitName: 'Codex',
              primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1_800_000_000 },
              secondary: { usedPercent: 10, windowDurationMins: 10_080, resetsAt: 1_800_200_000 },
              credits: { hasCredits: true, unlimited: false, balance: '20.00' },
              individualLimit: { limit: '100.00', used: '12.34', remainingPercent: 87.66, resetsAt: 1_800_100_000 },
              planType: 'plus',
              rateLimitReachedType: null,
            },
          },
          rateLimitResetCredits: { availableCount: 2n },
        }
      case 'account/usage/read':
        return {
          summary: {
            lifetimeTokens: 1234567890123456789n,
            peakDailyTokens: 42n,
            longestRunningTurnSec: 7n,
            currentStreakDays: 3n,
            longestStreakDays: 5n,
          },
          dailyUsageBuckets: [
            { startDate: '2026-06-19', tokens: 42n },
          ],
        }
      case 'account/rateLimitResetCredit/consume':
        return { outcome: 'reset' }
      default:
        throw new Error(`Unexpected Codex request: ${method}`)
    }
  }

  async nextNotification(): Promise<null> {
    return null
  }
}

afterEach(() => {
  providerRuntimeHostManager.clear()
})

describe('codex account diagnostics', () => {
  it('returns unsupported without creating an app-server client', async () => {
    const createAppServerClient = vi.fn()
    const diagnostics = await readCodexAccountDiagnostics({
      providerTargetId: 'anthropic-target',
    }, {
      ...createDiagnosticsDeps({
        providerTargetId: 'anthropic-target',
        providerKind: 'anthropic',
        credentialRef: null,
      }),
      createAppServerClient,
    })

    expect(diagnostics.supported).toBe(false)
    expect(diagnostics.unavailableReason).toBe('Codex account diagnostics are only available for Codex provider targets.')
    expect(createAppServerClient).not.toHaveBeenCalled()
  })

  it('projects rate limits, reset credits, and token usage for ChatGPT auth', async () => {
    const client = new FakeCodexAccountClient()
    const appServerOptions: CodexAppServerClientOptions[] = []
    const diagnostics = await readCodexAccountDiagnostics({
      providerTargetId: 'codex-chatgpt-target',
    }, createDiagnosticsDeps({
      providerTargetId: 'codex-chatgpt-target',
      providerKind: 'openai-compatible',
      credentialRef: 'credential-chatgpt',
      client,
      appServerOptions,
    }))

    expect(diagnostics.supported).toBe(true)
    expect(diagnostics.account).toMatchObject({
      authMode: 'chatgptAuthTokens',
      accountType: 'chatgpt',
      email: 'user@example.com',
      planType: 'pro',
      requiresOpenaiAuth: false,
    })
    expect(diagnostics.rateLimits?.primary?.usedPercent).toBe(40)
    expect(diagnostics.rateLimits?.individualLimit).toEqual({
      limit: '100.00',
      used: '12.34',
      remainingPercent: 87.66,
      resetsAt: 1_800_100_000,
    })
    expect(diagnostics.rateLimitsByLimitId?.codex?.secondary?.windowDurationMins).toBe(10_080)
    expect(diagnostics.rateLimitResetCredits?.availableCount).toBe('2')
    expect(diagnostics.tokenUsage?.summary.lifetimeTokens).toBe('1234567890123456789')
    expect(diagnostics.tokenUsage?.dailyUsageBuckets).toEqual([
      { startDate: '2026-06-19', tokens: '42' },
    ])
    expect(client.requests.map(request => request.method)).toEqual([
      'account/login/start',
      'account/read',
      'account/rateLimits/read',
      'account/usage/read',
    ])
    expect(appServerOptions[0]?.env?.CRADLE_CHAT_SESSION_ID).toBe(
      codexProviderTargetDiagnosticsAppServerScopeId('codex-chatgpt-target'),
    )
    expect(client.close).toHaveBeenCalled()
  })

  it('uses a provider-target diagnostics host scope while account reads are active', async () => {
    const client = new FakeCodexAccountClient()
    const accountReadStarted: {
      resolve: (() => void) | null
      promise: Promise<void>
    } = {
      resolve: null,
      promise: Promise.resolve(),
    }
    accountReadStarted.promise = new Promise((resolve) => {
      accountReadStarted.resolve = resolve
    })
    const originalRequest = client.request.bind(client)
    vi.spyOn(client, 'request').mockImplementation(async (method, params) => {
      if (method === 'account/read') {
        accountReadStarted.resolve?.()
        return new Promise(() => undefined)
      }
      return originalRequest(method, params)
    })

    const diagnosticsPromise = readCodexAccountDiagnostics({
      providerTargetId: 'codex-chatgpt-target',
    }, createDiagnosticsDeps({
      providerTargetId: 'codex-chatgpt-target',
      providerKind: 'openai-compatible',
      credentialRef: 'credential-chatgpt',
      client,
    }))

    await accountReadStarted.promise

    expect(providerRuntimeHostManager.listHosts()).toEqual([
      expect.objectContaining({
        runtimeKind: 'codex',
        providerTargetId: 'codex-chatgpt-target',
        scopeId: codexProviderTargetDiagnosticsAppServerScopeId('codex-chatgpt-target'),
        hasResource: true,
      }),
    ])

    await expect(Promise.race([
      diagnosticsPromise,
      Promise.resolve('diagnostics-still-active'),
    ])).resolves.toBe('diagnostics-still-active')
  })

  it('passes the reset credit idempotency key to Codex app-server', async () => {
    const client = new FakeCodexAccountClient()
    const result = await consumeCodexRateLimitResetCredit({
      providerTargetId: 'codex-chatgpt-reset-target',
      idempotencyKey: 'reset-attempt-1',
    }, createDiagnosticsDeps({
      providerTargetId: 'codex-chatgpt-reset-target',
      providerKind: 'openai-compatible',
      credentialRef: 'credential-chatgpt',
      client,
    }))

    expect(result.outcome).toBe('reset')
    expect(client.requests).toContainEqual({
      method: 'account/rateLimitResetCredit/consume',
      params: { idempotencyKey: 'reset-attempt-1' },
    })
  })

  it('returns unsupported WHAM diagnostics without fetching endpoints', async () => {
    const fetchWhamEndpoint = vi.fn()
    const diagnostics = await readCodexWhamDiagnostics({
      providerTargetId: 'anthropic-target',
    }, {
      ...createDiagnosticsDeps({
        providerTargetId: 'anthropic-target',
        providerKind: 'anthropic',
        credentialRef: null,
      }),
      fetchWhamEndpoint,
    })

    expect(diagnostics.supported).toBe(false)
    expect(diagnostics.endpoints).toEqual({
      usage: null,
      rateLimitResetCredits: null,
      referralEligibilityRules: null,
    })
    expect(fetchWhamEndpoint).not.toHaveBeenCalled()
  })

  it('reads WHAM diagnostics with the ChatGPT bearer credential', async () => {
    const fetchWhamEndpoint = vi.fn(async (
      key: CodexWhamEndpointKey,
      url: string,
      _auth: { accessToken: string, chatgptAccountId: string },
    ): Promise<CodexWhamEndpointResult> => ({
      key,
      url,
      ok: true,
      status: 200,
      reason: null,
      body: key === 'rateLimitResetCredits'
        ? { available_credits: 2, credits: [{ expires_at: 1_800_000_000 }] }
        : { ok: true },
    }))

    const diagnostics = await readCodexWhamDiagnostics({
      providerTargetId: 'codex-chatgpt-target',
    }, {
      ...createDiagnosticsDeps({
        providerTargetId: 'codex-chatgpt-target',
        providerKind: 'openai-compatible',
        credentialRef: 'credential-chatgpt',
      }),
      fetchWhamEndpoint,
    })

    expect(diagnostics.supported).toBe(true)
    expect(diagnostics.account).toEqual({
      authMode: 'chatgptAuthTokens',
      chatgptAccountId: 'account-id',
      planType: 'plus',
    })
    expect(fetchWhamEndpoint).toHaveBeenCalledTimes(3)
    expect(fetchWhamEndpoint.mock.calls[0]?.[2]).toEqual({
      accessToken: 'access-token',
      chatgptAccountId: 'account-id',
    })
    expect(diagnostics.endpoints.rateLimitResetCredits?.body).toEqual({
      available_credits: 2,
      credits: [{ expires_at: 1_800_000_000 }],
    })
  })
})

function createDiagnosticsDeps(input: {
  providerTargetId: string
  providerKind: ResolvedProviderTarget['providerKind']
  credentialRef: string | null
  client?: CodexAppServerClientLike
  appServerOptions?: CodexAppServerClientOptions[]
}) {
  return {
    resolveProviderTarget: () => createResolvedProviderTarget(input),
    readSecret: () => createChatgptSecret(),
    readSecretValueWithMetadata: () => ({
      id: input.credentialRef ?? 'credential-chatgpt',
      kind: CODEX_CHATGPT_AUTH_SECRET_KIND,
      label: 'ChatGPT',
      secret: createChatgptSecret(),
    }),
    updateSecretValue: vi.fn(),
    readCodexPreferences: () => ({ useCradleUserAgent: true }),
    createAppServerClient: input.client
      ? (options: CodexAppServerClientOptions) => {
          input.appServerOptions?.push(options)
          return input.client!
        }
      : undefined,
  }
}

function createResolvedProviderTarget(input: {
  providerTargetId: string
  providerKind: ResolvedProviderTarget['providerKind']
  credentialRef: string | null
}): ResolvedProviderTarget {
  return {
    target: {
      id: input.providerTargetId,
      kind: 'manual',
    },
    id: input.providerTargetId,
    kind: 'manual',
    label: 'Provider',
    providerKind: input.providerKind,
    enabled: true,
    connectionConfigJson: '{}',
    configJson: JSON.stringify({
      authMode: input.credentialRef ? 'chatgptAuthTokens' : 'apikey',
      enabledModels: [],
      skillPaths: [],
      additionalDirectories: [],
    }),
    credentialRef: input.credentialRef,
    enabledModelsJson: '[]',
    customModelsJson: '[]',
    iconSlug: null,
    sourceMetadata: null,
  }
}

function createChatgptSecret(): string {
  return JSON.stringify({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    chatgptAccountId: 'account-id',
    chatgptPlanType: 'plus',
  })
}
