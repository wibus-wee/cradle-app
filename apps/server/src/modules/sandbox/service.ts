import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'

import { AppError } from '../../errors/app-error'
import { createChildLogger } from '../../logging/logger'
import * as Session from '../session/service'
import * as Worktree from '../worktree/service'
import { SANDBOX_LABEL_INSTANCE, SANDBOX_LABEL_MARK, sandboxLabels } from './labels'
import {
  ensureSandboxDataDirs,
  resolveSandboxScratchDir,
} from './paths'
import type { SandboxProfile } from './profiles'
import {
  getSandboxProfile,
  listSandboxProfiles,
  readSandboxPoolConfig,
} from './profiles'
import type { SandboxMountSpec, SandboxRuntime } from './runtime'
import {
  getSandboxRuntime,
} from './runtime'
import type { SandboxInstanceRecord, SandboxLeaseRecord } from './store'
import {
  listActiveInstances,
  listActiveLeases,
  readSandboxStore,
  updateSandboxStore,
} from './store'

const logger = createChildLogger({ module: 'sandbox' })

export interface SandboxLeaseSummary {
  id: string
  instanceId: string
  profileId: string
  engineContainerId: string
  workId: string | null
  sessionId: string | null
  workspaceId: string
  purpose: string
  mountsResolved: SandboxMountSpec[]
  createdAt: number
  expiresAt: number | null
  releasedAt: number | null
}

export interface SandboxPoolStatus {
  runtimeKind: SandboxRuntime['kind']
  engineAvailable: boolean
  config: ReturnType<typeof readSandboxPoolConfig>
  profiles: Array<{
    id: string
    name: string
    image: string
    warm: number
    leased: number
  }>
  totals: {
    warm: number
    leased: number
    stopping: number
    dead: number
    activeLeases: number
  }
}

