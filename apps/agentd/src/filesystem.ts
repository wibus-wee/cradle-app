import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

import { access, lstat, readFile, readdir } from 'node:fs/promises'
import type {
  FsListDirectoryParams,
  FsListDirectoryResult,
  FsReadFileParams,
  FsReadFileResult,
  FsStatParams,
  FsStatResult,
  GitProbeRepositoryParams,
  GitProbeRepositoryResult,
  RemoteFsEntry,
  RemoteFsEntryKind,
} from '@cradle/remote-agent-protocol'

const execFileAsync = promisify(execFile)

export async function listDirectory(rawParams: unknown): Promise<FsListDirectoryResult> {
  const params = rawParams as FsListDirectoryParams
  const directoryPath = resolveRemotePath(params.path)
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const resolvedEntries = await Promise.all(entries.map(async (entry): Promise<RemoteFsEntry> => {
    const entryPath = resolve(directoryPath, entry.name)
    const stats = await lstat(entryPath)
    return {
      name: entry.name,
      path: entryPath,
      kind: entryKind(stats),
      size: stats.isFile() ? stats.size : null,
      modifiedAt: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null,
      hidden: entry.name.startsWith('.'),
    }
  }))

  return {
    path: directoryPath,
    parentPath: dirname(directoryPath) === directoryPath ? null : dirname(directoryPath),
    entries: resolvedEntries.sort(compareEntries),
  }
}

export async function statPath(rawParams: unknown): Promise<FsStatResult> {
  const params = rawParams as FsStatParams
  if (!params.path?.trim()) {
    throw new Error('path is required')
  }

  const path = resolveRemotePath(params.path)
  const stats = await lstat(path)
  return {
    path,
    name: basename(path),
    kind: entryKind(stats),
    size: stats.isFile() ? stats.size : null,
    modifiedAt: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null,
    hidden: basename(path).startsWith('.'),
  }
}

export async function readTextFile(rawParams: unknown): Promise<FsReadFileResult> {
  const params = rawParams as FsReadFileParams
  if (!params.path?.trim()) {
    throw new Error('path is required')
  }

  const path = resolveRemotePath(params.path)
  return { content: await readFile(path, 'utf8') }
}

export async function probeRepository(rawParams: unknown): Promise<GitProbeRepositoryResult> {
  const params = rawParams as GitProbeRepositoryParams
  if (!params.path?.trim()) {
    throw new Error('path is required')
  }

  const path = resolveRemotePath(params.path)
  if (!await pathExists(path)) {
    return { path, isRepository: false, rootPath: null, branch: null, remoteUrl: null }
  }

  const rootPath = await runGit(path, ['rev-parse', '--show-toplevel'])
  if (!rootPath) {
    return { path, isRepository: false, rootPath: null, branch: null, remoteUrl: null }
  }

  return {
    path,
    isRepository: true,
    rootPath,
    branch: await runGit(rootPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    remoteUrl: await runGit(rootPath, ['config', '--get', 'remote.origin.url']),
  }
}

function resolveRemotePath(input?: string | null): string {
  const trimmed = input?.trim()
  if (!trimmed || trimmed === '~') {
    return homedir()
  }
  if (trimmed.startsWith('~/')) {
    return resolve(homedir(), trimmed.slice(2))
  }
  return resolve(trimmed)
}

function entryKind(stats: { isFile(): boolean, isDirectory(): boolean, isSymbolicLink(): boolean }): RemoteFsEntryKind {
  if (stats.isSymbolicLink()) {
    return 'symlink'
  }
  if (stats.isDirectory()) {
    return 'directory'
  }
  if (stats.isFile()) {
    return 'file'
  }
  return 'other'
}

function compareEntries(a: RemoteFsEntry, b: RemoteFsEntry): number {
  if (a.kind === 'directory' && b.kind !== 'directory') {
    return -1
  }
  if (a.kind !== 'directory' && b.kind === 'directory') {
    return 1
  }
  return a.name.localeCompare(b.name)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

async function runGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: 5_000,
      windowsHide: true,
    })
    const value = stdout.trim()
    return value.length > 0 ? value : null
  }
  catch {
    return null
  }
}
