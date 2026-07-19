import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'

import type { AcpAgent, AcpAuditEntry } from '@cradle/db'
import { acpAgents, acpAuditLog } from '@cradle/db'
import type { DownloadTaskView } from '@cradle/download-center'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db, getServerConfig } from '../../infra'
import type { AcpArtifactDownloadCenter, InstallResult } from './acp.installer'
import { AcpInstaller } from './acp.installer'
import type { AcpDistributionType, RegistryAgent } from './acp.registry'
import { AcpRegistry } from './acp.registry'
import { isAbsoluteOrPathLikeCommand } from './launch-config'

// ── in-memory state ──

const installAbortControllers = new Map<string, AbortController>()

const registry = new AcpRegistry()
const installer = new AcpInstaller()

export type AcpAgentSource = 'registry' | 'local'
export type LocalDistributionType = 'command' | 'npx' | 'uvx'

export interface AcpDownloadCenter extends AcpArtifactDownloadCenter {
  list: (filters: {
    ownerNamespace?: string
    ownerResourceType?: string
    ownerResourceId?: string
  }) => readonly Pick<DownloadTaskView, 'taskId' | 'status'>[]
  cancel: (taskId: string) => unknown
}

const AuditInputSchema = z.object({
  agentId: z.string(),
  action: z.string(),
  path: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).default({}),
})

const AGENT_ID_RE = /^[a-z][a-z0-9-]*$/

// ── helpers ──

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getRuntimeDataDir(): string {
  const config = getServerConfig()
  return config.dataDir ?? dirname(config.dbPath)
}

function binaryDownloadOwner(agentId: string, displayName = agentId) {
  return {
    namespace: 'acp',
    resourceType: 'agent',
    resourceId: agentId,
    displayName,
  }
}

async function findRegistryAgent(agentId: string): Promise<RegistryAgent | undefined> {
  const agents = await registry.fetchRegistry()
  return agents.find(a => a.id === agentId)
}

function envKeysOnly(env: Record<string, string> | null | undefined): string[] {
  return env ? Object.keys(env) : []
}

function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug || 'agent'
}

function generateLocalAgentId(name: string): string {
  const short = randomBytes(3).toString('hex')
  return `local-${slugifyName(name)}-${short}`
}

function assertValidAgentId(id: string): void {
  if (!AGENT_ID_RE.test(id)) {
    throw new AppError({
      code: 'invalid_acp_input',
      status: 400,
      message: 'agent id must match /^[a-z][a-z0-9-]*$/',
      details: { id },
    })
  }
}

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new AppError({
      code: 'invalid_acp_input',
      status: 400,
      message: `${field} must be an array of strings`,
    })
  }
  return value
}

function assertStringRecord(value: unknown, field: string): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError({
      code: 'invalid_acp_input',
      status: 400,
      message: `${field} must be an object of string values`,
    })
  }
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') {
      throw new AppError({
        code: 'invalid_acp_input',
        status: 400,
        message: `${field} values must be strings`,
        details: { key },
      })
    }
    result[key] = entry
  }
  return result
}

// ── store layer ──

function listInstalledFromDb(): AcpAgent[] {
  return db().select().from(acpAgents).orderBy(desc(acpAgents.updatedAt)).all()
}

function getInstalledFromDb(agentId: string): AcpAgent | undefined {
  return db().select().from(acpAgents).where(eq(acpAgents.id, agentId)).get()
}

function markInstalling(input: { agentId: string, name: string, version: string, distributionType: AcpDistributionType }): void {
  const now = currentUnixSeconds()
  db().insert(acpAgents).values({
    id: input.agentId,
    name: input.name,
    version: input.version,
    source: 'registry',
    distributionType: input.distributionType,
    status: 'installing',
    updatedAt: now,
  }).onConflictDoUpdate({
    target: acpAgents.id,
    set: {
      name: input.name,
      version: input.version,
      distributionType: input.distributionType,
      status: 'installing',
      updatedAt: now,
      // intentionally omit source and override_* so reinstall preserves them
    },
  }).run()
}