export interface SandboxExecOutcome {
  leaseId: string
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface LeaseSandboxInput {
  profileId: string
  workspaceId: string
  workId?: string | null
  sessionId?: string | null
  purpose?: string
  /** Host path to mount at profile.workdir. Defaults to Work/session execution root when sessionId set. */
  mountPath?: string | null
  mountWritable?: boolean
  networkMode?: 'none' | 'bridge'
  ttlSec?: number
}

let hooksRegistered = false

export function registerSandboxSessionHooks(): void {
  if (hooksRegistered) {
    return
  }
  hooksRegistered = true
  Session.onSessionArchiving(async (sessionId) => {
    await releaseLeasesForSession(sessionId)
  })
  Session.onSessionCleanup((sessionId) => {
    void releaseLeasesForSession(sessionId)
  })
}

export function listProfiles(): SandboxProfile[] {
  return listSandboxProfiles()
}

export async function getPoolStatus(): Promise<SandboxPoolStatus> {
  const runtime = getSandboxRuntime()
  const engineAvailable = await runtime.ping()
  const snapshot = readSandboxStore()
  const config = readSandboxPoolConfig()
  const profiles = listSandboxProfiles().map((profile) => {
    const instances = snapshot.instances.filter(item => item.profileId === profile.id)
    return {
      id: profile.id,
      name: profile.name,
      image: profile.image,
      warm: instances.filter(item => item.poolState === 'warm').length,
      leased: instances.filter(item => item.poolState === 'leased').length,
    }
  })
  return {
    runtimeKind: runtime.kind,
    engineAvailable,
    config,
    profiles,
    totals: {
      warm: snapshot.instances.filter(item => item.poolState === 'warm').length,
      leased: snapshot.instances.filter(item => item.poolState === 'leased').length,
      stopping: snapshot.instances.filter(item => item.poolState === 'stopping').length,
      dead: snapshot.instances.filter(item => item.poolState === 'dead').length,
      activeLeases: listActiveLeases(snapshot).length,
    },
  }
}

export function listLeases(filter: {
  workId?: string
  sessionId?: string
  workspaceId?: string
  includeReleased?: boolean
} = {}): SandboxLeaseSummary[] {
  const snapshot = readSandboxStore()
  const leases = filter.includeReleased
    ? snapshot.leases
    : listActiveLeases(snapshot)
  return leases
    .filter(lease => !filter.workId || lease.workId === filter.workId)
    .filter(lease => !filter.sessionId || lease.sessionId === filter.sessionId)
    .filter(lease => !filter.workspaceId || lease.workspaceId === filter.workspaceId)
    .map(lease => toLeaseSummary(lease, snapshot.instances))
    .sort((left, right) => right.createdAt - left.createdAt)
}

export async function leaseSandbox(input: LeaseSandboxInput): Promise<SandboxLeaseSummary> {
  const profile = getSandboxProfile(input.profileId)
  if (!profile) {
    throw new AppError({
      code: 'sandbox_profile_not_found',
      status: 404,
      message: `Sandbox profile not found: ${input.profileId}`,
    })
  }

  const config = readSandboxPoolConfig()
  const snapshot = readSandboxStore()
  const active = listActiveInstances(snapshot)
  const warmForProfile = active.find(
    item => item.profileId === profile.id && item.poolState === 'warm',
  )
  // Leasing destroys one warm container (if any) then creates one leased container.
  // Only reject when that would grow the pool past maxTotal.
  if (!warmForProfile && active.length >= config.maxTotal) {
    throw new AppError({
      code: 'sandbox_capacity_exceeded',
      status: 409,
      message: `Sandbox pool is at capacity (${config.maxTotal})`,
      details: { maxTotal: config.maxTotal, active: active.length },
    })
  }

  if (input.workId) {
    const workLeases = listActiveLeases(snapshot).filter(lease => lease.workId === input.workId)
    if (workLeases.length >= config.maxPerWork) {
      throw new AppError({
        code: 'sandbox_work_capacity_exceeded',
        status: 409,
        message: `Work already holds the maximum number of sandboxes (${config.maxPerWork})`,
        details: { maxPerWork: config.maxPerWork, workId: input.workId },
      })
    }
  }

  const mountPath = resolveMountPath(input)

  // Docker bind mounts are create-time only. Consume a warm slot (destroy idle
  // container) then create a mounted leased container so image layers stay hot.
  await consumeWarmSlot(profile.id)

  const leaseId = randomUUID()
  const instanceId = randomUUID()
  const createdAt = now()
  const ttlSec = input.ttlSec && input.ttlSec > 0 ? input.ttlSec : profile.idleTtlSec
  const expiresAt = createdAt + ttlSec
  const resolvedMounts = buildMounts({
    profile,
    instanceIdHint: instanceId,
    mountPath,
    mountWritable: input.mountWritable === true,
  })
  ensureScratch(instanceId)

  const runtime = getSandboxRuntime()
  const engineAvailable = await runtime.ping()
  if (!engineAvailable) {
    throw new AppError({
      code: 'sandbox_engine_unavailable',
      status: 503,
      message: 'Sandbox engine unavailable (OrbStack/Docker not reachable)',
    })
  }

  try {
    await runtime.pullImage(profile.image)
  }
  catch (error) {
    logger.warn('sandbox image pull failed; trying create anyway', { err: error, image: profile.image })
  }

  const networkMode = input.networkMode ?? profile.networkMode
  let engineContainerId: string | null = null
  try {
    const created = await runtime.create({
      name: `cradle-sandbox-${instanceId.slice(0, 8)}`,
      image: profile.image,
      workdir: profile.workdir,
      env: {
        ...profile.env,
        CRADLE_SANDBOX_LEASE_ID: leaseId,
        CRADLE_SANDBOX_INSTANCE_ID: instanceId,
        CRADLE_WORKSPACE_ID: input.workspaceId,
      },
      mounts: resolvedMounts,
      networkMode,
      cpuLimit: profile.cpuLimit,
      memoryMb: profile.memoryMb,
      labels: {
        ...profile.labels,
        ...sandboxLabels({
          profileId: profile.id,
          instanceId,
          poolState: 'leased',
          leaseId,
        }),
      },
    })
    engineContainerId = created.id
    await runtime.start(created.id)

    updateSandboxStore((store) => {
      store.instances.push({
        id: instanceId,
        profileId: profile.id,
        engineContainerId: created.id,
        poolState: 'leased',
        leaseId,
        createdAt,
        lastHeartbeatAt: createdAt,
      })
      store.leases.push({
        id: leaseId,
        instanceId,
        workId: input.workId ?? null,
        sessionId: input.sessionId ?? null,
        workspaceId: input.workspaceId,
        purpose: input.purpose?.trim() || 'test',
        mountsResolved: resolvedMounts,
        createdAt,
        expiresAt,
        releasedAt: null,
      })
    })

    void refillWarmPool().catch((error) => {
      logger.warn('sandbox warm pool refill failed', { err: error })
    })

    return {
      id: leaseId,
      instanceId,
      profileId: profile.id,
      engineContainerId: created.id,
      workId: input.workId ?? null,
      sessionId: input.sessionId ?? null,
      workspaceId: input.workspaceId,
      purpose: input.purpose?.trim() || 'test',
      mountsResolved: resolvedMounts,
      createdAt,
      expiresAt,
      releasedAt: null,
    }
  }
  catch (error) {
    if (engineContainerId) {
      await runtime.remove(engineContainerId, true)
    }
    rmScratch(instanceId)
    throw new AppError({
      code: 'sandbox_lease_failed',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to lease sandbox',
    })
  }
}

export async function releaseLease(leaseId: string): Promise<SandboxLeaseSummary> {
  const snapshot = readSandboxStore()
  const lease = snapshot.leases.find(item => item.id === leaseId)
  if (!lease) {
    throw new AppError({
      code: 'sandbox_lease_not_found',
      status: 404,
      message: `Sandbox lease not found: ${leaseId}`,
    })
  }
  if (lease.releasedAt != null) {
    return toLeaseSummary(lease, snapshot.instances)
  }
  await destroyInstance(lease.instanceId, leaseId)
  const updated = readSandboxStore()
  const released = updated.leases.find(item => item.id === leaseId)!
  void refillWarmPool().catch((error) => {
    logger.warn('sandbox warm pool refill failed', { err: error })
  })
  return toLeaseSummary(released, updated.instances)
}

export async function releaseLeasesForSession(sessionId: string): Promise<number> {
  const active = listActiveLeases().filter(lease => lease.sessionId === sessionId)
  for (const lease of active) {
    await releaseLease(lease.id)
  }
  return active.length
}

export async function releaseLeasesForWork(workId: string): Promise<number> {
  const active = listActiveLeases().filter(lease => lease.workId === workId)
  for (const lease of active) {
    await releaseLease(lease.id)
  }
  return active.length
}

export async function execInLease(input: {
  leaseId: string
  command: string[]
  workdir?: string
  env?: Record<string, string>
  timeoutMs?: number
}): Promise<SandboxExecOutcome> {
  if (!input.command.length) {
    throw new AppError({
      code: 'sandbox_exec_command_required',
      status: 400,
      message: 'Sandbox exec requires a non-empty command',
    })
  }

  const snapshot = readSandboxStore()
  const lease = snapshot.leases.find(item => item.id === input.leaseId)
  if (!lease || lease.releasedAt != null) {
    throw new AppError({
      code: 'sandbox_lease_not_found',
      status: 404,
      message: `Active sandbox lease not found: ${input.leaseId}`,
    })
  }
  const instance = snapshot.instances.find(item => item.id === lease.instanceId)
  if (!instance || instance.poolState !== 'leased') {
    throw new AppError({
      code: 'sandbox_instance_unavailable',
      status: 409,
      message: 'Sandbox instance is not leased/running',
    })
  }

  const config = readSandboxPoolConfig()
  const timeoutMs = Math.min(
    Math.max(input.timeoutMs ?? config.defaultExecTimeoutMs, 1),
    config.maxExecTimeoutMs,
  )
  const profile = getSandboxProfile(
    snapshot.instances.find(item => item.id === lease.instanceId)?.profileId ?? '',
  )

  const runtime = getSandboxRuntime()
  const result = await runtime.exec({
    containerId: instance.engineContainerId,
    command: input.command,
    workdir: input.workdir ?? profile?.workdir,
    env: input.env,
    timeoutMs,
  })

  updateSandboxStore((store) => {
    const row = store.instances.find(item => item.id === instance.id)
    if (row) {
      row.lastHeartbeatAt = now()
    }
  })

  return {
    leaseId: lease.id,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
  }
}

export async function reconcilePool(): Promise<{
  expiredReleased: number
  orphansRemoved: number
  warmEnsured: number
}> {
  const runtime = getSandboxRuntime()
  const expiredReleased = await releaseExpiredLeases()
  let orphansRemoved = 0

  if (await runtime.ping()) {
    const labeled = await runtime.listLabeled({ [SANDBOX_LABEL_MARK]: '1' })
    const snapshot = readSandboxStore()
    const knownEngineIds = new Set(
      snapshot.instances
        .filter(item => item.poolState !== 'dead')
        .map(item => item.engineContainerId),
    )

    for (const container of labeled) {
      if (knownEngineIds.has(container.id)) {
        continue
      }
      // Engine has a Cradle-labeled container we do not track — remove it.
      await runtime.remove(container.id, true)
      orphansRemoved += 1
    }

    // Mark missing leased/warm instances dead and release leases.
    for (const instance of listActiveInstances(snapshot)) {
      const inspected = await runtime.inspect(instance.engineContainerId)
      if (inspected && inspected.state === 'running') {
        continue
      }
      await destroyInstance(instance.id, instance.leaseId)
    }
  }

  const warmEnsured = await refillWarmPool()
  return { expiredReleased, orphansRemoved, warmEnsured }
}

export async function refillWarmPool(): Promise<number> {
  const runtime = getSandboxRuntime()
  if (!(await runtime.ping())) {
    return 0
  }
  const config = readSandboxPoolConfig()
  let created = 0
  for (const profile of listSandboxProfiles()) {
    while (true) {
      const snapshot = readSandboxStore()
      const active = listActiveInstances(snapshot)
      if (active.length >= config.maxTotal) {
        return created
      }
      const warmForProfile = active.filter(
        item => item.profileId === profile.id && item.poolState === 'warm',
      ).length
      if (warmForProfile >= config.minWarm) {
        break
      }
      await createWarmInstance(profile)
      created += 1
    }
  }
  return created
}

async function createWarmInstance(profile: SandboxProfile): Promise<SandboxInstanceRecord> {
  const runtime = getSandboxRuntime()
  const instanceId = randomUUID()
  const createdAt = now()
  ensureScratch(instanceId)
  const mounts: SandboxMountSpec[] = [{
    hostPath: resolveSandboxScratchDir(instanceId),
    containerPath: '/scratch',
    readOnly: false,
  }]

  try {
    await runtime.pullImage(profile.image)
  }
  catch (error) {
    logger.warn('warm pool image pull failed', { err: error, image: profile.image })
  }

  const created = await runtime.create({
    name: `cradle-sandbox-warm-${instanceId.slice(0, 8)}`,
    image: profile.image,
    workdir: profile.workdir,
    env: profile.env,
    mounts,
    networkMode: 'none',
    cpuLimit: profile.cpuLimit,
    memoryMb: profile.memoryMb,
    labels: {
      ...profile.labels,
      ...sandboxLabels({
        profileId: profile.id,
        instanceId,
        poolState: 'warm',
      }),
    },
  })
  await runtime.start(created.id)

  const record: SandboxInstanceRecord = {
    id: instanceId,
    profileId: profile.id,
    engineContainerId: created.id,
    poolState: 'warm',
    leaseId: null,
    createdAt,
    lastHeartbeatAt: createdAt,
  }
  updateSandboxStore((store) => {
    store.instances.push(record)
  })
  return record
}

async function consumeWarmSlot(profileId: string): Promise<void> {
  const snapshot = readSandboxStore()
  const warm = snapshot.instances.find(
    item => item.profileId === profileId && item.poolState === 'warm',
  )
  if (!warm) {
    return
  }
  await destroyInstance(warm.id, null)
}

async function releaseExpiredLeases(): Promise<number> {
  const timestamp = now()
  const expired = listActiveLeases().filter(
    lease => lease.expiresAt != null && lease.expiresAt <= timestamp,
  )
  for (const lease of expired) {
    await releaseLease(lease.id)
  }
  return expired.length
}

async function destroyInstance(instanceId: string, leaseId: string | null): Promise<void> {
  const runtime = getSandboxRuntime()
  const snapshot = readSandboxStore()
  const instance = snapshot.instances.find(item => item.id === instanceId)
  if (instance?.engineContainerId) {
    updateSandboxStore((store) => {
      const row = store.instances.find(item => item.id === instanceId)
      if (row) {
        row.poolState = 'stopping'
      }
    })
    await runtime.stop(instance.engineContainerId, 2)
    await runtime.remove(instance.engineContainerId, true)
  }

  const releasedAt = now()
  updateSandboxStore((store) => {
    const row = store.instances.find(item => item.id === instanceId)
    if (row) {
      row.poolState = 'dead'
      row.leaseId = null
      row.lastHeartbeatAt = releasedAt
    }
    if (leaseId) {
      const lease = store.leases.find(item => item.id === leaseId)
      if (lease && lease.releasedAt == null) {
        lease.releasedAt = releasedAt
      }
    }
    else if (instance?.leaseId) {
      const lease = store.leases.find(item => item.id === instance.leaseId)
      if (lease && lease.releasedAt == null) {
        lease.releasedAt = releasedAt
      }
    }
  })
  rmScratch(instanceId)
  void SANDBOX_LABEL_INSTANCE
}

function resolveMountPath(input: LeaseSandboxInput): string | null {
  if (input.mountPath) {
    return input.mountPath
  }
  if (!input.sessionId) {
    return null
  }
  const session = Session.get(input.sessionId)
  if (!session) {
    throw new AppError({
      code: 'sandbox_session_not_found',
      status: 404,
      message: `Session not found for sandbox lease: ${input.sessionId}`,
    })
  }
  const execution = Worktree.resolveSessionExecutionRoot(session)
  if (!execution.rootPath) {
    throw new AppError({
      code: 'sandbox_mount_unavailable',
      status: 409,
      message: 'Session has no local execution root to mount into the sandbox',
    })
  }
  return execution.rootPath
}

function buildMounts(input: {
  profile: SandboxProfile
  instanceIdHint: string
  mountPath: string | null
  mountWritable: boolean
}): SandboxMountSpec[] {
  const mounts: SandboxMountSpec[] = [{
    hostPath: resolveSandboxScratchDir(input.instanceIdHint),
    containerPath: '/scratch',
    readOnly: false,
  }]
  if (input.mountPath) {
    mounts.push({
      hostPath: input.mountPath,
      containerPath: input.profile.workdir,
      readOnly: !input.mountWritable,
    })
  }
  return mounts
}

function ensureScratch(instanceId: string): void {
  ensureSandboxDataDirs()
  mkdirSync(resolveSandboxScratchDir(instanceId), { recursive: true })
}

function rmScratch(instanceId: string): void {
  try {
    rmSync(resolveSandboxScratchDir(instanceId), { recursive: true, force: true })
  }
  catch {
    // best-effort
  }
}

function toLeaseSummary(
  lease: SandboxLeaseRecord,
  instances: SandboxInstanceRecord[],
): SandboxLeaseSummary {
  const instance = instances.find(item => item.id === lease.instanceId)
  return {
    id: lease.id,
    instanceId: lease.instanceId,
    profileId: instance?.profileId ?? 'unknown',
    engineContainerId: instance?.engineContainerId ?? '',
    workId: lease.workId,
    sessionId: lease.sessionId,
    workspaceId: lease.workspaceId,
    purpose: lease.purpose,
    mountsResolved: lease.mountsResolved,
    createdAt: lease.createdAt,
    expiresAt: lease.expiresAt,
    releasedAt: lease.releasedAt,
  }
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}
