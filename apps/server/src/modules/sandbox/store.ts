import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { ensureSandboxDataDirs, resolveSandboxStorePath } from './paths'
import type { SandboxMountSpec } from './runtime/types'

export type SandboxPoolState = 'warm' | 'leased' | 'stopping' | 'dead'

export interface SandboxInstanceRecord {
  id: string
  profileId: string
  engineContainerId: string
  poolState: SandboxPoolState
  leaseId: string | null
  createdAt: number
  lastHeartbeatAt: number
}

export interface SandboxLeaseRecord {
  id: string
  instanceId: string
  workId: string | null
  sessionId: string | null
  workspaceId: string
  purpose: string
  mountsResolved: SandboxMountSpec[]
  createdAt: number
  expiresAt: number | null
  releasedAt: number | null
}

interface SandboxStoreSnapshot {
  version: 1
  instances: SandboxInstanceRecord[]
  leases: SandboxLeaseRecord[]
}

const EMPTY: SandboxStoreSnapshot = {
  version: 1,
  instances: [],
  leases: [],
}

let memory: SandboxStoreSnapshot | null = null

/** Test seam — keep state in memory without touching disk. */
export function useMemorySandboxStoreForTests(): void {
  memory = structuredClone(EMPTY)
}

export function resetSandboxStoreForTests(): void {
  memory = structuredClone(EMPTY)
}

export function readSandboxStore(): SandboxStoreSnapshot {
  if (memory) {
    return memory
  }
  const path = resolveSandboxStorePath()
  if (!existsSync(path)) {
    return structuredClone(EMPTY)
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SandboxStoreSnapshot
    if (parsed.version !== 1 || !Array.isArray(parsed.instances) || !Array.isArray(parsed.leases)) {
      return structuredClone(EMPTY)
    }
    return parsed
  }
  catch {
    return structuredClone(EMPTY)
  }
}

export function writeSandboxStore(snapshot: SandboxStoreSnapshot): void {
  if (memory) {
    memory = structuredClone(snapshot)
    return
  }
  ensureSandboxDataDirs()
  const path = resolveSandboxStorePath()
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  renameSync(tempPath, path)
}

export function updateSandboxStore(
  mutate: (snapshot: SandboxStoreSnapshot) => void,
): SandboxStoreSnapshot {
  const snapshot = structuredClone(readSandboxStore())
  mutate(snapshot)
  writeSandboxStore(snapshot)
  return snapshot
}

export function listActiveLeases(snapshot = readSandboxStore()): SandboxLeaseRecord[] {
  return snapshot.leases.filter(lease => lease.releasedAt == null)
}

export function listActiveInstances(snapshot = readSandboxStore()): SandboxInstanceRecord[] {
  return snapshot.instances.filter(instance => instance.poolState !== 'dead')
}
