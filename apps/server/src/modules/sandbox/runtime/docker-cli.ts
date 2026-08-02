import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { promisify } from 'node:util'

import { SANDBOX_LABEL_MARK } from '../labels'
import type {
  SandboxCreateRequest,
  SandboxEngineContainer,
  SandboxExecRequest,
  SandboxExecResult,
  SandboxRuntime,
} from './types'

const execFileAsync = promisify(execFile)

const DEFAULT_IDLE_COMMAND = ['sleep', 'infinity']
const LIST_FORMAT = '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Labels}}'

/**
 * Docker Engine / OrbStack adapter via the `docker` CLI.
 * OrbStack exposes a Docker-compatible engine and CLI.
 */
export class DockerCliSandboxRuntime implements SandboxRuntime {
  readonly kind = 'docker-cli' as const

  constructor(private readonly dockerBin = process.env.CRADLE_SANDBOX_DOCKER_BIN || 'docker') {}

  async ping(): Promise<boolean> {
    try {
      await this.run(['info', '--format', '{{.ServerVersion}}'], 8_000)
      return true
    }
    catch {
      return false
    }
  }

  async pullImage(image: string): Promise<void> {
    await this.run(['pull', image], 10 * 60_000)
  }

  async create(request: SandboxCreateRequest): Promise<SandboxEngineContainer> {
    const args = ['create', '--name', request.name, '--workdir', request.workdir]

    if (request.networkMode === 'none') {
      args.push('--network', 'none')
    }
    else if (request.networkMode === 'bridge') {
      args.push('--network', 'bridge')
    }

    if (request.memoryMb && request.memoryMb > 0) {
      args.push('--memory', `${request.memoryMb}m`)
    }
    if (request.cpuLimit && request.cpuLimit > 0) {
      args.push('--cpus', String(request.cpuLimit))
    }

    // Never mount the host Docker socket into a sandbox.
    for (const mount of request.mounts) {
      args.push(
        '--mount',
        `type=bind,source=${mount.hostPath},target=${mount.containerPath}${mount.readOnly ? ',readonly' : ''}`,
      )
    }

    for (const [key, value] of Object.entries(request.env)) {
      args.push('--env', `${key}=${value}`)
    }
    for (const [key, value] of Object.entries(request.labels)) {
      args.push('--label', `${key}=${value}`)
    }

    args.push(request.image, ...(request.command ?? DEFAULT_IDLE_COMMAND))
    const { stdout } = await this.run(args, 120_000)
    const id = stdout.trim()
    const inspected = await this.inspect(id)
    if (!inspected) {
      throw new Error(`docker create succeeded but inspect failed for ${id}`)
    }
    return inspected
  }

  async start(containerId: string): Promise<void> {
    await this.run(['start', containerId], 60_000)
  }

  async stop(containerId: string, timeoutSec = 5): Promise<void> {
    try {
      await this.run(['stop', '-t', String(timeoutSec), containerId], 60_000)
    }
    catch {
      // Already stopped / missing — reconcile treats as gone.
    }
  }

  async remove(containerId: string, force = true): Promise<void> {
    try {
      const args = force ? ['rm', '-f', containerId] : ['rm', containerId]
      await this.run(args, 60_000)
    }
    catch {
      // Missing container is fine during reconcile/release.
    }
  }

  async exec(request: SandboxExecRequest): Promise<SandboxExecResult> {
    const args = ['exec']
    if (request.workdir) {
      args.push('--workdir', request.workdir)
    }
    for (const [key, value] of Object.entries(request.env ?? {})) {
      args.push('--env', `${key}=${value}`)
    }
    args.push(request.containerId, ...request.command)

    try {
      const { stdout, stderr } = await this.run(args, request.timeoutMs)
      return {
        exitCode: 0,
        stdout,
        stderr,
        timedOut: false,
      }
    }
    catch (error) {
      const failure = asExecFailure(error)
      if (failure.timedOut) {
        return {
          exitCode: 124,
          stdout: failure.stdout,
          stderr: failure.stderr || 'sandbox exec timed out',
          timedOut: true,
        }
      }
      return {
        exitCode: failure.exitCode ?? 1,
        stdout: failure.stdout,
        stderr: failure.stderr || failure.message,
        timedOut: false,
      }
    }
  }