function saveInstalledToDb(input: {
  agent: RegistryAgent
  distributionType: AcpDistributionType
  result: InstallResult
  clearOverrides?: boolean
}): void {
  const now = currentUnixSeconds()
  const overrideClear = input.clearOverrides
    ? {
        overrideCmd: null,
        overrideArgs: null,
        overrideEnv: null,
      }
    : {}

  db().insert(acpAgents).values({
    id: input.agent.id,
    name: input.agent.name,
    version: input.agent.version,
    source: 'registry',
    distributionType: input.distributionType,
    installPath: input.result.installPath,
    cmd: input.result.cmd,
    args: JSON.stringify(input.result.args),
    env: JSON.stringify(input.result.env),
    status: 'installed',
    updatedAt: now,
  }).onConflictDoUpdate({
    target: acpAgents.id,
    set: {
      name: input.agent.name,
      version: input.agent.version,
      distributionType: input.distributionType,
      installPath: input.result.installPath,
      cmd: input.result.cmd,
      args: JSON.stringify(input.result.args),
      env: JSON.stringify(input.result.env),
      status: 'installed',
      updatedAt: now,
      ...overrideClear,
      // intentionally omit source so it stays registry; omit override_* unless clearing
    },
  }).run()
}

function markFailed(agentId: string): void {
  const now = currentUnixSeconds()
  const existing = getInstalledFromDb(agentId)
  db().insert(acpAgents).values({
    id: agentId,
    name: existing?.name ?? agentId,
    version: existing?.version ?? '0.0.0',
    source: existing?.source ?? 'registry',
    distributionType: existing?.distributionType ?? 'npx',
    installPath: existing?.installPath ?? null,
    cmd: existing?.cmd ?? null,
    args: existing?.args ?? '[]',
    env: existing?.env ?? '{}',
    overrideCmd: existing?.overrideCmd ?? null,
    overrideArgs: existing?.overrideArgs ?? null,
    overrideEnv: existing?.overrideEnv ?? null,
    status: 'failed',
    updatedAt: now,
  }).onConflictDoUpdate({
    target: acpAgents.id,
    set: {
      status: 'failed',
      updatedAt: now,
    },
  }).run()
}

function deleteInstalledFromDb(agentId: string): void {
  db().delete(acpAgents).where(eq(acpAgents.id, agentId)).run()
}

function listAuditEntriesFromDb(agentId?: string): AcpAuditEntry[] {
  if (agentId) {
    return db().select().from(acpAuditLog).where(eq(acpAuditLog.agentId, agentId)).orderBy(desc(acpAuditLog.id)).all()
  }
  return db().select().from(acpAuditLog).orderBy(desc(acpAuditLog.id)).all()
}

function recordAudit(input: z.input<typeof AuditInputSchema>): void {
  const audit = AuditInputSchema.parse(input)
  db().insert(acpAuditLog).values({
    agentId: audit.agentId,
    action: audit.action,
    path: audit.path,
    details: JSON.stringify(audit.details),
  }).run()
}

// ── public API ──

export function fetchRegistry(): Promise<RegistryAgent[]> {
  return registry.fetchRegistry()
}

export async function getDistributionTypes(agentId: string): Promise<{ agentId: string, types: AcpDistributionType[] }> {
  const agent = await findRegistryAgent(agentId)
  if (!agent) {
    throw new AppError({
      code: 'acp_agent_not_found',
      status: 404,
      message: 'ACP agent not found in registry',
      details: { agentId },
    })
  }
  return { agentId, types: registry.getSupportedDistributionTypes(agent) }
}

export function listInstalled(): AcpAgent[] {
  return listInstalledFromDb()
}

export function getInstalled(agentId: string): AcpAgent | null {
  return getInstalledFromDb(agentId) ?? null
}

export interface CreateLocalAgentInput {
  id?: string
  name: string
  cmd: string
  args?: string[]
  env?: Record<string, string>
  distributionType?: LocalDistributionType
  version?: string
}

