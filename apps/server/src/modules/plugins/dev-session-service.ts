import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import type { PluginLayer, PluginManifest } from '@cradle/plugin-sdk'
import { parseCradlePluginPackageJsonText } from '@cradle/plugin-sdk/manifest'

import { AppError } from '../../errors/app-error'
import { openSseEventStream } from '../../infra/sse-event-stream'
import {
  activateDevelopmentPlugin,
  deactivateDevelopmentPlugin,
  reloadDevelopmentPluginServerLayer,
} from '../../plugins/loader'

const SESSION_TIMEOUT_MS = 45_000
const SWEEP_INTERVAL_MS = 10_000

export interface PluginDevSessionEntries {
  server: string | null
  web: string | null
  desktop: string | null
}

export interface PluginDevSessionRevisions {
  server: number
  web: number
  desktop: number
}

export interface PluginDevSessionView {
  id: string
  pluginName: string
  routeSegment: string
  displayName: string
  packageDir: string
  entries: PluginDevSessionEntries
  revisions: PluginDevSessionRevisions
  createdAt: number
  updatedAt: number
}

export interface PluginDevSessionEvent {
  type: 'started' | 'reloaded' | 'stopped'
  layer: PluginLayer | null
  session: PluginDevSessionView
}

interface PluginDevSession extends PluginDevSessionView {
  lastHeartbeatAt: number
}

type EventListener = (event: PluginDevSessionEvent) => void

function isPathWithin(path: string, parent: string): boolean {
  const childPath = relative(parent, path)
  return childPath === '' || (!childPath.startsWith('..') && !isAbsolute(childPath))
}

async function requireFile(packageDir: string, entry: string | null, layer: PluginLayer): Promise<string | null> {
  if (!entry) { return null }
  const entryPath = resolve(packageDir, entry)
  if (!isPathWithin(entryPath, packageDir)) {
    throw new AppError({
      code: 'plugin_dev_entry_invalid',
      status: 400,
      message: `Development ${layer} entry must stay within the plugin package.`,
    })
  }
  const info = await stat(entryPath).catch(() => null)
  if (!info?.isFile()) {
    throw new AppError({
      code: 'plugin_dev_entry_missing',
      status: 400,
      message: `Development ${layer} entry does not exist: ${entry}`,
    })
  }
  return entry
}

function toView(session: PluginDevSession): PluginDevSessionView {
  const { lastHeartbeatAt: _lastHeartbeatAt, ...view } = session
  return view
}

export class PluginDevSessionService {
  private readonly sessions = new Map<string, PluginDevSession>()
  private readonly listeners = new Set<EventListener>()
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  async create(input: {
    packageDir: string
    entries: Partial<Record<PluginLayer, string>>
  }): Promise<PluginDevSessionView> {
    await this.sweepExpired()
    if (!isAbsolute(input.packageDir)) {
      throw new AppError({
        code: 'plugin_dev_package_dir_invalid',
        status: 400,
        message: 'Plugin development packageDir must be an absolute path.',
      })
    }

    const packageDir = resolve(input.packageDir)
    const packageInfo = await stat(packageDir).catch(() => null)
    if (!packageInfo?.isDirectory()) {
      throw new AppError({
        code: 'plugin_dev_package_missing',
        status: 400,
        message: 'Plugin development package directory does not exist.',
      })
    }

    const parsed = parseCradlePluginPackageJsonText(await readFile(resolve(packageDir, 'package.json'), 'utf8'))
    if ([...this.sessions.values()].some(session => session.pluginName === parsed.name)) {
      throw new AppError({
        code: 'plugin_dev_session_conflict',
        status: 409,
        message: `A development session is already active for ${parsed.name}.`,
      })
    }

    const entries: PluginDevSessionEntries = {
      server: await requireFile(packageDir, input.entries.server ?? null, 'server'),
      web: await requireFile(packageDir, input.entries.web ?? null, 'web'),
      desktop: await requireFile(packageDir, input.entries.desktop ?? null, 'desktop'),
    }
    if (!entries.server && !entries.web && !entries.desktop) {
      throw new AppError({
        code: 'plugin_dev_entries_empty',
        status: 400,
        message: 'At least one built development entry is required.',
      })
    }

    const manifest: PluginManifest = {
      name: parsed.name,
      version: parsed.version,
      packageDir,
      cradle: {
        ...parsed.cradle,
        server: entries.server ?? undefined,
        web: entries.web ?? undefined,
        desktop: entries.desktop ?? undefined,
      },
    }
    const now = Date.now()
    const revisions: PluginDevSessionRevisions = {
      server: entries.server ? 1 : 0,
      web: entries.web ? 1 : 0,
      desktop: entries.desktop ? 1 : 0,
    }
    const descriptor = await activateDevelopmentPlugin(manifest, revisions.server)
    const session: PluginDevSession = {
      id: randomUUID(),
      pluginName: parsed.name,
      routeSegment: descriptor.routeSegment,
      displayName: descriptor.displayName,
      packageDir,
      entries,
      revisions,
      createdAt: now,
      updatedAt: now,
      lastHeartbeatAt: now,
    }
    this.sessions.set(session.id, session)
    this.ensureSweepTimer()
    const view = toView(session)
    this.publish({ type: 'started', layer: null, session: view })
    return view
  }

