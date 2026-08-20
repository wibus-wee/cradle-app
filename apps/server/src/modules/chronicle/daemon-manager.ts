import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import { z } from 'zod'

import { getServerConfig } from '../../infra'
import type { ManagedChildProcess } from '../../infra/managed-process'
import { spawnManagedProcess } from '../../infra/managed-process'
import type { ChronicleEmbeddingBatch } from './inference-worker'
import { SupervisedChronicleInferenceWorker } from './inference-worker'

let chronicleProcess: ManagedChildProcess | null = null
let lastExitCode: number | null = null
let lastExitAt: number | null = null
let currentOptions: ChronicleDaemonOptions | null = null
let pendingRestartOptions: ChronicleDaemonOptions | null = null
let embeddingWorker: SupervisedChronicleInferenceWorker | null = null
let lastRuntimeError: string | null = null

export interface ChronicleDaemonOptions {
  storageRoot: string
  audioCaptureEnabled: boolean
  audioCaptureMode: 'meeting' | 'continuous'
  audioSource: 'microphone' | 'system' | 'mixed'
  audioSegmentMs: number
  audioSegmentIntervalMs: number
  audioRmsThreshold: number
  privacySensitiveAppBundleIds?: string[]
  privacySensitiveTitlePatterns?: string[]
  privacySensitiveUrlPatterns?: string[]
}

const ChronicleDaemonOptionsSchema = z.object({
  storageRoot: z.string(),
  audioCaptureEnabled: z.boolean(),
  audioCaptureMode: z.enum(['meeting', 'continuous']),
  audioSource: z.enum(['microphone', 'system', 'mixed']),
  audioSegmentMs: z.number().finite().positive(),
  audioSegmentIntervalMs: z.number().finite().positive(),
  audioRmsThreshold: z.number().finite().nonnegative(),
  privacySensitiveAppBundleIds: z.array(z.string()).default([]),
  privacySensitiveTitlePatterns: z.array(z.string()).default([]),
  privacySensitiveUrlPatterns: z.array(z.string()).default([]),
})

const EmbeddingBatchOptionsSchema = z
  .object({
    timeoutMs: z.number().finite().positive().default(120_000),
  })
  .prefault({})

const ManagedProcessErrorMessageSchema = z.object({
  type: z.literal('error'),
  message: z.string().min(1),
})

const PROCESS_RESOURCE_FIELD_SEPARATOR_PATTERN = /\s+/

const ProcessResourcesTextSchema = z
  .string()
  .trim()
  .transform((value) => {
    const [rssRaw, cpuRaw] = value.split(PROCESS_RESOURCE_FIELD_SEPARATOR_PATTERN)
    return {
      rssMB: Number.parseInt(rssRaw, 10) / 1024,
      cpuPercent: Number.parseFloat(cpuRaw),
    }
  })
  .pipe(
    z.object({
      rssMB: z.number().finite().nonnegative(),
      cpuPercent: z.number().finite().nonnegative(),
    }),
  )

function getModelResourcesRoot(): string {
  const config = getServerConfig()
  const namespaceRoot = config.dataDir
    ? resolve(config.dataDir, 'chronicle')
    : resolve(homedir(), '.cradle', 'chronicle')
  return resolve(namespaceRoot, 'models')
}

export function createDaemonArgs(rawOptions: ChronicleDaemonOptions): string[] {
  const options = ChronicleDaemonOptionsSchema.parse(rawOptions)
  const args = ['--daemon', '--storage-root', options.storageRoot]
  if (options.audioCaptureEnabled) {
    args.push(
      '--audio-capture',
      '--audio-capture-mode',
      options.audioCaptureMode,
      '--audio-source',
      options.audioSource,
      '--audio-segment-ms',
      String(options.audioSegmentMs),
      '--audio-segment-interval-ms',
      String(options.audioSegmentIntervalMs),
      '--audio-rms-threshold',
      String(options.audioRmsThreshold),
    )
  }
 else {
    args.push('--no-audio-capture')
  }
  for (const bundleId of options.privacySensitiveAppBundleIds) {
    args.push('--privacy-sensitive-app', bundleId)
  }
  for (const pattern of options.privacySensitiveTitlePatterns) {
    args.push('--privacy-sensitive-title', pattern)
  }
  for (const pattern of options.privacySensitiveUrlPatterns) {
    args.push('--privacy-sensitive-url', pattern)
  }
  return args
}