export function createLocalAgent(input: CreateLocalAgentInput): AcpAgent {
  const name = input.name.trim()
  if (!name) {
    throw new AppError({
      code: 'invalid_acp_input',
      status: 400,
      message: 'name is required',
    })
  }
  const cmd = input.cmd.trim()
  if (!cmd) {
    throw new AppError({
      code: 'invalid_acp_input',
      status: 400,
      message: 'cmd is required',
    })
  }

  const distributionType: LocalDistributionType = input.distributionType ?? 'command'
  if (distributionType !== 'command' && distributionType !== 'npx' && distributionType !== 'uvx') {
    throw new AppError({
      code: 'invalid_acp_input',
      status: 400,
      message: 'distributionType must be command, npx, or uvx for local agents',
      details: { distributionType },
    })
  }

  const args = input.args != null ? assertStringArray(input.args, 'args') : []
  const env = input.env != null ? assertStringRecord(input.env, 'env') : {}
  const version = (input.version?.trim() || 'local')

  let id = input.id?.trim()
  if (id) {
    assertValidAgentId(id)
  }
  else {
    id = generateLocalAgentId(name)
  }

  if (getInstalledFromDb(id)) {
    throw new AppError({
      code: 'acp_agent_id_conflict',
      status: 409,
      message: 'ACP agent id already exists',
      details: { agentId: id },
    })
  }

  const now = currentUnixSeconds()
  db().insert(acpAgents).values({
    id,
    name,
    version,
    source: 'local',
    distributionType,
    installPath: null,
    cmd,
    args: JSON.stringify(args),
    env: JSON.stringify(env),
    overrideCmd: null,
    overrideArgs: null,
    overrideEnv: null,
    status: 'installed',
    updatedAt: now,
  }).run()

  recordAudit({
    agentId: id,
    action: 'local_register',
    path: null,
    details: {
      distributionType,
      cmdPresent: true,
      envKeys: envKeysOnly(env),
    },
  })

  return getInstalledFromDb(id)!
}

export interface UpdateLaunchConfigInput {
  name?: string
  // registry overrides
  overrideCmd?: string | null
  overrideArgs?: string[] | null
  overrideEnv?: Record<string, string> | null
  // local base fields
  cmd?: string
  args?: string[]
  env?: Record<string, string>
  distributionType?: LocalDistributionType
  version?: string
}

