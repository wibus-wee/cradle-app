import { execFileSync } from 'node:child_process'

import type { ManagedChildProcess } from '../../infra/managed-process'

export interface ProcessResources {
  rssMB: number
  cpuPercent: number
}

export interface RuntimeProcessResources {
  running: boolean
  pid: number | null
  rssMB: number | null
  cpuPercent: number | null
}

const PROCESS_RESOURCE_FIELD_SEPARATOR_PATTERN = /\s+/

export function readManagedProcessPid(proc: ManagedChildProcess): number | null {
  return proc.targetPid ?? proc.pid ?? null
}

export function readProcessResourceUsage(pid: number): ProcessResources | null {
  try {
    const output = execFileSync('ps', ['-o', 'rss=,pcpu=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 1000,
    }).trim()
    const [rssRaw, cpuRaw] = output.split(PROCESS_RESOURCE_FIELD_SEPARATOR_PATTERN)
    const rssMB = Number.parseInt(rssRaw, 10) / 1024
    const cpuPercent = Number.parseFloat(cpuRaw)
    if (!Number.isFinite(rssMB) || rssMB < 0 || !Number.isFinite(cpuPercent) || cpuPercent < 0) {
      return null
    }
    return {
      rssMB: Math.round(rssMB * 100) / 100,
      cpuPercent: Math.round(cpuPercent * 100) / 100,
    }
  }
  catch {
    return null
  }
}

export function emptyRuntimeProcessResources(): RuntimeProcessResources {
  return {
    running: false,
    pid: null,
    rssMB: null,
    cpuPercent: null,
  }
}

export function readProcessResources(proc: ManagedChildProcess): RuntimeProcessResources {
  const pid = readManagedProcessPid(proc)
  if (!pid) {
    return emptyRuntimeProcessResources()
  }
  const usage = readProcessResourceUsage(pid)
  return {
    running: true,
    pid,
    rssMB: usage?.rssMB ?? null,
    cpuPercent: usage?.cpuPercent ?? null,
  }
}