export function findChronicleBinary(): string {
  const configuredPath = process.env.CRADLE_CHRONICLE_PATH?.trim()
  if (configuredPath) {
    const binary = resolve(configuredPath)
    if (!existsSync(binary)) {
      throw new Error(`Configured Chronicle runtime is missing at ${binary}`)
    }
    return binary
  }

  const candidates = [
    join(process.cwd(), '..', '..', 'chronicle', 'target', 'release', 'cradle-chronicle'),
    join(process.cwd(), '..', '..', 'chronicle', 'target', 'debug', 'cradle-chronicle'),
    join(
      (process as { resourcesPath?: string }).resourcesPath ?? '',
      'chronicle',
      'cradle-chronicle',
    ),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  for (const directory of process.env.PATH?.split(delimiter).filter(Boolean) ?? []) {
    const candidate = resolve(directory, 'cradle-chronicle')
    if (existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(
    'Chronicle runtime is missing. Build it with `pnpm --filter @cradle/desktop build:chronicle`.',
  )
}

export async function runEmbeddingBatch(
  texts: readonly string[],
  modelsRoot: string,
  options: { signal?: AbortSignal, timeoutMs?: number } = {},
): Promise<ChronicleEmbeddingBatch> {
  const embeddingOptions = EmbeddingBatchOptionsSchema.parse(options)
  if (!embeddingWorker) {
    embeddingWorker = new SupervisedChronicleInferenceWorker({
      command: findChronicleBinary(),
      args: ['--embedding-worker'],
      env: buildChronicleEnv({ CRADLE_MODELS_DIR: modelsRoot }),
    })
  }
  return embeddingWorker.embed(texts, {
    signal: options.signal,
    timeoutMs: embeddingOptions.timeoutMs,
  })
}

function buildChronicleEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const modelsRoot = extra.CRADLE_MODELS_DIR ?? getModelResourcesRoot()
  const ortDylibPath = findOrtDylibPath(modelsRoot)
  return {
    ...process.env,
    CRADLE_MODELS_DIR: modelsRoot,
    ...(ortDylibPath ? { ORT_DYLIB_PATH: ortDylibPath } : {}),
    ...extra,
  }
}

function findOrtDylibPath(modelsRoot: string): string | null {
  const configured = process.env.ORT_DYLIB_PATH
  if (configured && existsSync(configured)) {
    return configured
  }

  const exactCandidates = [
    join(modelsRoot, 'onnxruntime', 'libonnxruntime.dylib'),
    join(modelsRoot, 'onnxruntime', 'libonnxruntime.1.24.4.dylib'),
    join(modelsRoot, 'onnxruntime', 'capi', 'libonnxruntime.dylib'),
    join(modelsRoot, 'onnxruntime', 'capi', 'libonnxruntime.1.24.4.dylib'),
  ]
  for (const candidate of exactCandidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  const searchRoots = [
    join(homedir(), '.cache', 'uv', 'archive-v0'),
    join(homedir(), '.cradle', 'chronicle', 'models'),
    modelsRoot,
  ]
  for (const root of searchRoots) {
    const found = findOrtDylibInTree(root, 6)
    if (found) {
      return found
    }
  }
  return null
}

function findOrtDylibInTree(root: string, depth: number): string | null {
  if (depth < 0 || !existsSync(root)) {
    return null
  }
  let entries: string[]
  try {
    entries = readdirSync(root)
  }
 catch {
    return null
  }

  for (const entry of entries) {
    const path = join(root, entry)
    let isDirectory = false
    try {
      const stats = statSync(path)
      isDirectory = stats.isDirectory()
    }
 catch {
      continue
    }

    if (!isDirectory && /^libonnxruntime(?:\.[\d.]+)?\.dylib$/.test(entry)) {
      return path
    }
    if (isDirectory) {
      const found = findOrtDylibInTree(path, depth - 1)
      if (found) {
        return found
      }
    }
  }
  return null
}

export function isRunning(): boolean {
  return chronicleProcess !== null && chronicleProcess.exitCode === null
}

function getRunningDaemonOptions(): ChronicleDaemonOptions {
  if (!currentOptions) {
    throw new Error('Chronicle daemon is running without launch options.')
  }
  return currentOptions
}

export function getDaemonInfo() {
  const running = isRunning()
  const options = running ? getRunningDaemonOptions() : null
  let available = true
  let availabilityError: string | null = null
  try {
    findChronicleBinary()
  }
 catch (error) {
    available = false
    availabilityError = error instanceof Error ? error.message : String(error)
  }
  return {
    available,
    running,
    pid: chronicleProcess?.pid ?? null,
    lastExitCode,
    lastExitAt,
    audioCaptureEnabled: options ? options.audioCaptureEnabled : false,
    audioCaptureMode: options ? options.audioCaptureMode : 'meeting',
    audioSource: options ? options.audioSource : 'microphone',
    restartPending: pendingRestartOptions !== null,
    runtimeError: lastRuntimeError ?? availabilityError,
  }
}

export function getDaemonResources(): {
  running: boolean
  pid: number | null
  rssMB: number | null
  cpuPercent: number | null
} {
  const pid = chronicleProcess ? readManagedProcessPid(chronicleProcess) : null
  if (!isRunning() || !pid) {
    return { running: false, pid: null, rssMB: null, cpuPercent: null }
  }

  try {
    const output = execSync(`ps -o rss=,pcpu= -p ${pid}`, { encoding: 'utf8', timeout: 1000 })
    const resources = ProcessResourcesTextSchema.parse(output)
    return {
      running: true,
      pid,
      rssMB: Math.round(resources.rssMB * 100) / 100,
      cpuPercent: Math.round(resources.cpuPercent * 100) / 100,
    }
  }
 catch {
    return { running: true, pid, rssMB: null, cpuPercent: null }
  }
}

export function startDaemon(options: ChronicleDaemonOptions): boolean {
  if (isRunning()) {
    return true
  }

  try {
    const binary = findChronicleBinary()
    const cradleUrl = process.env.CRADLE_URL ?? buildServerUrl()
    const args = createDaemonArgs(options)
    lastRuntimeError = null
    chronicleProcess = spawnManagedProcess({
      kind: 'spawn',
      command: binary,
      args,
      env: buildChronicleEnv({
        CRADLE_URL: cradleUrl,
        CRADLE_CHRONICLE_AUDIO_CAPTURE: options.audioCaptureEnabled ? '1' : '0',
        CRADLE_CHRONICLE_AUDIO_CAPTURE_MODE: options.audioCaptureMode,
        CRADLE_CHRONICLE_AUDIO_SOURCE: options.audioSource,
      }),
      stdin: 'ignore',
      shutdownGraceMs: 5_000,
    })

    chronicleProcess.on('exit', (code) => {
      lastExitCode = code
      lastExitAt = Date.now()
      chronicleProcess = null
      currentOptions = null
      if (pendingRestartOptions) {
        const nextOptions = pendingRestartOptions
        pendingRestartOptions = null
        startDaemon(nextOptions)
      }
    })

    chronicleProcess.on('message', (message) => {
      const result = ManagedProcessErrorMessageSchema.safeParse(message)
      if (result.success) {
        lastRuntimeError = result.data.message
      }
    })

    chronicleProcess.on('error', (err) => {
      console.error('[chronicle-daemon] spawn error:', err.message)
      chronicleProcess = null
      currentOptions = null
    })

    chronicleProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[chronicle-daemon]', data.toString().trimEnd())
    })

    currentOptions = options
    return true
  }
 catch (err) {
    lastRuntimeError = err instanceof Error ? err.message : String(err)
    console.error('[chronicle-daemon] failed to spawn:', err)
    return false
  }
}

export function restartDaemon(options: ChronicleDaemonOptions): boolean {
  if (!isRunning()) {
    return startDaemon(options)
  }
  pendingRestartOptions = options
  void stopCurrentDaemon()
  return true
}

export function stopDaemon(): Promise<void> {
  pendingRestartOptions = null
  return stopCurrentDaemon()
}

async function stopCurrentDaemon(): Promise<void> {
  const child = chronicleProcess
  if (!child) {
    return
  }
  await child.stop('SIGTERM')
}

export async function cleanup(): Promise<void> {
  await Promise.all([stopDaemon(), resetEmbeddingWorker()])
}

export async function resetEmbeddingWorker(): Promise<void> {
  const worker = embeddingWorker
  embeddingWorker = null
  await worker?.stop()
}

function readManagedProcessPid(child: ManagedChildProcess): number | null {
  return child.targetPid ?? child.pid ?? null
}

function buildServerUrl(): string {
  const config = getServerConfig()
  const host
    = config.host.includes(':') && !config.host.startsWith('[') ? `[${config.host}]` : config.host
  return `http://${host}:${config.port}`
}