export function updateLaunchConfig(agentId: string, patch: UpdateLaunchConfigInput): AcpAgent {
  const record = getInstalledFromDb(agentId)
  if (!record) {
    throw new AppError({
      code: 'acp_agent_not_installed',
      status: 404,
      message: 'ACP agent is not installed',
      details: { agentId },
    })
  }

  const source = (record.source ?? 'registry') as AcpAgentSource
  const now = currentUnixSeconds()
  const set: Partial<typeof acpAgents.$inferInsert> = { updatedAt: now }

  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) {
      throw new AppError({
        code: 'invalid_acp_input',
        status: 400,
        message: 'name must be non-blank when provided',
      })
    }
    set.name = name
  }

  if (source === 'local') {
    if (patch.overrideCmd !== undefined || patch.overrideArgs !== undefined || patch.overrideEnv !== undefined) {
      throw new AppError({
        code: 'invalid_acp_input',
        status: 400,
        message: 'override fields are not valid for local agents; update base cmd/args/env instead',
      })
    }

    if (patch.cmd !== undefined) {
      const cmd = patch.cmd.trim()
      if (!cmd) {
        throw new AppError({
          code: 'invalid_acp_input',
          status: 400,
          message: 'cmd must be non-blank when provided',
        })
      }
      set.cmd = cmd
    }
    if (patch.args !== undefined) {
      set.args = JSON.stringify(assertStringArray(patch.args, 'args'))
    }
    if (patch.env !== undefined) {
      set.env = JSON.stringify(assertStringRecord(patch.env, 'env'))
    }
    if (patch.distributionType !== undefined) {
      if (patch.distributionType !== 'command' && patch.distributionType !== 'npx' && patch.distributionType !== 'uvx') {
        throw new AppError({
          code: 'invalid_acp_input',
          status: 400,
          message: 'distributionType must be command, npx, or uvx for local agents',
        })
      }
      set.distributionType = patch.distributionType
    }
    if (patch.version !== undefined) {
      const version = patch.version.trim()
      if (!version) {
        throw new AppError({
          code: 'invalid_acp_input',
          status: 400,
          message: 'version must be non-blank when provided',
        })
      }
      set.version = version
    }

    db().update(acpAgents).set(set).where(eq(acpAgents.id, agentId)).run()
    recordAudit({
      agentId,
      action: 'local_update',
      path: null,
      details: {
        fields: Object.keys(patch).filter(k => (patch as Record<string, unknown>)[k] !== undefined),
        envKeys: patch.env ? envKeysOnly(patch.env) : undefined,
      },
    })
    return getInstalledFromDb(agentId)!
  }

  // registry
  if (
    patch.cmd !== undefined
    || patch.args !== undefined
    || patch.env !== undefined
    || patch.distributionType !== undefined
    || patch.version !== undefined
  ) {
    throw new AppError({
      code: 'invalid_acp_input',
      status: 400,
      message: 'base launch fields are installer-owned for registry agents; use overrideCmd/overrideArgs/overrideEnv',
    })
  }

  if (patch.overrideCmd !== undefined) {
    if (patch.overrideCmd === null) {
      set.overrideCmd = null
    }
    else {
      const overrideCmd = patch.overrideCmd.trim()
      if (!overrideCmd) {
        throw new AppError({
          code: 'invalid_acp_input',
          status: 400,
          message: 'overrideCmd must be non-blank when provided (use null to clear)',
        })
      }
      if (
        (record.distributionType === 'npx' || record.distributionType === 'uvx')
        && isAbsoluteOrPathLikeCommand(overrideCmd)
      ) {
        throw new AppError({
          code: 'invalid_acp_input',
          status: 400,
          message: 'overrideCmd must not be an absolute or path-like value for npx/uvx agents',
          details: { overrideCmd },
        })
      }
      set.overrideCmd = overrideCmd
    }
  }

  if (patch.overrideArgs !== undefined) {
    if (patch.overrideArgs === null) {
      set.overrideArgs = null
    }
    else {
      set.overrideArgs = JSON.stringify(assertStringArray(patch.overrideArgs, 'overrideArgs'))
    }
  }

  if (patch.overrideEnv !== undefined) {
    if (patch.overrideEnv === null) {
      set.overrideEnv = null
    }
    else {
      set.overrideEnv = JSON.stringify(assertStringRecord(patch.overrideEnv, 'overrideEnv'))
    }
  }

  db().update(acpAgents).set(set).where(eq(acpAgents.id, agentId)).run()
  recordAudit({
    agentId,
    action: 'launch_override_update',
    path: null,
    details: {
      fields: Object.keys(patch).filter(k => (patch as Record<string, unknown>)[k] !== undefined),
      envKeys: patch.overrideEnv ? envKeysOnly(patch.overrideEnv) : undefined,
    },
  })
  return getInstalledFromDb(agentId)!
}

