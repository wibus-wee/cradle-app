import {
  automationDefinitions,
  automationRuns,
  providerTargets,
  sessionAwaits,
  sessions,
  workspaces,
} from '@cradle/db'
import { desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'

import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import * as ChatRuntime from '../chat-runtime/runtime'
import * as Chronicle from '../chronicle/service'

interface DesktopSessionItem {
  id: string
  sessionId: string
  title: string
  workspaceId: string | null
  workspaceName: string
  runtimeKind: string
  modelId: string | null
  updatedAt: number
  state: 'running' | 'awaiting' | 'pinned' | 'recent'
  detail: string
}

interface DesktopHealthItem {
  id: string
  label: string
  value: string
  status: 'ok' | 'active' | 'warning' | 'danger' | 'unknown'
  detail: string | null
}

interface DesktopSummary {
  generatedAt: number
  running: number
  recentSessions: number
  pinnedSessions: number
  pendingAwaits: number
  enabledAutomations: number
  runningAutomations: number
  workspaces: number
  enabledProviders: number
  totalProviders: number
}

interface DesktopAwaitItem {
  id: string
  sessionId: string
  title: string
  workspaceId: string | null
  workspaceName: string
  source: string
  reason: string | null
  createdAt: number
}

interface DesktopUserInputRequestItem {
  id: string
  sessionId: string
  runId: string
  requestId: string
  title: string
  workspaceId: string | null
  workspaceName: string
  providerMethod: string
  questionCount: number
  firstQuestion: string | null
  createdAt: number
}

const DEFAULT_WORKSPACE_NAME = 'No workspace'
const DEFAULT_SESSION_TITLE = 'Waiting session'
const RUNNING_LIMIT = 8
const RECENT_SESSION_LIMIT = 8
const AWAIT_LIMIT = 20

function readWorkspaceNames(workspaceIds: Array<string | null>): Map<string, string> {
  const ids = [...new Set(workspaceIds.flatMap(id => (id ? [id] : [])))]
  if (ids.length === 0) {
    return new Map()
  }

  const rows = db()
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(inArray(workspaces.id, ids))
    .all()

  return new Map(rows.map(row => [row.id, row.name]))
}

function readSessionTitles(sessionIds: string[]): Map<string, string> {
  const ids = [...new Set(sessionIds.filter(id => id.length > 0))]
  if (ids.length === 0) {
    return new Map()
  }

  const rows = db()
    .select({ id: sessions.id, title: sessions.title })
    .from(sessions)
    .where(inArray(sessions.id, ids))
    .all()

  return new Map(rows.map(row => [row.id, row.title]))
}

function toDesktopSessionItem(
  row: typeof sessions.$inferSelect,
  workspaceNames: Map<string, string>,
  detail: string,
  modelId: string | null,
  state: DesktopSessionItem['state'],
): DesktopSessionItem {
  const workspaceName = row.workspaceId
    ? (workspaceNames.get(row.workspaceId) ?? DEFAULT_WORKSPACE_NAME)
    : DEFAULT_WORKSPACE_NAME

  return {
    id: row.id,
    sessionId: row.id,
    title: row.title,
    workspaceId: row.workspaceId,
    workspaceName,
    runtimeKind: row.runtimeKind,
    modelId,
    updatedAt: row.updatedAt,
    state,
    detail,
  }
}

function readRunningItems(): DesktopSessionItem[] {
  const activeRuns = ChatRuntime.listActiveRunSummaries()
  if (activeRuns.length === 0) {
    return []
  }

  const runBySessionId = new Map(activeRuns.map(run => [run.sessionId, run]))
  const rows = db()
    .select()
    .from(sessions)
    .where(inArray(sessions.id, [...runBySessionId.keys()]))
    .all()
  const workspaceNames = readWorkspaceNames(rows.map(row => row.workspaceId))

  return rows
    .map(row =>
      toDesktopSessionItem(
        row,
        workspaceNames,
        `Running ${row.runtimeKind}`,
        runBySessionId.get(row.id)?.modelId ?? null,
        'running',
      ))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, RUNNING_LIMIT)
}

