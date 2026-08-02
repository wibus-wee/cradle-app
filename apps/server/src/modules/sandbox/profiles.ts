import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { readNonNegativeIntegerEnv, readPositiveIntegerEnv } from '../../helpers/env'
import { resolveCradleDataDir } from '../worktree/worktree-paths'
import type { SandboxNetworkMode } from './runtime/types'

export interface SandboxProfile {
  id: string
  name: string
  image: string
  workdir: string
  env: Record<string, string>
  cpuLimit?: number
  memoryMb?: number
  networkMode: SandboxNetworkMode
  idleTtlSec: number
  labels: Record<string, string>
}

export interface SandboxPoolConfig {
  minWarm: number
  maxTotal: number
  maxPerWork: number
  defaultExecTimeoutMs: number
  maxExecTimeoutMs: number
}

interface ProfileFileShape {
  profiles?: Array<Partial<SandboxProfile> & { id: string, image: string }>
  pool?: Partial<SandboxPoolConfig>
}

const DEFAULT_PROFILES: SandboxProfile[] = [
  {
    id: 'node22',
    name: 'Node.js 22',
    image: 'node:22-bookworm-slim',
    workdir: '/workspace',
    env: {
      NODE_ENV: 'test',
    },
    cpuLimit: 1,
    memoryMb: 1024,
    networkMode: 'none',
    idleTtlSec: 30 * 60,
    labels: {},
  },
  {
    id: 'python312',
    name: 'Python 3.12',
    image: 'python:3.12-slim-bookworm',
    workdir: '/workspace',
    env: {
      PYTHONDONTWRITEBYTECODE: '1',
    },
    cpuLimit: 1,
    memoryMb: 1024,
    networkMode: 'none',
    idleTtlSec: 30 * 60,
    labels: {},
  },
]

export function readSandboxPoolConfig(): SandboxPoolConfig {
  const fromFile = readProfileFile()?.pool ?? {}
  return {
    minWarm: fromFile.minWarm
      ?? readNonNegativeIntegerEnv('CRADLE_SANDBOX_MIN_WARM', 1),
    maxTotal: fromFile.maxTotal
      ?? readPositiveIntegerEnv('CRADLE_SANDBOX_MAX_TOTAL', 16),
    maxPerWork: fromFile.maxPerWork
      ?? readPositiveIntegerEnv('CRADLE_SANDBOX_MAX_PER_WORK', 4),
    defaultExecTimeoutMs: fromFile.defaultExecTimeoutMs
      ?? readPositiveIntegerEnv('CRADLE_SANDBOX_EXEC_TIMEOUT_MS', 30_000),
    maxExecTimeoutMs: fromFile.maxExecTimeoutMs
      ?? readPositiveIntegerEnv('CRADLE_SANDBOX_EXEC_MAX_TIMEOUT_MS', 120_000),
  }
}

export function listSandboxProfiles(): SandboxProfile[] {
  const file = readProfileFile()
  if (!file?.profiles?.length) {
    return DEFAULT_PROFILES.map(cloneProfile)
  }
  return file.profiles.map(normalizeProfile)
}

export function getSandboxProfile(profileId: string): SandboxProfile | null {
  return listSandboxProfiles().find(profile => profile.id === profileId) ?? null
}

function readProfileFile(): ProfileFileShape | null {
  const configured = process.env.CRADLE_SANDBOX_PROFILES_PATH
  const candidates = [
    configured,
    join(resolveCradleDataDir(), 'sandbox-profiles.json'),
  ].filter((value): value is string => Boolean(value))

  for (const path of candidates) {
    if (!existsSync(path)) {
      continue
    }
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as ProfileFileShape
    }
    catch {
      return null
    }
  }
  return null
}

function normalizeProfile(
  input: Partial<SandboxProfile> & { id: string, image: string },
): SandboxProfile {
  const networkMode = input.networkMode === 'bridge' ? 'bridge' : 'none'
  return {
    id: input.id,
    name: input.name?.trim() || input.id,
    image: input.image,
    workdir: input.workdir?.trim() || '/workspace',
    env: input.env ?? {},
    cpuLimit: input.cpuLimit,
    memoryMb: input.memoryMb,
    networkMode,
    idleTtlSec: input.idleTtlSec && input.idleTtlSec > 0 ? input.idleTtlSec : 30 * 60,
    labels: input.labels ?? {},
  }
}

function cloneProfile(profile: SandboxProfile): SandboxProfile {
  return {
    ...profile,
    env: { ...profile.env },
    labels: { ...profile.labels },
  }
}
