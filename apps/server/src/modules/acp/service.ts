import { dirname } from 'node:path'

import type { AcpAgent, AcpAuditEntry } from '@cradle/db'
import { acpAgents, acpAuditLog } from '@cradle/db'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db, getServerConfig } from '../../infra'
import type { InstallResult } from './acp.installer'
import { AcpInstaller } from './acp.installer'
import type { AcpDistributionType, RegistryAgent } from './acp.registry'
import { AcpRegistry } from './acp.registry'

// ── in-memory state ──

const installAbortControllers = new Map<string, AbortController>()

const registry = new AcpRegistry()
const installer = new AcpInstaller()

const AuditInputSchema = z.object({
  agentId: z.string(),
  action: z.string(),
  path: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).default({}),
})

// ── helpers ──

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getRuntimeDataDir(): string {
  const config = getServerConfig()
  return config.dataDir ?? dirname(config.dbPath)
}

async function findRegistryAgent(agentId: string): Promise<RegistryAgent | undefined> {
  const agents = await registry.fetchRegistry()
  return agents.find(a => a.id === agentId)
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
    },
  }).run()
}

function saveInstalledToDb(input: { agent: RegistryAgent, distributionType: AcpDistributionType, result: InstallResult }): void {
  const now = currentUnixSeconds()
  db().insert(acpAgents).values({
    id: input.agent.id,
    name: input.agent.name,
    version: input.agent.version,
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
    distributionType: existing?.distributionType ?? 'npx',
    installPath: existing?.installPath ?? null,
    cmd: existing?.cmd ?? null,
    args: existing?.args ?? '[]',
    env: existing?.env ?? '{}',
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
  return registry.fetchRegistry().then(agents => agents.map(agent => ({
    ...agent,
    distribution: {
      npx: agent.distribution.npx,
      uvx: agent.distribution.uvx,
    },
  })))
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

export async function install(agentId: string, distributionType: AcpDistributionType): Promise<AcpAgent> {
  const agent = await findRegistryAgent(agentId)
  if (!agent) {
    throw new AppError({
      code: 'acp_agent_not_found',
      status: 404,
      message: 'ACP agent not found in registry',
      details: { agentId },
    })
  }

  if (distributionType === 'binary') {
    throw new AppError({
      code: 'acp_binary_integrity_metadata_missing',
      status: 409,
      message: 'ACP binary installation requires a trusted publisher checksum, but the registry does not provide one',
      details: { agentId, distributionType },
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

  try {
    const result: InstallResult = installer.installPackageAgent(agent, distributionType)

    saveInstalledToDb({ agent, distributionType, result })
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
}

export function cancelInstall(agentId: string): void {
  const controller = installAbortControllers.get(agentId)
  if (controller) {
    controller.abort()
    installAbortControllers.delete(agentId)
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
    details: { distributionType: record.distributionType },
  })

  if (record.distributionType === 'binary' && record.installPath) {
    await installer.uninstallBinaryAgent(agentId, record.installPath, getRuntimeDataDir())
  }

  deleteInstalledFromDb(agentId)
  recordAudit({
    agentId,
    action: 'uninstall_complete',
    path: record.installPath,
    details: { distributionType: record.distributionType },
  })
}

export function getAuditLog(agentId?: string) {
  return listAuditEntriesFromDb(agentId)
}

export function getAgentInstallPath(agentId: string): string {
  return installer.getAgentInstallDir(getRuntimeDataDir(), agentId)
}
