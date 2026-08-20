import { execFileSync } from 'node:child_process'

import type { ManagedChildProcess } from './managed-process'

export interface ProcessResources {
  rssMB: number
  cpuPercent: number
}

export interface ProcessTreeResources extends ProcessResources {
  descendantCount: number
}

export interface RuntimeProcessResources {
  running: boolean
  pid: number | null
  rssMB: number | null
  cpuPercent: number | null
}

export interface RuntimeProcessResource extends RuntimeProcessResources {
  hostId: string
  providerTargetId: string
  scopeId: string
}

export function summarizeRuntimeProcessResources(
  resources: RuntimeProcessResources[],
): RuntimeProcessResources {
  const runningResources = resources.filter(resource => resource.running)
  const rssMB = runningResources
    .map(resource => resource.rssMB)
    .filter((value): value is number => value !== null)
    .reduce((total, value) => total + value, 0)
  const cpuPercentValues = runningResources
    .map(resource => resource.cpuPercent)
    .filter((value): value is number => value !== null)

  return {
    running: runningResources.length > 0,
    pid: runningResources[0]?.pid ?? null,
    rssMB: runningResources.length > 0 && rssMB > 0 ? rssMB : null,
    cpuPercent: cpuPercentValues.length > 0
      ? cpuPercentValues.reduce((total, value) => total + value, 0)
      : null,
  }
}

const PROCESS_RESOURCE_FIELD_SEPARATOR_PATTERN = /\s+/

interface ProcessTableRow {
  pid: number
  ppid: number
  rssKB: number
  cpuPercent: number
}

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

export function readProcessTreeResourceUsage(pid: number): ProcessTreeResources | null {
  try {
    const output = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,pcpu='], {
      encoding: 'utf8',
      timeout: 1000,
    })
    const rows = output
      .split('\n')
      .map(parseProcessTableRow)
      .filter((row): row is ProcessTableRow => row !== null)
    const root = rows.find(row => row.pid === pid)
    if (!root) {
      return null
    }

    const tree = [root]
    const pendingPids = [pid]
    while (pendingPids.length > 0) {
      const parentPid = pendingPids.shift()
      if (parentPid === undefined) {
        break
      }
      for (const row of rows) {
        if (row.ppid !== parentPid) {
          continue
        }
        tree.push(row)
        pendingPids.push(row.pid)
      }
    }

    const rssMB = tree.reduce((total, row) => total + row.rssKB, 0) / 1024
    const cpuPercent = tree.reduce((total, row) => total + row.cpuPercent, 0)
    return {
      rssMB: Math.round(rssMB * 100) / 100,
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      descendantCount: tree.length - 1,
    }
  }
  catch {
    return null
  }
}

function parseProcessTableRow(rawLine: string): ProcessTableRow | null {
  const [pidRaw, ppidRaw, rssRaw, cpuRaw] = rawLine.trim().split(PROCESS_RESOURCE_FIELD_SEPARATOR_PATTERN)
  const pid = Number.parseInt(pidRaw ?? '', 10)
  const ppid = Number.parseInt(ppidRaw ?? '', 10)
  const rssKB = Number.parseInt(rssRaw ?? '', 10)
  const cpuPercent = Number.parseFloat(cpuRaw ?? '')
  if (
    !Number.isInteger(pid)
    || !Number.isInteger(ppid)
    || !Number.isInteger(rssKB)
    || !Number.isFinite(cpuPercent)
    || cpuPercent < 0
  ) {
    return null
  }
  return { pid, ppid, rssKB, cpuPercent }
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
