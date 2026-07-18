import { mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'

import type {
  PluginProcessHandle,
  PluginProcessService,
  PluginProcessSpec,
  PluginProcessView,
} from '@cradle/plugin-sdk/server'

import type { ManagedChildProcess } from '../infra/managed-process'
import { spawnManagedProcess } from '../infra/managed-process'

interface OwnedProcess {
  child: ManagedChildProcess
  owner: string
  view: PluginProcessView
}

const processesByOwner = new Map<string, Map<string, OwnedProcess>>()

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function requireOwnedPath(root: string, candidate: string, label: string): Promise<string> {
  const resolvedRoot = await realpath(root)
  const resolvedCandidate = await realpath(path.resolve(candidate))
  if (!isInside(resolvedRoot, resolvedCandidate)) {
    throw new Error(`Plugin process ${label} must stay inside the plugin data directory.`)
  }
  return resolvedCandidate
}

function ownerProcesses(owner: string): Map<string, OwnedProcess> {
  const existing = processesByOwner.get(owner)
  if (existing) { return existing }
  const created = new Map<string, OwnedProcess>()
  processesByOwner.set(owner, created)
  return created
}

function publicView(entry: OwnedProcess): PluginProcessView {
  return { ...entry.view }
}

function inheritedRuntimeEnv(): Record<string, string> {
  const allowed = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP'] as const
  return Object.fromEntries(allowed.flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
}

async function stopEntry(entry: OwnedProcess): Promise<void> {
  if (entry.child.exitCode !== null || entry.child.signalCode !== null) { return }
  entry.view = { ...entry.view, state: 'stopping' }
  await entry.child.stop()
}

async function spawnOwnedProcess(
  owner: string,
  dataDir: string,
  spec: PluginProcessSpec,
): Promise<PluginProcessHandle> {
  const entries = ownerProcesses(owner)
  if (!spec.id.trim()) { throw new Error('Plugin process id must not be empty.') }
  if (entries.has(spec.id)) { throw new Error(`Plugin process is already registered: ${spec.id}`) }

  await mkdir(dataDir, { recursive: true })
  const command = await requireOwnedPath(dataDir, spec.command, 'command')
  const cwd = await requireOwnedPath(dataDir, spec.cwd ?? dataDir, 'working directory')
  const view: PluginProcessView = {
    id: spec.id,
    displayName: spec.displayName,
    pid: null,
    state: 'starting',
    startedAt: new Date().toISOString(),
  }
  const child = spawnManagedProcess({
    kind: 'spawn',
    command,
    args: [...(spec.args ?? [])],
    cwd,
    inheritEnv: false,
    env: {
      ...inheritedRuntimeEnv(),
      ...spec.env,
    },
  })
  const entry: OwnedProcess = { child, owner, view }
  entries.set(spec.id, entry)

  child.stdout?.resume()
  child.stderr?.resume()
  child.once('exit', () => {
    if (entries.get(spec.id)?.child === child) {
      entries.delete(spec.id)
      if (entries.size === 0) { processesByOwner.delete(owner) }
    }
  })

  await new Promise<void>((resolveStarted, rejectStarted) => {
    const timeout = setTimeout(() => {
      rejectStarted(new Error(`Plugin process did not start in time: ${spec.id}`))
      void child.stop()
    }, 10_000)
    timeout.unref()
    const cleanup = () => {
      clearTimeout(timeout)
      child.off('error', onError)
      child.off('exit', onExit)
      child.off('message', onMessage)
    }
    const onError = (error: Error) => {
      cleanup()
      rejectStarted(error)
    }
    const onExit = () => {
      cleanup()
      rejectStarted(new Error(`Plugin process exited before startup completed: ${spec.id}`))
    }
    const onMessage = (message: unknown) => {
      if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'started') { return }
      cleanup()
      entry.view = {
        ...entry.view,
        pid: typeof child.targetPid === 'number' ? child.targetPid : null,
        state: 'running',
      }
      resolveStarted()
    }
    child.once('error', onError)
    child.once('exit', onExit)
    child.on('message', onMessage)
  })

  return {
    id: spec.id,
    status: () => {
      const current = processesByOwner.get(owner)?.get(spec.id)
      return current ? publicView(current) : null
    },
    stop: async () => {
      const current = processesByOwner.get(owner)?.get(spec.id)
      if (current) { await stopEntry(current) }
    },
  }
}

export function createPluginProcessService(owner: string, dataDir: string): PluginProcessService {
  return {
    spawn: spec => spawnOwnedProcess(owner, dataDir, spec),
    list: () => listPluginProcesses(owner),
    stop: async (id) => {
      const entry = processesByOwner.get(owner)?.get(id)
      if (entry) { await stopEntry(entry) }
    },
    stopAll: () => stopPluginProcesses(owner),
  }
}

export function listPluginProcesses(owner: string): PluginProcessView[] {
  return Array.from(processesByOwner.get(owner)?.values() ?? [], publicView)
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
}

export async function stopPluginProcesses(owner: string): Promise<void> {
  const entries = [...(processesByOwner.get(owner)?.values() ?? [])]
  const results = await Promise.allSettled(entries.map(stopEntry))
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) { throw failure.reason }
}

export async function stopAllPluginProcesses(): Promise<void> {
  const results = await Promise.allSettled(Array.from(processesByOwner.keys(), stopPluginProcesses))
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) { throw failure.reason }
}
