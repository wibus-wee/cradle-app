import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { KimiAsyncApiDocument, KimiOpenApiDocument } from '../src/modules/chat-runtime-providers/kimi/protocol/generator'
import {
  createKimiProtocolManifest,
  normalizeKimiAsyncApiDocument,
  normalizeKimiOpenApiDocument,
  stringifyKimiJson,
} from '../src/modules/chat-runtime-providers/kimi/protocol/generator'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = join(scriptDir, '..')
const protocolRoot = join(serverRoot, 'src/modules/chat-runtime-providers/kimi/protocol')
const kimiCommand = process.env.KIMI_COMMAND || 'kimi'
const kimiHome = await mkdtemp(join(tmpdir(), 'cradle-kimi-protocol-'))

try {
  const runtimeVersion = await readKimiVersion()
  const port = await startKimiWeb()
  const token = await readFileWithRetry(join(kimiHome, 'server.token'))
  const [openapi, asyncapi] = await Promise.all([
    fetchKimiJson<KimiOpenApiDocument>(port, '/openapi.json', token),
    fetchKimiJson<KimiAsyncApiDocument>(port, '/asyncapi.json', token),
  ])

  if (!openapi.openapi.startsWith('3.')) {
    throw new Error(`Expected Kimi OpenAPI 3.x, received ${openapi.openapi}.`)
  }
  if (!asyncapi.asyncapi.startsWith('3.')) {
    throw new Error(`Expected Kimi AsyncAPI 3.x, received ${asyncapi.asyncapi}.`)
  }

  const normalizedOpenapi = normalizeKimiOpenApiDocument(openapi)
  const normalizedAsyncapi = normalizeKimiAsyncApiDocument(asyncapi)
  const manifest = createKimiProtocolManifest({
    runtimeVersion,
    openapi: normalizedOpenapi,
    asyncapi: normalizedAsyncapi,
    generatedDate: new Date().toISOString().slice(0, 10),
  })

  await mkdir(protocolRoot, { recursive: true })
  await writeFile(join(protocolRoot, 'openapi.json'), stringifyKimiJson(normalizedOpenapi), 'utf8')
  await writeFile(join(protocolRoot, 'asyncapi.json'), stringifyKimiJson(normalizedAsyncapi), 'utf8')
  await writeFile(join(protocolRoot, 'MANIFEST.json'), stringifyKimiJson(manifest), 'utf8')
  await run('pnpm', ['exec', 'tsx', 'scripts/generate-kimi-web-protocol-bindings.ts'])

  console.log(`Generated Kimi Web protocol bindings from kimi ${runtimeVersion}`)
  console.log(`OpenAPI SHA-256: ${manifest.openapiSha256}`)
  console.log(`AsyncAPI SHA-256: ${manifest.asyncapiSha256}`)
}
finally {
  await stopKimiWeb().catch(() => undefined)
  await rm(kimiHome, { force: true, recursive: true })
}

function readKimiVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(kimiCommand, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    child.once('error', reject)
    child.once('exit', (code) => {
      const version = output.match(/\b\d+\.\d+\.\d+(?:[-+][A-Z0-9.-]+)?\b/i)?.[0]
      if (code === 0 && version) {
        resolve(version)
        return
      }
      reject(new Error(`Could not read the Kimi version from ${kimiCommand}.`))
    })
  })
}

function startKimiWeb(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(kimiCommand, ['web', '--port', '0', '--no-open', '--log-level', 'silent'], {
      env: { ...process.env, KIMI_CODE_HOME: kimiHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const timeout = setTimeout(() => {
      reject(new Error(`Kimi web did not report a loopback port within 10 seconds.`))
    }, 10_000)
    const readPort = (chunk: Buffer): void => {
      output += stripAnsi(chunk.toString())
      const port = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//)?.[1]
      if (port) {
        clearTimeout(timeout)
        resolve(Number(port))
      }
    }
    child.stdout.on('data', readPort)
    child.stderr.on('data', readPort)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      if (!/http:\/\/127\.0\.0\.1:(\d+)\//.test(output)) {
        clearTimeout(timeout)
        reject(new Error(`Kimi web exited before reporting a loopback port (code ${code ?? 1}).`))
      }
    })
  })
}

async function readFileWithRetry(path: string): Promise<string> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await readFile(path, 'utf8')
    }
    catch (error) {
      lastError = error as Error
      await delay(100)
    }
  }
  throw new Error(`Kimi did not create ${path}: ${lastError?.message ?? 'unknown error'}`)
}

async function fetchKimiJson<T>(port: number, path: string, token: string): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { authorization: `Bearer ${token.trim()}` },
      })
      if (!response.ok) {
        throw new Error(`Kimi returned ${response.status} for ${path}.`)
      }
      return await response.json() as T
    }
    catch (error) {
      lastError = error as Error
      await delay(100)
    }
  }
  throw new Error(`Could not fetch Kimi ${path}: ${lastError?.message ?? 'unknown error'}`)
}

function stopKimiWeb(): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(kimiCommand, ['web', 'kill'], {
      env: { ...process.env, KIMI_CODE_HOME: kimiHome },
      stdio: 'ignore',
    })
    child.once('error', () => resolve())
    child.once('exit', () => resolve())
  })
}

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: serverRoot, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${file} ${args.join(' ')} failed with ${signal ? `signal ${signal}` : `code ${code ?? 1}`}`))
    })
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9:;<=>?]*[\x20-\x2F]*[\x40-\x7E]/g, '')
}