  async inspect(containerId: string): Promise<SandboxEngineContainer | null> {
    try {
      const { stdout } = await this.run(
        [
          'inspect',
          '--format',
          '{{.Id}}\t{{.Name}}\t{{.Config.Image}}\t{{.State.Status}}\t{{json .Config.Labels}}',
          containerId,
        ],
        15_000,
      )
      return parseInspectLine(stdout.trim())
    }
    catch {
      return null
    }
  }

  async listLabeled(labelEquals: Record<string, string>): Promise<SandboxEngineContainer[]> {
    const filters = Object.entries(labelEquals).flatMap(([key, value]) => [
      '--filter',
      `label=${key}=${value}`,
    ])
    if (!Object.hasOwn(labelEquals, SANDBOX_LABEL_MARK)) {
      filters.push('--filter', `label=${SANDBOX_LABEL_MARK}=1`)
    }
    const { stdout } = await this.run(['ps', '-a', '--format', LIST_FORMAT, ...filters], 30_000)
    return stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(parseListLine)
      .filter((item): item is SandboxEngineContainer => item !== null)
  }

  private async run(args: string[], timeoutMs: number): Promise<{ stdout: string, stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync(this.dockerBin, args, {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
      })
      return {
        stdout: typeof stdout === 'string' ? stdout : String(stdout),
        stderr: typeof stderr === 'string' ? stderr : String(stderr),
      }
    }
    catch (error) {
      throw enrichDockerError(error, args)
    }
  }
}

export async function detectDockerSocketPath(): Promise<string | null> {
  const candidates = [
    process.env.DOCKER_HOST?.replace(/^unix:\/\//, '') ?? null,
    `${process.env.HOME ?? ''}/.orbstack/run/docker.sock`,
    '/var/run/docker.sock',
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    }
    catch {
      // try next
    }
  }
  return null
}

function parseListLine(line: string): SandboxEngineContainer | null {
  const parts = line.split('\t')
  if (parts.length < 5) {
    return null
  }
  const [id, name, image, state, labelsRaw] = parts
  return {
    id,
    name: name.replace(/^\//, ''),
    image,
    state: normalizeState(state),
    labels: parseLabels(labelsRaw),
  }
}

function parseInspectLine(line: string): SandboxEngineContainer | null {
  const parts = line.split('\t')
  if (parts.length < 5) {
    return null
  }
  const [id, name, image, state, labelsJson] = parts
  let labels: Record<string, string> = {}
  try {
    labels = JSON.parse(labelsJson) as Record<string, string>
  }
  catch {
    labels = parseLabels(labelsJson)
  }
  return {
    id,
    name: name.replace(/^\//, ''),
    image,
    state: normalizeState(state),
    labels: labels ?? {},
  }
}

function parseLabels(raw: string): Record<string, string> {
  if (!raw || raw === '<no value>') {
    return {}
  }
  const labels: Record<string, string> = {}
  for (const part of raw.split(',')) {
    const index = part.indexOf('=')
    if (index <= 0) {
      continue
    }
    labels[part.slice(0, index)] = part.slice(index + 1)
  }
  return labels
}

function normalizeState(state: string): SandboxEngineContainer['state'] {
  switch (state) {
    case 'created':
    case 'running':
    case 'exited':
    case 'dead':
      return state
    default:
      return 'unknown'
  }
}

function asExecFailure(error: unknown): {
  message: string
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
} {
  if (!error || typeof error !== 'object') {
    return {
      message: String(error),
      stdout: '',
      stderr: '',
      exitCode: 1,
      timedOut: false,
    }
  }
  const record = error as {
    message?: string
    stdout?: string | Buffer
    stderr?: string | Buffer
    code?: number | string
    killed?: boolean
    signal?: string
  }
  const stdout = typeof record.stdout === 'string' ? record.stdout : record.stdout ? String(record.stdout) : ''
  const stderr = typeof record.stderr === 'string' ? record.stderr : record.stderr ? String(record.stderr) : ''
  const timedOut = record.killed === true || record.signal === 'SIGTERM'
  const exitCode = typeof record.code === 'number' ? record.code : null
  return {
    message: record.message ?? 'docker exec failed',
    stdout,
    stderr,
    exitCode,
    timedOut,
  }
}

function enrichDockerError(error: unknown, args: string[]): Error {
  const failure = asExecFailure(error)
  const detail = failure.stderr.trim() || failure.message
  return new Error(`docker ${args.join(' ')} failed: ${detail}`)
}
