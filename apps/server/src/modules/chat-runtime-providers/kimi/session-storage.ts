import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { resolveKimiProviderHome, resolveKimiRuntimeHome } from './runtime-home'

interface PathMeasurement {
  bytes: number
  fileCount: number
}

export interface KimiProviderStorageHome {
  providerTargetId: string
  home: string
}

export interface KimiSessionStorageCleanupResult extends PathMeasurement {
  sessionCount: number
  indexEntriesRemoved: number
  cacheCleared: boolean
}

export function measureKimiSessionStorage(input: {
  providerTargetId: string
  providerSessionId: string
}): PathMeasurement {
  const providerSessionId = assertSafeSessionId(input.providerSessionId)
  const home = resolveKimiProviderHome(input.providerTargetId)
  const measurements = findSessionPaths(home, providerSessionId).map(measurePath)
  measurements.push(measurePath(eventJournalPath(home, providerSessionId)))
  measurements.push({ bytes: measureIndexEntries(home, new Set([providerSessionId])), fileCount: 0 })
  return addMeasurements(...measurements)
}

export function listKimiProviderStorageHomes(): KimiProviderStorageHome[] {
  const root = join(resolveKimiRuntimeHome(), 'providers')
  if (!isSafeDirectory(root)) {
    return []
  }

  const homes: KimiProviderStorageHome[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue
    }
    try {
      const providerTargetId = decodeURIComponent(entry.name)
      if (encodeURIComponent(providerTargetId) !== entry.name) {
        continue
      }
      const home = resolveKimiProviderHome(providerTargetId)
      if (dirname(home) === resolve(root)) {
        homes.push({ providerTargetId, home })
      }
    }
    catch {
      // Ignore provider directories that do not match Cradle's encoded ownership format.
    }
  }
  return homes
}

export function listKimiStoredSessionIds(providerTargetId: string): Set<string> {
  const home = resolveKimiProviderHome(providerTargetId)
  const ids = new Set<string>()
  collectDirectorySessionIds(home, ids)
  collectEventSessionIds(home, ids)
  collectIndexSessionIds(home, ids)
  return ids
}

export function deleteKimiSessionStorage(input: {
  providerTargetId: string
  providerSessionIds: Iterable<string>
  clearDerivedCache?: boolean
}): KimiSessionStorageCleanupResult {
  const home = resolveKimiProviderHome(input.providerTargetId)
  const sessionIds = new Set(Array.from(input.providerSessionIds, assertSafeSessionId))
  const cachePath = join(home, 'cache', 'query-store')
  const before = addMeasurements(
    ...Array.from(sessionIds, providerSessionId => (
      measureKimiSessionStorage({ providerTargetId: input.providerTargetId, providerSessionId })
    )),
    input.clearDerivedCache ? measurePath(cachePath) : { bytes: 0, fileCount: 0 },
  )

  for (const providerSessionId of sessionIds) {
    for (const path of findSessionPaths(home, providerSessionId)) {
      removeOwnedPath(home, path)
      removeEmptyWorkspaceDirectory(home, dirname(path))
    }
    removeOwnedPath(home, eventJournalPath(home, providerSessionId))
  }

  const indexEntriesRemoved = removeIndexEntries(home, sessionIds)
  const cacheCleared = Boolean(input.clearDerivedCache && existsSync(cachePath))
  if (cacheCleared) {
    removeOwnedPath(home, cachePath)
  }

  return {
    ...before,
    sessionCount: sessionIds.size,
    indexEntriesRemoved,
    cacheCleared,
  }
}

export function deleteKimiUnboundProviderSessionStorage(
  providerTargetId: string,
): KimiSessionStorageCleanupResult {
  const home = resolveKimiProviderHome(providerTargetId)
  const sessionIds = listKimiStoredSessionIds(providerTargetId)
  const before = measureProviderSessionState(home)
  const cleanup = deleteKimiSessionStorage({
    providerTargetId,
    providerSessionIds: sessionIds,
    clearDerivedCache: true,
  })

  removeOwnedPath(home, join(home, 'sessions'))
  removeOwnedPath(home, join(home, 'session_index.jsonl'))
  removeNonGlobalEventJournals(home)
  return { ...cleanup, ...before }
}

function collectDirectorySessionIds(home: string, ids: Set<string>): void {
  const sessionsRoot = join(home, 'sessions')
  if (!isSafeDirectory(sessionsRoot)) {
    return
  }
  for (const workspace of readdirSync(sessionsRoot, { withFileTypes: true })) {
    const workspacePath = join(sessionsRoot, workspace.name)
    if (!workspace.isDirectory() || workspace.isSymbolicLink() || !isOwnedPath(home, workspacePath)) {
      continue
    }
    for (const session of readdirSync(workspacePath, { withFileTypes: true })) {
      if ((session.isDirectory() || session.isSymbolicLink()) && isSafeSessionId(session.name)) {
        ids.add(session.name)
      }
    }
  }
}

function collectEventSessionIds(home: string, ids: Set<string>): void {
  const eventsRoot = join(home, 'server', 'events')
  if (!isSafeDirectory(eventsRoot)) {
    return
  }
  for (const entry of readdirSync(eventsRoot, { withFileTypes: true })) {
    if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.endsWith('.jsonl')) {
      continue
    }
    const sessionId = entry.name.slice(0, -'.jsonl'.length)
    if (sessionId !== '__global__' && isSafeSessionId(sessionId)) {
      ids.add(sessionId)
    }
  }
}

