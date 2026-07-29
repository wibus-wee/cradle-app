import { t } from 'elysia'

const costBreakdown = t.Object({
  costUsd: t.Number(),
  promptTokens: t.Number(),
  uncachedInputTokens: t.Number(),
  cachedInputTokens: t.Number(),
  cacheWriteInputTokens: t.Number(),
  completionTokens: t.Number(),
  totalTokens: t.Number(),
  uncachedInputCostUsd: t.Number(),
  cacheReadCostUsd: t.Number(),
  cacheWriteCostUsd: t.Number(),
  outputCostUsd: t.Number(),
  count: t.Number(),
})

const runtimePerformanceMetrics = t.Object({
  sampleCount: t.Number(),
  firstTokenSampleCount: t.Number(),
  p50FirstTokenMs: t.Nullable(t.Number()),
  p95FirstTokenMs: t.Nullable(t.Number()),
  p50TotalDurationMs: t.Nullable(t.Number()),
  p95TotalDurationMs: t.Nullable(t.Number()),
})

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

  claudeReconciliationQuery: t.Object({
    maxBindings: t.Optional(t.Numeric({ minimum: 1, maximum: 1_000 })),
  }),

  usageReconciliationSummary: t.Object({
    bindings: t.Number(),
    transcripts: t.Number(),
    inserted: t.Number(),
    duplicates: t.Number(),
    incidents: t.Number(),
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
    totalUncachedInputTokens: t.Number(),
    totalCachedInputTokens: t.Number(),
    totalCacheWriteInputTokens: t.Number(),
    totalCompletionTokens: t.Number(),
    totalTokens: t.Number(),
    uncachedInputCostUsd: t.Number(),
    cacheReadCostUsd: t.Number(),
    cacheWriteCostUsd: t.Number(),
    outputCostUsd: t.Number(),
    byModel: t.Array(t.Object({
      modelId: t.String(),
      ...costBreakdown.properties,
    })),
    byAgent: t.Array(t.Object({
      agentId: t.String(),
      agentName: t.String(),
      ...costBreakdown.properties,
    })),
    byProviderTarget: t.Array(t.Object({
      providerTargetId: t.String(),
      providerTargetName: t.Nullable(t.String()),
      ...costBreakdown.properties,
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
    uncachedInputTokens: t.Number(),
    cachedInputTokens: t.Number(),
    cacheWriteInputTokens: t.Number(),
    completionTokens: t.Number(),
    totalTokens: t.Number(),
    uncachedInputCostUsd: t.Number(),
    cacheReadCostUsd: t.Number(),
    cacheWriteCostUsd: t.Number(),
    outputCostUsd: t.Number(),
    stepCount: t.Number(),
  })),

  runtimePerformance: t.Object({
    coverageStartedAt: t.Nullable(t.Number()),
    coverageEndedAt: t.Nullable(t.Number()),
    summary: runtimePerformanceMetrics,
    byRuntime: t.Array(t.Object({
      runtimeKind: t.String(),
      ...runtimePerformanceMetrics.properties,
    })),
    byProviderTarget: t.Array(t.Object({
      providerTargetId: t.Nullable(t.String()),
      providerTargetName: t.Nullable(t.String()),
      ...runtimePerformanceMetrics.properties,
    })),
    byModel: t.Array(t.Object({
      modelId: t.String(),
      ...runtimePerformanceMetrics.properties,
    })),
    daily: t.Array(t.Object({
      date: t.String(),
      runtimeKind: t.String(),
      ...runtimePerformanceMetrics.properties,
    })),
  }),

  // ── Tool Usage Breakdown models ──

  toolUsageEntry: t.Object({
    toolName: t.String(),
    count: t.Number(),
    successCount: t.Number(),
    failureCount: t.Number(),
    deniedCount: t.Number(),
    interruptedCount: t.Number(),
    medianDurationMs: t.Nullable(t.Number()),
  }),

  toolUsageBreakdown: t.Object({
    overall: t.Array(t.Object({
      toolName: t.String(),
      count: t.Number(),
      successCount: t.Number(),
      failureCount: t.Number(),
      deniedCount: t.Number(),
      interruptedCount: t.Number(),
      medianDurationMs: t.Nullable(t.Number()),
    })),
    byRuntime: t.Array(t.Object({
      runtimeKind: t.String(),
      tools: t.Array(t.Object({
        toolName: t.String(),
        count: t.Number(),
        successCount: t.Number(),
        failureCount: t.Number(),
        deniedCount: t.Number(),
        interruptedCount: t.Number(),
        medianDurationMs: t.Nullable(t.Number()),
      })),
    })),
    byModel: t.Array(t.Object({
      modelId: t.String(),
      tools: t.Array(t.Object({
        toolName: t.String(),
        count: t.Number(),
        successCount: t.Number(),
        failureCount: t.Number(),
        deniedCount: t.Number(),
        interruptedCount: t.Number(),
        medianDurationMs: t.Nullable(t.Number()),
      })),
    })),
    summary: t.Object({
      totalCalls: t.Number(),
      successCount: t.Number(),
      failureCount: t.Number(),
      deniedCount: t.Number(),
      interruptedCount: t.Number(),
      successRatePct: t.Number(),
      uniqueToolCount: t.Number(),
      medianDurationMs: t.Nullable(t.Number()),
    }),
    daily: t.Array(t.Object({
      date: t.String(),
      toolName: t.String(),
      count: t.Number(),
    })),
    dailyByRuntime: t.Array(t.Object({
      date: t.String(),
      runtimeKind: t.String(),
      toolName: t.String(),
      count: t.Number(),
    })),
    dailyByModel: t.Array(t.Object({
      date: t.String(),
      modelId: t.String(),
      toolName: t.String(),
      count: t.Number(),
    })),
  }),

  // ── Cost Efficiency Trend models ──

  dailyCostEfficiency: t.Object({
    date: t.String(),
    totalTokens: t.Number(),
    runCount: t.Number(),
    avgTokensPerRun: t.Number(),
    totalCostUsd: t.Number(),
    avgCostPerRun: t.Number(),
  }),
}
