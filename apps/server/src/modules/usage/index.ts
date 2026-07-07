import { Elysia, t } from 'elysia'

import { UsageModel } from './model'
import * as Usage from './service'

export const usage = new Elysia({
  prefix: '/usage',
  detail: { tags: ['usage'] },
})
  .get('/daily', ({ query }) => Usage.getDailyUsage(query.days), {
    detail: {
      'summary': 'Get daily usage',
      'x-cradle-cli': {
        command: ['usage', 'daily'],
      },
    },
    query: UsageModel.dailyQuery,
    response: { 200: t.Array(UsageModel.dailyUsage) },
  })
  .get('/daily-by-model', ({ query }) => Usage.getDailyUsageByModel(query.days), {
    detail: {
      'summary': 'Get daily usage broken down by model',
      'x-cradle-cli': {
        command: ['usage', 'daily-by-model'],
      },
    },
    query: UsageModel.dailyQuery,
    response: { 200: t.Array(UsageModel.dailyUsageByModel) },
  })
  .get('/patterns/hourly', () => Usage.getHourlyUsagePattern(), {
    detail: {
      'summary': 'Get hourly usage pattern',
      'x-cradle-cli': {
        command: ['usage', 'patterns', 'hourly'],
      },
    },
    response: { 200: t.Array(UsageModel.hourlyUsage) },
  })
  .get('/summary', () => Usage.getUsageSummary(), {
    detail: {
      'summary': 'Get usage summary',
      'x-cradle-cli': {
        command: ['usage', 'summary'],
      },
    },
    response: { 200: UsageModel.usageSummary },
  })
  .get('/stats', () => Usage.getUsageStats(), {
    detail: {
      'summary': 'Get usage stats',
      'x-cradle-cli': {
        command: ['usage', 'stats'],
      },
    },
    response: { 200: UsageModel.usageStats },
  })
  .get('/sessions/recent', ({ query }) => Usage.getRecentUsageSessions(query.limit), {
    detail: {
      'summary': 'Get recent usage sessions',
      'x-cradle-cli': {
        command: ['usage', 'sessions', 'recent'],
      },
    },
    query: UsageModel.recentSessionsQuery,
    response: { 200: t.Array(UsageModel.recentSession) },
  })
  .get('/sessions/:sessionId', ({ params }) => Usage.getSessionUsage(params.sessionId), {
    detail: {
      'summary': 'Get session usage',
      'x-cradle-cli': {
        command: ['usage', 'session'],
      },
    },
    params: UsageModel.sessionParams,
    response: { 200: UsageModel.sessionUsage },
  })
  .get('/cost/summary', ({ query }) => Usage.getCostSummary(query.from, query.to), {
    detail: {
      'summary': 'Get cost summary with model breakdown',
      'x-cradle-cli': {
        command: ['usage', 'cost', 'summary'],
      },
    },
    query: UsageModel.dateRangeQuery,
    response: { 200: UsageModel.costSummary },
  })
  .get('/cost/sessions', ({ query }) => Usage.getSessionsCost(query.from, query.to), {
    detail: {
      'summary': 'Get per-session cost breakdown',
      'x-cradle-cli': {
        command: ['usage', 'cost', 'sessions'],
      },
    },
    query: UsageModel.dateRangeQuery,
    response: { 200: UsageModel.sessionCost },
  })
  .get('/cost/daily', ({ query }) => Usage.getDailyCost(query.from, query.to), {
    detail: {
      'summary': 'Get daily cost trend',
      'x-cradle-cli': {
        command: ['usage', 'cost', 'daily'],
      },
    },
    query: UsageModel.dateRangeQuery,
    response: { 200: UsageModel.dailyCost },
  })
