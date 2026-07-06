import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { relayServers } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { db } from '../../infra'
import type { ManagedChildProcess } from '../../infra/managed-process'
import { spawnManagedProcess } from '../../infra/managed-process'
import { createChildLogger } from '../../logging/logger'
import { getNetworkPreferencesSync } from '../preferences/service'
import { readDefaultRelayServer } from './service'

const localRelayServerId = 'system:local-relayd'
const localRelayDisplayName = 'Built-in local relay'
const defaultRelayHost = '127.0.0.1'
const networkRelayHost = '0.0.0.0'
const relaydExecutableName = process.platform === 'win32' ? 'relayd.exe' : 'relayd'
const localModuleDir = dirname(fileURLToPath(import.meta.url))
const logger = createChildLogger({ module: 'local-relayd-supervisor' })

interface RunningLocalRelayd {
  child: ManagedChildProcess
  relayUrl: string
}

type InboundAccessMode = 'local' | 'network'

const defaultInboundRelayConfig = {
  managedRelayAccessMode: 'local' as const,
  managedRelayPublicUrl: null,
}

let runningLocalRelayd: RunningLocalRelayd | null = null

export function shouldStartManagedLocalRelayd(): boolean {
  const configured = process.env.CRADLE_RELAYD_AUTOSTART?.trim().toLowerCase()
  if (configured === '0' || configured === 'false' || configured === 'no') {
    return false
  }
  if (configured === '1' || configured === 'true' || configured === 'yes') {
    return true
  }
  return !isTestEnvironment()
}

export async function startManagedLocalRelayd(): Promise<void> {
  if (runningLocalRelayd || !shouldStartManagedLocalRelayd()) {
    return
  }

  const launch = await resolveLocalRelaydLaunch()
  if (!launch) {
    logger.warn('managed local relayd is enabled but no relayd executable or development source tree was found')
    return
  }

  const networkConfig = resolveManagedLocalRelaydNetworkConfig()
  const listenAddr = process.env.CRADLE_RELAYD_LISTEN?.trim()
    || await resolveManagedLocalRelaydListenAddr(networkConfig)
  const localReadyUrl = localReadyUrlForListenAddr(listenAddr)
  const relayUrl = process.env.CRADLE_RELAYD_PUBLIC_URL?.trim()
    || networkConfig.publicUrl
    || localReadyUrl
  const child = spawnManagedProcess({
    kind: 'spawn',
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    env: {
      ...process.env,
      CRADLE_RELAYD_LISTEN: listenAddr,
      CRADLE_RELAYD_PUBLIC_URL: relayUrl,
      CRADLE_RELAYD_EXIT_ON_STDIN_CLOSE: '1',
    },
    stdin: 'pipe',
    shutdownGraceMs: 3_000,
  })

  runningLocalRelayd = { child, relayUrl }
  child.stdout?.on('data', chunk => logger.info('relayd stdout', { output: chunk.toString('utf8').trimEnd() }))
  child.stderr?.on('data', chunk => logger.warn('relayd stderr', { output: chunk.toString('utf8').trimEnd() }))
  child.on('error', (error) => {
    logger.error('managed local relayd failed to spawn', { err: error })
    closeChildOwnerPipe(child)
    if (runningLocalRelayd?.child === child) {
      runningLocalRelayd = null
    }
  })
  child.on('exit', (code, signal) => {
    logger.info('managed local relayd exited', { code, signal })
    closeChildOwnerPipe(child)
    if (runningLocalRelayd?.child === child) {
      runningLocalRelayd = null
    }
  })

  try {
    await waitForReady(localReadyUrl)
    upsertManagedLocalRelayServer(relayUrl)
    logger.info('managed local relayd started', { relayUrl, pid: readManagedProcessPid(child) })
  }
  catch (error) {
    await stopManagedLocalRelayd()
    logger.warn('managed local relayd did not become ready', { err: error })
  }
}

export async function stopManagedLocalRelayd(): Promise<void> {
  const running = runningLocalRelayd
  if (!running) {
    return
  }
  runningLocalRelayd = null
  await terminateChild(running.child)
}

function resolveManagedLocalRelaydNetworkConfig(): { accessMode: InboundAccessMode, publicUrl: string | null } {
  try {
    const inbound = getNetworkPreferencesSync().inbound ?? defaultInboundRelayConfig
    return {
      accessMode: inbound.managedRelayAccessMode,
      publicUrl: inbound.managedRelayPublicUrl,
    }
  }
  catch (error) {
    logger.warn('failed to read managed local relayd network preferences; using local-only defaults', { err: error })
    return { accessMode: 'local', publicUrl: null }
  }
}

async function resolveManagedLocalRelaydListenAddr(config: { accessMode: InboundAccessMode, publicUrl: string | null }): Promise<string> {
  const host = config.accessMode === 'network' ? networkRelayHost : defaultRelayHost
  const portFromPublicUrl = config.accessMode === 'network' && config.publicUrl
    ? listenPortFromPublicUrl(config.publicUrl)
    : null
  if (portFromPublicUrl !== null) {
    return `${host}:${portFromPublicUrl}`
  }
  return await allocateListenAddr(host)
}

