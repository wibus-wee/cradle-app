import type { ChildProcess } from 'node:child_process'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AfterAll, BeforeAll } from '@cucumber/cucumber'

import { resolveManagedCodexAppServerPath } from './codex-runtime'

function killProcessGroup(proc: ChildProcess, signal: NodeJS.Signals) {
  try {
    if (proc.pid) {
      process.kill(-proc.pid, signal)
    }
  }
  catch {
    // Process may already be dead
  }
}

async function stopProcessGroup(
  proc: ChildProcess | null,
  timeoutMs: number,
  signal: NodeJS.Signals = 'SIGTERM',
): Promise<void> {
  if (!proc) {
    return
  }
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return
  }

  killProcessGroup(proc, signal)

  await new Promise<void>((resolve) => {
    let settled = false
    let timeout: NodeJS.Timeout | null = null
    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      resolve()
    }

    proc.once('exit', finish)
    timeout = setTimeout(() => {
      if (signal !== 'SIGKILL') {
        killProcessGroup(proc, 'SIGKILL')
      }
      // Wait for the process exit event before deleting its SQLite/log files.
      // A final guard keeps teardown bounded if the platform never reaps it.
      timeout = setTimeout(finish, 1000)
    }, timeoutMs)
  })
}

async function runProcess(command: string, args: string[], options: Parameters<typeof spawn>[2]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, options)
    let stderr = ''

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? `exit ${code}`}):\n${stderr}`))
    })
  })
}

async function preparePluginFixture(dataDir: string): Promise<{ fixtureBinDir: string, fixturePluginArchive: string, realNpmPath: string }> {
  const fixtureBinDir = join(dataDir, 'fixture-bin')
  const archiveDir = join(dataDir, 'fixture-archives')
  mkdirSync(fixtureBinDir, { recursive: true })
  mkdirSync(archiveDir, { recursive: true })

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const realNpmPath = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [npm], { encoding: 'utf8' })
    .split(/\r?\n/)[0]!
    .trim()
  await runProcess(npm, ['pack', join(ROOT, 'e2e', 'fixtures', 'plugins', 'visible-panel'), '--ignore-scripts', '--pack-destination', archiveDir], {
    cwd: ROOT,
    env: process.env,
    stdio: process.env.CRADLE_E2E_VERBOSE ? 'inherit' : ['ignore', 'ignore', 'pipe'],
  })
  const archiveName = readdirSync(archiveDir).find(entry => entry.endsWith('.tgz'))
  if (!archiveName) {
    throw new Error('E2E plugin fixture archive was not created')
  }
  const fixturePluginArchive = join(archiveDir, archiveName)

  const shimPath = join(fixtureBinDir, 'npm')
  writeFileSync(shimPath, `#!/usr/bin/env node
const { copyFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { basename, join } = require('node:path')
const args = process.argv.slice(2)
const destinationIndex = args.indexOf('--pack-destination')
const specifier = args[1] ?? ''
if (args[0] !== 'pack' || specifier !== '@cradle/e2e-visible-panel@latest' || destinationIndex < 0) {
  const result = spawnSync(process.env.CRADLE_E2E_REAL_NPM_PATH, args, { stdio: 'inherit' })
  process.exit(result.status ?? 1)
}
const archive = process.env.CRADLE_E2E_PLUGIN_FIXTURE_ARCHIVE
const destination = args[destinationIndex + 1]
if (!archive || !destination) process.exit(2)
copyFileSync(archive, join(destination, basename(archive)))
console.log(basename(archive))
`, 'utf8')
  chmodSync(shimPath, 0o755)
  return { fixtureBinDir, fixturePluginArchive, realNpmPath }
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

interface E2EServerInstance {
  serverProcess: ChildProcess
  webProcess: ChildProcess | null
  webDistDir: string | null
  dataDir: string
  serverUrl: string
  webUrl: string | null
  launchConfig: ManagedServerLaunchConfig
}

interface ManagedServerLaunchConfig {
  dataDir: string
  serverHomeDir: string
  serverPort: number
  nodeBinary: string
  codexAppServerPath: string | null
  fixtureBinDir: string
  fixturePluginArchive: string
  realNpmPath: string
}

let instance: E2EServerInstance | null = null

/** Exported so CradleWorld can override its serverUrl. */
export function getManagedServerUrl(): string | null {
  return instance?.serverUrl ?? null
}

/** Exported so CradleWorld can override its webUrl. */
export function getManagedWebUrl(): string | null {
  return instance?.webUrl ?? null
}

export function getManagedDataDir(): string | null {
  return instance?.dataDir ?? null
}

async function waitForReady(url: string, label: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        return
      }
    }
    catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`${label} did not become ready at ${url} within ${timeoutMs}ms`)
}

async function reserveAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to reserve an available TCP port')))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

async function startManagedServer(config: ManagedServerLaunchConfig): Promise<ChildProcess> {
  const {
    codexAppServerPath,
    dataDir,
    nodeBinary,
    serverHomeDir,
    serverPort,
    fixtureBinDir,
    fixturePluginArchive,
    realNpmPath,
  } = config
  const serverProcess = spawn(nodeBinary, ['--import', 'tsx', 'src/index.ts'], {
    cwd: join(ROOT, 'apps', 'server'),
    env: {
      ...process.env,
      PATH: `${fixtureBinDir}:${dirname(nodeBinary)}:${process.env.PATH ?? ''}`,
      HOME: serverHomeDir,
      // Workspace fixtures and ad-hoc workspaces live under this checkout-owned
      // cache. Prevent Git from inheriting the Cradle repository above it.
      GIT_CEILING_DIRECTORIES: dataDir,
      CRADLE_DATA_DIR: dataDir,
      CRADLE_AD_HOC_WORKSPACE_ROOT: join(dataDir, 'ad-hoc-workspaces'),
      CRADLE_PORT: String(serverPort),
      CRADLE_HOST: '127.0.0.1',
      CRADLE_ALLOW_PRIVATE_PROVIDER_HOSTS: '127.0.0.1,localhost,::1',
      CRADLE_CREDENTIAL_SECRET: 'e2e-test-secret',
      ...(codexAppServerPath ? { CRADLE_CODEX_APP_SERVER_PATH: codexAppServerPath } : {}),
      CRADLE_E2E: '1',
      CRADLE_E2E_PLUGIN_FIXTURE_ARCHIVE: fixturePluginArchive,
      CRADLE_E2E_REAL_NPM_PATH: realNpmPath,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  serverProcess.stdout?.on('data', (chunk: Buffer) => {
    if (process.env.CRADLE_E2E_VERBOSE) {
      process.stderr.write(`[server] ${chunk.toString()}`)
    }
  })
  serverProcess.stderr?.on('data', (chunk: Buffer) => {
    if (process.env.CRADLE_E2E_VERBOSE) {
      process.stderr.write(`[server:err] ${chunk.toString()}`)
    }
  })

  const serverUrl = `http://127.0.0.1:${serverPort}`
  try {
    await waitForReady(`${serverUrl}/health`, 'Managed E2E Server')
    return serverProcess
  }
  catch (error) {
    await stopProcessGroup(serverProcess, 5000)
    throw error
  }
}

