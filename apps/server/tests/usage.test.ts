import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agents, providerTargets, sessions, usageLogs, workspaces } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function unixDaysAgo(daysAgo: number): number {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return Math.floor(date.getTime() / 1000)
}

function isoDaysAgo(daysAgo: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return date.toISOString().slice(0, 10)
}

describe('usage capability', () => {
  it('aggregates daily usage, summary, stats, and session totals', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const d = db()

      const workspaceId = randomUUID()
      const providerTargetOneId = randomUUID()
      const providerTargetTwoId = randomUUID()
      const agentOneId = randomUUID()
      const agentTwoId = randomUUID()
      const sessionOneId = randomUUID()
      const sessionTwoId = randomUUID()

      d.insert(workspaces).values({
        id: workspaceId,
        name: 'Workspace',
        locatorJson: JSON.stringify({ kind: 'local', path: workspaceRoot }),
      }).run()
      d.insert(providerTargets).values([
        { id: providerTargetOneId, kind: 'manual', providerKind: 'openai-compatible', displayName: 'Provider One' },
        { id: providerTargetTwoId, kind: 'manual', providerKind: 'openai-compatible', displayName: 'Provider Two' },
      ]).run()
      d.insert(agents).values([
        { id: agentOneId, name: 'Agent One', avatarSeed: 'agent-one', providerTargetId: providerTargetOneId },
        { id: agentTwoId, name: 'Agent Two', avatarSeed: 'agent-two', providerTargetId: providerTargetTwoId },
      ]).run()
      d.insert(sessions).values([
        { id: sessionOneId, workspaceId, title: 'Session One', providerTargetId: providerTargetOneId, agentId: agentOneId },
        { id: sessionTwoId, workspaceId, title: 'Session Two', providerTargetId: providerTargetTwoId, agentId: agentTwoId },
      ]).run()
      d.insert(usageLogs).values([
        {
          id: randomUUID(),
          sessionId: sessionOneId,
          messageId: null,
          providerTargetId: providerTargetOneId,
          modelId: 'gpt-4o',
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          createdAt: unixDaysAgo(2),
        },
        {
          id: randomUUID(),
          sessionId: sessionOneId,
          messageId: null,
          providerTargetId: providerTargetOneId,
          modelId: 'gpt-4o',
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
          createdAt: unixDaysAgo(1),
        },
        {
          id: randomUUID(),
          sessionId: sessionTwoId,
          messageId: null,
          providerTargetId: providerTargetTwoId,
          modelId: 'gpt-4o-mini',
          promptTokens: 8,
          completionTokens: 7,
          totalTokens: 15,
          createdAt: unixDaysAgo(0),
        },
      ]).run()

      const dailyRes = await app.handle(new Request('http://localhost/usage/daily?days=30'))
      expect(dailyRes.status).toBe(200)
      expect(await dailyRes.json()).toEqual([
        { date: isoDaysAgo(2), promptTokens: 10, completionTokens: 5, totalTokens: 15, count: 1 },
        { date: isoDaysAgo(1), promptTokens: 20, completionTokens: 10, totalTokens: 30, count: 1 },
        { date: isoDaysAgo(0), promptTokens: 8, completionTokens: 7, totalTokens: 15, count: 1 },
      ])

      const summaryRes = await app.handle(new Request('http://localhost/usage/summary'))
      expect(summaryRes.status).toBe(200)
      expect(await summaryRes.json()).toEqual({
        totalPromptTokens: 38,
        totalCompletionTokens: 22,
        totalTokens: 60,
        totalTurns: 3,
        byAgent: [
          { agentId: agentOneId, agentName: 'Agent One', totalTokens: 45, count: 2 },
          { agentId: agentTwoId, agentName: 'Agent Two', totalTokens: 15, count: 1 },
        ],
        byProviderTarget: [
          { providerTargetId: providerTargetOneId, providerTargetName: 'Provider One', totalTokens: 45, count: 2 },
          { providerTargetId: providerTargetTwoId, providerTargetName: 'Provider Two', totalTokens: 15, count: 1 },
        ],
        byModel: [
          { modelId: 'gpt-4o', totalTokens: 45, count: 2 },
          { modelId: 'gpt-4o-mini', totalTokens: 15, count: 1 },
        ],
      })

      const costSummaryRes = await app.handle(new Request('http://localhost/usage/cost/summary'))
      expect(costSummaryRes.status).toBe(200)
      expect(await costSummaryRes.json()).toEqual({
        totalCostUsd: 0.0002304,
        totalPromptTokens: 38,
        totalCompletionTokens: 22,
        totalTokens: 60,
        byModel: [
          { modelId: 'gpt-4o', costUsd: 0.000225, promptTokens: 30, completionTokens: 15, totalTokens: 45, count: 2 },
          { modelId: 'gpt-4o-mini', costUsd: 0.0000054, promptTokens: 8, completionTokens: 7, totalTokens: 15, count: 1 },
        ],
        byAgent: [
          { agentId: agentOneId, agentName: 'Agent One', costUsd: 0.000225, promptTokens: 30, completionTokens: 15, totalTokens: 45, count: 2 },
          { agentId: agentTwoId, agentName: 'Agent Two', costUsd: 0.0000054, promptTokens: 8, completionTokens: 7, totalTokens: 15, count: 1 },
        ],
        byProviderTarget: [
          { providerTargetId: providerTargetOneId, providerTargetName: 'Provider One', costUsd: 0.000225, promptTokens: 30, completionTokens: 15, totalTokens: 45, count: 2 },
          { providerTargetId: providerTargetTwoId, providerTargetName: 'Provider Two', costUsd: 0.0000054, promptTokens: 8, completionTokens: 7, totalTokens: 15, count: 1 },
        ],
      })

      const statsRes = await app.handle(new Request('http://localhost/usage/stats'))
      expect(statsRes.status).toBe(200)
      expect(await statsRes.json()).toEqual({
        currentStreak: 3,
        longestStreak: 3,
        activeDays: 3,
        avgDailyTokens: 20,
        peakDay: { date: isoDaysAgo(1), totalTokens: 30 },
        todayTokens: 15,
      })

      const sessionUsageRes = await app.handle(new Request(`http://localhost/usage/sessions/${sessionOneId}`))
      expect(sessionUsageRes.status).toBe(200)
      expect(await sessionUsageRes.json()).toEqual({
        totalTokens: 45,
        promptTokens: 30,
        completionTokens: 15,
        count: 2,
      })

      const invalidDaily = await app.handle(new Request('http://localhost/usage/daily?days=0'))
      expect(invalidDaily.status).toBe(400)
      expect((await invalidDaily.json()).code).toBe('validation_error')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
