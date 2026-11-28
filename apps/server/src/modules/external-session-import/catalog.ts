import { randomUUID } from 'node:crypto'

import { externalSessionImports, externalWorkImportItems } from '@cradle/db'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import * as Workspace from '../workspace/service'
import { createExternalSessionSources } from './sources'
import type {
  ExternalSessionDescriptor,
  ExternalSessionSourceAdapter,
  ExternalSessionSourceApp,
} from './types'

export interface HistoricalWorkspacePlanView {
  kind: 'existing' | 'create'
  reason:
    | 'exact-path'
    | 'containing-path'
    | 'git-identity'
    | 'import-record'
    | 'available-project-root'
    | 'offline-historical-root'
  historicalKey: string
  workspaceId: string | null
  name: string
  path: string
  availability: 'available' | 'missing' | 'remote'
}

export interface ExternalSessionCandidateView {
  candidateId: string
  sourceHostId: string
  sourceApp: ExternalSessionSourceApp
  externalSessionId: string
  sourceRevision: string
  title: string
  summary: string | null
  workspacePath: string
  createdAt: number | null
  updatedAt: number | null
  archived: boolean
  estimatedBytes: number | null
  childSessionCount: number | null
  alreadyImported: boolean
  importState: 'available' | 'imported' | 'update-available'
  importRecordId: string | null
  workspacePlan: HistoricalWorkspacePlanView
}

export interface ExternalSessionScanView {
  id: string
  createdAt: number
  candidates: ExternalSessionCandidateView[]
  warnings: string[]
}

interface StoredExternalSessionScan {
  view: ExternalSessionScanView
  descriptors: Map<string, ExternalSessionDescriptor>
}

const SCAN_TTL_MS = 15 * 60 * 1_000
const scans = new Map<string, StoredExternalSessionScan>()

export interface ExternalSessionCatalogDependencies {
  adapters?: ExternalSessionSourceAdapter[]
  now?: () => number
}

export async function scanExternalSessions(
  input: {
    sourceHostId?: string
    sourceApps?: ExternalSessionSourceApp[]
    limitPerSource?: number
  } = {},
  dependencies: ExternalSessionCatalogDependencies = {},
): Promise<ExternalSessionScanView> {
  const now = dependencies.now?.() ?? Date.now()
  evictExpiredScans(now)
  const sourceHostId = input.sourceHostId ?? 'local'
  const requestedApps = new Set(input.sourceApps ?? ['claude', 'codex', 'kimi', 'opencode'])
  const adapters = (dependencies.adapters ?? createExternalSessionSources())
    .filter(adapter => requestedApps.has(adapter.sourceApp))

  const discoveries = await Promise.allSettled(adapters.map(async adapter => ({
    sourceApp: adapter.sourceApp,
    descriptors: await adapter.discover({
      sourceHostId,
      limit: input.limitPerSource,
    }),
  })))
  const warnings: string[] = []
  const descriptors: ExternalSessionDescriptor[] = []
  for (const discovery of discoveries) {
    if (discovery.status === 'rejected') {
      warnings.push(discovery.reason instanceof Error
        ? discovery.reason.message
        : String(discovery.reason))
      continue
    }
    descriptors.push(...discovery.value.descriptors)
  }

  const descriptorMap = new Map<string, ExternalSessionDescriptor>()
  const candidates = descriptors
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .map((descriptor) => {
      descriptorMap.set(descriptor.candidateId, descriptor)
      return candidateView(descriptor)
    })
  const id = randomUUID()
  const view: ExternalSessionScanView = {
    id,
    createdAt: Math.floor(now / 1000),
    candidates,
    warnings,
  }
  scans.set(id, { view, descriptors: descriptorMap })
  return view
}

export function getExternalSessionScan(id: string): ExternalSessionScanView {
  const stored = readStoredScan(id)
  return stored.view
}

export function resolveExternalSessionCandidates(
  scanId: string,
  candidateIds: string[],
): ExternalSessionDescriptor[] {
  const stored = readStoredScan(scanId)
  const seen = new Set<string>()
  return candidateIds.map((candidateId) => {
    if (seen.has(candidateId)) {
      throw new AppError({
        code: 'external_session_candidate_duplicate',
        status: 400,
        message: 'Import selection contains a duplicate candidate',
        details: { candidateId },
      })
    }
    seen.add(candidateId)
    const descriptor = stored.descriptors.get(candidateId)
    if (!descriptor) {
      throw new AppError({
        code: 'external_session_candidate_not_found',
        status: 404,
        message: 'External session candidate was not found in this scan',
        details: { scanId, candidateId },
      })
    }
    return descriptor
  })
}