/** Crash and restart only the managed Server, preserving its data, port, and web preview. */
export async function restartManagedServer(): Promise<void> {
  if (!instance) {
    throw new Error('Application process restart requires the managed E2E Server')
  }

  await stopProcessGroup(instance.serverProcess, 5000, 'SIGKILL')
  instance.serverProcess = await startManagedServer(instance.launchConfig)
  console.log(`[e2e] Managed server restarted at ${instance.serverUrl} (data preserved: ${instance.dataDir})`)
}

const BUILD_LOCK_PATH = join(ROOT, 'node_modules', '.cache', 'cradle-e2e-web-build.lock')
const BUILD_LOCK_TIMEOUT_MS = 10 * 60_000
const BUILD_LOCK_STALE_MS = 15 * 60_000

/**
 * Serialize the shared `plugin-sdk` build across parallel Cucumber workers: concurrent
 * tsc runs would write the same dist directory. A worker that died holding the lock is
 * stolen once its lock file goes stale.
 */
async function acquireBuildLock(): Promise<() => void> {
  mkdirSync(dirname(BUILD_LOCK_PATH), { recursive: true })
  const start = Date.now()
  for (;;) {
    try {
      const fd = openSync(BUILD_LOCK_PATH, 'wx')
      return () => {
        closeSync(fd)
        try {
          unlinkSync(BUILD_LOCK_PATH)
        }
        catch { /* already released */ }
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      // Steal a lock left behind by a crashed worker.
      try {
        const stats = statSync(BUILD_LOCK_PATH)
        if (Date.now() - stats.mtimeMs > BUILD_LOCK_STALE_MS) {
          unlinkSync(BUILD_LOCK_PATH)
          continue
        }
      }
      catch { /* someone else released or stole it first — retry loop handles it */ }
    }
    if (Date.now() - start > BUILD_LOCK_TIMEOUT_MS) {
      throw new Error('Timed out waiting for the e2e web build lock')
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

/**
 * If CRADLE_SERVER_URL is set, we assume the user is managing the server themselves.
 * Otherwise, we start an isolated server with a temp data directory.
 */
BeforeAll({ timeout: 120_000 }, async () => {
  // If user explicitly provides a server URL, don't start a managed server
  if (process.env.CRADLE_SERVER_URL) {
    return
  }

  // Codex refuses CODEX_HOME beneath an OS temporary directory. Keep the
  // per-run data in the checkout's ignored dependency cache instead.
  const runtimeCacheDir = join(ROOT, 'node_modules', '.cache')
  mkdirSync(runtimeCacheDir, { recursive: true })
  const dataDir = mkdtempSync(join(runtimeCacheDir, 'cradle-e2e-data-'))
  const serverHomeDir = join(dataDir, 'home')
  mkdirSync(serverHomeDir, { recursive: true })
  chmodSync(dataDir, 0o777)
  chmodSync(serverHomeDir, 0o777)
  const serverPort = await reserveAvailablePort()
  const codexAppServerPath = resolveManagedCodexAppServerPath(ROOT)
  const nodeBinary = process.env.CRADLE_E2E_NODE
    ?? (existsSync(join(process.env.HOME ?? '', '.nvm/versions/node/v22.22.2/bin/node'))
      ? join(process.env.HOME ?? '', '.nvm/versions/node/v22.22.2/bin/node')
      : process.execPath)
  const pluginFixture = await preparePluginFixture(dataDir)
  const launchConfig: ManagedServerLaunchConfig = {
    dataDir,
    serverHomeDir,
    serverPort,
    nodeBinary,
    codexAppServerPath,
    ...pluginFixture,
  }

  let serverProcess: ChildProcess | null = null
  let webProcess: ChildProcess | null = null
  let webDistDir: string | null = null

  try {
    // Use tsx as a Node loader instead of its CLI. The CLI creates an IPC socket even
    // for a one-shot process, which is blocked in hardened CI/sandbox environments.
    serverProcess = await startManagedServer(launchConfig)

    const serverUrl = `http://127.0.0.1:${serverPort}`
    console.log(`[e2e] Managed server started at ${serverUrl} (data: ${dataDir})`)
    if (codexAppServerPath) {
      console.log(`[e2e] Codex app-server: ${codexAppServerPath}`)
    }
    else {
      console.warn('[e2e] Codex app-server not resolved — Codex scenarios will fail until sync:codex-runtime')
    }

    // Build and serve the production web bundle so E2E measures application startup,
    // not Vite's on-demand module transformation on a cold runner.
    let webUrl: string | null = null

    if (!process.env.CRADLE_WEB_URL) {
      const webPort = await reserveAvailablePort()
      const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
      const vite = join(ROOT, 'apps', 'web', 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
      webDistDir = mkdtempSync(join(tmpdir(), 'cradle-e2e-web-dist-'))

      // The plugin-sdk dist is shared across parallel workers; serialize the build.
      const releaseBuildLock = await acquireBuildLock()
      try {
        await runProcess(pnpm, ['--filter', '@cradle/plugin-sdk', 'build'], {
          cwd: ROOT,
          env: {
            ...process.env,
            CRADLE_E2E: '1',
            VITE_SERVER_URL: serverUrl,
          },
          stdio: process.env.CRADLE_E2E_VERBOSE ? 'inherit' : ['ignore', 'ignore', 'pipe'],
        })

        await runProcess(vite, ['build', '--outDir', webDistDir, '--emptyOutDir'], {
          cwd: join(ROOT, 'apps', 'web'),
          env: {
            ...process.env,
            CRADLE_E2E: '1',
            VITE_SERVER_URL: serverUrl,
          },
          stdio: process.env.CRADLE_E2E_VERBOSE ? 'inherit' : ['ignore', 'ignore', 'pipe'],
        })
      }
      finally {
        releaseBuildLock()
      }

      webProcess = spawn(vite, ['preview', '--outDir', webDistDir, '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
        cwd: join(ROOT, 'apps', 'web'),
        env: {
          ...process.env,
          CRADLE_E2E: '1',
          VITE_SERVER_URL: serverUrl,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      })

      webProcess.stdout?.on('data', (chunk: Buffer) => {
        if (process.env.CRADLE_E2E_VERBOSE) {
          process.stderr.write(`[web] ${chunk.toString()}`)
        }
      })
      webProcess.stderr?.on('data', (chunk: Buffer) => {
        if (process.env.CRADLE_E2E_VERBOSE) {
          process.stderr.write(`[web:err] ${chunk.toString()}`)
        }
      })

      webUrl = `http://localhost:${webPort}`
      await waitForReady(webUrl, 'Managed E2E Web', 30_000)

      console.log(`[e2e] Managed web production preview started at ${webUrl}`)
    }

    instance = { serverProcess, webProcess, webDistDir, dataDir, serverUrl, webUrl, launchConfig }
  }
  catch (error) {
    await stopProcessGroup(webProcess, 3000)
    await stopProcessGroup(serverProcess, 5000)
    try {
      rmSync(dataDir, { recursive: true, force: true })
    }
    catch { /* best effort */ }
    if (webDistDir) {
      try {
        rmSync(webDistDir, { recursive: true, force: true })
      }
      catch { /* best effort */ }
    }
    throw error
  }
})

AfterAll({ timeout: 15_000 }, async () => {
  if (!instance) {
    return
  }

  const { serverProcess, webProcess, webDistDir, dataDir } = instance

  await stopProcessGroup(webProcess, 3000)
  await stopProcessGroup(serverProcess, 5000)

  try {
    rmSync(dataDir, { recursive: true, force: true })
  }
  catch { /* best effort */ }

  if (webDistDir) {
    try {
      rmSync(webDistDir, { recursive: true, force: true })
    }
    catch { /* best effort */ }
  }

  instance = null
})