function readRecentSessionItems(activeItems: DesktopSessionItem[]): DesktopSessionItem[] {
  const activeBySessionId = new Map(activeItems.map(item => [item.sessionId, item]))
  const pendingAwaitSessionIds = new Set(
    db()
      .select({ sessionId: sessionAwaits.chatSessionId })
      .from(sessionAwaits)
      .where(eq(sessionAwaits.status, 'pending'))
      .all()
      .map(row => row.sessionId),
  )
  const rows = db()
    .select()
    .from(sessions)
    .where(isNull(sessions.archivedAt))
    .orderBy(desc(sessions.updatedAt))
    .limit(RECENT_SESSION_LIMIT)
    .all()
  const workspaceNames = readWorkspaceNames(rows.map(row => row.workspaceId))

  const recentItems = rows.map((row) => {
    const activeItem = activeBySessionId.get(row.id)
    if (activeItem) {
      return {
        ...activeItem,
        title: row.title,
        workspaceId: row.workspaceId,
        workspaceName: row.workspaceId
          ? (workspaceNames.get(row.workspaceId) ?? DEFAULT_WORKSPACE_NAME)
          : DEFAULT_WORKSPACE_NAME,
        updatedAt: row.updatedAt,
      }
    }

    const state: DesktopSessionItem['state'] = pendingAwaitSessionIds.has(row.id)
      ? 'awaiting'
      : row.pinned
        ? 'pinned'
        : 'recent'

    return toDesktopSessionItem(
      row,
      workspaceNames,
      state === 'awaiting'
        ? `Awaiting input or external signal`
        : state === 'pinned'
          ? `Pinned ${row.runtimeKind}`
          : `Recent ${row.runtimeKind}`,
      null,
      state,
    )
  })

  const knownSessionIds = new Set(recentItems.map(item => item.sessionId))
  const missingActiveItems = activeItems.filter(item => !knownSessionIds.has(item.sessionId))
  return [...missingActiveItems, ...recentItems]
    .sort((left, right) => {
      if (left.state === 'running' && right.state !== 'running') {
        return -1
      }
      if (right.state === 'running' && left.state !== 'running') {
        return 1
      }
      return right.updatedAt - left.updatedAt
    })
    .slice(0, RECENT_SESSION_LIMIT)
}

function readAutomationCounts(): { enabled: number, running: number } {
  const enabled
    = db()
      .select({ count: sql<number>`count(*)` })
      .from(automationDefinitions)
      .where(eq(automationDefinitions.enabled, true))
      .get()
?.count ?? 0

  const running
    = db()
      .select({ count: sql<number>`count(*)` })
      .from(automationRuns)
      .where(or(eq(automationRuns.status, 'queued'), eq(automationRuns.status, 'running')))
      .get()
?.count ?? 0

  return { enabled, running }
}

function readAwaitCount(): number {
  return (
    db()
      .select({ count: sql<number>`count(*)` })
      .from(sessionAwaits)
      .where(eq(sessionAwaits.status, 'pending'))
      .get()
?.count ?? 0
  )
}

function readPinnedSessionCount(): number {
  return (
    db()
      .select({ count: sql<number>`count(*)` })
      .from(sessions)
      .where(eq(sessions.pinned, 1))
      .get()
?.count ?? 0
  )
}

export function getDesktopAwaits(): DesktopAwaitItem[] {
  const rows = db()
    .select()
    .from(sessionAwaits)
    .where(eq(sessionAwaits.status, 'pending'))
    .orderBy(desc(sessionAwaits.createdAt))
    .limit(AWAIT_LIMIT)
    .all()
  const workspaceNames = readWorkspaceNames(rows.map(row => row.workspaceId))
  const sessionTitles = readSessionTitles(rows.map(row => row.chatSessionId))

  return rows.map(row => ({
    id: row.id,
    sessionId: row.chatSessionId,
    title: sessionTitles.get(row.chatSessionId) ?? DEFAULT_SESSION_TITLE,
    workspaceId: row.workspaceId,
    workspaceName: workspaceNames.get(row.workspaceId) ?? DEFAULT_WORKSPACE_NAME,
    source: row.source,
    reason: row.reason,
    createdAt: row.createdAt,
  }))
}

export function getDesktopUserInputRequests(): DesktopUserInputRequestItem[] {
  const pendingInputs = ChatRuntime.listPendingRuntimeUserInputs()
  if (pendingInputs.length === 0) {
    return []
  }

  const sessionIds = [...new Set(pendingInputs.map(input => input.sessionId))]
  const sessionRows = db()
    .select({ id: sessions.id, title: sessions.title, workspaceId: sessions.workspaceId })
    .from(sessions)
    .where(inArray(sessions.id, sessionIds))
    .all()
  const sessionsById = new Map(sessionRows.map(row => [row.id, row]))
  const workspaceNames = readWorkspaceNames(sessionRows.map(row => row.workspaceId))

  return pendingInputs.map((input) => {
    const session = sessionsById.get(input.sessionId)
    const workspaceId = session?.workspaceId ?? null
    return {
      id: `${input.sessionId}:${input.requestId}`,
      sessionId: input.sessionId,
      runId: input.runId,
      requestId: input.requestId,
      title: session?.title ?? DEFAULT_SESSION_TITLE,
      workspaceId,
      workspaceName: workspaceId
        ? (workspaceNames.get(workspaceId) ?? DEFAULT_WORKSPACE_NAME)
        : DEFAULT_WORKSPACE_NAME,
      providerMethod: input.providerMethod,
      questionCount: input.questionCount,
      firstQuestion: input.firstQuestion,
      createdAt: input.createdAt,
    }
  })
}

