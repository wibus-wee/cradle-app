import { t } from 'elysia'

import { modelCapabilitiesSchema, providerKindSchema } from '../provider-contracts/model'

const providerTargetKind = t.Union([t.Literal('manual'), t.Literal('external')])
const providerKind = providerKindSchema
const nullableString = t.Union([t.String(), t.Null()])
const nullableNumber = t.Union([t.Number(), t.Null()])
const providerAuthDiagnosticsStatus = t.Union([
  t.Literal('ready'),
  t.Literal('warning'),
  t.Literal('error'),
  t.Literal('unknown'),
])
const providerAuthStatus = t.Union([
  t.Literal('authenticated'),
  t.Literal('unauthenticated'),
  t.Literal('unknown'),
])
const claudeAgentAuthMode = t.Union([t.Literal('apiKey'), t.Literal('claudeAi')])
const codexAccountType = t.Union([
  t.Literal('apiKey'),
  t.Literal('chatgpt'),
  t.Literal('amazonBedrock'),
])

const claudeAgentConfigPatch = t.Union([
  t.Object({
    modelAliases: t.Optional(t.Object({
      haiku: t.Optional(t.String()),
      sonnet: t.Optional(t.String()),
      opus: t.Optional(t.String()),
    }, { additionalProperties: false })),
  }, { additionalProperties: false }),
  t.Null(),
])

const codexRateLimitWindowDiagnostics = t.Object({
  usedPercent: t.Number(),
  windowDurationMins: nullableNumber,
  resetsAt: nullableNumber,
}, { additionalProperties: false })

const codexSpendControlLimitDiagnostics = t.Object({
  limit: t.String(),
  used: t.String(),
  remainingPercent: t.Number(),
  resetsAt: t.Number(),
}, { additionalProperties: false })

const codexRateLimitSnapshotDiagnostics = t.Object({
  limitId: nullableString,
  limitName: nullableString,
  primary: t.Union([codexRateLimitWindowDiagnostics, t.Null()]),
  secondary: t.Union([codexRateLimitWindowDiagnostics, t.Null()]),
  credits: t.Union([
    t.Object({
      hasCredits: t.Boolean(),
      unlimited: t.Boolean(),
      balance: nullableString,
    }, { additionalProperties: false }),
    t.Null(),
  ]),
  individualLimit: t.Union([codexSpendControlLimitDiagnostics, t.Null()]),
  planType: nullableString,
  rateLimitReachedType: nullableString,
}, { additionalProperties: false })

const codexTokenUsageDiagnostics = t.Object({
  summary: t.Object({
    lifetimeTokens: nullableString,
    peakDailyTokens: nullableString,
    longestRunningTurnSec: nullableString,
    currentStreakDays: nullableString,
    longestStreakDays: nullableString,
  }, { additionalProperties: false }),
  dailyUsageBuckets: t.Array(
    t.Object({
      startDate: t.String(),
      tokens: t.String(),
    }, { additionalProperties: false }),
  ),
}, { additionalProperties: false })

const codexWhamEndpointKey = t.Union([
  t.Literal('usage'),
  t.Literal('rateLimitResetCredits'),
  t.Literal('referralEligibilityRules'),
])

const codexWhamEndpointResult = t.Object({
  key: codexWhamEndpointKey,
  url: t.String(),
  ok: t.Boolean(),
  status: nullableNumber,
  reason: nullableString,
  body: t.Any(),
}, { additionalProperties: false })