function candidateView(descriptor: ExternalSessionDescriptor): ExternalSessionCandidateView {
  const imported = findImportedCandidate(descriptor)
  const importedWorkspace = imported?.workspaceId ? Workspace.get(imported.workspaceId) : null
  const workspacePlan = importedWorkspace
    ? {
        kind: 'existing' as const,
        reason: 'import-record' as const,
        historicalKey: `import:${imported?.recordId ?? importedWorkspace.id}`,
        workspaceId: importedWorkspace.id,
        name: importedWorkspace.name,
        path: importedWorkspace.locator.path,
        availability: importedWorkspace.availability,
      }
    : workspacePlanView(Workspace.planHistoricalWorkspace({
        sourceHostId: descriptor.sourceHostId,
        workspacePath: descriptor.workspacePath,
        gitIdentity: descriptor.gitIdentity,
      }))
  return {
    candidateId: descriptor.candidateId,
    sourceHostId: descriptor.sourceHostId,
    sourceApp: descriptor.sourceApp,
    externalSessionId: descriptor.externalSessionId,
    sourceRevision: descriptor.sourceRevision,
    title: descriptor.title,
    summary: descriptor.summary,
    workspacePath: descriptor.workspacePath,
    createdAt: descriptor.createdAt,
    updatedAt: descriptor.updatedAt,
    archived: descriptor.archived,
    estimatedBytes: descriptor.estimatedBytes,
    childSessionCount: descriptor.childSessionCount,
    alreadyImported: imported !== null,
    importState: !imported
      ? 'available'
      : imported.sourceRevision === descriptor.sourceRevision ? 'imported' : 'update-available',
    importRecordId: imported?.recordId ?? null,
    workspacePlan,
  }
}

function findImportedCandidate(descriptor: ExternalSessionDescriptor): {
  recordId: string | null
  sourceRevision: string | null
  workspaceId: string | null
} | null {
  const current = db()
    .select({
      recordId: externalSessionImports.id,
      sourceRevision: externalSessionImports.sourceRevision,
      workspaceId: externalSessionImports.workspaceId,
    })
    .from(externalSessionImports)
    .where(and(
      eq(externalSessionImports.sourceHostId, descriptor.sourceHostId),
      eq(externalSessionImports.sourceApp, descriptor.sourceApp),
      eq(externalSessionImports.externalSessionId, descriptor.externalSessionId),
    ))
    .get()
  if (current) {
    return current
  }
  // Legacy external_work_import_items predate this module and only ever
  // recorded claude/codex sessions; newer source apps cannot have legacy rows.
  if (descriptor.sourceApp !== 'claude' && descriptor.sourceApp !== 'codex') {
    return null
  }
  const legacy = db()
    .select({ externalId: externalWorkImportItems.externalId })
    .from(externalWorkImportItems)
    .where(and(
      eq(externalWorkImportItems.sourceApp, descriptor.sourceApp),
      eq(externalWorkImportItems.sourceKind, 'session'),
    ))
    .all()
    .some(record => normalizeLegacyExternalId(record.externalId) === descriptor.externalSessionId)
  return legacy ? { recordId: null, sourceRevision: null, workspaceId: null } : null
}

function normalizeLegacyExternalId(externalId: string): string {
  return externalId.startsWith('history:') ? externalId.slice('history:'.length) : externalId
}

function workspacePlanView(plan: Workspace.HistoricalWorkspacePlan): HistoricalWorkspacePlanView {
  if (plan.kind === 'existing') {
    return {
      kind: 'existing',
      reason: plan.reason,
      historicalKey: plan.historicalKey,
      workspaceId: plan.workspace.id,
      name: plan.workspace.name,
      path: plan.workspace.locator.path,
      availability: plan.workspace.availability,
    }
  }
  return {
    kind: 'create',
    reason: plan.reason,
    historicalKey: plan.historicalKey,
    workspaceId: null,
    name: plan.name,
    path: plan.locator.path,
    availability: plan.availability,
  }
}

function readStoredScan(id: string): StoredExternalSessionScan {
  evictExpiredScans(Date.now())
  const stored = scans.get(id)
  if (!stored) {
    throw new AppError({
      code: 'external_session_scan_not_found',
      status: 404,
      message: 'External session scan expired or was not found; scan again',
      details: { scanId: id },
    })
  }
  return stored
}

function evictExpiredScans(now: number): void {
  for (const [id, scan] of scans) {
    if (now - scan.view.createdAt * 1000 > SCAN_TTL_MS) {
      scans.delete(id)
    }
  }
}
