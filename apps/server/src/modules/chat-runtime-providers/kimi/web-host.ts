import { readFile, writeFile } from 'node:fs/promises'

import type { ManagedChildProcess, ManagedSpawnOptions } from '../../../infra/managed-process'
import { spawnManagedProcess } from '../../../infra/managed-process'
import type { KimiProviderConfig } from './config'
import { renderKimiConfigToml } from './config'
import type { KimiHttpClient } from './http/client'
import { createKimiHttpClient } from './http/client'
import { getApiV1Healthz } from './protocol/rest/sdk.gen'
import { prepareKimiProviderHome } from './runtime-home'
import type { KimiWebSocketClient } from './websocket/client'
import { createKimiWebSocketClient } from './websocket/client'

const STARTUP_TIMEOUT_MS = 10_000

export interface KimiWebHostOptions {
  command: string
  providerTargetId: string
  providerConfig: KimiProviderConfig
  credential: string | null
}

export interface KimiWebHostResource {
  home: string
  url: string
  http: KimiHttpClient
  events: KimiWebSocketClient
  process: ManagedChildProcess
  close: () => Promise<void>
}

export async function createKimiWebHostResource(input: KimiWebHostOptions): Promise<KimiWebHostResource> {
  const home = prepareKimiProviderHome(input.providerTargetId)
  await writeFile(
    `${home}/config.toml`,
    renderKimiConfigToml({ provider: input.providerConfig, credential: input.credential }),
    { encoding: 'utf8', mode: 0o600 },
  )

  const { process, url } = await launchKimiWeb({ command: input.command, home })
  try {
    const token = (await readKimiServerToken(home)).trim()
    const http = createKimiHttpClient({ baseUrl: url, bearerToken: token })
    await http.request(getApiV1Healthz({ client: http.client }))
    const events = await createKimiWebSocketClient({ baseUrl: url, bearerToken: token })
    return {
      home,
url,
http,
events,
process,
      close: async () => {
        await events.close()
        await stopKimiWeb(process)
      },
    }
  }
  catch (error) {
    await stopKimiWeb(process)
    throw error
  }
}

export function createKimiWebProcessOptions(input: { command: string, home: string }): ManagedSpawnOptions {
  return {
    kind: 'spawn',
    command: input.command,
    args: ['web', '--port', '0', '--no-open', '--log-level', 'silent'],
    env: { ...process.env, KIMI_CODE_HOME: input.home },
    stdin: 'ignore',
    shutdownGraceMs: 3_000,
  }
}

async function launchKimiWeb(input: { command: string, home: string }): Promise<{ process: ManagedChildProcess, url: string }> {
  const process = spawnManagedProcess(createKimiWebProcessOptions(input))
  return await new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    const timeout = setTimeout(() => finish(new Error('Kimi web did not report a loopback URL within 10 seconds.')), STARTUP_TIMEOUT_MS)
    timeout.unref?.()

    const finish = (error?: Error, url?: string): void => {
      if (settled) { return }
      settled = true
      clearTimeout(timeout)
      if (error) {
        void stopKimiWeb(process)
        reject(error)
      }
      else {
        resolve({ process, url: url! })
      }
    }
    const readOutput = (chunk: Buffer): void => {
      output += chunk.toString().replace(/\x1B\[[0-9:;<=>?]*[\x20-\x2F]*[\x40-\x7E]/g, '')
      const port = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//)?.[1]
      if (port) { finish(undefined, `http://127.0.0.1:${port}`) }
    }
    process.stdout?.on('data', readOutput)
    process.stderr?.on('data', readOutput)
    process.once('error', error => finish(error))
    process.once('exit', (code, signal) => finish(new Error(`Kimi web exited before startup (code ${code}, signal ${signal}).`)))
  })
}

async function readKimiServerToken(home: string): Promise<string> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await readFile(`${home}/server.token`, 'utf8')
    }
    catch (error) {
      lastError = error as Error
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  throw new Error(`Kimi web did not create its server token: ${lastError?.message ?? 'unknown error'}`)
}

async function stopKimiWeb(process: ManagedChildProcess): Promise<void> {
  if (process.exitCode === null && process.signalCode === null) {
    await process.stop('SIGTERM')
  }
}
