import { t } from 'elysia'

export const UsageModel = {
  dailyUsage: t.Object({
    date: t.String(),
    promptTokens: t.Number(),
    completionTokens: t.Number(),
    totalTokens: t.Number(),
    count: t.Number(),
  }),

  dailyUsageByModel: t.Object({
    date: t.String(),
    modelId: t.String(),
    totalTokens: t.Number(),
    count: t.Number(),
  }),

  hourlyUsage: t.Object({
    hour: t.Number(),
    promptTokens: t.Number(),
    completionTokens: t.Number(),
    totalTokens: t.Number(),
    count: t.Number(),
  }),

  usageSummary: t.Object({
    totalPromptTokens: t.Number(),
    totalCompletionTokens: t.Number(),
    totalTokens: t.Number(),
    totalTurns: t.Number(),
    byAgent: t.Array(t.Object({
      agentId: t.String(),
      agentName: t.String(),
      totalTokens: t.Number(),
      count: t.Number(),
    })),
    byProviderTarget: t.Array(t.Object({
      providerTargetId: t.String(),
      providerTargetName: t.Nullable(t.String()),
      totalTokens: t.Number(),
      count: t.Number(),
    })),
    byModel: t.Array(t.Object({
      modelId: t.String(),
      totalTokens: t.Number(),
      count: t.Number(),
    })),
  }),

  usageStats: t.Object({
    currentStreak: t.Number(),
    longestStreak: t.Number(),
    activeDays: t.Number(),
    avgDailyTokens: t.Number(),
    peakDay: t.Nullable(t.Object({
      date: t.String(),
      totalTokens: t.Number(),
    })),
    todayTokens: t.Number(),
  }),

  sessionUsage: t.Object({
    totalTokens: t.Number(),
    promptTokens: t.Number(),
    completionTokens: t.Number(),
    count: t.Number(),
    byModel: t.Array(t.Object({
      modelId: t.String(),
      promptTokens: t.Number(),
      completionTokens: t.Number(),
      totalTokens: t.Number(),
      turnCount: t.Number(),
    })),
  }),

  recentSession: t.Object({
    sessionId: t.String(),
    title: t.String(),
    agentId: t.Nullable(t.String()),
    agentName: t.Nullable(t.String()),
    modelId: t.String(),
    costUsd: t.Number(),
    promptTokens: t.Number(),
    completionTokens: t.Number(),
    totalTokens: t.Number(),
    turnCount: t.Number(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
    lastUsageAt: t.Number(),
  }),

  dailyQuery: t.Object({
    days: t.Optional(t.Numeric({ minimum: 1 })),
  }),

  recentSessionsQuery: t.Object({
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 20 })),
  }),

  sessionParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),

  // ── Cost Dashboard models ──

  dateRangeQuery: t.Object({
    from: t.Optional(t.String({ format: 'date' })),
    to: t.Optional(t.String({ format: 'date' })),
  }),

  costSummary: t.Object({
    totalCostUsd: t.Number(),
    totalPromptTokens: t.Number(),
    totalCompletionTokens: t.Number(),
    totalTokens: t.Number(),
    byModel: t.Array(t.Object({
      modelId: t.String(),
      costUsd: t.Number(),
      promptTokens: t.Number(),
      completionTokens: t.Number(),
      totalTokens: t.Number(),
      count: t.Number(),
    })),
    byAgent: t.Array(t.Object({
      agentId: t.String(),
      agentName: t.String(),
      costUsd: t.Number(),
      promptTokens: t.Number(),
      completionTokens: t.Number(),
      totalTokens: t.Number(),
      count: t.Number(),
    })),
    byProviderTarget: t.Array(t.Object({
      providerTargetId: t.String(),
      providerTargetName: t.Nullable(t.String()),
      costUsd: t.Number(),
      promptTokens: t.Number(),
      completionTokens: t.Number(),
      totalTokens: t.Number(),
      count: t.Number(),
    })),
  }),

  sessionCost: t.Array(t.Object({
    sessionId: t.String(),
    costUsd: t.Number(),
    promptTokens: t.Number(),
    completionTokens: t.Number(),
    totalTokens: t.Number(),
    stepCount: t.Number(),
  })),

  dailyCost: t.Array(t.Object({
    date: t.String(),
    modelId: t.String(),
    costUsd: t.Number(),
    promptTokens: t.Number(),
    completionTokens: t.Number(),
    totalTokens: t.Number(),
    stepCount: t.Number(),
  })),
}