function listenPortFromPublicUrl(publicUrl: string): number | null {
  try {
    const url = new URL(publicUrl)
    if (url.port) {
      return Number.parseInt(url.port, 10)
    }
    return null
  }
  catch {
    return null
  }
}

function localReadyUrlForListenAddr(listenAddr: string): string {
  const port = listenPortFromListenAddr(listenAddr)
  const host = listenAddr.startsWith(`${networkRelayHost}:`) ? defaultRelayHost : listenAddr.slice(0, listenAddr.lastIndexOf(':'))
  return `http://${host || defaultRelayHost}:${port}`
}

function listenPortFromListenAddr(listenAddr: string): number {
  const separator = listenAddr.lastIndexOf(':')
  const port = separator >= 0 ? Number.parseInt(listenAddr.slice(separator + 1), 10) : Number.NaN
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Managed relayd listen address must include a positive port: ${listenAddr}`)
  }
  return port
}

function upsertManagedLocalRelayServer(relayUrl: string): void {
  const now = Math.floor(Date.now() / 1000)
  const existingDefault = readDefaultRelayServer()
  const row = db()
    .select({ id: relayServers.id })
    .from(relayServers)
    .where(eq(relayServers.id, localRelayServerId))
    .get()
  const shouldBeDefault = existingDefault === null || existingDefault.id === localRelayServerId

  if (row) {
    db()
      .update(relayServers)
      .set({
        displayName: localRelayDisplayName,
        relayUrl,
        enabled: true,
        isDefault: shouldBeDefault,
        updatedAt: now,
      })
      .where(eq(relayServers.id, localRelayServerId))
      .run()
    return
  }

  db()
    .insert(relayServers)
    .values({
      id: localRelayServerId,
      displayName: localRelayDisplayName,
      relayUrl,
      enabled: true,
      isDefault: shouldBeDefault,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

async function resolveLocalRelaydLaunch(): Promise<{ command: string, args: string[], cwd?: string } | null> {
  const explicitPath = process.env.CRADLE_RELAYD_PATH?.trim()
  if (explicitPath) {
    return { command: explicitPath, args: [] }
  }

  const packagedPath = join(
    (process as { resourcesPath?: string }).resourcesPath ?? '',
    'relayd',
    `${process.platform}-${process.arch}`,
    relaydExecutableName,
  )
  if (existsSync(packagedPath)) {
    return { command: packagedPath, args: [] }
  }

  const sourceDir = resolveRelaydSourceDir()
  if (sourceDir) {
    return { command: 'go', args: ['run', './cmd/relayd'], cwd: sourceDir }
  }
  return null
}

function resolveRelaydSourceDir(): string | null {
  const candidates = [
    resolve(process.cwd(), '../relayd'),
    resolve(process.cwd(), 'apps/relayd'),
    resolve(localModuleDir, '../../../../relayd'),
    resolve(localModuleDir, '../../../../../apps/relayd'),
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'go.mod')) && existsSync(join(candidate, 'cmd/relayd/main.go'))) {
      return candidate
    }
  }
  return null
}

async function allocateListenAddr(host: string): Promise<string> {
  const port = await new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        if (!address || typeof address === 'string') {
          reject(new Error('allocated relayd listen address was not a TCP address'))
          return
        }
        resolvePort(address.port)
      })
    })
  })
  return `${host}:${port}`
}

async function waitForReady(relayUrl: string): Promise<void> {
  const deadline = Date.now() + 10_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/readyz', ensureTrailingSlash(relayUrl)), { signal: AbortSignal.timeout(500) })
      if (response.ok) {
        return
      }
      lastError = new Error(`relayd ready check returned HTTP ${response.status}`)
    }
    catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw lastError instanceof Error ? lastError : new Error('relayd did not become ready')
}

async function terminateChild(child: ManagedChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  closeChildOwnerPipe(child)
  await child.stop('SIGTERM')
}

function closeChildOwnerPipe(child: ManagedChildProcess): void {
  const stdin = child.stdin
  if (!stdin || stdin.destroyed) {
    return
  }
  try {
    if (stdin.writable && !stdin.writableEnded) {
      stdin.end()
    }
    stdin.destroy()
  }
  catch {
    // Best-effort cleanup; process signals still handle termination.
  }
}

function readManagedProcessPid(child: ManagedChildProcess): number | null {
  return child.targetPid ?? child.pid ?? null
}

function isTestEnvironment(): boolean {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase()
  const cradleEnv = process.env.CRADLE_ENV?.toLowerCase()
  return nodeEnv === 'test' || cradleEnv === 'test'
}

function ensureTrailingSlash(value: string): URL {
  return new URL(value.endsWith('/') ? value : `${value}/`)
}
