import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..', '..')

export interface FabricNodeProcess {
  name: 'Desktop' | 'MacBook'
  process: ChildProcess
  dataDir: string
  homeDir: string
  serverUrl: string
  logPath: string
}

export interface FabricTopology {
  rootDir: string
  relayUrl: string
  relayDatabasePath: string
  relayLogPath: string
  relayProcess: ChildProcess
  webUrl: string
  webLogPath: string
  webProcess: ChildProcess
  desktop: FabricNodeProcess
  macbook: FabricNodeProcess
  restartRelay: () => Promise<void>
  restartNode: (name: FabricNodeProcess['name']) => Promise<void>
  stop: () => Promise<void>
}

async function reservePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to reserve an E2E port.')))
        return
      }
      server.close(error => error ? reject(error) : resolvePort(address.port))
    })
  })
}

async function waitForReady(url: string, label: string, timeoutMs = 45_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    }
    catch {
      // The child process is still starting.
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 200))
  }
  throw new Error(`${label} was not ready at ${url} within ${timeoutMs}ms.`)
}

function captureLogs(child: ChildProcess, logPath: string): void {
  child.stdout?.on('data', chunk => appendFileSync(logPath, chunk))
  child.stderr?.on('data', chunk => appendFileSync(logPath, chunk))
}

async function stopProcess(child: ChildProcess | null, timeoutMs = 5_000): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    }
    catch {
      return
    }
  }
  await new Promise<void>((resolveStop) => {
    let settled = false
    const finish = () => {
      if (!settled) {
        settled = true
        resolveStop()
      }
    }
    child.once('exit', finish)
    setTimeout(() => {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        }
        catch {}
      }
      setTimeout(finish, 500)
    }, timeoutMs)
  })
}

