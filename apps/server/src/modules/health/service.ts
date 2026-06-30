import type { Static } from 'elysia'

import type { HealthModel } from './model'

function toMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100
}

const CPU_SAMPLE_WINDOW_MS = 1_000

interface CpuSample {
  usageMicros: number
  sampledAt: number
}

let previousCpuSample: CpuSample | null = null
let stableCpuPercent: number | null = null

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100
}

function readCpuSnapshot(): Static<typeof HealthModel['checkResponse']>['cpu'] {
  const usage = process.cpuUsage()
  const current: CpuSample = {
    usageMicros: usage.user + usage.system,
    sampledAt: Date.now(),
  }
  const previous = previousCpuSample

  if (!previous) {
    previousCpuSample = current
    return {
      percent: null,
      userMicros: usage.user,
      systemMicros: usage.system,
      sampleMs: null,
      usedMicros: null,
      windowReady: false,
    }
  }

  const sampleMs = Math.max(0, current.sampledAt - previous.sampledAt)
  const usedMicros = Math.max(0, current.usageMicros - previous.usageMicros)
  if (sampleMs < CPU_SAMPLE_WINDOW_MS) {
    return {
      percent: stableCpuPercent,
      userMicros: usage.user,
      systemMicros: usage.system,
      sampleMs,
      usedMicros,
      windowReady: false,
    }
  }

  previousCpuSample = current
  stableCpuPercent = roundPercent((usedMicros / (sampleMs * 1000)) * 100)
  return {
    percent: stableCpuPercent,
    userMicros: usage.user,
    systemMicros: usage.system,
    sampleMs,
    usedMicros,
    windowReady: true,
  }
}

export function check(): Static<typeof HealthModel['checkResponse']> {
  const mem = process.memoryUsage()
  return {
    status: 'ok',
    uptime: Math.round(process.uptime()),
    memory: {
      heapUsed: toMB(mem.heapUsed),
      heapTotal: toMB(mem.heapTotal),
      rss: toMB(mem.rss),
      external: toMB(mem.external),
    },
    cpu: readCpuSnapshot(),
    timestamp: Date.now(),
  }
}

export function resetHealthSamplesForTests(): void {
  previousCpuSample = null
  stableCpuPercent = null
}