  list(): PluginDevSessionView[] {
    return Array.from(this.sessions.values(), toView)
  }

  async reload(sessionId: string, layer: PluginLayer): Promise<PluginDevSessionView> {
    await this.sweepExpired()
    const session = this.requireSession(sessionId)
    if (!session.entries[layer]) {
      throw new AppError({
        code: 'plugin_dev_layer_missing',
        status: 400,
        message: `Plugin development session does not contain a ${layer} layer.`,
      })
    }
    session.revisions[layer] += 1
    session.updatedAt = Date.now()
    session.lastHeartbeatAt = session.updatedAt
    if (layer === 'server') {
      await reloadDevelopmentPluginServerLayer(session.pluginName, session.revisions.server)
    }
    const view = toView(session)
    this.publish({ type: 'reloaded', layer, session: view })
    return view
  }

  heartbeat(sessionId: string): PluginDevSessionView {
    const session = this.requireSession(sessionId)
    session.lastHeartbeatAt = Date.now()
    return toView(session)
  }

  async remove(sessionId: string): Promise<{ removed: true }> {
    const session = this.sessions.get(sessionId)
    if (!session) { return { removed: true } }
    this.sessions.delete(sessionId)
    await deactivateDevelopmentPlugin(session.pluginName)
    this.publish({ type: 'stopped', layer: null, session: toView(session) })
    this.stopSweepTimerIfIdle()
    return { removed: true }
  }

  async shutdown(): Promise<void> {
    for (const sessionId of [...this.sessions.keys()]) {
      await this.remove(sessionId)
    }
    this.stopSweepTimer()
  }

  stream(signal: AbortSignal): ReadableStream<Uint8Array> {
    return openSseEventStream({
      signal,
      source: {
        subscribe: (listener) => {
          this.listeners.add(listener)
          return () => {
            this.listeners.delete(listener)
          }
        },
      },
    })
  }

  private requireSession(sessionId: string): PluginDevSession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new AppError({
        code: 'plugin_dev_session_not_found',
        status: 404,
        message: 'Plugin development session was not found.',
      })
    }
    return session
  }

  private publish(event: PluginDevSessionEvent): void {
    for (const listener of this.listeners) { listener(event) }
  }

  private ensureSweepTimer(): void {
    if (this.sweepTimer) { return }
    this.sweepTimer = setInterval(() => void this.sweepExpired(), SWEEP_INTERVAL_MS)
    this.sweepTimer.unref?.()
  }

  private stopSweepTimerIfIdle(): void {
    if (this.sessions.size === 0) { this.stopSweepTimer() }
  }

  private stopSweepTimer(): void {
    if (!this.sweepTimer) { return }
    clearInterval(this.sweepTimer)
    this.sweepTimer = null
  }

  private async sweepExpired(): Promise<void> {
    const expiresBefore = Date.now() - SESSION_TIMEOUT_MS
    for (const session of [...this.sessions.values()]) {
      if (session.lastHeartbeatAt < expiresBefore) {
        await this.remove(session.id)
      }
    }
  }
}

export const pluginDevSessions = new PluginDevSessionService()