export async function install(
  agentId: string,
  distributionType: AcpDistributionType,
  downloadCenter: AcpDownloadCenter,
): Promise<AcpAgent> {
  const existing = getInstalledFromDb(agentId)
  if (existing?.source === 'local') {
    throw new AppError({
      code: 'acp_local_not_installable',
      status: 409,
      message: 'Local ACP agents cannot be installed from the registry',
      details: { agentId },
    })
  }
  if (existing?.status === 'installing') {
    throw new AppError({
      code: 'acp_install_in_progress',
      status: 409,
      message: 'ACP agent installation is already in progress',
      details: { agentId },
    })
  }

  const agent = await findRegistryAgent(agentId)
  if (!agent) {
    throw new AppError({
      code: 'acp_agent_not_found',
      status: 404,
      message: 'ACP agent not found in registry',
      details: { agentId },
    })
  }

  const supportedTypes = registry.getSupportedDistributionTypes(agent)
  if (!supportedTypes.includes(distributionType)) {
    throw new AppError({
      code: 'acp_distribution_not_supported',
      status: 409,
      message: 'Requested ACP distribution is not supported for this agent on the current platform',
      details: { agentId, distributionType, supportedTypes },
    })
  }

  const previousDistributionType = existing?.distributionType
  const clearOverrides = Boolean(
    previousDistributionType
    && previousDistributionType !== distributionType,
  )
  const hadOverrides = Boolean(
    existing?.overrideCmd != null || existing?.overrideArgs != null || existing?.overrideEnv != null,
  )

  markInstalling({
    agentId,
    name: agent.name,
    version: agent.version,
    distributionType,
  })
  recordAudit({
    agentId,
    action: 'install_start',
    path: null,
    details: { distributionType },
  })
  const controller = new AbortController()
  installAbortControllers.set(agentId, controller)

  try {
    const result: InstallResult = distributionType === 'binary'
      ? await installer.installBinaryAgent(agent, getRuntimeDataDir(), downloadCenter, controller.signal)
      : installer.installPackageAgent(agent, distributionType)

    saveInstalledToDb({
      agent,
      distributionType,
      result,
      clearOverrides,
    })

    if (clearOverrides && hadOverrides) {
      recordAudit({
        agentId,
        action: 'launch_override_cleared',
        path: null,
        details: {
          reason: 'distribution_type_changed',
          previousDistributionType,
          distributionType,
        },
      })
    }

    recordAudit({
      agentId,
      action: 'install_complete',
      path: result.installPath,
      details: { distributionType, cmd: result.cmd, args: result.args },
    })
    return getInstalledFromDb(agentId)!
  }
  catch (error) {
    markFailed(agentId)
    recordAudit({
      agentId,
      action: 'install_failed',
      path: null,
      details: { distributionType, error: stringifyError(error) },
    })
    throw error
  }
  finally {
    if (installAbortControllers.get(agentId) === controller) {
      installAbortControllers.delete(agentId)
    }
  }
}

export function cancelInstall(agentId: string, downloadCenter: AcpDownloadCenter): void {
  const controller = installAbortControllers.get(agentId)
  controller?.abort()
  const owner = binaryDownloadOwner(agentId)
  const activeDownload = downloadCenter.list({
    ownerNamespace: owner.namespace,
    ownerResourceType: owner.resourceType,
    ownerResourceId: owner.resourceId,
  }).find(task => task.status === 'queued' || task.status === 'downloading' || task.status === 'verifying')
  if (activeDownload) {
    downloadCenter.cancel(activeDownload.taskId)
  }
  markFailed(agentId)
  recordAudit({
    agentId,
    action: 'install_failed',
    path: null,
    details: { cancelled: true },
  })
}

export async function uninstall(agentId: string): Promise<void> {
  const record = getInstalledFromDb(agentId)
  if (!record) {
    throw new AppError({
      code: 'acp_agent_not_installed',
      status: 404,
      message: 'ACP agent is not installed',
      details: { agentId },
    })
  }

  recordAudit({
    agentId,
    action: 'uninstall_start',
    path: record.installPath,
    details: {
      distributionType: record.distributionType,
      source: record.source ?? 'registry',
    },
  })

  // Only registry binary installs have a managed FS tree under installPath.
  if (record.source !== 'local' && record.distributionType === 'binary' && record.installPath) {
    await installer.uninstallBinaryAgent(agentId, record.installPath, getRuntimeDataDir())
  }

  deleteInstalledFromDb(agentId)
  recordAudit({
    agentId,
    action: 'uninstall_complete',
    path: record.installPath,
    details: {
      distributionType: record.distributionType,
      source: record.source ?? 'registry',
    },
  })
}

export function getAuditLog(agentId?: string) {
  return listAuditEntriesFromDb(agentId)
}

export function getAgentInstallPath(agentId: string): string {
  return installer.getAgentInstallDir(getRuntimeDataDir(), agentId)
}
