import { arch, cpus, freemem, homedir, hostname, platform, release, totalmem, type as osType, uptime, version as osVersion } from 'node:os'

import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

interface SystemInfo {
  hostname: string
  platform: string
  arch: string
  osType: string
  osVersion: string
  osRelease: string
  cpuModel: string
  cpuCores: number
  totalMemoryGB: number
  freeMemoryGB: number
  usedMemoryGB: number
  memoryUsagePercent: number
  uptimeHours: number
  nodeVersion: string
  homeDir: string
  pid: number
}

function getSystemInfo(): SystemInfo {
  const totalMem = totalmem()
  const freeMem = freemem()
  const usedMem = totalMem - freeMem
  const cpuInfo = cpus()

  return {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    osType: osType(),
    osVersion: osVersion(),
    osRelease: release(),
    cpuModel: cpuInfo[0]?.model ?? 'unknown',
    cpuCores: cpuInfo.length,
    totalMemoryGB: Math.round(totalMem / 1073741824 * 100) / 100,
    freeMemoryGB: Math.round(freeMem / 1073741824 * 100) / 100,
    usedMemoryGB: Math.round(usedMem / 1073741824 * 100) / 100,
    memoryUsagePercent: Math.round((usedMem / totalMem) * 100),
    uptimeHours: Math.round(uptime() / 3600 * 100) / 100,
    nodeVersion: process.version,
    homeDir: homedir(),
    pid: process.pid,
  }
}

export function activate(ctx: ServerPluginContext): void {
  ctx.routes.register({
    method: 'GET',
    path: '/info',
    label: 'System info',
    handler: () => getSystemInfo(),
  })

  ctx.logger.info('System Info plugin activated')
}
