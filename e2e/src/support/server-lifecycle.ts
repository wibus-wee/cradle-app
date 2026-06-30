import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { AfterAll, BeforeAll } from '@cucumber/cucumber'

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

async function stopProcessGroup(proc: ChildProcess | null, timeoutMs: number): Promise<void> {
  if (!proc) {
    return
  }
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return
  }

  killProcessGroup(proc, 'SIGTERM')

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
      killProcessGroup(proc, 'SIGKILL')
      finish()
    }, timeoutMs)
  })
}

const ROOT = resolve(__dirname, '..', '..', '..')
const CODEX_APP_SERVER_PATH_ENV = 'CRADLE_CODEX_APP_SERVER_PATH'
const CODEX_APP_SERVER_PACKAGE_PATH = '@openai/codex/bin/codex.js'

interface E2EServerInstance {
  serverProcess: ChildProcess
  webProcess: ChildProcess | null
  dataDir: string
  serverUrl: string
  webUrl: string | null
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

function resolveManagedCodexAppServerPath(): string {
  const configuredPath = process.env[CODEX_APP_SERVER_PATH_ENV]?.trim()
  if (configuredPath) {
    return configuredPath
  }

  try {
    return createRequire(join(ROOT, 'package.json')).resolve(CODEX_APP_SERVER_PACKAGE_PATH)
  }
  catch (error) {
    throw new Error(`Unable to resolve ${CODEX_APP_SERVER_PACKAGE_PATH} for the managed E2E server`, {
      cause: error,
    })
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

  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-e2e-data-'))
  const serverPort = await reserveAvailablePort()
  const codexAppServerPath = resolveManagedCodexAppServerPath()

  let serverProcess: ChildProcess | null = null
  let webProcess: ChildProcess | null = null

  try {
    serverProcess = spawn(join(ROOT, 'apps', 'server', 'node_modules', '.bin', 'vite-node'), ['src/index.ts'], {
      cwd: join(ROOT, 'apps', 'server'),
      env: {
        ...process.env,
        CRADLE_DATA_DIR: dataDir,
        CRADLE_PORT: String(serverPort),
        CRADLE_HOST: '127.0.0.1',
        CRADLE_CREDENTIAL_SECRET: 'e2e-test-secret',
        CRADLE_MOCK_LLM_URL: 'http://127.0.0.1:1', // Placeholder — actual URL set per-profile config.baseUrl
        CRADLE_CODEX_APP_SERVER_PATH: codexAppServerPath,
        CRADLE_E2E: '1',
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
    await waitForReady(`${serverUrl}/health`, 'Managed E2E Server')

    console.log(`[e2e] Managed server started at ${serverUrl} (data: ${dataDir})`)

    // Start a web dev server pointing to the managed API server
    let webUrl: string | null = null

    if (!process.env.CRADLE_WEB_URL) {
      const webPort = await reserveAvailablePort()
      webProcess = spawn(join(ROOT, 'apps', 'web', 'node_modules', '.bin', 'vite'), ['--port', String(webPort), '--strictPort'], {
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

      console.log(`[e2e] Managed web dev server started at ${webUrl}`)
    }

    instance = { serverProcess, webProcess, dataDir, serverUrl, webUrl }
  }
  catch (error) {
    await stopProcessGroup(webProcess, 3000)
    await stopProcessGroup(serverProcess, 5000)
    try {
      rmSync(dataDir, { recursive: true, force: true })
    }
    catch { /* best effort */ }
    throw error
  }
})

AfterAll({ timeout: 15_000 }, async () => {
  if (!instance) {
    return
  }

  const { serverProcess, webProcess, dataDir } = instance

  await stopProcessGroup(webProcess, 3000)
  await stopProcessGroup(serverProcess, 5000)

  try {
    rmSync(dataDir, { recursive: true, force: true })
  }
  catch { /* best effort */ }

  instance = null
})
