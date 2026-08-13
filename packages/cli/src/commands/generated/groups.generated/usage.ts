import type { Command } from 'commander'

import { register as registerUsageCostDaily } from '../usage/cost/daily'
import { register as registerUsageCostSessions } from '../usage/cost/sessions'
import { register as registerUsageCostSummary } from '../usage/cost/summary'
import { register as registerUsageCostEfficiency } from '../usage/cost-efficiency'
import { register as registerUsageDaily } from '../usage/daily'
import { register as registerUsageDailyByModel } from '../usage/daily-by-model'
import { register as registerUsagePatternsHourly } from '../usage/patterns/hourly'
import { register as registerUsagePerformance } from '../usage/performance'
import { register as registerUsageReconcileClaude } from '../usage/reconcile/claude'
import { register as registerUsageSession } from '../usage/session'
import { register as registerUsageSessionsRecent } from '../usage/sessions/recent'
import { register as registerUsageStats } from '../usage/stats'
import { register as registerUsageSummary } from '../usage/summary'
import { register as registerUsageTools } from '../usage/tools'

export function registerGeneratedCommands(program: Command): void {
  registerUsageCostDaily(program)
  registerUsageCostSessions(program)
  registerUsageCostSummary(program)
  registerUsageCostEfficiency(program)
  registerUsageDaily(program)
  registerUsageDailyByModel(program)
  registerUsagePatternsHourly(program)
  registerUsagePerformance(program)
  registerUsageReconcileClaude(program)
  registerUsageSession(program)
  registerUsageSessionsRecent(program)
  registerUsageStats(program)
  registerUsageSummary(program)
  registerUsageTools(program)
}
