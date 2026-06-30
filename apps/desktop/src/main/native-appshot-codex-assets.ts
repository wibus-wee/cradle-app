/*
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CODEX_APP_CAPTURE_TMP_DIR = join(tmpdir(), 'com.openai.sky.CUAService')
export const MAX_CODEX_APP_CAPTURE_BYTES = 25 * 1024 * 1024

export interface CodexAppshotObservedAsset {
  path: string
  relativePath: string
  dataURL: string
  mimeType: 'image/png' | 'image/jpeg'
  size: number
  modifiedAtMs: number
  sha256: string
}

export interface CodexAppshotObserveOptions {
  durationMs?: number
  pollIntervalMs?: number
  baselinePaths?: string[]
  startedAtMs?: number
}

export interface CodexAppshotObserveResult {
  rootPath: string
  startedAtMs: number
  durationMs: number
  assets: CodexAppshotObservedAsset[]
}

interface CodexAppshotAssetCandidate {
  path: string
  relativePath: string
  size: number
  modifiedAtMs: number
}

export function readCodexAppshotFilePath(rawPathOrUrl: string | null | undefined): string | null {
  const value = rawPathOrUrl?.trim()
  if (!value) {
    return null
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') {
      return null
    }
    return fileURLToPath(url)
  }
  catch {
    return isAbsolute(value) ? value : null
  }
}

export function readCodexAppshotMimeType(filePath: string): CodexAppshotObservedAsset['mimeType'] | null {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.png') {
    return 'image/png'
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg'
  }
  return null
}

export async function readCodexAppshotAsset(
  rawPathOrUrl: string | null | undefined,
  rootPath = CODEX_APP_CAPTURE_TMP_DIR,
): Promise<CodexAppshotObservedAsset | null> {
  const filePath = readCodexAppshotFilePath(rawPathOrUrl)
  if (!filePath) {
    return null
  }
  return readCodexAppshotAssetFromPath(filePath, rootPath)
}

export async function readCodexAppshotAssetFromPath(
  filePath: string,
  rootPath = CODEX_APP_CAPTURE_TMP_DIR,
): Promise<CodexAppshotObservedAsset | null> {
  const mimeType = readCodexAppshotMimeType(filePath)
  if (!mimeType) {
    return null
  }

  try {
    const [resolvedAssetPath, resolvedRootPath] = await Promise.all([
      realpath(filePath),
      realpath(rootPath),
    ])
    const relativePath = relative(resolvedRootPath, resolvedAssetPath)
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      return null
    }
    const metadata = await stat(resolvedAssetPath)
    if (!metadata.isFile() || metadata.size > MAX_CODEX_APP_CAPTURE_BYTES) {
      return null
    }
    const data = await readFile(resolvedAssetPath)
    return {
      path: resolvedAssetPath,
      relativePath,
      dataURL: `data:${mimeType};base64,${data.toString('base64')}`,
      mimeType,
      size: metadata.size,
      modifiedAtMs: metadata.mtimeMs,
      sha256: createHash('sha256').update(data).digest('hex'),
    }
  }
  catch {
    return null
  }
}

export async function observeCodexAppshotAssets(
  options: CodexAppshotObserveOptions = {},
  rootPath = CODEX_APP_CAPTURE_TMP_DIR,
): Promise<CodexAppshotObserveResult> {
  const durationMs = Math.max(0, options.durationMs ?? 8_000)
  const pollIntervalMs = Math.max(100, options.pollIntervalMs ?? 250)
  const startedAtMs = options.startedAtMs ?? Date.now()
  const baselinePaths = new Set(options.baselinePaths ?? [])
  const baseline = await readCodexAppshotAssetCandidates(rootPath)
  for (const path of baselinePaths) {
    baseline.set(path, { path, relativePath: path, size: 0, modifiedAtMs: Number.POSITIVE_INFINITY })
  }

  const deadlineMs = Date.now() + durationMs
  let current = baseline
  do {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadlineMs - Date.now())))
    current = await readCodexAppshotAssetCandidates(rootPath)
  } while (Date.now() < deadlineMs)

  const assets: CodexAppshotObservedAsset[] = []
  const candidates = [...current.values()]
    .filter(candidate => isNewOrChangedCodexAsset(candidate, baseline, startedAtMs))
    .sort((left, right) => left.modifiedAtMs - right.modifiedAtMs || left.path.localeCompare(right.path))

  for (const candidate of candidates) {
    const asset = await readCodexAppshotAssetFromPath(candidate.path, rootPath)
    if (asset) {
      assets.push(asset)
    }
  }

  return {
    rootPath: await readRealRootPath(rootPath),
    startedAtMs,
    durationMs,
    assets,
  }
}

async function readCodexAppshotAssetCandidates(rootPath: string): Promise<Map<string, CodexAppshotAssetCandidate>> {
  const candidates = new Map<string, CodexAppshotAssetCandidate>()
  let resolvedRootPath: string
  try {
    resolvedRootPath = await realpath(rootPath)
  }
  catch {
    return candidates
  }

  const files = await listImageFiles(resolvedRootPath)
  await Promise.all(files.map(async (filePath) => {
    try {
      const metadata = await stat(filePath)
      if (!metadata.isFile() || metadata.size > MAX_CODEX_APP_CAPTURE_BYTES) {
        return
      }
      const relativePath = relative(resolvedRootPath, filePath)
      candidates.set(filePath, {
        path: filePath,
        relativePath,
        size: metadata.size,
        modifiedAtMs: metadata.mtimeMs,
      })
    }
    catch {
      // Codex can rotate temp files while the observer is scanning.
    }
  }))
  return candidates
}

async function listImageFiles(rootPath: string): Promise<string[]> {
  const files: string[] = []
  async function visit(directory: string): Promise<void> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    }
    catch {
      return
    }

    await Promise.all(entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
        return
      }
      if (entry.isFile() && readCodexAppshotMimeType(entryPath)) {
        files.push(entryPath)
      }
    }))
  }
  await visit(rootPath)
  return files
}

function isNewOrChangedCodexAsset(
  candidate: CodexAppshotAssetCandidate,
  baseline: Map<string, CodexAppshotAssetCandidate>,
  startedAtMs: number,
): boolean {
  const previous = baseline.get(candidate.path)
  if (previous && previous.modifiedAtMs === candidate.modifiedAtMs && previous.size === candidate.size) {
    return false
  }
  if (!previous && candidate.modifiedAtMs < startedAtMs - 500) {
    return false
  }
  return true
}

async function readRealRootPath(rootPath: string): Promise<string> {
  try {
    return await realpath(rootPath)
  }
  catch {
    return rootPath
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}