function readWorkspaceCount(): number {
  return (
    db()
      .select({ count: sql<number>`count(*)` })
      .from(workspaces)
      .get()
?.count ?? 0
  )
}

function readProviderCounts(): { enabled: number, total: number } {
  const enabled
    = db()
      .select({ count: sql<number>`count(*)` })
      .from(providerTargets)
      .where(eq(providerTargets.enabled, true))
      .get()
?.count ?? 0

  const total
    = db()
      .select({ count: sql<number>`count(*)` })
      .from(providerTargets)
      .get()
?.count ?? 0

  return { enabled, total }
}

async function readChronicleHealthItem(): Promise<DesktopHealthItem> {
  if (!Chronicle.isChronicleRuntimeAllowed()) {
    return {
      id: 'chronicle',
      label: 'Chronicle',
      value: 'Disabled',
      status: 'ok',
      detail: 'Chronicle runtime is only available in development builds.',
    }
  }

  try {
    const status = await Chronicle.getStatus()
    return {
      id: 'chronicle',
      label: 'Chronicle',
      value: status.running ? 'Running' : 'Idle',
      status: status.running ? 'active' : status.available ? 'ok' : 'warning',
      detail: status.available ? null : 'Chronicle is not configured.',
    }
  }
 catch {
    return {
      id: 'chronicle',
      label: 'Chronicle',
      value: 'Unavailable',
      status: 'warning',
      detail: 'Chronicle status could not be read.',
    }
  }
}

export function getDesktopSummary(): DesktopSummary {
  const running = readRunningItems()
  const pendingAwaitCount = readAwaitCount()
  const automationCounts = readAutomationCounts()
  const providerCounts = readProviderCounts()

  return {
    generatedAt: currentUnixSeconds(),
    running: running.length,
    recentSessions: readRecentSessionItems(running).length,
    pinnedSessions: readPinnedSessionCount(),
    pendingAwaits: pendingAwaitCount,
    enabledAutomations: automationCounts.enabled,
    runningAutomations: automationCounts.running,
    workspaces: readWorkspaceCount(),
    enabledProviders: providerCounts.enabled,
    totalProviders: providerCounts.total,
  }
}

export function getDesktopRecentSessions(): DesktopSessionItem[] {
  return readRecentSessionItems(readRunningItems())
}

export async function getDesktopHealth(): Promise<DesktopHealthItem[]> {
  const summary = getDesktopSummary()
  const chronicleHealth = await readChronicleHealthItem()

  return [
    {
      id: 'server',
      label: 'Server',
      value: 'Online',
      status: 'ok',
      detail: null,
    },
    {
      id: 'chat-runtime',
      label: 'Chat Runtime',
      value: summary.running > 0 ? `${summary.running} running` : 'Idle',
      status: summary.running > 0 ? 'active' : 'ok',
      detail: null,
    },
    {
      id: 'awaits',
      label: 'Awaits',
      value: summary.pendingAwaits > 0 ? `${summary.pendingAwaits} pending` : 'Clear',
      status: summary.pendingAwaits > 0 ? 'warning' : 'ok',
      detail:
        summary.pendingAwaits > 0 ? 'Sessions are waiting on user input or external checks.' : null,
    },
    {
      id: 'automations',
      label: 'Automations',
      value:
        summary.runningAutomations > 0
          ? `${summary.runningAutomations} active`
          : `${summary.enabledAutomations} enabled`,
      status: summary.runningAutomations > 0 ? 'active' : 'ok',
      detail: null,
    },
    {
      id: 'providers',
      label: 'Providers',
      value:
        summary.enabledProviders > 0 ? `${summary.enabledProviders} enabled` : 'Not configured',
      status: summary.enabledProviders > 0 ? 'ok' : 'warning',
      detail: summary.enabledProviders > 0 ? null : 'No enabled provider targets are configured.',
    },
    chronicleHealth,
  ]
}