async function buildRelayBinary(rootDir: string): Promise<string> {
  const binaryPath = join(rootDir, 'relayd')
  await new Promise<void>((resolveBuild, reject) => {
    const child = spawn('go', ['build', '-o', binaryPath, './cmd/relayd'], {
      cwd: join(ROOT, 'apps', 'relayd'),
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', chunk => stderr += chunk.toString())
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolveBuild()
      : reject(new Error(`Failed to build relayd (${code ?? 'signal'}):\n${stderr}`)))
  })
  chmodSync(binaryPath, 0o755)
  return binaryPath
}

async function startNode(input: {
  rootDir: string
  relayUrl: string
  name: FabricNodeProcess['name']
  port?: number
}): Promise<FabricNodeProcess> {
  const slug = input.name.toLowerCase()
  const dataDir = join(input.rootDir, slug)
  const homeDir = join(dataDir, 'home')
  const logPath = join(input.rootDir, `${slug}-server.log`)
  mkdirSync(homeDir, { recursive: true })
  chmodSync(dataDir, 0o777)
  chmodSync(homeDir, 0o777)
  const port = input.port ?? await reservePort()
  const serverUrl = `http://127.0.0.1:${port}`
  const nodeBinary = process.env.CRADLE_E2E_NODE ?? process.execPath
  const child = spawn(nodeBinary, ['--import', 'tsx', 'src/index.ts'], {
    cwd: join(ROOT, 'apps', 'server'),
    env: {
      ...process.env,
      HOME: homeDir,
      CRADLE_DATA_DIR: dataDir,
      CRADLE_AD_HOC_WORKSPACE_ROOT: join(dataDir, 'ad-hoc-workspaces'),
      CRADLE_PORT: String(port),
      CRADLE_HOST: '127.0.0.1',
      CRADLE_ALLOW_PRIVATE_PROVIDER_HOSTS: '127.0.0.1,localhost,::1',
      CRADLE_CREDENTIAL_SECRET: `fabric-e2e-${slug}-secret`,
      CRADLE_RELAYD_PUBLIC_URL: input.relayUrl,
      CRADLE_RELAYD_ACCESS_MODE: 'network',
      CRADLE_FABRIC_NODE_NAME: input.name,
      CRADLE_E2E: '1',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  captureLogs(child, logPath)
  await waitForReady(`${serverUrl}/health`, `${input.name} Cradle Server`)
  return { name: input.name, process: child, dataDir, homeDir, serverUrl, logPath }
}

export async function startFabricTopology(): Promise<FabricTopology> {
  const cacheRoot = join(ROOT, 'node_modules', '.cache')
  mkdirSync(cacheRoot, { recursive: true })
  const rootDir = mkdtempSync(join(cacheRoot, 'cradle-fabric-e2e-'))
  const relayPort = await reservePort()
  const relayUrl = `http://127.0.0.1:${relayPort}`
  const relayDatabasePath = join(rootDir, 'relayd.sqlite3')
  const relayLogPath = join(rootDir, 'relayd.log')
  const webLogPath = join(rootDir, 'web.log')
  let relayProcess: ChildProcess | null = null
  let webProcess: ChildProcess | null = null
  let desktop: FabricNodeProcess | null = null
  let macbook: FabricNodeProcess | null = null

  try {
    const relayBinary = process.env.CRADLE_E2E_RELAYD_PATH?.trim()
      || await buildRelayBinary(rootDir)
    relayProcess = spawn(relayBinary, [
      '--listen',
`127.0.0.1:${relayPort}`,
      '--public-url',
relayUrl,
      '--fabric-db',
relayDatabasePath,
    ], {
      cwd: join(ROOT, 'apps', 'relayd'),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    captureLogs(relayProcess, relayLogPath)
    await waitForReady(`${relayUrl}/readyz`, 'Fabric relayd')

    ;[desktop, macbook] = await Promise.all([
      startNode({ rootDir, relayUrl, name: 'Desktop' }),
      startNode({ rootDir, relayUrl, name: 'MacBook' }),
    ])

    const webPort = await reservePort()
    const vite = join(ROOT, 'node_modules', '.bin', 'vite')
    if (!existsSync(vite)) {
      throw new Error(`Vite executable is missing at ${vite}.`)
    }
    webProcess = spawn(vite, ['--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
      cwd: join(ROOT, 'apps', 'web'),
      env: {
        ...process.env,
        CRADLE_E2E: '1',
        VITE_SERVER_URL: desktop.serverUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    captureLogs(webProcess, webLogPath)
    const webUrl = `http://127.0.0.1:${webPort}`
    await waitForReady(webUrl, 'Fabric E2E Web')

    const topology: FabricTopology = {
      rootDir,
      relayUrl,
      relayDatabasePath,
      relayLogPath,
      relayProcess,
      webUrl,
      webLogPath,
      webProcess,
      desktop,
      macbook,
      restartRelay: async () => {
        await stopProcess(relayProcess)
        relayProcess = spawn(relayBinary, [
          '--listen',
`127.0.0.1:${relayPort}`,
          '--public-url',
relayUrl,
          '--fabric-db',
relayDatabasePath,
        ], {
          cwd: join(ROOT, 'apps', 'relayd'),
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        })
        captureLogs(relayProcess, relayLogPath)
        topology.relayProcess = relayProcess
        await waitForReady(`${relayUrl}/readyz`, 'restarted Fabric relayd')
      },
      restartNode: async (name) => {
        const current = name === 'Desktop' ? desktop! : macbook!
        await stopProcess(current.process)
        const restarted = await startNode({
          rootDir,
          relayUrl,
          name,
          port: Number(new URL(current.serverUrl).port),
        })
        if (name === 'Desktop') {
          desktop = restarted
          topology.desktop = restarted
        }
        else {
          macbook = restarted
          topology.macbook = restarted
        }
      },
      stop: async () => {
      await Promise.all([
        stopProcess(webProcess),
        stopProcess(desktop?.process ?? null),
        stopProcess(macbook?.process ?? null),
      ])
      await stopProcess(relayProcess)
      if (!process.env.CRADLE_E2E_KEEP_DATA) {
        rmSync(rootDir, { recursive: true, force: true })
      }
      },
    }

    return topology
  }
  catch (error) {
    await Promise.all([
      stopProcess(webProcess),
      stopProcess(desktop?.process ?? null),
      stopProcess(macbook?.process ?? null),
    ])
    await stopProcess(relayProcess)
    if (!process.env.CRADLE_E2E_KEEP_DATA) {
      rmSync(rootDir, { recursive: true, force: true })
    }
    throw error
  }
}
