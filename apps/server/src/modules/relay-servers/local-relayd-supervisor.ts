import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { relayServers } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { relayTokenSecret } from './relay-token-service'
import { readDefaultRelayServer } from './service'

const localRelayServerId = 'system:local-relayd'
const localRelayDisplayName = 'Built-in local relay'
const defaultRelayHost = '127.0.0.1'
const relaydExecutableName = process.platform === 'win32' ? 'relayd.exe' : 'relayd'
const localModuleDir = dirname(fileURLToPath(import.meta.url))
const logger = createChildLogger({ module: 'local-relayd-supervisor' })

interface RunningLocalRelayd {
  child: ChildProcess
  relayUrl: string
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
  return !isTestOrProductionEnvironment()
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

  const listenAddr = process.env.CRADLE_RELAYD_LISTEN?.trim() || await allocateLocalListenAddr()
  const relayUrl = process.env.CRADLE_RELAYD_PUBLIC_URL?.trim() || `http://${listenAddr}`
  let hmacSecret: string
  try {
    hmacSecret = relayTokenSecret()
  }
  catch (error) {
    logger.warn('managed local relayd is enabled but no relay HMAC secret is available', { err: error })
    return
  }
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: {
      ...process.env,
      CRADLE_RELAYD_LISTEN: listenAddr,
      CRADLE_RELAYD_PUBLIC_URL: relayUrl,
      CRADLE_RELAYD_DEV_HMAC_SECRET: hmacSecret,
    },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  runningLocalRelayd = { child, relayUrl }
  child.stdout?.on('data', chunk => logger.info('relayd stdout', { output: chunk.toString('utf8').trimEnd() }))
  child.stderr?.on('data', chunk => logger.warn('relayd stderr', { output: chunk.toString('utf8').trimEnd() }))
  child.on('error', (error) => {
    logger.error('managed local relayd failed to spawn', { err: error })
    if (runningLocalRelayd?.child === child) {
      runningLocalRelayd = null
    }
  })
  child.on('exit', (code, signal) => {
    logger.info('managed local relayd exited', { code, signal })
    if (runningLocalRelayd?.child === child) {
      runningLocalRelayd = null
    }
  })

  try {
    await waitForReady(relayUrl)
    upsertManagedLocalRelayServer(relayUrl)
    logger.info('managed local relayd started', { relayUrl, pid: child.pid ?? null })
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

async function allocateLocalListenAddr(): Promise<string> {
  const port = await new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, defaultRelayHost, () => {
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
  return `${defaultRelayHost}:${port}`
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

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  await new Promise<void>((resolveDone) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        signalChild(child, 'SIGKILL')
      }
      resolveDone()
    }, 3_000)
    timeout.unref()
    child.once('exit', () => {
      clearTimeout(timeout)
      resolveDone()
    })
    signalChild(child, 'SIGTERM')
  })
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    }
    catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH') {
        return
      }
      throw error
    }
  }
  child.kill(signal)
}

function isTestOrProductionEnvironment(): boolean {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase()
  const cradleEnv = process.env.CRADLE_ENV?.toLowerCase()
  return nodeEnv === 'test' || nodeEnv === 'production' || cradleEnv === 'test' || cradleEnv === 'production'
}

function ensureTrailingSlash(value: string): URL {
  return new URL(value.endsWith('/') ? value : `${value}/`)
}
