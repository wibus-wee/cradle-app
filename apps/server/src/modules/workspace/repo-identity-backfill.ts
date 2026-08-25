import { databaseMaintenanceTasks, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import type { MaintenanceResult, MaintenanceRunContext } from '../maintenance/service'
import * as Maintenance from '../maintenance/service'
import {
  hasWorkspaceGitIdentity,
  mergeWorkspaceGitIdentity,
  workspaceGitIdentityEquals,
} from './repo-identity'
import { refreshWorkspaceGitIdentity } from './service'
import type { WorkspaceGitIdentity, WorkspaceLocator } from './workspace-locator'
import {
  readWorkspaceGitIdentityJson,
  readWorkspaceLocatorJson,
  serializeWorkspaceGitIdentity,
} from './workspace-locator'

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000
const DEFAULT_MAX_RUN_MS = 5 * 60 * 1000

export const WORKSPACE_GIT_IDENTITY_BACKFILL_TASK_ID = 'workspace-git-identity-backfill-v1'

interface BackfillResult extends MaintenanceResult {
  workspacesScanned: number
  workspacesUpdated: number
  workspacesUnchanged: number
  workspacesDeferred: number
  lastDeferredWorkspaceId: string | null
  lastDeferredError: string | null
  migrationCompleted: boolean
}

interface BackfillDependencies {
  refreshIdentity: (locator: WorkspaceLocator) => Promise<WorkspaceGitIdentity>
}

const defaultDependencies: BackfillDependencies = {
  refreshIdentity: refreshWorkspaceGitIdentity,
}

export async function backfillWorkspaceGitIdentity(
  context: Pick<MaintenanceRunContext, 'deadline' | 'report'>,
  dependencies: BackfillDependencies = defaultDependencies,
): Promise<BackfillResult> {
  const task = ensureBackfillTask()
  if (task.status === 'completed') {
    return emptyResult(true)
  }

  const rows = db()
    .select({
      id: workspaces.id,
      locatorJson: workspaces.locatorJson,
      gitIdentityJson: workspaces.gitIdentityJson,
    })
    .from(workspaces)
    .all()

  const result = emptyResult(false)
  for (let index = 0; index < rows.length; index += 1) {
    if (Date.now() >= context.deadline) {
      result.workspacesDeferred += rows.length - index
      result.lastDeferredWorkspaceId = rows[index]?.id ?? null
      result.lastDeferredError = 'Run deadline reached.'
      break
    }

    const row = rows[index]!
    result.workspacesScanned += 1
    const locator = readWorkspaceLocatorJson(row.locatorJson)
    const current = readWorkspaceGitIdentityJson(row.gitIdentityJson)
    if (hasCompleteGitIdentity(current)) {
      result.workspacesUnchanged += 1
      context.report(result)
      continue
    }

    let probed: WorkspaceGitIdentity
    try {
      probed = await dependencies.refreshIdentity(locator)
    }
    catch (error) {
      result.workspacesDeferred += 1
      result.lastDeferredWorkspaceId = row.id
      result.lastDeferredError = error instanceof Error ? error.message : String(error)
      context.report(result)
      continue
    }

    const merged = mergeWorkspaceGitIdentity(current, probed)
    if (!hasWorkspaceGitIdentity(probed) || workspaceGitIdentityEquals(current, merged)) {
      result.workspacesUnchanged += 1
      context.report(result)
      continue
    }

    db()
      .update(workspaces)
      .set({
        gitIdentityJson: serializeWorkspaceGitIdentity(merged),
        updatedAt: currentUnixSeconds(),
      })
      .where(eq(workspaces.id, row.id))
      .run()
    result.workspacesUpdated += 1
    context.report(result)
  }

  result.migrationCompleted = result.workspacesDeferred === 0
  persistBackfillResult(result)
  return result
}

export function registerWorkspaceGitIdentityBackfillMaintenance(): void {
  Maintenance.registerTask({
    ownerNamespace: 'workspace',
    key: 'backfill-git-identity',
    title: 'Backfill workspace Git identity',
    intervalMs: DEFAULT_INTERVAL_MS,
    runOnStart: true,
    manuallyRunnable: true,
    maxRunMs: DEFAULT_MAX_RUN_MS,
    run: context => backfillWorkspaceGitIdentity(context),
  })
}

function ensureBackfillTask(): typeof databaseMaintenanceTasks.$inferSelect {
  const existing = readBackfillTask()
  if (existing) {
    return existing
  }

  db()
    .insert(databaseMaintenanceTasks)
    .values({
      id: WORKSPACE_GIT_IDENTITY_BACKFILL_TASK_ID,
      status: 'pending',
      requestedAt: currentUnixSeconds(),
      detailJson: '{}',
    })
    .onConflictDoNothing()
    .run()

  const created = readBackfillTask()
  if (!created) {
    throw new Error(`failed to create ${WORKSPACE_GIT_IDENTITY_BACKFILL_TASK_ID} maintenance task`)
  }
  return created
}

function readBackfillTask(): typeof databaseMaintenanceTasks.$inferSelect | undefined {
  return db()
    .select()
    .from(databaseMaintenanceTasks)
    .where(eq(databaseMaintenanceTasks.id, WORKSPACE_GIT_IDENTITY_BACKFILL_TASK_ID))
    .get()
}

function persistBackfillResult(result: BackfillResult): void {
  db()
    .update(databaseMaintenanceTasks)
    .set({
      status: result.migrationCompleted ? 'completed' : 'pending',
      completedAt: result.migrationCompleted ? currentUnixSeconds() : null,
      detailJson: JSON.stringify(result),
    })
    .where(eq(databaseMaintenanceTasks.id, WORKSPACE_GIT_IDENTITY_BACKFILL_TASK_ID))
    .run()
}

function emptyResult(migrationCompleted: boolean): BackfillResult {
  return {
    workspacesScanned: 0,
    workspacesUpdated: 0,
    workspacesUnchanged: 0,
    workspacesDeferred: 0,
    lastDeferredWorkspaceId: null,
    lastDeferredError: null,
    migrationCompleted,
  }
}

function hasCompleteGitIdentity(identity: WorkspaceGitIdentity): boolean {
  return Boolean(identity.originUrl && identity.repoRoot && identity.headSha && identity.branch)
}