export const ProviderTargetsModel = {
  providerTarget: t.Object({
    id: t.String(),
    kind: providerTargetKind,
    providerKind,
    displayName: t.String(),
    enabled: t.Boolean(),
    iconSlug: nullableString,
    connectionConfigJson: t.String(),
    credentialRef: nullableString,
    enabledModelsJson: t.String(),
    customModelsJson: t.String(),
    sourceKey: nullableString,
    externalRecordId: nullableString,
    sourceFingerprint: nullableString,
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  upsertManualBody: t.Object({
    displayName: t.String({ minLength: 1 }),
    providerKind,
    enabled: t.Optional(t.Boolean()),
    connectionConfig: t.Record(t.String(), t.Unknown()),
    credentialRef: t.Optional(nullableString),
    iconSlug: t.Optional(nullableString),
  }),

  idParams: t.Object({
    providerTargetId: t.String({ minLength: 1 }),
  }),

  listQuery: t.Object({
    runtimeKind: t.Optional(t.String({ minLength: 1 })),
    workspaceId: t.Optional(t.String({ minLength: 1 })),
  }),

  targetParams: t.Object({
    providerTargetKind,
    providerTargetId: t.String({ minLength: 1 }),
  }),

  modelSettings: t.Object({
    providerTargetKind: t.Optional(providerTargetKind),
    providerTargetId: t.String(),
    connectionConfigJson: t.String(),
    enabledModelsJson: t.String(),
    configJson: t.String(),
    customModelsJson: t.String(),
  }),

  modelSettingsBody: t.Object({
    claudeAgent: claudeAgentConfigPatch,
  }, { additionalProperties: false }),

  modelVisibilityBody: t.Object({
    enabledModels: t.Array(t.String({ minLength: 1 })),
  }),

  customModelsBody: t.Object({
    models: t.Array(
      t.Object({
        id: t.String({ minLength: 1 }),
        label: t.Optional(t.String()),
      }),
    ),
  }),

  customModelEntry: t.Object({
    id: t.String(),
    label: t.String(),
    capabilities: modelCapabilitiesSchema,
  }),

  customModelEntryList: t.Array(
    t.Object({
      id: t.String(),
      label: t.String(),
      capabilities: modelCapabilitiesSchema,
    }),
  ),

  chatgptCredentialLoginStartBody: t.Object({
    label: t.Optional(nullableString),
  }, { additionalProperties: false }),

  chatgptCredentialLoginStartResponse: t.Object({
    loginId: t.String({ minLength: 1 }),
    verificationUrl: t.String({ minLength: 1 }),
    userCode: t.String({ minLength: 1 }),
    expiresAt: t.Number(),
  }, { additionalProperties: false }),

  chatgptCredentialLoginStatus: t.Object({
    loginId: t.String({ minLength: 1 }),
    state: t.Union([
      t.Literal('pending'),
      t.Literal('completed'),
      t.Literal('failed'),
      t.Literal('cancelled'),
    ]),
    startedAt: t.Number(),
    completedAt: t.Union([t.Number(), t.Null()]),
    credentialRef: nullableString,
    email: nullableString,
    planType: nullableString,
    error: nullableString,
  }, { additionalProperties: false }),

  chatgptCredentialLoginParams: t.Object({
    loginId: t.String({ minLength: 1 }),
  }),

  providerAuthDiagnostics: t.Object({
    providerTargetId: t.String(),
    supported: t.Boolean(),
    unavailableReason: nullableString,
    refreshedAt: nullableNumber,
    status: providerAuthDiagnosticsStatus,
    available: t.Boolean(),
    authStatus: providerAuthStatus,
    authMode: t.Union([claudeAgentAuthMode, t.Null()]),
    authType: nullableString,
    authLabel: nullableString,
    version: nullableString,
    message: nullableString,
    account: t.Union([
      t.Object({
        email: nullableString,
        organization: nullableString,
        subscriptionType: nullableString,
        tokenSource: nullableString,
        apiKeySource: nullableString,
        apiProvider: nullableString,
      }, { additionalProperties: false }),
      t.Null(),
    ]),
  }, { additionalProperties: false }),

  codexAccountDiagnostics: t.Object({
    providerTargetId: t.String(),
    supported: t.Boolean(),
    unavailableReason: nullableString,
    refreshedAt: nullableNumber,
    account: t.Union([
      t.Object({
        authMode: t.Literal('chatgptAuthTokens'),
        accountType: t.Union([codexAccountType, t.Null()]),
        email: nullableString,
        planType: nullableString,
        requiresOpenaiAuth: t.Union([t.Boolean(), t.Null()]),
      }, { additionalProperties: false }),
      t.Null(),
    ]),
    rateLimits: t.Union([codexRateLimitSnapshotDiagnostics, t.Null()]),
    rateLimitsByLimitId: t.Union([
      t.Object({}, { additionalProperties: codexRateLimitSnapshotDiagnostics }),
      t.Null(),
    ]),
    rateLimitResetCredits: t.Union([
      t.Object({
        availableCount: t.String(),
      }, { additionalProperties: false }),
      t.Null(),
    ]),
    tokenUsage: t.Union([codexTokenUsageDiagnostics, t.Null()]),
  }, { additionalProperties: false }),

  codexWhamDiagnostics: t.Object({
    providerTargetId: t.String(),
    supported: t.Boolean(),
    unavailableReason: nullableString,
    refreshedAt: nullableNumber,
    account: t.Union([
      t.Object({
        authMode: t.Literal('chatgptAuthTokens'),
        chatgptAccountId: t.String(),
        planType: nullableString,
      }, { additionalProperties: false }),
      t.Null(),
    ]),
    endpoints: t.Object({
      usage: t.Union([codexWhamEndpointResult, t.Null()]),
      rateLimitResetCredits: t.Union([codexWhamEndpointResult, t.Null()]),
      referralEligibilityRules: t.Union([codexWhamEndpointResult, t.Null()]),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),

  codexRateLimitResetCreditConsumeBody: t.Object({
    idempotencyKey: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  codexRateLimitResetCreditConsumeResponse: t.Object({
    providerTargetId: t.String(),
    outcome: t.Union([
      t.Literal('reset'),
      t.Literal('nothingToReset'),
      t.Literal('noCredit'),
      t.Literal('alreadyRedeemed'),
    ]),
    consumedAt: t.Number(),
  }, { additionalProperties: false }),
}
