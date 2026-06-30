import type { GitFileStatusKind, GitFileStatusView } from '../git/service'
import { shortHash } from './utils'

interface FileSummary {
  path: string
  previousPath: string | null
  status: GitFileStatusKind
  additions: number
  deletions: number
  isBinary: boolean
}

export interface ParsedPatchLine {
  path: string
  side: 'base' | 'head'
  lineNumber: number
  text: string
  hunkHeader: string
  lineHash: string
  contextBeforeHash?: string
  contextAfterHash?: string
}

function contextHash(lines: ParsedPatchLine[]): string | undefined {
  if (lines.length === 0) {
    return undefined
  }
  return shortHash(lines.map(line => line.text).join('\n'))
}

function inferStatus(
  path: string,
  previousPath: string | null,
  statusByPath: Map<string, GitFileStatusKind>,
): GitFileStatusKind {
  const direct = statusByPath.get(path)
  if (direct) {
    return direct
  }
  if (previousPath) {
    const previous = statusByPath.get(previousPath)
    if (previous) {
      return previous
    }
  }
  if (previousPath && previousPath !== path) {
    return 'renamed'
  }
  return 'modified'
}

function parseDiffHeader(line: string): { previousPath: string | null, path: string } | null {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
  if (!match) {
    return null
  }
  const previousPath = match[1] ?? null
  const path = match[2] ?? match[1]!
  return { previousPath: previousPath === path ? null : previousPath, path }
}

function statusFromPatchMetadata(
  current: FileSummary,
  line: string,
): boolean {
  if (line.startsWith('new file mode ')) {
    if (current.status === 'modified') {
      current.status = 'added'
    }
    return true
  }
  if (line.startsWith('deleted file mode ')) {
    if (current.status === 'modified') {
      current.status = 'deleted'
    }
    return true
  }
  return false
}

export function parsePatchFileSummaries(
  patch: string,
  statusFiles: GitFileStatusView[],
): FileSummary[] {
  const statusByPath = new Map(statusFiles.map(file => [file.path, file.status]))
  const files: FileSummary[] = []
  let current: FileSummary | null = null

  function flush() {
    if (current) {
      files.push(current)
      current = null
    }
  }

  for (const line of patch.split('\n')) {
    const header = parseDiffHeader(line)
    if (header) {
      flush()
      current = {
        path: header.path,
        previousPath: header.previousPath,
        status: inferStatus(header.path, header.previousPath, statusByPath),
        additions: 0,
        deletions: 0,
        isBinary: false,
      }
      continue
    }

    if (!current) {
      continue
    }

    if (statusFromPatchMetadata(current, line)) {
      continue
    }
    if (line.startsWith('rename from ')) {
      current.previousPath = line.slice('rename from '.length)
      current.status = 'renamed'
      continue
    }
    if (line.startsWith('rename to ')) {
      current.path = line.slice('rename to '.length)
      current.status = 'renamed'
      continue
    }
    if (line === 'Binary files differ' || line.startsWith('Binary files ')) {
      current.isBinary = true
      continue
    }
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      continue
    }
    if (line.startsWith('+')) {
      current.additions++
      continue
    }
    if (line.startsWith('-')) {
      current.deletions++
    }
  }
  flush()

  if (files.length > 0) {
    return files
  }

  return statusFiles.map(file => ({
    path: file.path,
    previousPath: null,
    status: file.status,
    additions: 0,
    deletions: 0,
    isBinary: false,
  }))
}

function parseHunkHeader(line: string): { oldLine: number, newLine: number } | null {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
  if (!match) {
    return null
  }
  return {
    oldLine: Number(match[1]),
    newLine: Number(match[2]),
  }
}

export function parsePatchLines(patch: string): ParsedPatchLine[] {
  const lines: ParsedPatchLine[] = []
  let currentPath: string | null = null
  let currentHunkHeader = ''
  let oldLine = 0
  let newLine = 0

  function appendLine(side: 'base' | 'head', lineNumber: number, text: string) {
    if (!currentPath || !currentHunkHeader) {
      return
    }
    lines.push({
      path: currentPath,
      side,
      lineNumber,
      text,
      hunkHeader: currentHunkHeader,
      lineHash: shortHash(`${side}:${text}`),
    })
  }

  for (const line of patch.split('\n')) {
    const header = parseDiffHeader(line)
    if (header) {
      currentPath = header.path
      currentHunkHeader = ''
      oldLine = 0
      newLine = 0
      continue
    }

    if (!currentPath) {
      continue
    }

    if (line.startsWith('rename to ')) {
      currentPath = line.slice('rename to '.length)
      continue
    }

    const hunk = parseHunkHeader(line)
    if (hunk) {
      currentHunkHeader = line
      oldLine = hunk.oldLine
      newLine = hunk.newLine
      continue
    }

    if (!currentHunkHeader || line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('\\')) {
      continue
    }

    if (line.startsWith('+')) {
      appendLine('head', newLine, line.slice(1))
      newLine++
      continue
    }
    if (line.startsWith('-')) {
      appendLine('base', oldLine, line.slice(1))
      oldLine++
      continue
    }
    if (line.startsWith(' ')) {
      const text = line.slice(1)
      appendLine('base', oldLine, text)
      appendLine('head', newLine, text)
      oldLine++
      newLine++
    }
  }

  return lines.map((line, index) => {
    const sameFileSideBefore = lines
      .slice(Math.max(0, index - 3), index)
      .filter(candidate => candidate.path === line.path && candidate.side === line.side)
    const sameFileSideAfter = lines
      .slice(index + 1, index + 4)
      .filter(candidate => candidate.path === line.path && candidate.side === line.side)
    return {
      ...line,
      contextBeforeHash: contextHash(sameFileSideBefore),
      contextAfterHash: contextHash(sameFileSideAfter),
    }
  })
}

function normalizeReviewPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\/+/, '').toLowerCase()
}

export function isGeneratedReviewPath(path: string): boolean {
  const normalized = normalizeReviewPath(path)
  const segments = normalized.split('/').filter(Boolean)
  const basename = segments.at(-1) ?? normalized

  if (
    segments.includes('api-gen')
    || segments.includes('generated')
    || segments.includes('__generated__')
    || segments.includes('dist')
    || segments.includes('coverage')
    || segments.includes('node_modules')
    || segments.includes('drizzle')
  ) {
    return true
  }

  return basename.endsWith('.gen.ts')
    || basename.endsWith('.gen.tsx')
    || basename.endsWith('.generated.ts')
    || basename.endsWith('.generated.tsx')
    || basename.endsWith('.pb.go')
    || basename.endsWith('.pb.ts')
    || basename.endsWith('.snap')
    || basename === 'pnpm-lock.yaml'
    || basename === 'package-lock.json'
    || basename === 'yarn.lock'
    || basename === 'bun.lockb'
}

export function isGeneratedReviewFile(file: { path: string, previousPath: string | null }): boolean {
  return isGeneratedReviewPath(file.path)
    || (file.previousPath !== null && isGeneratedReviewPath(file.previousPath))
}