function removeNonGlobalEventJournals(home: string): void {
  const eventsRoot = join(home, 'server', 'events')
  if (!isSafeDirectory(eventsRoot)) {
    return
  }
  for (const entry of readdirSync(eventsRoot, { withFileTypes: true })) {
    if (entry.name !== '__global__.jsonl') {
      removeOwnedPath(home, join(eventsRoot, entry.name))
    }
  }
}

function collectIndexSessionIds(home: string, ids: Set<string>): void {
  for (const line of readIndexLines(home)) {
    const sessionId = readIndexSessionId(line)
    if (sessionId && isSafeSessionId(sessionId)) {
      ids.add(sessionId)
    }
  }
}

function findSessionPaths(home: string, providerSessionId: string): string[] {
  const sessionsRoot = join(home, 'sessions')
  if (!isSafeDirectory(sessionsRoot)) {
    return []
  }
  const paths: string[] = []
  for (const workspace of readdirSync(sessionsRoot, { withFileTypes: true })) {
    const workspacePath = join(sessionsRoot, workspace.name)
    if (!workspace.isDirectory() || workspace.isSymbolicLink() || !isOwnedPath(home, workspacePath)) {
      continue
    }
    const candidate = join(workspacePath, providerSessionId)
    if (existsSync(candidate) && isOwnedPath(home, candidate)) {
      paths.push(candidate)
    }
  }
  return paths
}

function removeIndexEntries(home: string, sessionIds: Set<string>): number {
  const path = join(home, 'session_index.jsonl')
  if (!existsSync(path)) {
    return 0
  }
  const lines = readIndexLines(home)
  const kept: string[] = []
  let removed = 0
  for (const line of lines) {
    const sessionId = readIndexSessionId(line)
    if (sessionId && sessionIds.has(sessionId)) {
      removed += 1
    }
    else {
      kept.push(line)
    }
  }
  if (removed === 0) {
    return 0
  }
  const temporaryPath = `${path}.cradle-tmp`
  writeFileSync(temporaryPath, kept.length > 0 ? `${kept.join('\n')}\n` : '', { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryPath, path)
  return removed
}

function measureIndexEntries(home: string, sessionIds: Set<string>): number {
  let bytes = 0
  for (const line of readIndexLines(home)) {
    const sessionId = readIndexSessionId(line)
    if (sessionId && sessionIds.has(sessionId)) {
      bytes += Buffer.byteLength(line) + 1
    }
  }
  return bytes
}

function readIndexLines(home: string): string[] {
  const path = join(home, 'session_index.jsonl')
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) {
    return []
  }
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)
}

function readIndexSessionId(line: string): string | null {
  try {
    const entry: { sessionId?: string } = JSON.parse(line)
    return typeof entry.sessionId === 'string' ? entry.sessionId : null
  }
  catch {
    return null
  }
}

function eventJournalPath(home: string, providerSessionId: string): string {
  return join(home, 'server', 'events', `${providerSessionId}.jsonl`)
}

function removeEmptyWorkspaceDirectory(home: string, path: string): void {
  if (!isOwnedPath(home, path) || !isSafeDirectory(path) || readdirSync(path).length > 0) {
    return
  }
  rmSync(path, { recursive: false, force: true })
}

function removeOwnedPath(home: string, path: string): void {
  if (!isOwnedPath(home, path)) {
    throw new Error('Kimi storage cleanup escaped the provider home.')
  }
  rmSync(path, { recursive: true, force: true })
}

function isOwnedPath(home: string, path: string): boolean {
  const relativePath = relative(resolve(home), resolve(path))
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

function isSafeDirectory(path: string): boolean {
  if (!existsSync(path)) {
    return false
  }
  const stat = lstatSync(path)
  return stat.isDirectory() && !stat.isSymbolicLink()
}

function assertSafeSessionId(sessionId: string): string {
  if (!isSafeSessionId(sessionId)) {
    throw new Error('Kimi session id is not a safe path segment.')
  }
  return sessionId
}

function isSafeSessionId(sessionId: string): boolean {
  return Boolean(sessionId) && sessionId !== '.' && sessionId !== '..' && basename(sessionId) === sessionId
}

function measurePath(path: string): PathMeasurement {
  if (!existsSync(path)) {
    return { bytes: 0, fileCount: 0 }
  }
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { bytes: stat.size, fileCount: 1 }
  }
  return addMeasurements(...readdirSync(path).map(entry => measurePath(join(path, entry))))
}

function measureProviderSessionState(home: string): PathMeasurement {
  const measurements = [
    measurePath(join(home, 'sessions')),
    measurePath(join(home, 'session_index.jsonl')),
    measurePath(join(home, 'cache', 'query-store')),
  ]
  const eventsRoot = join(home, 'server', 'events')
  if (isSafeDirectory(eventsRoot)) {
    measurements.push(...readdirSync(eventsRoot)
      .filter(entry => entry !== '__global__.jsonl')
      .map(entry => measurePath(join(eventsRoot, entry))))
  }
  return addMeasurements(...measurements)
}

function addMeasurements(...measurements: PathMeasurement[]): PathMeasurement {
  return measurements.reduce<PathMeasurement>((total, item) => ({
    bytes: total.bytes + item.bytes,
    fileCount: total.fileCount + item.fileCount,
  }), { bytes: 0, fileCount: 0 })
}
